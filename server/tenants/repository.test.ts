import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TTL_INVITO_MS } from "./costanti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

beforeEach(() => {
  resetTenantRepositoryForTesting();
});

describe("repository tenant in memoria", () => {
  it("semina il tenant 1 in modo idempotente e assegna gli id successivi", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    const t1 = await repo.assicuraTenantPredefinito();
    const ancora = await repo.assicuraTenantPredefinito();
    expect(t1.id).toBe(1);
    expect(ancora.id).toBe(1);
    expect(t1.slug).toBe("ruffino-group");
    expect(t1.stato).toBe("attivo");
    const acme = await repo.inserisci({ slug: "acme", nome: "Acme Infissi" });
    expect(acme.id).toBe(2);
    expect(repo.perSlug("acme")?.id).toBe(2);
    expect(repo.perId(3)).toBeNull();
    expect(repo.tutti().map(t => t.id)).toEqual([1, 2]);
  });

  it("rifiuta slug duplicati", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ slug: "acme", nome: "Acme" });
    await expect(repo.inserisci({ slug: "acme", nome: "Acme bis" })).rejects.toThrow(/slug/);
  });

  it("aggiorna lo stato e registra eventi in ordine", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const sospeso = await repo.aggiornaStato(t.id, "sospeso", "insoluto");
    expect(sospeso.stato).toBe("sospeso");
    expect(repo.perId(t.id)?.motivoStato).toBe("insoluto");
    await repo.registraEvento({ tenantId: t.id, tipo: "creato", attore: "boot" });
    await repo.registraEvento({ tenantId: t.id, tipo: "sospeso", attore: "script:tenant@qui", motivo: "insoluto" });
    const eventi = await repo.eventi(t.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creato", "sospeso"]);
    expect(eventi[1].motivo).toBe("insoluto");
  });

  // «Modifica azienda» (piano 2026-09-09, Task 1): un tenant nuovo nasce
  // senza dati di fatturazione né note, tutti null finché nessuno li compila.
  it("inserisci: fatturazione e note nascono a null", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    expect(t.note).toBeNull();
    expect(t.fatturazione).toEqual({
      partitaIva: null,
      codiceFiscale: null,
      indirizzoLegale: null,
      emailAmministrativa: null,
      pec: null,
      codiceSdi: null,
    });
  });

  it("aggiornaTenant: nome, note e fatturazione si aggiornano parzialmente, i campi non toccati restano com'erano", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });

    const conNote = await repo.aggiornaTenant(t.id, { nome: "Acme Infissi", note: "cliente storico" });
    expect(conNote.nome).toBe("Acme Infissi");
    expect(conNote.note).toBe("cliente storico");
    expect(conNote.fatturazione.partitaIva).toBeNull(); // non toccata da questo giro
    expect(conNote.updatedAt.getTime()).toBeGreaterThanOrEqual(t.updatedAt.getTime());

    const conFatturazione = await repo.aggiornaTenant(t.id, {
      fatturazione: { partitaIva: "01234567890", pec: "acme@pec.it" },
    });
    expect(conFatturazione.fatturazione).toEqual({
      partitaIva: "01234567890",
      codiceFiscale: null,
      indirizzoLegale: null,
      emailAmministrativa: null,
      pec: "acme@pec.it",
      codiceSdi: null,
    });
    // Nome e note del giro precedente sopravvivono: l'aggiornamento è parziale.
    expect(conFatturazione.nome).toBe("Acme Infissi");
    expect(conFatturazione.note).toBe("cliente storico");

    // Una seconda fatturazione parziale non azzera i campi già scritti.
    const ancora = await repo.aggiornaTenant(t.id, { fatturazione: { codiceSdi: "ABC1234" } });
    expect(ancora.fatturazione).toMatchObject({ partitaIva: "01234567890", pec: "acme@pec.it", codiceSdi: "ABC1234" });

    // `null` esplicito azzera il campo; la chiave assente lo lascia stare.
    const azzerata = await repo.aggiornaTenant(t.id, { note: null });
    expect(azzerata.note).toBeNull();
  });

  it("aggiornaTenant: lo slug cambiato sposta perSlug, quello duplicato è rifiutato, il proprio invariato è ok", async () => {
    const repo = getTenantRepository();
    const acme = await repo.inserisci({ slug: "acme", nome: "Acme" });
    await repo.inserisci({ slug: "beta", nome: "Beta" });

    await expect(repo.aggiornaTenant(acme.id, { slug: "beta" })).rejects.toThrow(/Slug già usato/);
    expect(repo.perSlug("beta")?.nome).toBe("Beta"); // il tentativo rifiutato non ha toccato l'altra azienda

    await expect(repo.aggiornaTenant(acme.id, { slug: "acme" })).resolves.toMatchObject({ slug: "acme" });

    const spostato = await repo.aggiornaTenant(acme.id, { slug: "acme-nuovo" });
    expect(spostato.slug).toBe("acme-nuovo");
    expect(repo.perSlug("acme")).toBeNull();
    expect(repo.perSlug("acme-nuovo")?.id).toBe(acme.id);
    expect(repo.perId(acme.id)?.slug).toBe("acme-nuovo");
  });

  it("aggiornaTenant su un id inesistente dà errore", async () => {
    const repo = getTenantRepository();
    await expect(repo.aggiornaTenant(999, { nome: "x" })).rejects.toThrow(/999/);
  });

  // `pnpm tenant elenco` legge gli eventi per sapere quali worker sono
  // sospesi ADESSO: senza limite si porta a casa la cronologia intera di
  // un'azienda vecchia (fix wave finale).
  it("eventi({ ultimi }) dà solo la coda, sempre in ordine crescente", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    for (const motivo of ["a", "b", "c", "d", "e"]) {
      await repo.registraEvento({ tenantId: t.id, tipo: "sospeso", attore: "boot", motivo });
    }
    expect((await repo.eventi(t.id, { ultimi: 2 })).map(e => e.motivo)).toEqual(["d", "e"]);
    // Più di quanti ce ne sono: li dà tutti, senza lamentarsi.
    expect((await repo.eventi(t.id, { ultimi: 99 })).map(e => e.motivo)).toEqual(["a", "b", "c", "d", "e"]);
    // `ultimi: 0` vale «tutti» (su Postgres LIMIT 0 darebbe zero righe: le due implementazioni concordano).
    expect((await repo.eventi(t.id, { ultimi: 0 })).map(e => e.motivo)).toEqual(["a", "b", "c", "d", "e"]);
    // Senza opzione, il comportamento di sempre.
    expect((await repo.eventi(t.id)).map(e => e.motivo)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("i comandi passano da in_attesa a eseguito o errore, uno alla volta", async () => {
    const repo = getTenantRepository();
    const a = await repo.accodaComando({ tipo: "sospendi", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@qui" });
    const b = await repo.accodaComando({ tipo: "riattiva", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@qui" });
    expect((await repo.comandiInAttesa()).map(c => c.id)).toEqual([a.id, b.id]);

    const primo = await repo.prendiEdEsegui(async c => ({ visto: c.id }));
    expect(primo).toBe("eseguito");
    expect((await repo.comando(a.id))?.esito).toEqual({ visto: a.id });

    const secondo = await repo.prendiEdEsegui(async () => {
      throw new Error("payload rotto");
    });
    expect(secondo).toBe("errore");
    expect((await repo.comando(b.id))?.esito).toEqual({ errore: "payload rotto" });
    expect((await repo.comando(b.id))?.eseguitoAt).toBeInstanceOf(Date);

    expect(await repo.prendiEdEsegui(async () => ({}))).toBe("nessuno");
    expect(await repo.comandiInAttesa()).toEqual([]);
  });

  it("azzera passwordHash nel payload alla chiusura del comando crea (Minor 1)", async () => {
    const repo = getTenantRepository();
    const payload = {
      slug: "acme",
      nome: "Acme Infissi",
      sede: { nome: "Acme Infissi" },
      proprietario: {
        nome: "Mario",
        cognome: "Rossi",
        email: "mario@acme.test",
        passwordHash: "scrypt$deadbeef$…",
      },
    };
    const comando = await repo.accodaComando({
      tipo: "crea",
      tenantId: null,
      payload,
      richiestoDa: "script:tenant@test",
    });
    expect((await repo.comando(comando.id))?.payload.proprietario).toMatchObject({
      passwordHash: payload.proprietario.passwordHash,
    });
    await repo.prendiEdEsegui(async () => ({ tenantId: 1 }));
    const chiuso = await repo.comando(comando.id);
    expect(chiuso?.stato).toBe("eseguito");
    expect((chiuso?.payload as any)?.proprietario?.passwordHash).toBeUndefined();
    // Il resto del payload resta leggibile (non è un redact totale).
    expect((chiuso?.payload as any)?.proprietario?.email).toBe("mario@acme.test");
  });

  it("lo specchio delle sedi in memoria è idempotente, segue il tenant di una sede e salta i tenant inesistenti", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    const due = await repo.inserisci({ slug: "due", nome: "Due Srl" });
    expect(await repo.tenantSedi()).toEqual([]);
    await repo.sincronizzaTenantSedi([
      { sedeId: 2, tenantId: 1 },
      { sedeId: 1, tenantId: 1 },
    ]);
    await repo.sincronizzaTenantSedi([{ sedeId: 1, tenantId: 1 }]);
    // Ordinate per sede, come la variante Postgres.
    expect(await repo.tenantSedi()).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 2, tenantId: 1 },
    ]);
    await repo.sincronizzaTenantSedi([{ sedeId: 2, tenantId: due.id }]);
    expect(await repo.tenantSedi()).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 2, tenantId: due.id },
    ]);
    // Tenant inesistente: la riga viene saltata, come farebbe la chiave
    // esterna su Postgres. Non è un errore.
    await repo.sincronizzaTenantSedi([{ sedeId: 3, tenantId: 99 }]);
    expect((await repo.tenantSedi()).map(r => r.sedeId)).toEqual([1, 2]);
    await repo.sincronizzaTenantSedi([]);
    expect((await repo.tenantSedi()).length).toBe(2);
  });

  it("storage: la riga nasce al primo delta, incrementa, non scende sotto zero, porta la quota", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    expect(await repo.storageDi(1)).toBeNull();
    const a = await repo.aggiornaStorage(1, 1000, 1);
    expect(a).toMatchObject({ tenantId: 1, bytes: 1000, file: 1, quotaBytes: 100 * 1024 ** 3, sogliaAvvisata: 0, ricalcolatoIl: null });
    const b = await repo.aggiornaStorage(1, -5000, -3);
    expect(b).toMatchObject({ bytes: 0, file: 0 });
    const c = await repo.impostaStorage(1, { bytes: 42, file: 2 });
    expect(c.bytes).toBe(42);
    expect(c.ricalcolatoIl).toBeInstanceOf(Date);
    await repo.impostaSogliaAvvisata(1, 80);
    expect((await repo.storageDi(1))?.sogliaAvvisata).toBe(80);
    const t = await repo.impostaQuotaStorage(1, 10);
    expect(t.storageQuotaBytes).toBe(10);
    expect((await repo.storageDi(1))?.quotaBytes).toBe(10);
  });

  it("oauth_state: consumo unico, tipo giusto, scadenza", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    const state = await repo.emettiStateOAuth({ tipo: "fic", tenantId: 1, sedeId: 3, utenteId: 7, payload: { redirectUri: "https://x/cb", scrittura: true } });
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await repo.consumaStateOAuth(state, "gdrive")).toBeNull();
    const riga = await repo.consumaStateOAuth(state, "fic");
    expect(riga).toMatchObject({ tipo: "fic", tenantId: 1, sedeId: 3, utenteId: 7, payload: { redirectUri: "https://x/cb", scrittura: true } });
    expect(await repo.consumaStateOAuth(state, "fic")).toBeNull(); // già consumato
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    const scaduto = await repo.emettiStateOAuth({ tipo: "gdrive", tenantId: 1, sedeId: null, utenteId: 7, payload: {} });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await repo.consumaStateOAuth(scaduto, "gdrive")).toBeNull();
    // 2, non 1: il primo state ("fic") ha lo stesso TTL di 10 minuti ed è
    // nato pochi istanti prima dello snapshot dell'orologio finto; avanzare
    // di 11 minuti lo scade anche se è già stato consumato. `pulisciStateScaduti`
    // pulisce per scadenza (spec WS3 §5: «pulizia delle righe scadute»), senza
    // eccezione per le righe già consumate.
    expect(await repo.pulisciStateScaduti()).toBe(2);
    vi.useRealTimers();
  });

  it("abbonamenti: upsert intero, cache, soglia_100 dello storage", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    expect(repo.abbonamentoDi(1)).toBeNull();
    const ora = new Date("2026-09-08T10:00:00Z");
    const a = await repo.salvaAbbonamento({
      tenantId: 1, tipo: "complimentary", periodicita: null, stato: "active",
      inizioPeriodo: ora, finePeriodo: null, prossimoRinnovo: null, disdettaAFinePeriodo: false,
      budgetTarsNanoMese: null, extraTarsNano: 0, extraTarsMese: null,
      tolleranzaStorageGiorni: 7, tolleranzaTarsGiorni: 7,
      tarsSogliaAvvisata: 0, tarsSogliaMese: null, tarsSoglia100Dal: null,
      insolutoDal: null, provider: "nessuno", providerRef: null,
      omaggio: { motivo: "proprietaria", attore: "boot", dataIso: ora.toISOString(), scadenzaIso: null },
      createdAt: ora, updatedAt: ora,
    });
    expect(a.stato).toBe("active");
    expect(repo.abbonamentoDi(1)?.omaggio?.motivo).toBe("proprietaria");
    const b = await repo.salvaAbbonamento({ ...a, stato: "suspended", insolutoDal: ora });
    expect(repo.abbonamentoDi(1)?.stato).toBe("suspended");
    expect(b.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());
    expect(repo.abbonamenti().map(x => x.tenantId)).toEqual([1]);
    await repo.aggiornaStorage(1, 10, 1);
    await repo.impostaSoglia100Storage(1, ora);
    expect((await repo.storageDi(1))?.soglia100Dal?.toISOString()).toBe(ora.toISOString());
    await repo.impostaSoglia100Storage(1, null);
    expect((await repo.storageDi(1))?.soglia100Dal).toBeNull();
  });

  // Postgres lo fa via la FK verso `tenants` (23503, vedi repository.pg.test.ts);
  // qui non c'è una FK, quindi la guardia è a mano — stesso messaggio.
  it("abbonamenti: rifiuta la scrittura se il tenant non esiste", async () => {
    const repo = getTenantRepository();
    const ora = new Date("2026-09-08T10:00:00Z");
    await expect(
      repo.salvaAbbonamento({
        tenantId: 999, tipo: "paid", periodicita: "monthly", stato: "active",
        inizioPeriodo: ora, finePeriodo: null, prossimoRinnovo: null, disdettaAFinePeriodo: false,
        budgetTarsNanoMese: null, extraTarsNano: 0, extraTarsMese: null,
        tolleranzaStorageGiorni: 7, tolleranzaTarsGiorni: 7,
        tarsSogliaAvvisata: 0, tarsSogliaMese: null, tarsSoglia100Dal: null,
        insolutoDal: null, provider: "nessuno", providerRef: null, omaggio: null,
        createdAt: ora, updatedAt: ora,
      })
    ).rejects.toThrow(/tenant 999 inesistente/);
  });
});

