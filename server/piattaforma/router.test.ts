// server/piattaforma/router.test.ts
// Il router `piattaforma` (WS6 spec §5.1): sole letture, dietro
// `piattaformaProcedure` — nessun amministratore, FORBIDDEN; azienda
// individuata per slug, mai per tenantId. La regola di costo vincolante di
// `aziende` (al più cinque giri di query in tutto) si prova qui spiando la
// repo finta, come indicato dal brief del task.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { hashPassword } from "../_core/password";
import { creaUtenteInterno, getUtentiStore } from "../routers/utenti";
import { getSediStore } from "../routers/sedi";
import { creaLedgerMemoriaPerTest, impostaLedgerPerTest } from "../tars/costi/ledger";
import { conTenant } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { crea } from "../tenants/servizio";
import type { Attore } from "../tenants/tipi";
import { piattaformaRouter } from "./router";

const SEDE = 96401;
const T0 = new Date("2026-09-09T09:00:00.000Z");
const PASSWORD = "Password-lunga-12";
const SCRIPT: Attore = { tipo: "script", nome: "script:router.test" };

let admin: any;
let caller: ReturnType<typeof piattaformaRouter.createCaller>;
let nU = 0;
let nS = 0;

function context(tenantId: number, sedeId = SEDE, ruoli = ["direzione"], user?: any): TrpcContext {
  return {
    user: user ?? ({ id: admin.id, loginMethod: "local", role: "admin", ruolo: ruoli[0], ruoli, name: "Admin" } as any),
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
    tenantId,
    tenant: null,
  };
}

describe("piattaformaRouter", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ now: T0, toFake: ["Date"] });
    process.env.FLAG_MULTI_AZIENDA = "on";
    resetTenantRepositoryForTesting();
    impostaLedgerPerTest(creaLedgerMemoriaPerTest());
    nU = getUtentiStore().length;
    nS = getSediStore().length;

    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    admin = conTenant(1, () =>
      creaUtenteInterno({
        tenantId: 1,
        nome: "Admin",
        cognome: "Pannello",
        email: "admin.pannello.router.test@wyndoor.test",
        ruoli: ["direzione"],
        sediIds: [SEDE],
        passwordHash: hashPassword(PASSWORD),
      })
    );
    process.env.PLATFORM_ADMIN_EMAILS = admin.email;

    await crea(
      {
        slug: "acme",
        nome: "Acme Infissi",
        sede: { nome: "Acme Infissi", citta: "Sarzana" },
        proprietario: { nome: "Mario", cognome: "Rossi", email: "mario@acme.test", passwordHash: hashPassword(PASSWORD) },
      },
      SCRIPT
    );
    await crea(
      {
        slug: "beta",
        nome: "Beta Serramenti",
        sede: { nome: "Beta Serramenti", citta: "Genova" },
        proprietario: { nome: "Luca", cognome: "Bianchi", email: "luca@beta.test", passwordHash: hashPassword(PASSWORD) },
      },
      SCRIPT
    );

    caller = piattaformaRouter.createCaller(context(1));
  });

  afterEach(() => {
    getUtentiStore().splice(nU);
    getSediStore().splice(nS);
    resetTenantRepositoryForTesting();
    impostaLedgerPerTest(null);
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.FLAG_MULTI_AZIENDA;
    vi.useRealTimers();
  });

  it("aziende: una riga per azienda con abbonamento, spazio, Tars, worker, backup e proprietari, in poche query", async () => {
    const repo = getTenantRepository();
    const spia = {
      storageTutti: vi.spyOn(repo, "storageTutti"),
      storageDi: vi.spyOn(repo, "storageDi"),
      eventi: vi.spyOn(repo, "eventi"),
      comandiInAttesa: vi.spyOn(repo, "comandiInAttesa"),
    };
    const righe = await caller.aziende();
    expect(righe.map(r => r.slug)).toEqual(["ruffino-group", "acme", "beta"]);
    expect(righe[1]).toMatchObject({
      stato: "attivo",
      abbonamento: { tipo: "paid", stato: "trialing" },
      proprietari: [{ email: "mario@acme.test" }],
    });
    expect(righe[1].tars).toMatchObject({ budgetEur: 25, consumoEur: 0, percentuale: 0 });
    expect(spia.storageTutti).toHaveBeenCalledTimes(1);
    expect(spia.storageDi).not.toHaveBeenCalled();
    expect(spia.eventi).not.toHaveBeenCalled(); // i worker sospesi vengono da eventiRecenti, una query
    expect(spia.comandiInAttesa).toHaveBeenCalledTimes(1);
  });

  it("azienda: scheda completa; slug sconosciuto → NOT_FOUND «Risorsa non trovata.»", async () => {
    const scheda = await caller.azienda({ slug: "acme" });
    expect(scheda.sedi).toHaveLength(1);
    expect(scheda.abbonamento?.budgetTarsEur).toBe(25);
    expect(scheda.eventi.map(e => e.tipo)).toContain("creato");
    expect(scheda.comandi).toEqual([]);
    await expect(caller.azienda({ slug: "nessuna" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Risorsa non trovata.",
    });
  });

  it("comando: il comando per id, null se non esiste", async () => {
    const repo = getTenantRepository();
    const accodato = await repo.accodaComando({
      tipo: "ricalcola_storage",
      tenantId: null,
      payload: { slug: "acme" },
      richiestoDa: `piattaforma:${admin.email}`,
    });
    await expect(caller.comando({ id: accodato.id })).resolves.toMatchObject({ id: accodato.id, tipo: "ricalcola_storage" });
    await expect(caller.comando({ id: accodato.id + 9999 })).resolves.toBeNull();
  });

  it("non amministratore → FORBIDDEN; nessuna procedura accetta tenantId", async () => {
    const utenteNonInElenco = { id: 999999, loginMethod: "local" };
    await expect(
      piattaformaRouter.createCaller(context(1, SEDE, ["direzione"], utenteNonInElenco)).aziende()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
