import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as persistenza from "../_core/persistence";
// Side-effect: registra "preventivi_documenti"/"ticket_allegati", che
// `avviaRicalcoloStorageIniziale` (Task 4) legge con `storeDi`.
import "../routers";
import { getSediStore } from "../routers/sedi";
// WS4 (Task 3 fix round 1, Ruling R7): `completaTenants` NON avvia più il
// worker degli abbonamenti — parte solo dopo il `listen`, in
// `_core/index.ts` (mai dal boot, testato in questo file). Il fermo resta
// qui come rete di sicurezza pura, senza effetto pratico sui test sotto.
import { fermaWorkerAbbonamenti } from "../abbonamenti/worker";
import {
  avviaBackfillTabelleTenant,
  avviaRicalcoloStorageIniziale,
  avviaTenants,
  completaTenants,
  fermaTenants,
  preparaTenants,
} from "./boot";
import { INTERVALLO_COMANDI_MS, TTL_STATE_OAUTH_MS } from "./costanti";
import { righeTenantSedi } from "./regole";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import * as servizioModulo from "./servizio";
import { ricalcolaStorageSeManca } from "./storage";
import * as tabelleModulo from "./tabelle";

const SEDE_A = 91201;
const SEDE_B = 91202;

/** Due sedi di prova nello store vivo, con il loro ripristino. */
function seminaSedi(): () => void {
  const sedi = getSediStore();
  const quante = sedi.length;
  const now = new Date();
  const base = { citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now };
  sedi.push(
    { ...base, id: SEDE_A, tenantId: 1, nome: "Sede tenant 1" },
    { ...base, id: SEDE_B, tenantId: 2, nome: "Sede tenant 2" }
  );
  return () => sedi.splice(quante);
}

beforeEach(() => {
  resetTenantRepositoryForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  fermaTenants();
  fermaWorkerAbbonamenti();
  vi.useRealTimers();
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("avviaTenants", () => {
  it("acceso: semina il tenant 1 ed esegue i comandi al boot e ogni 30 s", async () => {
    const repo = getTenantRepository();
    await avviaTenants();
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "prova del boot" },
      richiestoDa: "script:tenant@test",
    });
    await vi.advanceTimersByTimeAsync(INTERVALLO_COMANDI_MS + 10);
    expect(repo.perId(1)?.stato).toBe("sospeso");
  });

  it("spento: schema, cache e la sola riga del tenant 1 nel control plane; nessun altro store toccato, comandi lasciati in attesa", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "resta in attesa" },
      richiestoDa: "script:tenant@test",
    });
    await avviaTenants();
    // Task 12 fix round 1 (Ruling R13): la riga control plane del tenant 1 si
    // semina anche a interruttore spento — è additiva e inerte finché il
    // flag resta spento, ma serve allo specchio e al backfill del deploy
    // spento. Nessun altro tenant, nessun comando eseguito.
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    expect(repo.tutti().map(t => t.id)).toEqual([1]);
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });
});

describe("preparaTenants", () => {
  it("spento: restituisce [1] e semina SOLO la riga del tenant 1 nel control plane (Ruling R13)", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    const ids = await preparaTenants();
    expect(ids).toEqual([1]);
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    expect(repo.tutti().map(t => t.id)).toEqual([1]);
  });

  it("acceso: semina il tenant 1 e restituisce tutti i tenant in cache, anche i sospesi", async () => {
    const repo = getTenantRepository();
    const primi = await preparaTenants();
    expect(primi).toEqual([1]);
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    const sospesa = await repo.inserisci({ slug: "sospesa", nome: "Sospesa Srl", stato: "sospeso" });
    const ids = await preparaTenants();
    expect([...ids].sort((a, b) => a - b)).toEqual([1, sospesa.id].sort((a, b) => a - b));
  });
});