// Pannello piattaforma (WS6, spec §4.1-§4.3): inviti a token monouso e le
// letture in blocco che la scheda azienda e l'elenco useranno (una query per
// tutte le aziende, non una per tenant).
describe("inviti e letture in blocco (WS6)", () => {
  const T0 = new Date("2026-09-09T10:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emette un invito con token monouso e ne annulla i precedenti dello stesso utente", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const primo = await repo.emettiInvito({ tenantId: t.id, utenteId: 7, email: "m@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    const secondo = await repo.emettiInvito({ tenantId: t.id, utenteId: 7, email: "m@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    expect(primo.token).not.toBe(secondo.token);
    expect(primo.token.length).toBeGreaterThanOrEqual(40);
    expect(await repo.invitoPerToken(primo.token)).toBeNull(); // annullato dal secondo
    expect((await repo.invitoPerToken(secondo.token))?.id).toBe(secondo.invito.id);
    expect((await repo.invitiDi(t.id)).map(i => [i.id, i.annullatoIl !== null])).toEqual([
      [secondo.invito.id, false],
      [primo.invito.id, true],
    ]);
    expect(secondo.invito.scadeIl.getTime()).toBe(T0.getTime() + TTL_INVITO_MS);
  });

  it("consuma una volta sola, mai scaduto o annullato", async () => {
    const repo = getTenantRepository();
    const t = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const { token, invito } = await repo.emettiInvito({ tenantId: t.id, utenteId: 7, email: "m@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    expect((await repo.consumaInvito(token))?.id).toBe(invito.id);
    expect(await repo.consumaInvito(token)).toBeNull();
    const { token: t2 } = await repo.emettiInvito({ tenantId: t.id, utenteId: 8, email: "g@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    vi.setSystemTime(new Date(T0.getTime() + TTL_INVITO_MS + 1));
    expect(await repo.invitoPerToken(t2)).toBeNull();
    expect(await repo.consumaInvito(t2)).toBeNull();
    const { token: t3, invito: i3 } = await repo.emettiInvito({ tenantId: t.id, utenteId: 9, email: "z@acme.test", tipo: "proprietario", creatoDa: "piattaforma:t@r.it" });
    expect((await repo.annullaInvito(i3.id))?.annullatoIl).not.toBeNull();
    expect(await repo.consumaInvito(t3)).toBeNull();
    expect(await repo.pulisciInvitiScaduti()).toBe(0); // scaduti da meno di 30 giorni: restano
    vi.setSystemTime(new Date(T0.getTime() + TTL_INVITO_MS + 31 * 24 * 3600 * 1000));
    expect(await repo.pulisciInvitiScaduti()).toBeGreaterThanOrEqual(1);
  });

  it("comandiDi, storageTutti ed eventiRecenti leggono in blocco", async () => {
    const repo = getTenantRepository();
    const a = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const b = await repo.inserisci({ slug: "beta", nome: "Beta" });
    await repo.aggiornaStorage(a.id, 10, 1);
    await repo.aggiornaStorage(b.id, 20, 2);
    await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: a.id, payload: { slug: "acme" }, richiestoDa: "piattaforma:t@r.it" });
    await repo.registraEvento({ tenantId: b.id, tipo: "worker_sospeso", attore: "boot", dettagli: { etichetta: "imap", minuti: 15 } });
    expect((await repo.storageTutti()).map(s => [s.tenantId, s.bytes])).toEqual([[a.id, 10], [b.id, 20]]);
    expect((await repo.comandiDi(a.id, { ultimi: 20 })).map(c => c.tipo)).toEqual(["ricalcola_storage"]);
    expect(await repo.comandiDi(b.id)).toEqual([]);
    const recenti = await repo.eventiRecenti({ tipi: ["worker_sospeso", "worker_riarmato"], da: new Date(T0.getTime() - 3600_000) });
    expect(recenti.map(e => [e.tenantId, e.tipo])).toEqual([[b.id, "worker_sospeso"]]);
  });

  it("prendiEdEsegui con soloId prende solo quel comando", async () => {
    const repo = getTenantRepository();
    const a = await repo.inserisci({ slug: "acme", nome: "Acme" });
    const c1 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: a.id, payload: { slug: "acme" }, richiestoDa: "x" });
    const c2 = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: a.id, payload: { slug: "acme" }, richiestoDa: "x" });
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
  });
});
