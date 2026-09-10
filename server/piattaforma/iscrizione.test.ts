// server/piattaforma/iscrizione.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __impostaPostaPerTest } from "../_core/postaPiattaforma";
import { hashPassword } from "../_core/password";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { crea } from "../tenants/servizio";
import { MESSAGGI_PIATTAFORMA } from "./costanti";
import { iscrizioneDisponibile, registraProva, slugDaNome, slugLibero } from "./iscrizione";
import { __azzeraLimiteIscrizioniPerTest, iscrizioneRouter } from "./iscrizioneRouter";

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
const script = { tipo: "script" as const, nome: "script:tenant@test" };

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  await getTenantRepository().assicuraTenantPredefinito();
  nS = sedi.length;
  nU = utenti.length;
  process.env.RESEND_API_KEY = "re_test";
  __azzeraLimiteIscrizioniPerTest();
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  delete process.env.RESEND_API_KEY;
  delete process.env.FLAG_ISCRIZIONE_PUBBLICA;
  delete process.env.FLAG_MULTI_AZIENDA;
  __impostaPostaPerTest(null);
});

describe("slugDaNome e slugLibero", () => {
  it("normalizza come il client e ripiega su «azienda»", () => {
    expect(slugDaNome("Serramenti Però S.r.l.")).toBe("serramenti-pero-s-r-l");
    expect(slugDaNome("!!!")).toBe("azienda");
  });

  it("evita gli slug presi e quelli già in coda in un crea", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ slug: "acme", nome: "Acme" });
    await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload: { slug: "acme-2" },
      richiestoDa: "script:test",
    });
    expect(await slugLibero("Acme")).toBe("acme-3");
    expect(await slugLibero("Nuova")).toBe("nuova");
  });
});

describe("registraProva", () => {
  it("crea l'azienda in_attesa e manda l'invito, senza far uscire il link", async () => {
    const inviate: any[] = [];
    __impostaPostaPerTest(async m => {
      inviate.push(m);
      return { inviato: true, id: "em_iscr" };
    });
    const esito = await registraProva({
      azienda: "Serramenti Prova",
      nome: "Anna",
      cognome: "Verdi",
      email: "anna@prova.test",
      baseUrl: "https://app.test",
    });
    expect(esito).toEqual({ ok: true });
    const repo = getTenantRepository();
    const tenant = repo.perSlug("serramenti-prova")!;
    expect(tenant.stato).toBe("in_attesa");
    expect(inviate[0].a).toBe("anna@prova.test");
    // Il proprietario esiste ma nessuno conosce la sua password.
    const proprietario = utenti.find((u: any) => u.email === "anna@prova.test");
    expect(proprietario).toBeTruthy();
  });

  it("un'email già in uso non crea nulla e risponde ok lo stesso", async () => {
    await crea(
      {
        slug: "esistente",
        nome: "Esistente",
        sede: { nome: "Esistente" },
        proprietario: { nome: "M", cognome: "R", email: "gia@usata.test", passwordHash: hashPassword("Password-lunga-12") },
      },
      script
    );
    const prima = getTenantRepository().tutti().length;
    const esito = await registraProva({
      azienda: "Doppione",
      nome: "X",
      cognome: "Y",
      email: "GIA@usata.test",
      baseUrl: "https://app.test",
    });
    expect(esito).toEqual({ ok: true });
    expect(getTenantRepository().tutti().length).toBe(prima);
  });

  it("se l'invio dell'invito fallisce lancia: l'azienda resta in_attesa e la pulizia la coprirà", async () => {
    __impostaPostaPerTest(async () => ({ inviato: false, motivo: "rete giù" }));
    await expect(
      registraProva({ azienda: "Sfortunata", nome: "A", cognome: "B", email: "sfortunata@x.test", baseUrl: "https://app.test" })
    ).rejects.toThrow(/invito non inviato/);
    expect(getTenantRepository().perSlug("sfortunata")!.stato).toBe("in_attesa");
  });
});

describe("iscrizioneRouter", () => {
  const ctx = () =>
    ({
      req: { ip: "203.0.113.7", protocol: "https", get: () => "app.test" },
      res: {},
      user: null,
    }) as any;

  it("disponibile riflette flag e posta; registra rifiuta quando è chiusa", async () => {
    const caller = iscrizioneRouter.createCaller(ctx());
    expect((await caller.disponibile()).attiva).toBe(true);
    delete process.env.RESEND_API_KEY;
    expect((await caller.disponibile()).attiva).toBe(false);
    await expect(
      caller.registra({ azienda: "Chiusa", nome: "A", cognome: "B", email: "a@b.test" })
    ).rejects.toMatchObject({ message: MESSAGGI_PIATTAFORMA.iscrizioneNonDisponibile });
    process.env.RESEND_API_KEY = "re_test";
    process.env.FLAG_ISCRIZIONE_PUBBLICA = "off";
    expect(iscrizioneDisponibile()).toBe(false);
  });

  it("l'honeypot pieno risponde ok senza creare nulla; il limite per indirizzo scatta", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "em_h" }));
    const caller = iscrizioneRouter.createCaller(ctx());
    const prima = getTenantRepository().tutti().length;
    await expect(
      caller.registra({ azienda: "Robotica", nome: "A", cognome: "B", email: "bot@x.test", sito: "https://spam" })
    ).resolves.toEqual({ ok: true });
    expect(getTenantRepository().tutti().length).toBe(prima);
    for (let i = 0; i < 4; i++) {
      await caller.registra({ azienda: `Vera ${i}`, nome: "A", cognome: "B", email: `v${i}@x.test` });
    }
    await expect(
      caller.registra({ azienda: "Sesta", nome: "A", cognome: "B", email: "sesta@x.test" })
    ).rejects.toMatchObject({ message: MESSAGGI_PIATTAFORMA.troppiTentativi });
  });
});
