// F1/R19 (fix wave finale): le rotte anonime — handshake e webhook WhatsApp,
// feed ICS — non hanno un utente, quindi nessun tenant nel contesto della
// richiesta, ma leggono store PER TENANT (`whatsapp_app`, `whatsapp_config`,
// `calendar_tokens`). Con l'interruttore acceso e senza contesto quegli
// accessi lanciano, e in un handler `async` di Express 4 il rifiuto
// abbatterebbe il processo: Meta e Google riprovano, e il server entra in un
// ciclo di riavvii.
//
// Qui `modalitaTenantStretta(true)` toglie il ripiego dei test sul tenant 1:
// se un corpo dimenticasse di dichiarare il tenant, il test lo vedrebbe.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { __registraTenantNotoPerTest, storeDi } from "./persistence";
import { encryptSecret } from "./secretBox";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import { getSediStore } from "../routers/sedi";
// Import di effetto: registrano le famiglie di store che le rotte anonime
// leggono. Senza, `__registraTenantNotoPerTest(2)` non avrebbe nulla da
// istanziare per il secondo tenant.
import "../comunicazioni/whatsapp";
import "../routers/calendarSync";
import "../routers/interventi";
import type { AppWhatsApp, ConfigWhatsApp } from "../comunicazioni/whatsapp";
import {
  feedIcsPerToken,
  ingestisciWebhookWhatsApp,
  mittenteWebhookWhatsApp,
  verifyTokenDiQualcheTenant,
} from "./rotteAnonime";

const SEDE_T1 = 10;
const SEDE_T2 = 20;
const SEGRETO_T2 = "app-secret-di-acme";

const app = (id: number, sedeId: number, verifyToken: string): AppWhatsApp => ({
  id,
  sedeId,
  appId: `app-${id}`,
  configId: `cfg-${id}`,
  appSecretCifrato: "",
  verifyToken,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
});

const config = (
  id: number,
  sedeId: number,
  over: Partial<ConfigWhatsApp> = {}
): ConfigWhatsApp => ({
  id,
  sedeId,
  nome: `Numero ${id}`,
  numero: `+39000000000${id}`,
  phoneNumberId: "PN-CONDIVISO",
  wabaId: `waba-${id}`,
  tokenCifrato: "",
  appSecretCifrato: "",
  verifyToken: `verify-${id}`,
  attiva: true,
  ultimoMessaggio: null,
  messaggiRicevuti: 0,
  ultimoErrore: null,
  onboardingAt: null,
  storicoRichiestoAt: null,
  storicoUltimoEventoAt: null,
  storicoProgresso: null,
  storicoCompletatoAt: null,
  storicoSincronizzato: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  ...over,
});

const firmaDi = (raw: Buffer, segreto: string) =>
  `sha256=${createHmac("sha256", segreto).update(raw).digest("hex")}`;

const svuota = (nome: string) => {
  storeDi(1, nome).length = 0;
  storeDi(2, nome).length = 0;
};

const chiavePrima = process.env.MAIL_ENCRYPTION_KEY;