describe("completaTenants", () => {
  it("non tocca lo schema: ensureSchema del repository lo chiama solo preparaTenants", async () => {
    const repo = getTenantRepository();
    const spy = vi.spyOn(repo, "ensureSchema");
    await preparaTenants();
    expect(spy).toHaveBeenCalledTimes(1);
    await completaTenants();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("spento: la riga del tenant 1 è già seminata da preparaTenants; completaTenants non allinea il proprietario né esegue i comandi in attesa", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    const spiaAllinea = vi.spyOn(servizioModulo, "allineaTenantPredefinito");
    await repo.accodaComando({
      tipo: "sospendi",
      tenantId: 1,
      payload: { slug: "ruffino-group", motivo: "resta in attesa" },
      richiestoDa: "script:tenant@test",
    });
    await preparaTenants();
    // Ruling R13: la riga del tenant 1 esiste già dopo `preparaTenants`, a
    // interruttore spento. Ciò che resta condizionato all'interruttore, in
    // `completaTenants`, è solo la parte che tocca gli store: l'allineamento
    // del proprietario di ripiego e i comandi in attesa.
    expect(repo.perId(1)?.slug).toBe("ruffino-group");
    await completaTenants();
    expect(spiaAllinea).not.toHaveBeenCalled();
    expect((await repo.comandiInAttesa()).length).toBe(1);
  });

  it("sincronizza lo specchio tenant_sedi anche a interruttore spento", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const ripristina = seminaSedi();
    try {
      const repo = getTenantRepository();
      const spia = vi.spyOn(repo, "sincronizzaTenantSedi");
      const attese = righeTenantSedi(getSediStore());
      expect(attese).toEqual([
        { sedeId: SEDE_A, tenantId: 1 },
        { sedeId: SEDE_B, tenantId: 2 },
      ]);
      await preparaTenants();
      await completaTenants();
      expect(spia).toHaveBeenCalledWith(attese);
      // A interruttore spento il control plane ha SOLO la riga del tenant 1
      // (seminata da `preparaTenants`, Ruling R13): lo specchio registra la
      // sede del tenant 1 e SALTA SEDE_B, il cui tenant 2 non esiste ancora
      // nel control plane — non un errore (su Postgres sarebbe la chiave
      // esterna a rifiutarla, e il boot morirebbe lì se non saltassimo).
      expect(await repo.tenantSedi()).toEqual([{ sedeId: SEDE_A, tenantId: 1 }]);
    } finally {
      ripristina();
    }
  });

  it("acceso: lo specchio contiene le sedi dei tenant esistenti", async () => {
    const ripristina = seminaSedi();
    try {
      const repo = getTenantRepository();
      await preparaTenants(); // semina il tenant 1
      const due = await repo.inserisci({ slug: "due", nome: "Due Srl" });
      await completaTenants();
      expect(await repo.tenantSedi()).toEqual([
        { sedeId: SEDE_A, tenantId: 1 },
        { sedeId: SEDE_B, tenantId: due.id },
      ]);
    } finally {
      ripristina();
    }
  });

  // WS4 (Task 3, spec §4): l'omaggio del tenant 1 è control plane, come la
  // sua riga `tenants` — nasce sempre, prima ancora del ramo condizionato
  // all'interruttore qui sotto.
  it("acceso: semina l'abbonamento omaggio del tenant 1", async () => {
    await preparaTenants();
    await completaTenants();
    const a = getTenantRepository().abbonamentoDi(1);
    expect(a).not.toBeNull();
    expect(a).toMatchObject({ tenantId: 1, tipo: "complimentary", stato: "active", finePeriodo: null });
  });

  it("spento: lo semina lo stesso (control plane, sempre, come la riga del tenant 1)", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    await preparaTenants();
    await completaTenants();
    const a = getTenantRepository().abbonamentoDi(1);
    expect(a).not.toBeNull();
    expect(a?.tipo).toBe("complimentary");
  });
});

// Ruling R14: il backfill gira DOPO il listen, in sottofondo. Da lì un errore
// non ha nessuno che lo raccolga: deve fermarsi qui dentro, loggato, senza
// diventare un unhandled rejection che uccide il processo appena avviato.
describe("avviaBackfillTabelleTenant", () => {
  it("senza database non fa nulla e non logga", async () => {
    expect(persistenza.kvSql).toBeFalsy(); // la suite in memoria gira senza DATABASE_URL
    const spiaLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const spiaBackfill = vi.spyOn(tabelleModulo, "backfillTenantIdSulleTabelle");
    await expect(avviaBackfillTabelleTenant()).resolves.toBeUndefined();
    expect(spiaBackfill).not.toHaveBeenCalled();
    expect(spiaLog).not.toHaveBeenCalled();
    spiaBackfill.mockRestore();
    spiaLog.mockRestore();
  });

  it("con il database riassume righe e millisecondi per tabella", async () => {
    const spiaSql = vi.spyOn(persistenza, "kvSql", "get").mockReturnValue({} as never);
    const spiaBackfill = vi
      .spyOn(tabelleModulo, "backfillTenantIdSulleTabelle")
      .mockResolvedValue({ righe: { promemoria: 3, fatture: 0 }, ms: { promemoria: 12, fatture: 1 }, totale: 3 });
    const spiaLog = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(avviaBackfillTabelleTenant()).resolves.toBeUndefined();
    const riga = String(spiaLog.mock.calls.at(-1)?.[0] ?? "");
    expect(riga).toContain("[tenants] backfill tenant_id: 3 righe");
    expect(riga).toContain("promemoria: 3/12 ms");
    expect(riga).not.toContain("fatture"); // le tabelle a zero non si stampano
    spiaLog.mockRestore();
    spiaBackfill.mockRestore();
    spiaSql.mockRestore();
  });

  it("con il database, un errore del backfill si logga e non propaga", async () => {
    const spiaSql = vi.spyOn(persistenza, "kvSql", "get").mockReturnValue({} as never);
    const spiaBackfill = vi
      .spyOn(tabelleModulo, "backfillTenantIdSulleTabelle")
      .mockRejectedValue(new Error("lotto esploso"));
    const spiaErrore = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(avviaBackfillTabelleTenant()).resolves.toBeUndefined();
    expect(spiaBackfill).toHaveBeenCalledTimes(1);
    expect(spiaErrore).toHaveBeenCalledWith("[tenants] backfill tenant_id:", expect.any(Error));
    spiaErrore.mockRestore();
    spiaBackfill.mockRestore();
    spiaSql.mockRestore();
  });
});

