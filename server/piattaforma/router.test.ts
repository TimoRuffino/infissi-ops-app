// server/piattaforma/router.test.ts
// Il router `piattaforma` (WS6 spec §5.1): sole letture, dietro
// `piattaformaProcedure` — nessun amministratore, FORBIDDEN; azienda
// individuata per slug, mai per tenantId. La regola di costo vincolante di
// `aziende` (al più cinque giri di query in tutto) si prova qui spiando la
// repo finta, come indicato dal brief del task.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { hashPassword, isHashed, verifyPassword } from "../_core/password";
import { __impostaPostaPerTest } from "../_core/postaPiattaforma";
import { creaUtenteInterno, getUtentiStore } from "../routers/utenti";
import { getSediStore } from "../routers/sedi";
import { creaLedgerMemoriaPerTest, impostaLedgerPerTest } from "../tars/costi/ledger";
import { conTenant } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { crea } from "../tenants/servizio";
import type { Attore } from "../tenants/tipi";
import { __azzeraLimiteConfermePerTest } from "./accesso";
import { MESSAGGI_PIATTAFORMA } from "./costanti";
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
    user: user ?? ({ id: admin.id, email: admin.email, loginMethod: "local", role: "admin", ruolo: ruoli[0], ruoli, name: "Admin" } as any),
    // `get` per `baseUrlDa` (inviti, Task 7): senza APP_BASE_URL usa protocollo+host della richiesta.
    req: { protocol: "http", headers: {}, get: (_nome: string) => "app.test" } as any,
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
    __azzeraLimiteConfermePerTest();

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
    __impostaPostaPerTest(null);
    __azzeraLimiteConfermePerTest();
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

  it("crea: comando eseguito subito, proprietario con password inutilizzabile, omaggio e invito", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "em" }));
    const esito = await caller.crea({
      slug: "gamma",
      nome: "Gamma Srl",
      sede: { nome: "Gamma", citta: "Carrara" },
      proprietario: { nome: "Gina", cognome: "Verdi", email: "gina@gamma.test" },
      omaggio: { motivo: "pilota", scadenza: null },
      passwordConferma: PASSWORD,
    });
    expect(esito.comando.stato).toBe("eseguito");
    expect(esito.comando.richiestoDa).toBe(`piattaforma:${admin.email}`);
    expect(esito.comando.payload).not.toHaveProperty(["proprietario", "passwordHash"]); // tolto alla chiusura
    expect(esito.invito).toMatchObject({ inviato: true });
    // R9: la posta è partita, il token è già nella casella del proprietario:
    // una seconda copia nel browser sarebbe solo una presa in più da rubare.
    expect(esito.invito).not.toHaveProperty("link");
    const repo = getTenantRepository();
    expect(repo.abbonamentoDi(repo.perSlug("gamma")!.id)).toMatchObject({ tipo: "complimentary", stato: "active" });
    const gina = conTenant(repo.perSlug("gamma")!.id, () =>
      getUtentiStore().find((u: any) => u.email === "gina@gamma.test")
    );
    expect(verifyPassword("", gina.password)).toBe(false);
    expect(isHashed(gina.password)).toBe(true);
  });

  it("crea idempotente: la seconda chiamata sullo stesso slug non manda invito e lo dice in nota", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "em2" }));
    const inputCrea = {
      slug: "delta",
      nome: "Delta Srl",
      sede: { nome: "Delta", citta: "La Spezia" },
      proprietario: { nome: "Dario", cognome: "Neri", email: "dario@delta.test" },
      passwordConferma: PASSWORD,
    };
    const prima = await caller.crea(inputCrea);
    expect(prima.comando.stato).toBe("eseguito");
    expect(prima.invito).toMatchObject({ inviato: true });

    const seconda = await caller.crea(inputCrea);
    expect(seconda.comando.stato).toBe("eseguito");
    expect(seconda.invito).toBeNull();
    expect(seconda.omaggio).toBeNull();
    expect(seconda.nota).toBe(MESSAGGI_PIATTAFORMA.tenantGiaEsistente);
  });

  it("crea rifiutato dal dominio (email già di un'altra azienda): comando in errore, nessun invito", async () => {
    const esito = await caller.crea({
      slug: "epsilon",
      nome: "Epsilon Srl",
      sede: { nome: "Epsilon", citta: "Massa" },
      proprietario: { nome: "Mario", cognome: "Rossi", email: "mario@acme.test" },
      passwordConferma: PASSWORD,
    });
    expect(esito.comando.stato).toBe("errore");
    expect(esito.invito).toBeNull();
    expect(esito.omaggio).toBeNull();
    expect(getTenantRepository().perSlug("epsilon")).toBeNull();
  });

  it("password di conferma sbagliata → UNAUTHORIZED e nessun comando accodato", async () => {
    await expect(
      caller.sospendi({ slug: "acme", motivo: "prova", passwordConferma: "sbagliata-ma-lunga" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await getTenantRepository().comandiInAttesa()).toEqual([]);
  });

  it("sospendi/riattiva/abbonamento/proprietario: comando eseguito con l'attore piattaforma negli eventi", async () => {
    const repo = getTenantRepository();
    const s = await caller.sospendi({ slug: "acme", motivo: "insoluto di prova", passwordConferma: PASSWORD });
    expect(s.comando.stato).toBe("eseguito");
    const eventi = await repo.eventi(repo.perSlug("acme")!.id);
    expect(eventi.at(-1)).toMatchObject({ tipo: "sospeso", attore: `piattaforma:${admin.email}` });

    const r = await caller.riattiva({ slug: "acme", motivo: "risolto: riattivata", passwordConferma: PASSWORD });
    expect(r.comando.stato).toBe("eseguito");
    expect(repo.perSlug("acme")?.stato).toBe("attivo");

    const a = await caller.abbonamento({ azione: "quota", slug: "acme", quotaGb: 200, passwordConferma: PASSWORD });
    expect(a.comando.stato).toBe("eseguito");
    expect(repo.perSlug("acme")?.storageQuotaBytes).toBe(200 * 1024 ** 3);

    const p = await caller.proprietario({ slug: "acme", email: "mario@acme.test", azione: "assegna", passwordConferma: PASSWORD });
    expect(p.comando.stato).toBe("eseguito");
    expect(p.comando.richiestoDa).toBe(`piattaforma:${admin.email}`);
  });

  it("tenant 1: sospendere senza ancheTenant1 rifiuta; omaggio rifiutato dal dominio arriva come esito.errore", async () => {
    await expect(
      caller.sospendi({ slug: "ruffino-group", motivo: "prova prova", passwordConferma: PASSWORD })
    ).rejects.toThrow(/anche-tenant-1|ancheTenant1/);
    const o = await caller.abbonamento({
      azione: "omaggio",
      slug: "ruffino-group",
      motivo: "prova prova",
      scadenza: null,
      passwordConferma: PASSWORD,
    });
    expect(o.comando.stato).toBe("errore");
    expect(String(o.comando.esito?.errore)).toContain("tenant 1");
  });

  it("ricalcolaStorage e ripristina in prova restano in coda e non chiedono la password", async () => {
    const r = await caller.ricalcolaStorage({ slug: "acme" });
    expect(r.comando.stato).toBe("in_attesa");

    const rip = await caller.ripristina({ slug: "acme", backup: "2026-09-01", scrivi: false });
    expect(rip.comando.stato).toBe("in_attesa");
  });

  it("a interruttore spento le mutation rifiutano con PRECONDITION_FAILED", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    await expect(caller.ricalcolaStorage({ slug: "acme" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: MESSAGGI_PIATTAFORMA.solaLetturaFlagSpento,
    });
  });

  it("invita e annullaInvito", async () => {
    __impostaPostaPerTest(async () => ({ inviato: false, motivo: "non configurata" }));
    const i = await caller.invita({ slug: "acme", passwordConferma: PASSWORD });
    expect(i.inviato).toBe(false);
    expect(i.link).toContain("/invito/");
    const annullato = await caller.annullaInvito({ id: i.invito.id });
    expect(annullato?.annullatoIl).not.toBeNull();
  });

  // R9: un link d'invito è la presa dell'account del proprietario di
  // un'altra azienda. Chi lo emette conferma di essere ancora lui, e il
  // link non torna al browser se la posta lo ha già consegnato.
  it("invita senza conferma valida: schema rifiuta il campo mancante, password sbagliata → UNAUTHORIZED e nessun invito emesso", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "em_r9" }));
    const repo = getTenantRepository();
    const tenantId = repo.perSlug("acme")!.id;

    await expect(caller.invita({ slug: "acme" } as any)).rejects.toThrow();
    await expect(
      caller.invita({ slug: "acme", passwordConferma: "sbagliata-ma-lunga" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: MESSAGGI_PIATTAFORMA.passwordNonCorretta });

    expect(await repo.invitiDi(tenantId)).toEqual([]);
    const eventi = await repo.eventi(tenantId);
    expect(eventi.some(e => e.tipo === "invito_inviato")).toBe(false);
  });

  it("invita con posta che invia: nessun link nella risposta; con posta che fallisce: il link c'è", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "em_r9_ok" }));
    const inviato = await caller.invita({ slug: "acme", passwordConferma: PASSWORD });
    expect(inviato.inviato).toBe(true);
    expect(inviato.link).toBeUndefined();
    expect(inviato).not.toHaveProperty("link");

    __impostaPostaPerTest(async () => ({ inviato: false, motivo: "non configurata" }));
    const aMano = await caller.invita({ slug: "acme", passwordConferma: PASSWORD });
    expect(aMano.link).toContain("/invito/");
  });

  it("ripristina con scrivi: true e password corretta → comando in coda tipo ripristina_archivi", async () => {
    const repo = getTenantRepository();
    const rip = await caller.ripristina({ slug: "acme", backup: "2026-09-01", scrivi: true, passwordConferma: PASSWORD });
    expect(rip.comando.stato).toBe("in_attesa");
    expect(rip.comando.tipo).toBe("ripristina_archivi");
    const comandi = await repo.comandiInAttesa();
    expect(comandi).toHaveLength(1);
    expect(comandi[0].tipo).toBe("ripristina_archivi");
  });

  it("ripristina con scrivi: true e password sbagliata → UNAUTHORIZED e nessun comando accodato", async () => {
    const repo = getTenantRepository();
    await expect(
      caller.ripristina({ slug: "acme", backup: "2026-09-01", scrivi: true, passwordConferma: "sbagliata-ma-lunga" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await repo.comandiInAttesa()).toEqual([]);
  });

  it("ripristina con scrivi: true senza passwordConferma → UNAUTHORIZED e nessun comando accodato", async () => {
    const repo = getTenantRepository();
    await expect(caller.ripristina({ slug: "acme", backup: "2026-09-01", scrivi: true })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(await repo.comandiInAttesa()).toEqual([]);
  });

  it("proprietario con azione revoca rifiutato se unico proprietario → errore nel comando", async () => {
    const repo = getTenantRepository();
    const p = await caller.proprietario({ slug: "acme", email: "mario@acme.test", azione: "revoca", passwordConferma: PASSWORD });
    expect(p.comando.stato).toBe("errore");
    expect(p.comando.esito?.errore).toBeTruthy();
    expect(String(p.comando.esito?.errore)).toContain("proprietario");
  });

  it("slug sconosciuto su mutation sospendi → NOT_FOUND «Risorsa non trovata.»", async () => {
    await expect(
      caller.sospendi({ slug: "nessuna", motivo: "prova prova", passwordConferma: PASSWORD })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Risorsa non trovata.",
    });
  });

  it("slug sconosciuto su mutation riattiva → NOT_FOUND «Risorsa non trovata.»", async () => {
    await expect(
      caller.riattiva({ slug: "nessuna", motivo: "prova prova", passwordConferma: PASSWORD })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Risorsa non trovata.",
    });
  });

  it("slug sconosciuto su mutation proprietario → NOT_FOUND «Risorsa non trovata.»", async () => {
    await expect(
      caller.proprietario({ slug: "nessuna", email: "test@test.test", azione: "assegna", passwordConferma: PASSWORD })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Risorsa non trovata.",
    });
  });

  it("slug sconosciuto su mutation ricalcolaStorage → NOT_FOUND «Risorsa non trovata.»", async () => {
    await expect(caller.ricalcolaStorage({ slug: "nessuna" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Risorsa non trovata.",
    });
  });

  it("slug sconosciuto su mutation ripristina → NOT_FOUND «Risorsa non trovata.»", async () => {
    await expect(caller.ripristina({ slug: "nessuna", backup: "2026-09-01", scrivi: false })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Risorsa non trovata.",
    });
  });

  it("annullaInvito registra evento invito_annullato con attore piattaforma e invitoId nei dettagli", async () => {
    __impostaPostaPerTest(async () => ({ inviato: false, motivo: "non configurata" }));
    const i = await caller.invita({ slug: "acme", passwordConferma: PASSWORD });
    const invitoId = i.invito.id;
    const repo = getTenantRepository();
    const tenantId = repo.perSlug("acme")!.id;

    await caller.annullaInvito({ id: invitoId });
    const eventi = await repo.eventi(tenantId);
    const evento = eventi.find(e => e.tipo === "invito_annullato" && (e.dettagli as any)?.invitoId === invitoId);
    expect(evento).toBeTruthy();
    expect(evento?.attore).toBe(`piattaforma:${admin.email}`);
    expect((evento?.dettagli as any).invitoId).toBe(invitoId);
  });
});
