// server/abbonamenti/notifiche.test.ts
// Notifiche di abbonamento e consumi a proprietario e direzione (spec WS4
// §8). Repository delle notifiche in memoria (`setNotificationRepositoryForTesting`),
// utenti e sedi seminati a mano: qui si prova CHI riceve, con quale chiave e
// che cosa succede quando la sede non è in `notificationMode: "active"`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryNotificationRepository,
  setNotificationRepositoryForTesting,
  type NotificationRepository,
} from "../notifications/repository";
import { setFeatureFlags } from "../platform/featureFlags";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import { destinatariAzienda, notificaAzienda } from "./notifiche";
import {
  azzeraMemoriaAvvisiPerTest,
  politicaTarsAzienda,
  verificaCaricamento,
} from "./quota";
import {
  concediOmaggio,
  creaProva,
  impostaDisdetta,
  valutaAbbonamento,
} from "./servizio";

const T0 = new Date("2026-09-08T09:00:00Z");
const SEDE = 90701;
const ALTRA_SEDE = 90702;
const SEDE_TENANT_1 = 90703;
const PROPRIETARIO = 90711;
const DIREZIONE = 90712;
const COMMERCIALE = 90713;
const attore = { tipo: "script" as const, nome: "test" };

let repository: NotificationRepository;

const utente = (id: number, ruoli: string[], extra: Record<string, unknown> = {}) => ({
  id,
  tenantId: 2,
  nome: `Utente ${id}`,
  cognome: "Prova",
  email: `u${id}@example.test`,
  ruoli,
  sediIds: [SEDE],
  attivo: true,
  ...extra,
});

const notificheDi = async (recipientUserId: number, sedeId = SEDE) =>
  (await repository.list({ sedeId, recipientUserId, limit: 50, now: T0 })).items;

const notifica = (extra: Record<string, unknown> = {}) =>
  notificaAzienda({
    tenantId: 2,
    tipo: "abbonamento.avviso",
    titolo: "La prova di Wyndoor finisce fra 7 giorni",
    corpo: "Scade il 15/09/2026.",
    chiave: "abbonamento:2:avviso:7:2026-09-15",
    priorita: "normal",
    adesso: T0,
    ...extra,
  } as Parameters<typeof notificaAzienda>[0]);