// Task 4 (WS3): stessa cautela del backfill qui sopra, ma il ledger nasce
// SOLO per un tenant che non ce l'ha ancora — una seconda chiamata non deve
// ricalcolarlo una seconda volta (da lì in poi ci pensano put e delete).
describe("avviaRicalcoloStorageIniziale", () => {
  it("popola il ledger di un tenant senza riga; una seconda chiamata non lo ricalcola di nuovo", async () => {
    const repo = getTenantRepository();
    expect(await repo.storageDi(1)).toBeNull();
    await avviaRicalcoloStorageIniziale([1]);
    expect(await repo.storageDi(1)).not.toBeNull();
    expect((await repo.eventi(1)).filter(e => e.tipo === "storage_ricalcolato")).toHaveLength(1);
    await avviaRicalcoloStorageIniziale([1]);
    expect((await repo.eventi(1)).filter(e => e.tipo === "storage_ricalcolato")).toHaveLength(1);
  });

  // Fix wave finale, R17: la gara del primo boot. `preparaTenants()` gira
  // prima del `listen`, il ricalcolo dopo: nel mezzo un `putFile` crea la
  // riga del ledger con dentro un file solo. Se il ricalcolo si fermasse
  // alla riga, quell'azienda resterebbe senza ricalcolo per sempre — con un
  // ledger che conta uno su diecimila. Si guarda il timbro.
  it("una riga senza timbro (un putFile arrivato prima) non conta come ricalcolo fatto", async () => {
    const repo = getTenantRepository();
    const primaDelBoot = await repo.aggiornaStorage(1, 10, 1);
    expect(primaDelBoot.ricalcolatoIl).toBeNull();
    await ricalcolaStorageSeManca([1]);
    const dopo = await repo.storageDi(1);
    expect(dopo?.ricalcolatoIl).toBeInstanceOf(Date);
    expect((await repo.eventi(1)).filter(e => e.tipo === "storage_ricalcolato")).toHaveLength(1);
    // Timbrata una volta, la seconda chiamata non fa più niente.
    await ricalcolaStorageSeManca([1]);
    expect((await repo.eventi(1)).filter(e => e.tipo === "storage_ricalcolato")).toHaveLength(1);
  });
});

// Fix wave finale (minore): `pulisciStateScaduti()` esisteva, era provata e
// non la chiamava nessuno — la tabella `oauth_state` cresceva e non calava
// mai. Ora la chiama `preparaTenants()`, subito dopo `caricaCache()`.
describe("preparaTenants: spazzata degli state OAuth scaduti", () => {
  it("toglie gli state scaduti al boot e lo dice solo se ne ha tolti", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.emettiStateOAuth({ tipo: "gdrive", tenantId: 1, sedeId: null, utenteId: 7, payload: {} });
    vi.advanceTimersByTime(TTL_STATE_OAUTH_MS + 1000);

    const righe: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      righe.push(a.map(String).join(" "));
    });
    try {
      await preparaTenants();
    } finally {
      log.mockRestore();
    }
    expect(righe).toContain("[tenants] oauth_state: 1 state scaduti rimossi");
    // Non è rimasto niente da togliere: la spazzata ha fatto il suo lavoro.
    expect(await repo.pulisciStateScaduti()).toBe(0);

    // Secondo boot, nessuno state scaduto: nessuna riga di log.
    const righe2: string[] = [];
    const log2 = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      righe2.push(a.map(String).join(" "));
    });
    try {
      await preparaTenants();
    } finally {
      log2.mockRestore();
    }
    expect(righe2.some(r => r.includes("oauth_state"))).toBe(false);
  });
});
