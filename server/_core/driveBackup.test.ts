// Il backup notturno del 10/08/2026 è morto su un solo 503 "Transient
// failure" alla creazione della prima cartella. Drive quei 503 li fa, e la
// risposta giusta è riprovare: questi test tengono in piedi la differenza fra
// un errore che passa da solo e uno che non passerà mai.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __eseguiGiroNotturnoPerTest,
  __impostaAttesaRitentativoPerTest,
  attesaMs,
  backupLog,
  buildBackupTree,
  driveFetch,
  erroreTransitorio,
  resolveBackupFileData,
} from "./driveBackup";
import { sha256Hex } from "./fileStorage";
import { __registraTenantNotoPerTest, storeDi } from "./persistence";
import { getSediStore } from "../routers/sedi";
import { getCommesseStore } from "../routers/commesse";
import { getUtentiStore } from "../routers/utenti";
import { conTenant, modalitaTenantStretta } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import { __azzeraStatiGiriPerTest, statoGiro } from "../tenants/giri";

const TRANSIENTE_503 = JSON.stringify({
  error: {
    code: 503,
    message: "Transient failure.",
    errors: [
      {
        message: "Transient failure.",
        domain: "global",
        reason: "transientError",
      },
    ],
  },
});

const PERMESSI_403 = JSON.stringify({
  error: { code: 403, errors: [{ reason: "insufficientFilePermissions" }] },
});

const QUOTA_403 = JSON.stringify({
  error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] },
});

function risposta(
  status: number,
  corpo: string,
  headers: Record<string, string> = {}
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => corpo,
    json: async () => JSON.parse(corpo || "{}"),
  } as any;
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.useRealTimers();
});

describe("erroreTransitorio", () => {
  it("503, 500 e 429 passano da soli", () => {
    expect(erroreTransitorio(503, TRANSIENTE_503)).toBe(true);
    expect(erroreTransitorio(500, "")).toBe(true);
    expect(erroreTransitorio(429, "")).toBe(true);
  });

  it("un 403 di quota si riprova, uno di permessi no", () => {
    expect(erroreTransitorio(403, QUOTA_403)).toBe(true);
    expect(erroreTransitorio(403, PERMESSI_403)).toBe(false);
  });

  it("404 e 401 non si riprovano: riprovare non li cambia", () => {
    expect(erroreTransitorio(404, "")).toBe(false);
    expect(erroreTransitorio(401, "")).toBe(false);
  });
});

describe("attesaMs", () => {
  it("cresce a ogni tentativo", () => {
    expect(attesaMs(0, null)).toBeGreaterThanOrEqual(1000);
    expect(attesaMs(0, null)).toBeLessThan(2000);
    expect(attesaMs(3, null)).toBeGreaterThanOrEqual(8000);
    expect(attesaMs(10, null)).toBeLessThanOrEqual(30_500);
  });

  it("Retry-After di Google vince sul calcolo nostro", () => {
    expect(attesaMs(0, "5")).toBe(5000);
    // Ma non si aspetta un'ora perché l'header lo chiede.
    expect(attesaMs(0, "9999")).toBe(60_000);
    expect(attesaMs(1, "non-un-numero")).toBeGreaterThanOrEqual(2000);
  });
});