describe("rotte anonime: il tenant si cerca, non si presume", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    process.env.MAIL_ENCRYPTION_KEY = "test-only-encryption-key";
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const tenants = getTenantRepository();
    await tenants.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await tenants.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    __registraTenantNotoPerTest(2);
    getSediStore().length = 0;
    getSediStore().push(
      { id: SEDE_T1, tenantId: 1, nome: "La Spezia", attiva: true } as any,
      { id: SEDE_T2, tenantId: 2, nome: "Acme", attiva: true } as any
    );
    for (const nome of ["whatsapp_app", "whatsapp_config", "calendar_tokens", "interventi"]) {
      svuota(nome);
    }
  });
  afterEach(() => {
    modalitaTenantStretta(false);
    if (chiavePrima === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
    else process.env.MAIL_ENCRYPTION_KEY = chiavePrima;
  });

  describe("handshake del webhook WhatsApp (GET)", () => {
    it("accetta il verify token della SECONDA azienda: l'URL del callback è uno solo", async () => {
      storeDi<AppWhatsApp>(1, "whatsapp_app").push(app(1, SEDE_T1, "verify-rg"));
      storeDi<AppWhatsApp>(2, "whatsapp_app").push(app(2, SEDE_T2, "verify-acme"));
      await expect(verifyTokenDiQualcheTenant("verify-acme")).resolves.toBe(true);
      await expect(verifyTokenDiQualcheTenant("verify-rg")).resolves.toBe(true);
    });

    it("un token sconosciuto (o vuoto) è un no secco, senza lanciare", async () => {
      storeDi<AppWhatsApp>(2, "whatsapp_app").push(app(2, SEDE_T2, "verify-acme"));
      await expect(verifyTokenDiQualcheTenant("sbagliato")).resolves.toBe(false);
      await expect(verifyTokenDiQualcheTenant("")).resolves.toBe(false);
    });
  });

  describe("consegna del webhook WhatsApp (POST)", () => {
    it("la firma dice tenant e sede, e l'ingestione gira in quel contesto", async () => {
      storeDi<ConfigWhatsApp>(1, "whatsapp_config").push(
        config(1, SEDE_T1, { appSecretCifrato: encryptSecret("app-secret-di-rg") })
      );
      storeDi<ConfigWhatsApp>(2, "whatsapp_config").push(
        config(2, SEDE_T2, { appSecretCifrato: encryptSecret(SEGRETO_T2) })
      );

      const raw = Buffer.from(
        JSON.stringify({
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: { metadata: { phone_number_id: "PN-CONDIVISO" }, statuses: [] },
                },
              ],
            },
          ],
        })
      );
      const mittente = await mittenteWebhookWhatsApp(raw, firmaDi(raw, SEGRETO_T2));
      expect(mittente).toEqual({ tenantId: 2, sedeId: SEDE_T2 });

      await ingestisciWebhookWhatsApp(mittente!, JSON.parse(raw.toString("utf8")));

      // Le due aziende hanno lo STESSO phone_number_id: solo l'archivio di
      // chi ha firmato deve essersi mosso.
      expect(storeDi<ConfigWhatsApp>(2, "whatsapp_config")[0].diagnosticaWebhook?.eventiWebhook).toBe(1);
      expect(storeDi<ConfigWhatsApp>(1, "whatsapp_config")[0].diagnosticaWebhook).toBeUndefined();
    });

    it("l'ingestione dichiara il tenant della sede del numero", async () => {
      storeDi<ConfigWhatsApp>(2, "whatsapp_config").push(
        config(2, SEDE_T2, { appSecretCifrato: encryptSecret(SEGRETO_T2) })
      );
      const visto: Array<number | null> = [];
      const raw = Buffer.from(JSON.stringify({ entry: [] }));
      const mittente = await mittenteWebhookWhatsApp(raw, firmaDi(raw, SEGRETO_T2));
      expect(mittente).not.toBeNull();
      await ingestisciWebhookWhatsApp(mittente!, {
        get entry() {
          visto.push(tenantCorrente());
          return [];
        },
      });
      expect(visto).toEqual([2]);
    });

    it("nessuna chiave valida → nessun mittente, e nulla è stato letto", async () => {
      storeDi<ConfigWhatsApp>(2, "whatsapp_config").push(
        config(2, SEDE_T2, { appSecretCifrato: encryptSecret(SEGRETO_T2) })
      );
      const raw = Buffer.from(JSON.stringify({ entry: [] }));
      await expect(
        mittenteWebhookWhatsApp(raw, firmaDi(raw, "chiave-di-un-estraneo"))
      ).resolves.toBeNull();
      await expect(mittenteWebhookWhatsApp(raw, undefined)).resolves.toBeNull();
    });

    it("una configurazione spenta non firma nulla", async () => {
      storeDi<ConfigWhatsApp>(2, "whatsapp_config").push(
        config(2, SEDE_T2, { attiva: false, appSecretCifrato: encryptSecret(SEGRETO_T2) })
      );
      const raw = Buffer.from(JSON.stringify({ entry: [] }));
      await expect(
        mittenteWebhookWhatsApp(raw, firmaDi(raw, SEGRETO_T2))
      ).resolves.toBeNull();
    });
  });

  describe("feed ICS", () => {
    const intervento = (id: number, sedeId: number, note: string) => ({
      id,
      sedeId,
      tipo: "rilievo",
      stato: "pianificato",
      dataPianificata: "2026-09-10",
      oraInizio: "09:00",
      oraFine: "10:00",
      commessaId: null,
      indirizzo: "",
      note,
    });

    beforeEach(() => {
      storeDi(1, "calendar_tokens").push({
        sedeId: SEDE_T1,
        token: "token-rg",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      });
      storeDi(2, "calendar_tokens").push({
        sedeId: SEDE_T2,
        token: "token-acme",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      });
      storeDi(1, "interventi").push(intervento(1, SEDE_T1, "solo-di-ruffino"));
      storeDi(2, "interventi").push(intervento(2, SEDE_T2, "solo-di-acme"));
    });

    it("il token della seconda azienda serve il SUO calendario, non quello del tenant 1", async () => {
      const feed = await feedIcsPerToken("token-acme", "tutti.ics");
      expect(feed?.nomeFile).toBe("ruffino-tutti.ics");
      expect(feed?.corpo).toContain("solo-di-acme");
      expect(feed?.corpo).not.toContain("solo-di-ruffino");
    });

    it("ogni azienda vede solo i propri interventi", async () => {
      const feed = await feedIcsPerToken("token-rg", "rilievo.ics");
      expect(feed?.nomeFile).toBe("ruffino-rilievo.ics");
      expect(feed?.corpo).toContain("solo-di-ruffino");
      expect(feed?.corpo).not.toContain("solo-di-acme");
    });

    it("token sconosciuto (o vuoto) → null, senza dire in quale azienda cercare", async () => {
      await expect(feedIcsPerToken("token-inventato", "tutti.ics")).resolves.toBeNull();
      await expect(feedIcsPerToken("", "tutti.ics")).resolves.toBeNull();
    });
  });
});