describe("notifiche d'azienda", () => {
  beforeEach(() => {
    repository = createMemoryNotificationRepository();
    setNotificationRepositoryForTesting(repository);
    getSediStore().length = 0;
    getSediStore().push({ id: SEDE, tenantId: 2, nome: "HQ", attiva: true } as any);
    getUtentiStore().length = 0;
    getUtentiStore().push(
      utente(PROPRIETARIO, ["proprietario"]) as any,
      utente(DIREZIONE, ["direzione"]) as any,
      utente(COMMERCIALE, ["commerciale"]) as any
    );
    setFeatureFlags(SEDE, { notificationMode: "active" }, {
      actorUserId: null,
      reason: "Test notifiche abbonamento",
    });
  });

  afterEach(() => {
    setFeatureFlags(SEDE, { notificationMode: "legacy" }, {
      actorUserId: null,
      reason: "Test notifiche abbonamento: ripristino",
    });
    setFeatureFlags(ALTRA_SEDE, { notificationMode: "legacy" }, {
      actorUserId: null,
      reason: "Test notifiche abbonamento: ripristino",
    });
    setNotificationRepositoryForTesting(null);
    getSediStore().length = 0;
    getUtentiStore().length = 0;
    vi.restoreAllMocks();
  });

  it("destinatariAzienda: solo proprietari e direzione attivi, con la prima sede attiva del tenant", () => {
    expect(destinatariAzienda(2)).toEqual([
      { id: PROPRIETARIO, sedeId: SEDE },
      { id: DIREZIONE, sedeId: SEDE },
    ]);
  });

  it("destinatariAzienda: salta i disattivati e gli utenti di un'altra azienda", () => {
    getUtentiStore().length = 0;
    getUtentiStore().push(
      utente(PROPRIETARIO, ["proprietario"], { attivo: false }) as any,
      utente(DIREZIONE, ["direzione"], { tenantId: 3 }) as any,
      utente(COMMERCIALE, ["direzione", "commerciale"]) as any
    );
    expect(destinatariAzienda(2)).toEqual([{ id: COMMERCIALE, sedeId: SEDE }]);
  });

  it("destinatariAzienda: senza sedi attive del tenant nessun destinatario", () => {
    getSediStore().length = 0;
    expect(destinatariAzienda(2)).toEqual([]);
  });

  it("destinatariAzienda: chi non ha nessuna sede del tenant ricade sulla prima attiva", () => {
    getSediStore().push({ id: ALTRA_SEDE, tenantId: 2, nome: "Filiale", attiva: true } as any);
    getUtentiStore().length = 0;
    getUtentiStore().push(
      utente(PROPRIETARIO, ["proprietario"], { sediIds: [] }) as any,
      utente(DIREZIONE, ["direzione"], { sediIds: [ALTRA_SEDE] }) as any
    );
    expect(destinatariAzienda(2)).toEqual([
      { id: PROPRIETARIO, sedeId: SEDE },
      { id: DIREZIONE, sedeId: ALTRA_SEDE },
    ]);
  });

  it("notificaAzienda: due notifiche (proprietario e direzione), mai al commerciale", async () => {
    expect(await notifica()).toBe(2);

    const delProprietario = await notificheDi(PROPRIETARIO);
    expect(delProprietario).toHaveLength(1);
    expect(delProprietario[0]).toMatchObject({
      sedeId: SEDE,
      recipientUserId: PROPRIETARIO,
      canonicalKey: `abbonamento:2:avviso:7:2026-09-15:${PROPRIETARIO}`,
      type: "abbonamento.avviso",
      priority: "normal",
      title: "La prova di Wyndoor finisce fra 7 giorni",
      body: "Scade il 15/09/2026.",
      link: "/integrazioni?scheda=abbonamento",
      groupKey: "azienda:abbonamento.avviso",
      sourceEventId: null,
      entityRefs: [{ type: "tenant", id: "2" }],
    });
    expect(await notificheDi(DIREZIONE)).toHaveLength(1);
    expect(await notificheDi(COMMERCIALE)).toHaveLength(0);
  });

  it("notificaAzienda: la stessa chiave una seconda volta non duplica", async () => {
    expect(await notifica()).toBe(2);
    expect(await notifica()).toBe(0);
    expect(await notificheDi(PROPRIETARIO)).toHaveLength(1);

    // Una chiave diversa (soglia diversa) è un avviso nuovo.
    expect(await notifica({ chiave: "abbonamento:2:avviso:3:2026-09-15" })).toBe(2);
    expect(await notificheDi(PROPRIETARIO)).toHaveLength(2);
  });

  it("notificaAzienda: sede non in «active» → nessuna notifica e nessun errore", async () => {
    setFeatureFlags(SEDE, { notificationMode: "shadow" }, {
      actorUserId: null,
      reason: "Test notifiche abbonamento: shadow",
    });
    expect(await notifica()).toBe(0);
    expect(await notificheDi(PROPRIETARIO)).toHaveLength(0);
  });

  it("notificaAzienda: un repository che esplode non propaga l'errore", async () => {
    vi.spyOn(repository, "upsert").mockRejectedValue(new Error("kaboom"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(notifica()).resolves.toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it("notificaAzienda: senza destinatari restituisce zero", async () => {
    getUtentiStore().length = 0;
    expect(await notifica()).toBe(0);
  });
});

// ── Il cablaggio: chi chiama `notificaAzienda` e con che testo ───────────

describe("le transizioni dell'abbonamento notificano l'azienda", () => {
  const giorni = (n: number) => new Date(T0.getTime() + n * 86_400_000);

  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    repository = createMemoryNotificationRepository();
    setNotificationRepositoryForTesting(repository);
    resetTenantRepositoryForTesting();
    azzeraMemoriaAvvisiPerTest();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push({ id: SEDE, tenantId: 2, nome: "HQ", attiva: true } as any);
    getUtentiStore().length = 0;
    getUtentiStore().push(utente(DIREZIONE, ["direzione"]) as any);
    setFeatureFlags(SEDE, { notificationMode: "active" }, {
      actorUserId: null,
      reason: "Test notifiche abbonamento",
    });
  });

  afterEach(() => {
    setFeatureFlags(SEDE, { notificationMode: "legacy" }, {
      actorUserId: null,
      reason: "Test notifiche abbonamento: ripristino",
    });
    setNotificationRepositoryForTesting(null);
    resetTenantRepositoryForTesting();
    azzeraMemoriaAvvisiPerTest();
    getSediStore().length = 0;
    getUtentiStore().length = 0;
    delete process.env.FLAG_MULTI_AZIENDA;
  });

  it("avviso, insoluto e sola lettura: un titolo ciascuno, una volta sola", async () => {
    await creaProva(2, T0, attore);

    expect(await valutaAbbonamento(2, giorni(23))).toEqual({ transizione: null, avviso: 7 });
    const dopoAvviso = await notificheDi(DIREZIONE);
    expect(dopoAvviso).toHaveLength(1);
    expect(dopoAvviso[0]).toMatchObject({
      type: "abbonamento.avviso",
      priority: "normal",
      title: "La prova di Wyndoor finisce fra 7 giorni",
      link: "/integrazioni?scheda=abbonamento",
    });
    expect(dopoAvviso[0].body).toContain("08/10/2026");

    // Un secondo giro dello stesso giorno non ripete l'avviso (la
    // deduplicazione degli eventi impedisce la seconda chiamata).
    await valutaAbbonamento(2, giorni(23.5));
    expect(await notificheDi(DIREZIONE)).toHaveLength(1);

    // Avviso a 3 giorni: evento diverso, notifica nuova.
    await valutaAbbonamento(2, giorni(27));
    expect(await notificheDi(DIREZIONE)).toHaveLength(2);

    expect(await valutaAbbonamento(2, giorni(30.1))).toEqual({
      transizione: "past_due",
      avviso: null,
    });
    const insoluto = (await notificheDi(DIREZIONE)).find(
      n => n.type === "abbonamento.insoluto"
    );
    expect(insoluto).toMatchObject({
      priority: "high",
      title: "Abbonamento scaduto: 7 giorni per regolarizzare",
    });

    expect(await valutaAbbonamento(2, giorni(37.2))).toEqual({
      transizione: "suspended",
      avviso: null,
    });
    const sospeso = (await notificheDi(DIREZIONE)).find(n => n.type === "abbonamento.sospeso");
    expect(sospeso).toMatchObject({ priority: "high", title: "Azienda in sola lettura" });
  });

  it("l'omaggio con scadenza si annuncia come omaggio, non come prova", async () => {
    await creaProva(2, T0, attore);
    await concediOmaggio(2, { motivo: "pilota", scadenza: giorni(60) }, attore, T0);
    await valutaAbbonamento(2, giorni(53));
    const avviso = (await notificheDi(DIREZIONE)).find(n => n.type === "abbonamento.avviso");
    expect(avviso).toMatchObject({
      title: "L'abbonamento omaggio finisce fra 7 giorni",
      priority: "normal",
    });
  });

  it("la disdetta a fine periodo mette in sola lettura e lo dice", async () => {
    await creaProva(2, T0, attore);
    await impostaDisdetta(2, true, attore);
    expect(await valutaAbbonamento(2, giorni(31))).toEqual({
      transizione: "cancelled",
      avviso: null,
    });
    expect((await notificheDi(DIREZIONE)).map(n => n.type)).toEqual(["abbonamento.sospeso"]);
  });

  it("una notifica che fallisce non ferma la transizione", async () => {
    vi.spyOn(repository, "upsert").mockRejectedValue(new Error("kaboom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await creaProva(2, T0, attore);
    expect(await valutaAbbonamento(2, giorni(30.1))).toEqual({
      transizione: "past_due",
      avviso: null,
    });
    expect(getTenantRepository().abbonamentoDi(2)?.stato).toBe("past_due");
  });
});

describe("le soglie dei consumi notificano l'azienda", () => {
  const GB = 1024 ** 3;
  const BUDGET = 1_000_000_000; // 1 USD in nano
  const giorni = (n: number) => new Date(T0.getTime() + n * 86_400_000);

  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA;
    repository = createMemoryNotificationRepository();
    setNotificationRepositoryForTesting(repository);
    resetTenantRepositoryForTesting();
    azzeraMemoriaAvvisiPerTest();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push({ id: SEDE, tenantId: 2, nome: "HQ", attiva: true } as any);
    getUtentiStore().length = 0;
    getUtentiStore().push(utente(DIREZIONE, ["direzione"]) as any);
    setFeatureFlags(SEDE, { notificationMode: "active" }, {
      actorUserId: null,
      reason: "Test notifiche consumi",
    });
  });

  afterEach(() => {
    setFeatureFlags(SEDE, { notificationMode: "legacy" }, {
      actorUserId: null,
      reason: "Test notifiche consumi: ripristino",
    });
    setNotificationRepositoryForTesting(null);
    resetTenantRepositoryForTesting();
    azzeraMemoriaAvvisiPerTest();
    getSediStore().length = 0;
    getUtentiStore().length = 0;
    delete process.env.FLAG_MULTI_AZIENDA;
    vi.useRealTimers();
  });

  it("storage all'80 %: un avviso normale, una volta sola nella giornata", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await repo.impostaQuotaStorage(2, 10 * GB);
    await repo.aggiornaStorage(2, 8 * GB, 1);

    expect(await verificaCaricamento(2, 10, T0)).toBeNull();
    const avvisi = await notificheDi(DIREZIONE);
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0]).toMatchObject({ type: "consumi.storage", priority: "normal" });
    expect(avvisi[0].title).toContain("Spazio");

    // Un secondo caricamento lo stesso giorno non ripete l'avviso.
    await verificaCaricamento(2, 10, T0);
    expect(await notificheDi(DIREZIONE)).toHaveLength(1);
  });

  it("storage bloccato: avviso ad alta priorità", async () => {
    vi.useFakeTimers({ now: T0 });
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await repo.impostaQuotaStorage(2, 2 * GB);
    await repo.aggiornaStorage(2, 2 * GB, 1);
    await repo.impostaSoglia100Storage(2, T0);

    const dopoTolleranza = giorni(8);
    vi.setSystemTime(dopoTolleranza);
    expect(await verificaCaricamento(2, 10, dopoTolleranza)).not.toBeNull();
    const avvisi = await notificheDi(DIREZIONE);
    expect(avvisi).toHaveLength(1);
    expect(avvisi[0]).toMatchObject({ type: "consumi.storage", priority: "high" });
  });

  it("storage sotto il 50 %: nessuna notifica", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await repo.impostaQuotaStorage(2, 10 * GB);
    await repo.aggiornaStorage(2, 1 * GB, 1);
    expect(await verificaCaricamento(2, 10, T0)).toBeNull();
    expect(await notificheDi(DIREZIONE)).toHaveLength(0);
  });

  it("Tars all'80 % avvisa normale, al 100 % alto, il rifiuto è alto", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    const abbonamento = repo.abbonamentoDi(2)!;
    await repo.salvaAbbonamento({ ...abbonamento, budgetTarsNanoMese: BUDGET });
    const politica = politicaTarsAzienda();

    // Sotto le soglie: niente.
    await politica.dopoPrenotazione(2, BUDGET * 0.6, T0, { rifiutata: false });
    expect(await notificheDi(DIREZIONE)).toHaveLength(0);

    await politica.dopoPrenotazione(2, BUDGET * 0.85, T0, { rifiutata: false });
    const a80 = await notificheDi(DIREZIONE);
    expect(a80).toHaveLength(1);
    expect(a80[0]).toMatchObject({ type: "consumi.tars", priority: "normal" });

    await politica.dopoPrenotazione(2, BUDGET, T0, { rifiutata: false });
    const a100 = await notificheDi(DIREZIONE);
    expect(a100).toHaveLength(2);
    expect(a100.filter(n => n.priority === "high")).toHaveLength(1);

    await politica.dopoPrenotazione(2, BUDGET * 2, giorni(9), { rifiutata: true });
    const dopoIlBlocco = await notificheDi(DIREZIONE);
    expect(dopoIlBlocco).toHaveLength(3);
    expect(dopoIlBlocco.filter(n => n.priority === "high")).toHaveLength(2);
  });

  it("Tars senza budget d'azienda (tenant 1): nessuna notifica", async () => {
    // La proprietaria della piattaforma ha una sede, un presidio e persino
    // una riga d'abbonamento: quello che non ha è un tetto per azienda.
    getSediStore().push({ id: SEDE_TENANT_1, tenantId: 1, nome: "Sede 1", attiva: true } as any);
    getUtentiStore().push(
      utente(PROPRIETARIO, ["proprietario"], {
        tenantId: 1,
        sediIds: [SEDE_TENANT_1],
      }) as any
    );
    setFeatureFlags(SEDE_TENANT_1, { notificationMode: "active" }, {
      actorUserId: null,
      reason: "Test notifiche consumi: tenant 1",
    });
    await politicaTarsAzienda().dopoPrenotazione(1, BUDGET * 2, T0, { rifiutata: true });
    expect(await notificheDi(PROPRIETARIO, SEDE_TENANT_1)).toHaveLength(0);
    setFeatureFlags(SEDE_TENANT_1, { notificationMode: "legacy" }, {
      actorUserId: null,
      reason: "Test notifiche consumi: ripristino",
    });
  });
});
