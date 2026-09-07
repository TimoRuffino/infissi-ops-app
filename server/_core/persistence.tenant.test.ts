// server/_core/persistence.tenant.test.ts
// Senza DATABASE_URL: gli store vivono in memoria (loaded = true), il che
// basta per provare famiglie, Proxy, chiavi e resolver.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chiaveStore,
  getAllStoreSnapshots,
  impostaResolverTenant,
  persistedStore,
  storeDi,
  __resetPersistenzaPerTest,
  __registraTenantNotoPerTest,
} from "./persistence";

let tenant: number | null = 1;
const resolver = () => tenant;

describe("persistence per tenant", () => {
  beforeEach(() => {
    __resetPersistenzaPerTest();
    impostaResolverTenant(resolver);
    __registraTenantNotoPerTest(2);
    tenant = 1;
  });
  afterEach(() => __resetPersistenzaPerTest());

  it("chiaveStore: alias per il tenant 1, prefisso dagli altri", () => {
    expect(chiaveStore(1, "clienti")).toBe("clienti");
    expect(chiaveStore(2, "clienti")).toBe("tenant:2:clienti");
  });

  it("rifiuta nomi con prefisso tenant: e doppioni", () => {
    expect(() => persistedStore("tenant:2:x")).toThrow(/tenant:/);
    persistedStore("doppio");
    expect(() => persistedStore("doppio")).toThrow(/duplicate/);
  });

  it("due tenant vedono array diversi attraverso lo stesso Proxy", () => {
    const s = persistedStore<{ id: number; nome: string }>("clienti");
    const clienti = s.items;
    clienti.push({ id: 1, nome: "Uno" });
    tenant = 2;
    expect(clienti.length).toBe(0);
    clienti.push({ id: 2, nome: "Due" });
    expect(clienti.filter(c => c.id === 2)).toHaveLength(1);
    expect([...clienti].map(c => c.nome)).toEqual(["Due"]);
    expect(JSON.stringify(clienti)).toBe('[{"id":2,"nome":"Due"}]');
    expect(Array.isArray(clienti)).toBe(true);
    tenant = 1;
    expect(clienti[0]?.nome).toBe("Uno");
    clienti.length = 0;
    expect(storeDi(1, "clienti")).toEqual([]);
    expect(storeDi(2, "clienti")).toEqual([{ id: 2, nome: "Due" }]);
  });

  it("splice, indice, findIndex e sort lavorano sull'array reale del tenant", () => {
    const s = persistedStore<any>("commesse");
    const commesse = s.items;
    commesse.push({ id: 3 }, { id: 1 }, { id: 2 });
    commesse.sort((a, b) => a.id - b.id);
    const idx = commesse.findIndex(c => c.id === 2);
    commesse[idx] = { id: 2, nota: "x" };
    commesse.splice(0, 1);
    expect(storeDi(1, "commesse")).toEqual([{ id: 2, nota: "x" }, { id: 3 }]);
  });

  it("senza tenant nel contesto l'accesso è un errore, mai un array altrui", () => {
    const s = persistedStore<any>("interventi");
    tenant = null;
    expect(() => s.items.length).toThrow(/senza tenant nel contesto/);
    expect(() => s.items.push({ id: 1 })).toThrow(/senza tenant nel contesto/);
  });

  it("un tenant non istanziato è un errore esplicito", () => {
    const s = persistedStore<any>("verbali");
    tenant = 9;
    expect(() => s.items.length).toThrow(/non istanziato per il tenant 9/);
  });

  it("una famiglia globale ignora il contesto", () => {
    const s = persistedStore<any>("sedi", undefined, { ambito: "globale" });
    tenant = null;
    s.items.push({ id: 1 });
    tenant = 2;
    expect(s.items.length).toBe(1);
    expect(storeDi(1, "sedi")).toHaveLength(1);
  });

  it("gli snapshot elencano ogni istanza con nome e tenant", () => {
    persistedStore<any>("garanzie");
    persistedStore<any>("utenti", undefined, { ambito: "globale" });
    const chiavi = getAllStoreSnapshots().map(s => [s.key, s.nome, s.tenantId]);
    expect(chiavi).toEqual(
      expect.arrayContaining([["garanzie", "garanzie", 1], ["tenant:2:garanzie", "garanzie", 2], ["utenti", "utenti", null]])
    );
  });

  it("senza resolver: nei test ripiega sul tenant 1, fuori dai test è un errore", () => {
    __resetPersistenzaPerTest();
    const s = persistedStore<any>("anomalie");
    expect(s.items.length).toBe(0); // NODE_ENV=test → tenant 1
    const prima = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => s.items.length).toThrow(/senza resolver/);
    } finally {
      process.env.NODE_ENV = prima;
    }
  });
});