describe("driveFetch", () => {
  it("due 503 e poi passa: il backup non si accorge di niente", async () => {
    vi.useFakeTimers();
    const chiamate: number[] = [];
    global.fetch = vi.fn(async () => {
      chiamate.push(Date.now());
      return chiamate.length <= 2
        ? risposta(503, TRANSIENTE_503)
        : risposta(200, '{"id":"cartella-1"}');
    }) as any;

    const p = driveFetch("https://drive/test", {}, "Creazione della cartella");
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ id: "cartella-1" });
    expect(chiamate).toHaveLength(3);
  });

  it("un errore di permessi non si ritenta: una sola chiamata", async () => {
    const fetchMock = vi.fn(async () => risposta(403, PERMESSI_403));
    global.fetch = fetchMock as any;

    await expect(
      driveFetch("https://drive/test", {}, 'Caricamento di "x.pdf"')
    ).rejects.toThrow(/Caricamento di "x\.pdf" fallita \(HTTP 403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("503 a oltranza: 5 tentativi, poi un messaggio che dice cosa fare", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => risposta(503, TRANSIENTE_503));
    global.fetch = fetchMock as any;

    const p = driveFetch("https://drive/test", {}, "Creazione della cartella");
    const atteso = expect(p).rejects.toThrow(
      /dopo 5 tentativi.*guasto momentaneo di Drive/s
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await atteso;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("rispetta Retry-After invece di insistere subito", async () => {
    vi.useFakeTimers();
    let prima = true;
    const fetchMock = vi.fn(async () => {
      if (prima) {
        prima = false;
        return risposta(429, "", { "retry-after": "30" });
      }
      return risposta(200, "{}");
    });
    global.fetch = fetchMock as any;

    const p = driveFetch("https://drive/test", {}, "Ricerca della cartella");
    // A 10 secondi non ha ancora riprovato: l'header chiedeva 30.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    await p;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("resolveBackupFileData", () => {
  it("mantiene compatibili i file legacy inline", async () => {
    const data = await resolveBackupFileData({
      id: 1,
      nome: "preventivo.pdf",
      dataBase64: Buffer.from("legacy").toString("base64"),
    });
    expect(data?.toString()).toBe("legacy");
  });

  it("legge e verifica i file migrati tramite storageKey", async () => {
    const stored = Buffer.from("contenuto su R2");
    const loader = vi.fn(async () => stored);
    const data = await resolveBackupFileData(
      {
        id: 2,
        nome: "contratto.pdf",
        storageKey: "preventivi_documenti/12/2.pdf",
        checksum: sha256Hex(stored),
      },
      loader
    );

    expect(data).toEqual(stored);
    expect(loader).toHaveBeenCalledWith("preventivi_documenti/12/2.pdf");
  });

  it("ferma il backup se un oggetto migrato manca", async () => {
    await expect(
      resolveBackupFileData(
        { nome: "foto.jpg", storageKey: "ticket_allegati/8/4.jpg" },
        async () => null
      )
    ).rejects.toThrow(/Backup incompleto.*non trovato/);
  });

  it("ferma il backup se il checksum non coincide", async () => {
    await expect(
      resolveBackupFileData(
        {
          nome: "misure.pdf",
          storageKey: "preventivi_documenti/1/9.pdf",
          checksum: sha256Hex(Buffer.from("atteso")),
        },
        async () => Buffer.from("corrotto")
      )
    ).rejects.toThrow(/Backup incompleto.*checksum non valido/);
  });
});

// Task 10 (WS2 «porta aperta»): il backup notturno gira su un timer, fuori
// da qualunque richiesta, e monta l'albero leggendo la fotografia di TUTTI
// gli store (`getAllStoreSnapshots`, nessun Proxy). Le chiavi però sono per
// tenant: `stores["commesse"]` è l'alias del tenant 1, quindi la cartella
// «Sede …» di un'azienda diversa restava vuota — o, peggio, si sarebbe
// riempita dei dati di Ruffino Group. Ogni sede deve leggere le chiavi del
// SUO tenant.
//
// WS3 Task 7: la garanzia è diventata più forte. L'albero non è più uno per
// tutta l'installazione — è UNO PER AZIENDA, quella del contesto: la sede
// dell'altra azienda non compare affatto, né la sua cartella né le sue
// commesse nel dump `database/`.
describe("buildBackupTree per tenant (Task 10)", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const tenants = getTenantRepository();
    await tenants.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await tenants.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    __registraTenantNotoPerTest(2);
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "Alfa", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "Beta", attiva: true } as any
    );
    getUtentiStore().length = 0;
    getCommesseStore(); // registra la famiglia prima di storeDi
    storeDi(1, "commesse").length = 0;
    storeDi(2, "commesse").length = 0;
    storeDi(1, "commesse").push({
      id: 1,
      codice: "COM-T1",
      sedeId: 10,
      clienteId: null,
    } as any);
    storeDi(2, "commesse").push({
      id: 2,
      codice: "COM-T2",
      sedeId: 20,
      clienteId: null,
    } as any);
  });
  afterEach(() => modalitaTenantStretta(false));

  const percorsiDi = async (tenantId: number): Promise<string[]> => {
    const { files } = await conTenant(tenantId, () => buildBackupTree());
    return files.map(f => [...f.segments, f.name].join("/"));
  };

  it("la cartella di ogni sede porta le commesse del suo tenant, non quelle dell'altra azienda", async () => {
    const percorsi1 = await percorsiDi(1);
    const percorsi2 = await percorsiDi(2);

    expect(percorsi1).toContain(
      "Sede Alfa/Commesse senza cliente/COM-T1/commessa.json"
    );
    expect(percorsi2).toContain(
      "Sede Beta/Commesse senza cliente/COM-T2/commessa.json"
    );
    // L'altra azienda non c'è proprio: né la sua sede né le sue commesse.
    expect(percorsi1.some(p => p.startsWith("Sede Beta/"))).toBe(false);
    expect(percorsi1.some(p => p.includes("COM-T2"))).toBe(false);
    expect(percorsi2.some(p => p.startsWith("Sede Alfa/"))).toBe(false);
    expect(percorsi2.some(p => p.includes("COM-T1"))).toBe(false);
  });

  // WS3 Task 7: il dump grezzo NON è più completo di tutta l'installazione.
  // Fino a ieri `database/` portava una chiave per istanza (`commesse.json` e
  // `tenant:2:commesse.json` insieme): finito nel Drive di un'azienda, quel
  // file le consegnava l'archivio di tutte le altre. Ora l'albero è di
  // un'azienda sola — quella del contesto — e le quattro famiglie globali
  // arrivano filtrate.
  it("buildBackupTree produce solo l'azienda del contesto: database/, sedi e utenti filtrati, nomi degli store senza prefisso", async () => {
    __registraTenantNotoPerTest(2);
    storeDi<any>(2, "clienti").length = 0;
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "Sarzana", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "Acme HQ", attiva: true } as any
    );
    const utenti = getUtentiStore();
    utenti.length = 0;
    utenti.push(
      { id: 1, tenantId: 1, email: "a@1", passwordHash: "x", sediIds: [10] } as any,
      { id: 2, tenantId: 2, email: "b@2", passwordHash: "x", sediIds: [20] } as any
    );
    storeDi<any>(2, "clienti").push({
      id: 5,
      tenantId: 2,
      sedeId: 20,
      nome: "Cliente",
      cognome: "Due",
    });

    const albero = await conTenant(2, () => buildBackupTree());
    const nomi = albero.files.map(f => [...f.segments, f.name].join("/"));

    expect(nomi).toContain("database/clienti.json");
    expect(nomi.some(n => n.startsWith("database/tenant:"))).toBe(false);
    expect(nomi).not.toContain("database/backup_log.json");
    // Il refresh token cifrato del Drive non viaggia verso il Drive stesso.
    expect(nomi).not.toContain("database/backup_oauth.json");
    expect(nomi.some(n => n.startsWith("Sede Sarzana/"))).toBe(false);

    const utentiJson = JSON.parse(
      albero.files
        .find(f => f.name === "Utenti.json" && f.segments[0] === "Sede Acme HQ")!
        .data.toString("utf8")
    );
    expect(utentiJson.map((u: any) => u.id)).toEqual([2]);
    expect(JSON.stringify(utentiJson)).not.toContain("passwordHash");

    const dbUtenti = JSON.parse(
      albero.files
        .find(f => f.segments[0] === "database" && f.name === "utenti.json")!
        .data.toString("utf8")
    );
    expect(dbUtenti.map((u: any) => u.id)).toEqual([2]);
    const dbSedi = JSON.parse(
      albero.files
        .find(f => f.segments[0] === "database" && f.name === "sedi.json")!
        .data.toString("utf8")
    );
    expect(dbSedi.map((s: any) => s.id)).toEqual([20]);
    const clientiDb = JSON.parse(
      albero.files
        .find(f => f.segments[0] === "database" && f.name === "clienti.json")!
        .data.toString("utf8")
    );
    expect(clientiDb.map((c: any) => c.id)).toEqual([5]);
  });
});

