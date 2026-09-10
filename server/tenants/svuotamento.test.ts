// server/tenants/svuotamento.test.ts
// Lo svuotamento in memoria: guardie, camminata dei file, store e lapide.
// La parte Postgres (righe kv_store e tabelle per sede) è coperta dal
// percorso pg del repository; qui si prova tutto ciò che non richiede un
// database. Date relative, mai fisse.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __impostaDriverPerTest, type StorageDriver } from "../_core/fileStorage";
import { hashPassword } from "../_core/password";
import { storeDi } from "../_core/persistence";
import "../routers"; // registra le famiglie degli store (preventivi_documenti, ticket_allegati, …)
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { MESSAGGI, RITENZIONE_CANCELLAZIONE_MS } from "./costanti";
import { conTenant } from "./contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { cancella, crea, riattiva } from "./servizio";
import { svuotaTenant } from "./svuotamento";

const script = { tipo: "script" as const, nome: "script:tenant@test" };
const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  await getTenantRepository().assicuraTenantPredefinito();
  nS = sedi.length;
  nU = utenti.length;
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  __impostaDriverPerTest(null);
});

const inputAcme = () => ({
  slug: "acme",
  nome: "Acme Infissi",
  sede: { nome: "Acme Infissi", citta: "Sarzana" },
  proprietario: { nome: "Mario", cognome: "Rossi", email: "mario@acme.test", passwordHash: hashPassword("Password-lunga-12") },
});

describe("svuotaTenant: guardie", () => {
  it("rifiuta il tenant 1, uno stato diverso da cancellato, la ritenzione non compiuta e la doppia esecuzione", async () => {
    const { tenant } = await crea(inputAcme(), script);
    await expect(svuotaTenant({ tenantId: 1, forza: true, attore: script })).rejects.toThrow(
      MESSAGGI.tenant1NonSiChiude
    );
    await expect(svuotaTenant({ tenantId: tenant.id, forza: true, attore: script })).rejects.toThrow(
      /solo un'azienda cancellata/
    );
    await cancella(tenant.id, "uscita", script);
    await expect(svuotaTenant({ tenantId: tenant.id, forza: false, attore: script })).rejects.toThrow(
      /ritenzione di 30 giorni/
    );
    await svuotaTenant({ tenantId: tenant.id, forza: true, attore: script });
    await expect(svuotaTenant({ tenantId: tenant.id, forza: true, attore: script })).rejects.toThrow(
      MESSAGGI.aziendaSvuotata
    );
  });

  it("senza forza passa quando la ritenzione è compiuta", async () => {
    const { tenant } = await crea(inputAcme(), script);
    const trentunoGiorniFa = new Date(Date.now() - RITENZIONE_CANCELLAZIONE_MS - 86_400_000);
    await cancella(tenant.id, "uscita", script, trentunoGiorniFa);
    await expect(svuotaTenant({ tenantId: tenant.id, forza: false, attore: script })).resolves.toMatchObject({
      slug: `cancellata-${tenant.id}`,
    });
  });
});

describe("svuotaTenant: effetti", () => {
  it("cancella i file riferiti dai record, gli store, utenti e sedi; la lapide libera lo slug e riattiva rifiuta", async () => {
    const { tenant, sedeId, utenteId } = await crea(inputAcme(), script);
    const chiave = `tenant/${tenant.id}/documents/1/1-test.pdf`;
    const cancellati: string[] = [];
    const driver: StorageDriver = {
      name: "local",
      put: async () => {},
      get: async () => null,
      openRead: async () => null,
      delete: async k => {
        cancellati.push(k);
      },
      head: async () => ({ bytes: 123 }),
    };
    __impostaDriverPerTest(driver);
    conTenant(tenant.id, () => {
      storeDi<any>(tenant.id, "ticket_allegati").push({ id: 1, storageKey: chiave, size: 123 });
    });
    await cancella(tenant.id, "uscita definitiva", script);
    const esito = await svuotaTenant({ tenantId: tenant.id, forza: true, attore: script });
    expect(cancellati).toEqual([chiave]);
    expect(esito).toMatchObject({ file: 1, fileNonCancellati: 0, utenti: 1, sedi: 1, slug: `cancellata-${tenant.id}` });
    expect(esito.store).toBeGreaterThan(0);
    // Gli store del tenant non esistono più.
    expect(() => storeDi(tenant.id, "ticket_allegati")).toThrow(/non istanziato/);
    // Utenti e sedi del tenant sono usciti dagli store globali: l'email torna libera.
    expect(utenti.some((u: any) => u.id === utenteId)).toBe(false);
    expect(sedi.some((s: any) => s.id === sedeId)).toBe(false);
    const repo = getTenantRepository();
    const lapide = repo.perId(tenant.id)!;
    expect(lapide).toMatchObject({ slug: `cancellata-${tenant.id}`, stato: "cancellato" });
    expect(lapide.svuotatoIl).not.toBeNull();
    // Lo slug è di nuovo disponibile per una nuova azienda.
    await expect(repo.inserisci({ slug: "acme", nome: "Acme 2" })).resolves.toMatchObject({ slug: "acme" });
    // La lapide non si riapre.
    await expect(riattiva(tenant.id, "troppo tardi", script)).rejects.toThrow(MESSAGGI.aziendaSvuotata);
    const eventi = await repo.eventi(tenant.id);
    expect(eventi.at(-1)).toMatchObject({ tipo: "svuotato", dettagli: { slugPrima: "acme", file: 1 } });
  });

  it("un file che non si lascia cancellare ferma lo svuotamento prima della lapide", async () => {
    const { tenant } = await crea(inputAcme(), script);
    const chiave = `tenant/${tenant.id}/documents/1/2-test.pdf`;
    const driver: StorageDriver = {
      name: "local",
      put: async () => {},
      get: async () => null,
      openRead: async () => null,
      delete: async () => {
        throw new Error("storage momentaneamente giù");
      },
      head: async () => ({ bytes: 5 }),
    };
    __impostaDriverPerTest(driver);
    conTenant(tenant.id, () => {
      storeDi<any>(tenant.id, "ticket_allegati").push({ id: 2, storageKey: chiave, size: 5 });
    });
    await cancella(tenant.id, "uscita", script);
    await expect(svuotaTenant({ tenantId: tenant.id, forza: true, attore: script })).rejects.toThrow(
      /file non cancellati/
    );
    // Nulla è andato perso: store e record sono ancora lì, si ritenta.
    expect(storeDi<any>(tenant.id, "ticket_allegati")).toHaveLength(1);
    expect(getTenantRepository().perId(tenant.id)!.svuotatoIl).toBeNull();
  });
});
