// WhatsApp in sola lettura: firma del webhook, aggancio per numero,
// ingestione idempotente. La chiamata a Meta non è coperta (serve la rete);
// quello che conta è che un payload non firmato non entri mai, e che un
// messaggio finisca sulla commessa giusta.

import { createHmac } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { matchComunicazione } from "./match";
import { normalizzaTelefono, stessoNumero } from "@shared/telefono";
import {
  configWhatsApp,
  ingestisciWebhook,
  verificaFirma,
} from "./whatsapp";
import {
  listComunicazioni,
  _resetComunicazioniInMemoria,
} from "./comunicazioni";

const APP_SECRET = "app-secret-di-test";

function firma(body: string, secret = APP_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("normalizzazione telefono", () => {
  it("riduce le grafie umane alla stessa forma", () => {
    expect(normalizzaTelefono("+39 340 1234567")).toBe("393401234567");
    expect(normalizzaTelefono("340-1234567")).toBe("393401234567");
    expect(normalizzaTelefono("00393401234567")).toBe("393401234567");
    expect(normalizzaTelefono("0187 872687")).toBe("390187872687");
  });

  it("scarta ciò che non è un numero", () => {
    expect(normalizzaTelefono("")).toBeNull();
    expect(normalizzaTelefono("n/d")).toBeNull();
    expect(normalizzaTelefono("123")).toBeNull();
  });

  it("riconosce la stessa utenza scritta in modi diversi", () => {
    expect(stessoNumero("+39 340 1234567", "3401234567")).toBe(true);
    expect(stessoNumero("340 1234567", "340 7654321")).toBe(false);
    expect(stessoNumero(null, "3401234567")).toBe(false);
  });
});

describe("verificaFirma", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');

  it("accetta una firma corretta", () => {
    expect(verificaFirma(body, firma(body.toString()), APP_SECRET)).toBe(true);
  });

  it("rifiuta firma assente, malformata o con secret sbagliato", () => {
    expect(verificaFirma(body, undefined, APP_SECRET)).toBe(false);
    expect(verificaFirma(body, "sha1=abcd", APP_SECRET)).toBe(false);
    expect(verificaFirma(body, "non-una-firma", APP_SECRET)).toBe(false);
    expect(verificaFirma(body, firma(body.toString(), "altro"), APP_SECRET)).toBe(
      false
    );
  });

  it("rifiuta se il corpo è stato alterato dopo la firma", () => {
    const buona = firma(body.toString());
    const alterato = Buffer.from('{"object":"manomesso"}');
    expect(verificaFirma(alterato, buona, APP_SECRET)).toBe(false);
  });
});

describe("match WhatsApp per numero", () => {
  const clienti = [
    { id: 1, nome: "Mario", cognome: "Rossi", telefono: "340 1234567", email: null },
    { id: 2, nome: "Anna", cognome: "Verdi", telefono: "+39 347 9999999", email: null },
  ];
  const commesse = [
    { id: 10, codice: "COM-2026-035", clienteId: 1, stato: "produzione", telefono: null },
    { id: 11, codice: "COM-2026-051", clienteId: 2, stato: "attesa_posa", telefono: "333 1112222" },
    { id: 12, codice: "COM-2026-052", clienteId: 2, stato: "preventivo", telefono: null },
  ];
  const base = { oggetto: "", clienti: clienti as any, commesse: commesse as any, canale: "whatsapp" as const };

  it("numero del cliente con una sola commessa attiva → aggancio pieno", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "393401234567",
      testo: "Buongiorno, a che punto siamo?",
    });
    expect(m.clienteId).toBe(1);
    expect(m.commessaId).toBe(10);
    expect(m.confidenza).toBe("alta");
  });

  it("numero di contatto della commessa vince sull'anagrafica", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "+39 333 111 2222",
      testo: "Il cancello è aperto",
    });
    expect(m.commessaId).toBe(11);
    expect(m.confidenza).toBe("alta");
  });

  it("cliente con più commesse: aggancia il cliente e dichiara l'ambiguità", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "3479999999",
      testo: "novità?",
    });
    expect(m.clienteId).toBe(2);
    expect(m.commessaId).toBeNull();
    expect(m.confidenza).toBe("media");
    expect(m.motivo).toMatch(/COM-2026-051.*COM-2026-052/);
  });

  it("il codice nel testo vince anche su WhatsApp", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "3479999999",
      testo: "per la COM-2026-052 quando montate?",
    });
    expect(m.commessaId).toBe(12);
    expect(m.confidenza).toBe("alta");
  });

  it("numero sconosciuto → nessun aggancio, con motivo", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "391112223333",
      testo: "Salve, vorrei un preventivo",
    });
    expect(m.confidenza).toBe("nessuna");
    expect(m.motivo).toMatch(/non presente in anagrafica/);
  });
});

