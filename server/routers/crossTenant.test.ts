// Isolamento fra tenant sui router (WS2 Task 14): un tenant non deve mai
// vedere né toccare i dati di un altro (store per tenant, spec §3),
// il tenant sospeso resta in sola lettura, il tenant senza sede attiva è
// rifiutato anche in lettura (guardiaTenant, Task 7). A differenza di
// crossSede.test.ts (contesti a mano con `tenant: null`, nessuna guardia)
// qui i contesti portano un `TenantRecord` vero: la guardia gira e la
// risoluzione dello store passa da `ctx.tenantId` (vedi il commento sopra
// `caller`, più sotto, e il report del Task 14 per la verifica di non
// vacuità).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contestoDiProva } from "../_core/contestoDiProva";
import { istanziaStoresPerTenant } from "../_core/persistence";
import { appRouter } from "../routers";
import { getSediStore } from "./sedi";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";

// Id alti e slug dedicati: mai quelli di un altro file di test (v. CLAUDE.md
// e la convenzione di crossSede.test.ts / guardieTenant.test.ts).
const SEDE1 = 90301, SEDE2 = 90302, SEDE3 = 90303;
const UTENTE1 = 90311, UTENTE2 = 90312, UTENTE3 = 90313;

let t1: TenantRecord, t2: TenantRecord, sospeso: TenantRecord;
let nSedi = 0;

beforeAll(async () => {
  delete process.env.FLAG_MULTI_AZIENDA; // acceso (default): la guardia deve girare
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  t1 = await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
  t2 = await repo.inserisci({ slug: "acme-crosstenant", nome: "Acme" });
  sospeso = await repo.inserisci({ slug: "ferma-crosstenant", nome: "Ferma", stato: "sospeso" });
  // Il tenant 1 ha già le sue istanze (seminate all'avvio del modulo);
  // un tenant nato durante il test no: senza questo, `clienti.list` del
  // tenant 2 o del tenant sospeso morirebbe con «store non istanziato»
  // invece di restituire l'isolamento che vogliamo verificare.
  await istanziaStoresPerTenant(t2.id);
  await istanziaStoresPerTenant(sospeso.id);

  const sedi = getSediStore();
  nSedi = sedi.length;
  const now = new Date();
  sedi.push(
    { id: SEDE1, tenantId: t1.id, nome: "RG", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE2, tenantId: t2.id, nome: "Acme", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE3, tenantId: sospeso.id, nome: "Ferma", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
  );
});

afterAll(() => {
  getSediStore().splice(nSedi);
  delete process.env.FLAG_MULTI_AZIENDA;
});

// `tenantId: tenant.id` è ciò che `guardiaTenant` passa a `conTenant(...)`
// per risolvere l'istanza per-tenant degli store (server/_core/trpc.ts):
// è questo campo, non `tenant` stesso, a decidere quale array vede la
// procedura. `tenant` (il record) serve solo alle regole di rifiuto
// (sospeso/senza sede) in `motivoRifiutoTenant`.
const caller = (utenteId: number, sedeId: number | null, tenant: TenantRecord) =>
  appRouter.createCaller(contestoDiProva({ utenteId, sedeId, tenantId: tenant.id, tenant }));

describe("isolamento fra tenant: clienti", () => {
  // Un solo cliente, creato una volta nel tenant 1: le asserzioni sono
  // indipendenti (un `it` per caso) così un difetto in una di loro non
  // nasconde il risultato delle altre.
  let c1: { id: number };

  beforeAll(async () => {
    c1 = await caller(UTENTE1, SEDE1, t1).clienti.create({ nome: "Mario", cognome: "Uno" });
  });

  it("lista vuota per il tenant 2", async () => {
    expect(await caller(UTENTE2, SEDE2, t2).clienti.list({})).toEqual([]);
  });

  it("byId nullo per il tenant 2", async () => {
    expect(await caller(UTENTE2, SEDE2, t2).clienti.byId(c1.id)).toBeNull();
  });

  /**
   * DIFETTO NOTO (non introdotto dai Task 1-13 di WS2, ma reso raggiungibile
   * da loro — v. report del Task 14 per la diagnosi completa): il ramo
   * `if (idx === -1) throw new Error("Cliente non trovato")` di
   * `clienti.update` (server/routers/clienti.ts:522) lancia un `Error`
   * generico invece di `TRPCError({ code: "NOT_FOUND" })`; tRPC lo
   * trasforma in `INTERNAL_SERVER_ERROR`. Prima degli store per tenant e
   * degli id globali (Task 3, Task 13) un id valido esisteva SEMPRE da
   * qualche parte nell'unico array condiviso, quindi questo ramo era
   * raggiungibile solo con un id inventato; ora un id di un altro tenant è
   * reale e globale, e ci arriva davvero — con un codice diverso da quello
   * di un cliente di un'altra sede (assertSedeScope, riga sotto, corretto),
   * il che viola l'invariante «mai informazioni utili a enumerare l'id»
   * (CLAUDE.md). Questa asserzione documenta il comportamento CORRETTO e
   * fallisce finché il difetto non è risolto nel task responsabile:
   * non annacquarla per farla passare.
   */
  it("mutation NOT_FOUND per il tenant 2 (difetto noto, vedi report Task 14)", async () => {
    await expect(
      caller(UTENTE2, SEDE2, t2).clienti.update({ id: c1.id, nome: "X" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("nel proprio tenant il cliente resta intatto e lavorabile", async () => {
    await expect(
      caller(UTENTE1, SEDE1, t1).clienti.byId(c1.id)
    ).resolves.toMatchObject({ id: c1.id, nome: "Mario" });
  });
});

describe("isolamento fra tenant sui router", () => {
  it("le sedi elencate sono solo quelle del tenant", async () => {
    const sedi = await caller(UTENTE2, SEDE2, t2).sedi.list();
    expect(sedi.map((s: any) => s.id)).toEqual([SEDE2]);
  });

  it("tenant sospeso: le mutation sono rifiutate, le letture no", async () => {
    await expect(
      caller(UTENTE3, SEDE3, sospeso).clienti.create({ nome: "A", cognome: "B" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await caller(UTENTE3, SEDE3, sospeso).clienti.list({})).toEqual([]);
  });

  it("tenant senza sede attiva: rifiuto anche in lettura", async () => {
    await expect(
      caller(UTENTE2, null, t2).clienti.list({})
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