// WS3 Task 7: il backup notturno non è più «il backup di Ruffino Group» —
// è un giro su ogni azienda attiva, ognuna nel suo contesto, col suo Drive e
// il suo log. Un'azienda che non ha collegato il Drive fallisce da sola:
// le altre devono comunque avere il loro backup quella notte.
describe("giro notturno per azienda (Task 7)", () => {
  const envSalvato: Record<string, string | undefined> = {};
  const CHIAVI_ENV = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_SERVICE_ACCOUNT_FILE",
  ];
  // Il ripiego locale del tenant 1 scrive davvero su disco, sotto
  // `<cwd>/backups`. Il test gli dà una cwd tutta sua (una cartella
  // temporanea, tolta dopo): così non scrive dentro i backup locali veri di
  // chi esegue la suite, e «la cartella esiste» significa che l'ha creata
  // questo giro, non che c'era già.
  let radiceFinta = "";

  beforeEach(async () => {
    radiceFinta = fs.mkdtempSync(path.join(os.tmpdir(), "backup-notturno-"));
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    for (const k of CHIAVI_ENV) {
      envSalvato[k] = process.env[k];
      delete process.env[k]; // né OAuth né service account: nessuna rete
    }
    modalitaTenantStretta(true);
    __impostaAttesaRitentativoPerTest(0); // i tre tentativi senza i 20 minuti veri
    // L'interruttore per (worker, azienda) vive in un modulo: senza questo
    // azzeramento il conteggio di un caso arriverebbe al successivo.
    __azzeraStatiGiriPerTest();
    resetTenantRepositoryForTesting();
    const tenants = getTenantRepository();
    await tenants.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await tenants.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    __registraTenantNotoPerTest(2);
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "Alfa", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "Beta", attiva: true } as any
    );
    getUtentiStore().length = 0;
    getCommesseStore(); // registra la famiglia prima di storeDi
    for (const t of [1, 2]) {
      for (const nome of ["commesse", "clienti", "backup_oauth", "backup_config", "backup_log"]) {
        storeDi<any>(t, nome).length = 0;
      }
    }
  });

  afterEach(() => {
    modalitaTenantStretta(false);
    __impostaAttesaRitentativoPerTest(null);
    for (const k of CHIAVI_ENV) {
      if (envSalvato[k] === undefined) delete process.env[k];
      else process.env[k] = envSalvato[k];
    }
    fs.rmSync(radiceFinta, { recursive: true, force: true });
  });

  // Fix wave finale, R16: un'azienda che non ha ancora collegato il suo
  // Drive non è «in errore» — non ha collegato niente. Si salta con una
  // riga di log, senza tentativi, senza log di backup e senza far scattare
  // l'interruttore. (Prima faceva tre tentativi e due attese da 20 minuti
  // ogni notte, davanti a tutte le altre aziende.)
  it("un'azienda senza Drive collegato viene saltata, e il backup delle altre si fa", async () => {
    // Le righe si raccolgono qui: `mockRestore()` azzera anche `mock.calls`,
    // quindi dopo il `finally` non ci sarebbe più niente da leggere.
    const righe: string[] = [];
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(radiceFinta);
    const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      righe.push(a.map(String).join(" "));
    });
    try {
      await __eseguiGiroNotturnoPerTest();
    } finally {
      cwd.mockRestore();
      log.mockRestore();
    }

    const ultimo1 = conTenant(1, () => backupLog(1))[0];
    expect(ultimo1?.ok).toBe(true);
    expect(ultimo1?.target).toBe("locale");
    expect(ultimo1?.trigger).toBe("schedulato");
    const cartella = path.join(radiceFinta, "backups", ultimo1!.rootName);
    // L'albero sul disco è quello dell'azienda 1: la sua sede, non l'altra.
    expect(fs.readdirSync(cartella).sort()).toEqual(["Sede Alfa", "database"]);

    // Il tenant 2 non ha nemmeno provato: nessuna riga di log del backup.
    expect(conTenant(2, () => backupLog(10))).toEqual([]);
    expect(righe).toContain("[backup] tenant 2: Drive non collegato, salto");
    // E il salto non è un errore: l'interruttore del worker resta a zero.
    expect(statoGiro("backup", 2)).toEqual({ erroriConsecutivi: 0, sospesoFinoA: 0, sospensioni: 0 });
    expect(conTenant(1, () => backupLog(10))).toHaveLength(1);
  });

  // L'altra metà di R16: un backup che fallisce davvero deve USCIRE dal
  // corpo del giro, altrimenti l'interruttore per (worker, azienda) del
  // Task 10 non potrebbe mai scattare per il backup. Il fallimento qui è
  // deterministico e senza rete: il tenant 2 ha la riga OAuth (quindi non
  // si salta) ma manca il client OAuth nell'ambiente, e per un'azienda
  // diversa da Ruffino Group non ci sono ripieghi.
  it("tre tentativi falliti fanno contare l'errore all'interruttore, e l'altra azienda gira lo stesso", async () => {
    storeDi<any>(2, "backup_oauth").push({
      id: 1,
      refreshTokenCifrato: "finto",
      email: "acme@example.com",
      rootFolderId: null,
      connectedAt: new Date(),
    });
    // I ritentativi del tenant 2 parlano (warn ×2 + error del giro e
    // dell'interruttore): rumore atteso, zittito perché l'output resti pulito.
    const errori: string[] = [];
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(radiceFinta);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      errori.push(a.map(String).join(" "));
    });
    try {
      await __eseguiGiroNotturnoPerTest();
    } finally {
      cwd.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }

    const log2 = conTenant(2, () => backupLog(10));
    expect(log2).toHaveLength(3); // le tre notti di tentativi
    expect(log2[0]?.ok).toBe(false);
    expect(log2[0]?.error).toBe(
      "Account Google non collegato: collega il Drive dell'azienda da Integrazioni → Backup"
    );
    // L'errore è arrivato a `perOgniTenantAttivo`: dopo tre giri come
    // questo l'azienda verrebbe sospesa per 15 minuti.
    expect(statoGiro("backup", 2)).toMatchObject({ erroriConsecutivi: 1, sospensioni: 0 });
    expect(errori.some(r => r.startsWith("[backup] tenant 2:"))).toBe(true);
    // Il tenant 1 non ne ha risentito: il suo backup della notte c'è.
    expect(conTenant(1, () => backupLog(10))).toHaveLength(1);
    expect(conTenant(1, () => backupLog(1))[0]?.ok).toBe(true);
    expect(statoGiro("backup", 1)).toEqual({ erroriConsecutivi: 0, sospesoFinoA: 0, sospensioni: 0 });
  });
});