describe("ingestione webhook", () => {
  beforeAll(() => {
    _resetComunicazioniInMemoria();
    configWhatsApp.length = 0;
    configWhatsApp.push({
      id: 1,
      sedeId: 1,
      nome: "Aziendale",
      numero: "+390187872687",
      phoneNumberId: "PHONE_1",
      wabaId: "WABA_1",
      tokenCifrato: "",
      appSecretCifrato: "",
      verifyToken: "vt",
      attiva: true,
      ultimoMessaggio: null,
      messaggiRicevuti: 0,
      ultimoErrore: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  const payload = (id: string, testo: string) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "PHONE_1" },
              contacts: [{ wa_id: "393401234567", profile: { name: "Mario Rossi" } }],
              messages: [
                {
                  id,
                  from: "393401234567",
                  timestamp: "1786000000",
                  type: "text",
                  text: { body: testo },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  it("registra un messaggio e ignora il duplicato", async () => {
    const n = await ingestisciWebhook(payload("wamid.AAA", "Quando montate?"));
    expect(n).toBe(1);

    const doppio = await ingestisciWebhook(payload("wamid.AAA", "Quando montate?"));
    expect(doppio).toBe(0);

    const rows = await listComunicazioni({ sedeId: 1, canale: "whatsapp" });
    expect(rows).toHaveLength(1);
    expect(rows[0].mittenteNome).toBe("Mario Rossi");
    expect(rows[0].testo).toBe("Quando montate?");
    expect(rows[0].mittente).toBe("393401234567");
  });

  it("ignora un numero non configurato invece di sbagliare sede", async () => {
    const estraneo = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "ALTRO" },
                messages: [
                  { id: "wamid.ZZZ", from: "393000000000", type: "text", text: { body: "ciao" } },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(await ingestisciWebhook(estraneo)).toBe(0);
  });

  it("le ricevute di consegna non creano comunicazioni", async () => {
    const statuses = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PHONE_1" },
                statuses: [{ id: "wamid.AAA", status: "read" }],
              },
            },
          ],
        },
      ],
    };
    expect(await ingestisciWebhook(statuses)).toBe(0);
  });

  it("un messaggio con media lo elenca come allegato scaricabile", async () => {
    const conFoto = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PHONE_1" },
                messages: [
                  {
                    id: "wamid.FOTO",
                    from: "393401234567",
                    type: "image",
                    image: { id: "MEDIA_1", mime_type: "image/jpeg", caption: "il difetto" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(await ingestisciWebhook(conFoto)).toBe(1);
    const rows = await listComunicazioni({ sedeId: 1, canale: "whatsapp" });
    const foto = rows.find((r) => r.messageId === "wamid.FOTO");
    expect(foto?.testo).toBe("il difetto");
    expect(foto?.allegati[0]?.mediaId).toBe("MEDIA_1");
  });
});

// Il flusso Meta impone: webhook verificato PRIMA, numero registrato dopo.
// Una configurazione deve quindi poter esistere col solo verify token —
// ma non deve poter essere accesa finché è incompleta, altrimenti
// rifiuterebbe ogni webhook in silenzio (senza app secret nessuna firma
// può essere verificata).
describe("configurazione parziale", () => {
  function makeCtx(): any {
    return {
      user: {
        id: 1, openId: "local-1", name: "Admin", email: "a@b.it",
        loginMethod: "local", role: "admin", ruolo: "direzione",
        ruoli: ["direzione"], createdAt: new Date(), updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "http", headers: {}, get: () => "localhost:3000" },
      res: {},
      sedeId: 1,
      sediIds: [1],
    };
  }

  beforeAll(() => {
    process.env.MAIL_ENCRYPTION_KEY = "chiave-di-test";
    configWhatsApp.length = 0;
  });

  it("si crea col solo verify token e non è accendibile finché è incompleta", async () => {
    const { appRouter } = await import("../routers");
    const caller = appRouter.createCaller(makeCtx());

    const creata = await caller.mail.whatsapp.create({
      nome: "Aziendale",
      verifyToken: "verify-token-di-prova-lungo",
    });
    expect(creata.phoneNumberId).toBe("");
    expect(creata.attiva).toBe(false);
    expect(creata.tokenConfigurato).toBe(false);

    // L'handshake del webhook funziona già: è ciò che serve su Meta ora.
    const { configPerVerifyToken } = await import("./whatsapp");
    expect(configPerVerifyToken("verify-token-di-prova-lungo")).toBeDefined();

    // Ma accenderla no, e l'errore dice cosa manca.
    await expect(
      caller.mail.whatsapp.update({ id: creata.id, attiva: true })
    ).rejects.toThrow(/Phone number ID.*app secret/s);

    // Completata, si accende.
    await caller.mail.whatsapp.update({
      id: creata.id,
      numero: "+390187872687",
      phoneNumberId: "PHONE_9",
      wabaId: "WABA_9",
      token: "token-lungo-abbastanza",
      appSecret: "app-secret-lungo",
    });
    const accesa = await caller.mail.whatsapp.update({
      id: creata.id,
      attiva: true,
    });
    expect(accesa.attiva).toBe(true);
    // I segreti non escono mai dal server.
    expect(JSON.stringify(accesa)).not.toContain("app-secret-lungo");
    expect(JSON.stringify(accesa)).not.toContain("token-lungo-abbastanza");
  });
});
