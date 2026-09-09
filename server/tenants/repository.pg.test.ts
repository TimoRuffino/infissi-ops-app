// Su PostgreSQL vero, come server/_core/jsonbSnapshot.pg.test.ts:
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm vitest run server/tenants/repository.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import {
  createPostgresTenantRepository,
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

/** Stesso numero in tabelle.pg.test.ts: i due file non si sovrappongono. */
const LOCK_TENANT_PG = 20260907;

describe.skipIf(!conDatabase)("repository tenant su Postgres", () => {
  const sql = kvSql!;
  let riservata: Awaited<ReturnType<typeof sql.reserve>> | null = null;

  beforeAll(async () => {
    // `tabelle.pg.test.ts` lavora sulle stesse tabelle: il lock consultivo su
    // una connessione riservata serializza i due file, che vitest esegue in
    // parallelo (senza, i DROP di qui cadrebbero in mezzo alle sue prove).
    riservata = await sql.reserve();
    await riservata`SELECT pg_advisory_lock(${LOCK_TENANT_PG})`;
    await sql`DROP TABLE IF EXISTS tenant_inviti, abbonamenti, tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    resetTenantRepositoryForTesting();
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS tenant_inviti, abbonamenti, tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    if (riservata) {
      await riservata`SELECT pg_advisory_unlock(${LOCK_TENANT_PG})`;
      riservata.release();
    }
  });

  it("lo schema è idempotente e il seed del tenant 1 pure", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    resetTenantRepositoryForTesting();
    const repo2 = getTenantRepository();
    await repo2.ensureSchema();
    const t1 = await repo2.assicuraTenantPredefinito();
    const bis = await repo2.assicuraTenantPredefinito();
    expect(t1.id).toBe(1);
    expect(bis.id).toBe(1);
    const righe = await sql`SELECT COUNT(*)::int AS n FROM tenants`;
    expect(righe[0].n).toBe(1);
    const acme = await repo2.inserisci({ slug: "acme", nome: "Acme" });
    expect(acme.id).toBeGreaterThanOrEqual(2);
    await repo2.caricaCache();
    expect(repo2.perSlug("acme")?.id).toBe(acme.id);
  });

  it("tenant_eventi rifiuta UPDATE e DELETE", async () => {
    const repo = getTenantRepository();
    const ev = await repo.registraEvento({ tenantId: 1, tipo: "creato", attore: "boot" });
    await expect(sql`UPDATE tenant_eventi SET motivo = 'x' WHERE id = ${ev.id}`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM tenant_eventi WHERE id = ${ev.id}`).rejects.toThrow(/append-only/);
    expect((await repo.eventi(1)).length).toBe(1);
  });

  it("i comandi si prendono uno alla volta con FOR UPDATE SKIP LOCKED", async () => {
    const repo = getTenantRepository();
    const c = await repo.accodaComando({ tipo: "sospendi", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    expect(await repo.prendiEdEsegui(async x => ({ id: x.id }))).toBe("eseguito");
    expect((await repo.comando(c.id))?.stato).toBe("eseguito");
    expect(await repo.prendiEdEsegui(async () => ({}))).toBe("nessuno");
  });

  it("rifiuta lo slug duplicato anche a cache fredda, dal vincolo UNIQUE di Postgres", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ slug: "doppio", nome: "Uno" });
    resetTenantRepositoryForTesting();
    const repo2 = getTenantRepository();
    await expect(repo2.inserisci({ slug: "doppio", nome: "Due" })).rejects.toThrow(/slug già usato/);
    const righe = await sql`SELECT COUNT(*)::int AS n FROM tenants WHERE slug = 'doppio'`;
    expect(righe[0].n).toBe(1);
  });

  it("lo specchio tenant_sedi è idempotente e segue il tenant di una sede", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    await repo.caricaCache(); // le prove qui sopra lasciano la cache fredda
    const acme = repo.perSlug("acme") ?? (await repo.inserisci({ slug: "acme", nome: "Acme" }));
    await repo.sincronizzaTenantSedi([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 5, tenantId: acme.id },
    ]);
    // Due volte le stesse righe: nessun duplicato, nessun errore di chiave.
    await repo.sincronizzaTenantSedi([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 5, tenantId: acme.id },
    ]);
    expect(await repo.tenantSedi()).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 5, tenantId: acme.id },
    ]);
    // La sede 5 passa al tenant 1: lo specchio la segue, senza righe in più.
    await repo.sincronizzaTenantSedi([{ sedeId: 5, tenantId: 1 }]);
    expect(await repo.tenantSedi()).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 5, tenantId: 1 },
    ]);
    // Lista vuota: non tocca nulla.
    await repo.sincronizzaTenantSedi([]);
    expect((await repo.tenantSedi()).length).toBe(2);
    // Tenant inesistente: la riga viene saltata e il boot non muore sulla
    // chiave esterna (è il caso reale dell'interruttore spento, con `tenants`
    // ancora vuota).
    await expect(repo.sincronizzaTenantSedi([{ sedeId: 9, tenantId: 4242 }])).resolves.toBeUndefined();
    expect((await repo.tenantSedi()).map(r => r.sedeId)).toEqual([1, 5]);
  });

  it("con creaSchema:false lo script non esegue DDL: si ferma se le tabelle mancano e non ricrea il trigger", async () => {
    await sql`DROP TABLE IF EXISTS tenant_inviti, abbonamenti, tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    const soloLettura = createPostgresTenantRepository(sql, { creaSchema: false });
    await expect(soloLettura.caricaCache()).rejects.toThrow(/control plane del tenant assenti/);
    expect((await sql`SELECT to_regclass('tenants') AS t`)[0].t).toBeNull();

    // Il server crea lo schema; poi lo script legge senza DROP/CREATE TRIGGER.
    resetTenantRepositoryForTesting();
    await getTenantRepository().ensureSchema();
    const trigger = () => sql`SELECT oid FROM pg_trigger WHERE tgname = 'tenant_eventi_solo_insert'`;
    const prima = (await trigger())[0].oid;
    const soloLettura2 = createPostgresTenantRepository(sql, { creaSchema: false });
    await soloLettura2.caricaCache();
    expect(soloLettura2.tutti()).toEqual([]);
    expect((await trigger())[0].oid).toBe(prima);

    // Controprova: il repository del server ricrea il trigger (oid nuovo).
    resetTenantRepositoryForTesting();
    await getTenantRepository().ensureSchema();
    expect((await trigger())[0].oid).not.toBe(prima);

    // Anche lo specchio `tenant_sedi` fa parte del control plane: se manca
    // solo lui, la sonda in sola lettura si ferma lo stesso.
    await sql`DROP TABLE IF EXISTS tenant_sedi`;
    const soloLettura3 = createPostgresTenantRepository(sql, { creaSchema: false });
    await expect(soloLettura3.caricaCache()).rejects.toThrow(/control plane del tenant assenti/);
    resetTenantRepositoryForTesting();
    await getTenantRepository().ensureSchema();
    expect((await sql`SELECT to_regclass('tenant_sedi') AS t`)[0].t).not.toBeNull();
  });

  it("storage e oauth_state su Postgres: incremento atomico, soglia, quota, consumo unico, CHECK dei comandi nuovi", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    await repo.assicuraTenantPredefinito();
    // Delta di segno misto in sequenza, non in Promise.all: con -5 la riga
    // usa il ramo INSERT/UPDATE con GREATEST(delta, 0), quindi il risultato
    // dipende da QUALE arriva per primo al DB (se -5 vince la corsa, la riga
    // nasce a zero invece di sottrarre) — non è un bug, è il clamp voluto,
    // ma rende il test non deterministico se lanciato in concorrenza.
    // Eseguendoli uno alla volta il totale è prevedibile.
    await repo.aggiornaStorage(1, 10, 1);
    await repo.aggiornaStorage(1, 20, 1);
    await repo.aggiornaStorage(1, -5, 0);
    expect(await repo.storageDi(1)).toMatchObject({ bytes: 25, file: 2, quotaBytes: 100 * 1024 ** 3 });
    // Concorrenza vera, ma solo delta positivi: qui il clamp non entra mai in
    // gioco, quindi l'ordine di arrivo non conta e la somma finale deve
    // tornare esatta — è la prova che l'incremento su Postgres è atomico
    // (nessuna scrittura concorrente si perde per una race sul valore letto).
    const primaDellaConcorrenza = await repo.storageDi(1);
    await Promise.all([repo.aggiornaStorage(1, 10, 1), repo.aggiornaStorage(1, 20, 1), repo.aggiornaStorage(1, 5, 1)]);
    const dopoLaConcorrenza = await repo.storageDi(1);
    expect(dopoLaConcorrenza?.bytes).toBe((primaDellaConcorrenza?.bytes ?? 0) + 35);
    expect(dopoLaConcorrenza?.file).toBe((primaDellaConcorrenza?.file ?? 0) + 3);
    await repo.impostaSogliaAvvisata(1, 50);
    expect((await repo.storageDi(1))?.sogliaAvvisata).toBe(50);
    expect((await repo.impostaQuotaStorage(1, 1234)).storageQuotaBytes).toBe(1234);
    expect((await repo.storageDi(1))?.quotaBytes).toBe(1234);
    const state = await repo.emettiStateOAuth({ tipo: "gdrive", tenantId: 1, sedeId: null, utenteId: 1, payload: { a: 1 } });
    expect((await repo.consumaStateOAuth(state, "gdrive"))?.payload).toEqual({ a: 1 });
    expect(await repo.consumaStateOAuth(state, "gdrive")).toBeNull();
    const c = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: 1, payload: { slug: "ruffino-group" }, richiestoDa: "test" });
    expect(c.tipo).toBe("ricalcola_storage");
  });

  it("abbonamenti su Postgres: upsert intero con date e JSON, cache, soglia_100 dello storage, comando nuovo, schema idempotente", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    await repo.assicuraTenantPredefinito();
    expect(repo.abbonamentoDi(1)).toBeNull();
    const ora = new Date("2026-09-08T10:00:00Z");
    // Tenant inesistente: niente riga in `tenants`, la FK di Postgres rifiuta
    // l'INSERT (23503) e viene tradotta nello stesso messaggio della guardia in memoria.
    await expect(
      repo.salvaAbbonamento({
        tenantId: 999999, tipo: "paid", periodicita: "monthly", stato: "active",
        inizioPeriodo: ora, finePeriodo: null, prossimoRinnovo: null, disdettaAFinePeriodo: false,
        budgetTarsNanoMese: null, extraTarsNano: 0, extraTarsMese: null,
        tolleranzaStorageGiorni: 7, tolleranzaTarsGiorni: 7,
        tarsSogliaAvvisata: 0, tarsSogliaMese: null, tarsSoglia100Dal: null,
        insolutoDal: null, provider: "nessuno", providerRef: null, omaggio: null,
        createdAt: ora, updatedAt: ora,
      })
    ).rejects.toThrow(/tenant 999999 inesistente/);
    const salvato = await repo.salvaAbbonamento({
      tenantId: 1, tipo: "complimentary", periodicita: null, stato: "active",
      inizioPeriodo: ora, finePeriodo: null, prossimoRinnovo: null, disdettaAFinePeriodo: false,
      budgetTarsNanoMese: null, extraTarsNano: 0, extraTarsMese: null,
      tolleranzaStorageGiorni: 7, tolleranzaTarsGiorni: 7,
      tarsSogliaAvvisata: 0, tarsSogliaMese: null, tarsSoglia100Dal: null,
      insolutoDal: null, provider: "nessuno", providerRef: { note: "seed" },
      omaggio: { motivo: "proprietaria", attore: "boot", dataIso: ora.toISOString(), scadenzaIso: null },
      createdAt: ora, updatedAt: ora,
    });
    expect(salvato.stato).toBe("active");
    expect(salvato.omaggio?.motivo).toBe("proprietaria");
    expect(salvato.inizioPeriodo.toISOString()).toBe(ora.toISOString());
    expect(repo.abbonamentoDi(1)?.providerRef).toEqual({ note: "seed" });

    // Upsert che cambia stato: stessa chiave primaria, nessuna riga in più.
    const aggiornato = await repo.salvaAbbonamento({ ...salvato, stato: "suspended", insolutoDal: ora });
    expect(repo.abbonamentoDi(1)?.stato).toBe("suspended");
    expect(aggiornato.updatedAt.getTime()).toBeGreaterThanOrEqual(salvato.updatedAt.getTime());
    expect(aggiornato.createdAt.toISOString()).toBe(salvato.createdAt.toISOString());
    const righe = await sql`SELECT COUNT(*)::int AS n FROM abbonamenti`;
    expect(righe[0].n).toBe(1);

    // caricaCache() su un repository nuovo: la cache degli abbonamenti si
    // ricostruisce da zero, come quella dei tenant.
    resetTenantRepositoryForTesting();
    const repo2 = getTenantRepository();
    await repo2.caricaCache();
    expect(repo2.abbonamentoDi(1)?.stato).toBe("suspended");
    expect(repo2.abbonamenti().map(a => a.tenantId)).toEqual([1]);

    // Soglia 100 dello storage: impostata PRIMA di ogni delta, su un tenant
    // fresco — il tenant 1 in questo file ha già una riga `tenant_storage`
    // dal test precedente. Qui la riga non esiste ancora: `impostaSoglia100Storage`
    // la crea da sé (stesso ON CONFLICT di `impostaSogliaAvvisata`); un delta
    // successivo non la tocca; si riarma a null.
    const tenantStorage = await repo2.inserisci({ slug: "abbonamenti-soglia100", nome: "Soglia100 Srl" });
    expect(await repo2.storageDi(tenantStorage.id)).toBeNull();
    await repo2.impostaSoglia100Storage(tenantStorage.id, ora);
    expect((await repo2.storageDi(tenantStorage.id))?.soglia100Dal?.toISOString()).toBe(ora.toISOString());
    await repo2.aggiornaStorage(tenantStorage.id, 10, 1);
    expect((await repo2.storageDi(tenantStorage.id))?.soglia100Dal?.toISOString()).toBe(ora.toISOString());
    await repo2.impostaSoglia100Storage(tenantStorage.id, null);
    expect((await repo2.storageDi(tenantStorage.id))?.soglia100Dal).toBeNull();

    // Il CHECK di tenant_comandi accetta già il tipo nuovo.
    const comando = await repo2.accodaComando({ tipo: "imposta_abbonamento", tenantId: 1, payload: { tipo: "paid" }, richiestoDa: "test" });
    expect(comando.tipo).toBe("imposta_abbonamento");

    // Idempotenza dello schema: un secondo ensureSchema (repository fresco,
    // quindi non memoizzato) non fallisce — la guardia sul CHECK trova già
    // `imposta_abbonamento` e salta l'ALTER.
    resetTenantRepositoryForTesting();
    const repo3 = getTenantRepository();
    await expect(repo3.ensureSchema()).resolves.toBeUndefined();
  });

  // WS6 (pannello piattaforma, spec §4.1-§4.2): stessi due casi del repository
  // in memoria, sulla tabella vera — token monouso, annullo dei precedenti,
  // consumo una tantum, scadenza e pulizia dopo 30 giorni. Sette giorni reali
  // non si aspettano in un test: la scadenza si simula retrodatando `scade_il`
  // con SQL diretto, come farebbe il tempo che passa davvero.
  it("inviti su Postgres: token monouso, annulla i precedenti, consumo unico, scadenza e pulizia dopo 30 giorni", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    const acme = repo.perSlug("acme-inviti") ?? (await repo.inserisci({ slug: "acme-inviti", nome: "Acme Inviti" }));

    const primo = await repo.emettiInvito({ tenantId: acme.id, utenteId: 701, email: "M@Acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    const secondo = await repo.emettiInvito({ tenantId: acme.id, utenteId: 701, email: "m@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    expect(primo.token).not.toBe(secondo.token);
    expect(primo.token.length).toBeGreaterThanOrEqual(40);
    expect(primo.invito.email).toBe("m@acme.test"); // normalizzata minuscola
    expect(await repo.invitoPerToken(primo.token)).toBeNull(); // annullato dal secondo
    expect((await repo.invitoPerToken(secondo.token))?.id).toBe(secondo.invito.id);
    expect((await repo.invitiDi(acme.id)).map(i => [i.id, i.annullatoIl !== null])).toEqual([
      [secondo.invito.id, false],
      [primo.invito.id, true],
    ]);

    // Consumo una tantum.
    expect((await repo.consumaInvito(secondo.token))?.id).toBe(secondo.invito.id);
    expect(await repo.consumaInvito(secondo.token)).toBeNull();

    // Scadenza simulata retrodatando `scade_il`.
    const terzo = await repo.emettiInvito({ tenantId: acme.id, utenteId: 702, email: "z@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    await sql`UPDATE tenant_inviti SET scade_il = NOW() - interval '1 second' WHERE id = ${terzo.invito.id}`;
    expect(await repo.invitoPerToken(terzo.token)).toBeNull();
    expect(await repo.consumaInvito(terzo.token)).toBeNull();

    // Annullato: non consumabile, e annullarlo di nuovo è idempotente.
    const quarto = await repo.emettiInvito({ tenantId: acme.id, utenteId: 703, email: "w@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    expect((await repo.annullaInvito(quarto.invito.id))?.annullatoIl).not.toBeNull();
    expect(await repo.consumaInvito(quarto.token)).toBeNull();
    expect((await repo.annullaInvito(quarto.invito.id))?.id).toBe(quarto.invito.id);

    // pulisciInvitiScaduti: cancella solo chi è scaduto da più di 30 giorni.
    expect(await repo.pulisciInvitiScaduti()).toBe(0); // il terzo è scaduto da 1 secondo, non da 30 giorni
    await sql`UPDATE tenant_inviti SET scade_il = NOW() - interval '31 days' WHERE id = ${terzo.invito.id}`;
    expect(await repo.pulisciInvitiScaduti()).toBeGreaterThanOrEqual(1);
    expect((await repo.invitiDi(acme.id)).map(i => i.id)).not.toContain(terzo.invito.id);
  });

  it("concorrenza: due consumaInvito sullo stesso token danno esattamente un vincitore; prendiEdEsegui(soloId) con due comandi", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    const acme = repo.perSlug("acme-inviti-conc") ?? (await repo.inserisci({ slug: "acme-inviti-conc", nome: "Acme Concorrenza" }));
    const { token } = await repo.emettiInvito({ tenantId: acme.id, utenteId: 801, email: "conc@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    const risultati = await Promise.all([repo.consumaInvito(token), repo.consumaInvito(token)]);
    expect(risultati.filter(r => r !== null).length).toBe(1);

    const c1 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: acme.id, payload: { slug: acme.slug }, richiestoDa: "test" });
    const c2 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: acme.id, payload: { slug: acme.slug }, richiestoDa: "test" });
    const visti: number[] = [];
    expect(
      await repo.prendiEdEsegui(
        async c => {
          visti.push(c.id);
          return { ok: true };
        },
        { soloId: c2.id }
      )
    ).toBe("eseguito");
    expect(visti).toEqual([c2.id]);
    expect((await repo.comando(c1.id))?.stato).toBe("in_attesa");
    expect(await repo.prendiEdEsegui(async () => ({}), { soloId: c2.id })).toBe("nessuno");
    expect(
      await repo.prendiEdEsegui(
        async c => {
          visti.push(c.id);
          return {};
        },
        { soloId: c1.id }
      )
    ).toBe("eseguito");
    expect(visti).toEqual([c2.id, c1.id]);
  });

  // WS6 (pannello piattaforma, spec §4.3, fix round 1): `comandiDi`,
  // `storageTutti` ed `eventiRecenti` erano finora esercitati solo dal
  // repository in memoria — il loro SQL non aveva mai girato su Postgres
  // vero. I tre test seguenti chiudono quel buco prima che il router del
  // pannello (Task 6) dipenda da questi metodi.
  it("comandiDi su Postgres: più recenti prima, ultimi taglia, tenant sconosciuto dà vuoto", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    const a = repo.perSlug("comandi-a") ?? (await repo.inserisci({ slug: "comandi-a", nome: "Comandi A" }));
    const b = repo.perSlug("comandi-b") ?? (await repo.inserisci({ slug: "comandi-b", nome: "Comandi B" }));
    const a1 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: a.id, payload: { slug: a.slug }, richiestoDa: "test" });
    const a2 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: a.id, payload: { slug: a.slug }, richiestoDa: "test" });
    const b1 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: b.id, payload: { slug: b.slug }, richiestoDa: "test" });

    expect((await repo.comandiDi(a.id)).map(c => c.id)).toEqual([a2.id, a1.id]);
    expect((await repo.comandiDi(a.id, { ultimi: 1 })).map(c => c.id)).toEqual([a2.id]);
    expect((await repo.comandiDi(b.id)).map(c => c.id)).toEqual([b1.id]);
    expect(await repo.comandiDi(999999)).toEqual([]);
  });

  it("storageTutti su Postgres: tutte le aziende in una query, quota di ciascuna, ordinate per tenantId", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    const c = repo.perSlug("storage-tutti-c") ?? (await repo.inserisci({ slug: "storage-tutti-c", nome: "Storage Tutti C" }));
    const d = repo.perSlug("storage-tutti-d") ?? (await repo.inserisci({ slug: "storage-tutti-d", nome: "Storage Tutti D" }));
    await repo.aggiornaStorage(c.id, 111, 3);
    await repo.aggiornaStorage(d.id, 222, 5);
    await repo.impostaQuotaStorage(c.id, 777);

    const tutte = await repo.storageTutti();
    const tenantIds = tutte.map(s => s.tenantId);
    expect(tenantIds).toEqual([...tenantIds].sort((x, y) => x - y)); // ordinate per tenantId

    expect(tutte.find(s => s.tenantId === c.id)).toMatchObject({ bytes: 111, file: 3, quotaBytes: 777 });
    expect(tutte.find(s => s.tenantId === d.id)).toMatchObject({ bytes: 222, file: 5, quotaBytes: 100 * 1024 ** 3 });
  });

  // La tabella è append-only (trigger `tenant_eventi_solo_insert`, vedi il
  // test più sopra): per simulare un evento vecchio si retrodata `created_at`
  // con SQL diretto, aggirando il trigger SOLO per questa transazione con
  // `session_replication_role = replica` (un `SET LOCAL`: si spegne da solo
  // alla fine della transazione, la tabella resta append-only per tutti gli
  // altri test del file).
  it("eventiRecenti su Postgres: filtra per tipo e finestra di tempo su tutte le aziende, tenant giusto", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    const e1 = repo.perSlug("eventi-recenti-e1") ?? (await repo.inserisci({ slug: "eventi-recenti-e1", nome: "Eventi Recenti E1" }));
    const e2 = repo.perSlug("eventi-recenti-e2") ?? (await repo.inserisci({ slug: "eventi-recenti-e2", nome: "Eventi Recenti E2" }));

    const vecchio = await repo.registraEvento({ tenantId: e1.id, tipo: "worker_sospeso", attore: "boot", dettagli: { etichetta: "imap" } });
    await sql.begin(async tx => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE tenant_eventi SET created_at = NOW() - interval '2 hours' WHERE id = ${vecchio.id}`;
    });

    const da = new Date();
    const recenteA = await repo.registraEvento({ tenantId: e1.id, tipo: "worker_sospeso", attore: "boot", dettagli: { etichetta: "smtp" } });
    const recenteB = await repo.registraEvento({ tenantId: e2.id, tipo: "worker_riarmato", attore: "boot" });
    await repo.registraEvento({ tenantId: e2.id, tipo: "creato", attore: "boot" }); // tipo non richiesto: escluso

    const risultato = await repo.eventiRecenti({ tipi: ["worker_sospeso", "worker_riarmato"], da });
    expect(risultato.map(e => e.id)).toEqual([recenteA.id, recenteB.id]); // ascendente per id, il vecchio fuori dalla finestra
    expect(risultato.map(e => e.tenantId)).toEqual([e1.id, e2.id]);
  });

  it("lo schema del WS3 è idempotente anche sopra uno schema del WS2 (CHECK vecchio a terra)", async () => {
    await sql`DROP TABLE IF EXISTS tenant_inviti, abbonamenti, tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    await sql`CREATE TABLE tenants (id BIGSERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      stato TEXT NOT NULL CHECK (stato IN ('attivo','sospeso')), motivo_stato TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE tenant_comandi (id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario')),
      tenant_id BIGINT, payload JSONB NOT NULL, stato TEXT NOT NULL DEFAULT 'in_attesa', esito JSONB,
      richiesto_da TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), eseguito_at TIMESTAMPTZ)`;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.assicuraTenantPredefinito();
    const c = await repo.accodaComando({ tipo: "ripristina_archivi", tenantId: 1, payload: {}, richiestoDa: "test" });
    expect(c.tipo).toBe("ripristina_archivi");
    expect((await sql`SELECT storage_quota_bytes FROM tenants WHERE id = 1`)[0].storage_quota_bytes).toBe(String(100 * 1024 ** 3));
  });
});
