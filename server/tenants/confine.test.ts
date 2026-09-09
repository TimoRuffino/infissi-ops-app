// server/tenants/confine.test.ts
// Guardie STRUTTURALI del tenant (spec WS1 §10.8), sul modello di
// server/tars/costi/confine.test.ts: leggono il sorgente e falliscono se
// qualcuno reintroduce un percorso che la spec vieta.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo, RADICE } from "../_core/sorgentiDiProva";
import { TENANT_PREDEFINITO_ID } from "./costanti";

const PRODUZIONE = fileSorgente(["server", "shared", "scripts"]).filter(f => !/\.test\.ts$/.test(f));
const testo = (f: string) => readFileSync(f, "utf8");

describe("confine del tenant", () => {
  it("nessuno schema di input tRPC o di strumento Tars accetta tenantId o tenant", () => {
    const colpevoli = PRODUZIONE.filter(f => /\b(tenantId|tenant)\s*:\s*z\./.test(testo(f))).map(relativo);
    expect(colpevoli).toEqual([]);
  });

  // WS3: `tenant_storage` inizia comunque per "tenant" (già coperta), ma
  // `oauth_state` no — va nominata a parte perché la guardia resti vera anche
  // per lei (control plane del tenant, spec WS3 §5). WS4: stessa ragione per
  // `abbonamenti`.
  //
  // Fix wave finale: la guardia guardava solo l'INSERT, e un `UPDATE
  // abbonamenti` o un `DELETE FROM abbonamenti` scritto fuori dal repository
  // sarebbe passato — proprio la scrittura che il confine vuole vietare (uno
  // stato d'abbonamento cambiato senza passare da `abbonamenti/servizio.ts`).
  it("INSERT/UPDATE/DELETE su tenant* e oauth_state/abbonamenti compaiono solo nel repository", () => {
    const scrittura = /(INSERT INTO|UPDATE|DELETE FROM)\s+(tenant|oauth_state|abbonamenti)/;
    const scrittori = PRODUZIONE.filter(f => scrittura.test(testo(f))).map(relativo);
    expect(scrittori).toEqual([join("server", "tenants", "repository.ts")]);
  });

  it("portaChiusaPerTenant non compare più in server/", () => {
    const superstiti = PRODUZIONE.filter(f => testo(f).includes("portaChiusaPerTenant")).map(relativo);
    expect(superstiti).toEqual([]);
  });

  // Fix round 1 (Task 7): contestoCorrente.ts deve restare una FOGLIA del
  // grafo dei moduli — niente ./contesto, ./repository o router — altrimenti
  // si riapre il ciclo con _core/trpc.ts (che importa `conTenant` da lì) che
  // faceva crashare al semplice import un router caricato prima di questo
  // modulo (v. _core/ordineImport.test.ts).
  it("server/tenants/contestoCorrente.ts importa solo interruttori, costanti e _core/persistence", () => {
    const testoModulo = testo(join(RADICE, "server", "tenants", "contestoCorrente.ts"));
    const specifiers = [...testoModulo.matchAll(/^import\s+(?:.+?\s+from\s+)?["']([^"']+)["'];?\s*$/gm)]
      .map(m => m[1])
      .filter(s => !s.startsWith("node:"));
    expect(new Set(specifiers)).toEqual(new Set(["../platform/interruttori", "./costanti", "../_core/persistence"]));
  });

  it("AsyncLocalStorage compare solo in server/tenants/contestoCorrente.ts", () => {
    const usi = PRODUZIONE.filter(f => /AsyncLocalStorage/.test(testo(f))).map(relativo);
    expect(usi).toEqual([join("server", "tenants", "contestoCorrente.ts")]);
  });

  // Task 15 (spec WS2 §3.1, §5.1): il verso della dipendenza è uno solo.
  // `persistence.ts` non sa che esistono i tenant — riceve il resolver con
  // `impostaResolverTenant` e la lista degli id come parametro di
  // `bootstrapAll`. Un import di `../tenants/*` da qui riaprirebbe il ciclo
  // (contestoCorrente importa persistence) e legherebbe il registro degli
  // store al control plane.
  it("server/_core/persistence.ts non importa da server/tenants/", () => {
    const testoModulo = testo(join(RADICE, "server", "_core", "persistence.ts"));
    const specifiers = [...testoModulo.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]);
    expect(specifiers.filter(s => s.includes("tenants/"))).toEqual([]);
  });

  // Task 15 (spec WS2 §3.2): `storeDi(tenantId, nome)` scavalca il contesto e
  // restituisce l'array reale di un'altra azienda. È lo strumento di
  // migrazione, verifica e (domani) Platform Admin: dentro un router o uno
  // strumento di Tars sarebbe una porta aperta sui dati altrui, perché lì il
  // tenant deve venire SEMPRE dal contesto (il Proxy di `store.items`).
  it("storeDi non compare in server/routers/ né in server/tars/strumenti/", () => {
    const superficie = fileSorgente([join("server", "routers"), join("server", "tars", "strumenti")]);
    const colpevoli = superficie
      .filter(f => !/\.test\.ts$/.test(f) && /\bstoreDi\s*\(/.test(testo(f)))
      .map(relativo);
    expect(colpevoli).toEqual([]);
  });

  // Task 15 (spec WS2 §3.1): `persistence.ts` non importa `./costanti` (v. la
  // guardia sopra), quindi il numero del tenant predefinito è scritto due
  // volte. Le due copie devono restare uguali: se divergessero,
  // `chiaveStore(1, "clienti")` smetterebbe di essere l'alias della chiave di
  // oggi e il tenant 1 si ritroverebbe archivi vuoti sotto `tenant:1:*`.
  it("il letterale TENANT_PREDEFINITO di persistence.ts vale TENANT_PREDEFINITO_ID", () => {
    const testoModulo = testo(join(RADICE, "server", "_core", "persistence.ts"));
    const trovato = /^const TENANT_PREDEFINITO\s*=\s*(\d+);/m.exec(testoModulo);
    expect(trovato).not.toBeNull();
    expect(Number(trovato![1])).toBe(TENANT_PREDEFINITO_ID);
  });

  it("lo script tenant non importa router né store", () => {
    const script = testo(join(RADICE, "scripts", "tenant.ts"));
    expect(script).not.toMatch(/from "\.\.\/server\/routers/);
    expect(script).not.toMatch(/bootstrapAll/);
  });

  // Task 13: `pnpm tenant verifica` legge `kv_store` SOLO tramite
  // `leggiBlobDaDb`/`elencaChiaviDaDb` (persistence.ts, §7.2): uno `SELECT …
  // FROM kv_store` scritto a mano nello script bypasserebbe quel confine e
  // duplicherebbe la logica di lettura in un posto che deve restare pura.
  it("lo script tenant non legge kv_store direttamente: usa leggiBlobDaDb/elencaChiaviDaDb", () => {
    const script = testo(join(RADICE, "scripts", "tenant.ts"));
    expect(script).not.toMatch(/kv_store/);
  });
});
