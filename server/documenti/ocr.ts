// OCR locale con Tesseract 5 (D7, slice 4 — PRD §19.4).
//
// Tesseract non legge i PDF: le pagine vengono PRIMA renderizzate in PNG
// con pdftoppm (poppler), poi riconosciute una per una in formato TSV per
// conservare pagina, coordinate e confidenza per parola. Tutto locale:
// nessun servizio cloud, nessuna credenziale, i byte non lasciano mai la
// macchina. I processi partono con execFile e argomenti fissi — MAI
// interpolazione shell, mai input dell'utente negli argomenti — dentro
// una directory temporanea isolata sempre ripulita.
//
// Ogni fallimento è un esito esplicito (binario mancante, lingua
// mancante, timeout, troppe pagine, OCR fallito): niente fallback
// silenziosi. Il testo riconosciuto resta input non fidato e attraversa
// lo stesso estrattore deterministico del testo nativo.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { interruttoreAttivo } from "../platform/interruttori";

const execFileAsync = promisify(execFile);

export const OCR_VERSIONE = "1.0.0";

/** Sotto queste soglie il risultato è marcato «da verificare». */
export const SOGLIA_CONFIDENZA_MEDIA = 80;
export const SOGLIA_CONFIDENZA_PAGINA = 60;

export type ConfigOcr = {
  /** Lingue tesseract richieste, es. "ita+eng". Configurabile via OCR_LINGUE. */
  lingue: string;
  dpi: number;
  maxPagine: number;
  timeoutPaginaMs: number;
  timeoutTotaleMs: number;
  binari: { pdftoppm: string; tesseract: string };
};

export function configOcrDefault(): ConfigOcr {
  return {
    lingue: process.env.OCR_LINGUE?.trim() || "ita+eng",
    dpi: 300,
    maxPagine: 20,
    timeoutPaginaMs: 30_000,
    timeoutTotaleMs: 120_000,
    binari: {
      pdftoppm: process.env.OCR_PDFTOPPM_BIN?.trim() || "pdftoppm",
      tesseract: process.env.OCR_TESSERACT_BIN?.trim() || "tesseract",
    },
  };
}

export type PaginaOcr = {
  testo: string;
  /** Confidenza media (0-100) delle parole riconosciute nella pagina. */
  confidenza: number;
  parole: number;
};

export type EsitoOcr =
  | {
      esito: "ocr_completato";
      pagine: PaginaOcr[];
      /** Lingue EFFETTIVE usate (richieste ∩ installate). */
      lingue: string;
      lingueMancanti: string[];
      dpi: number;
      versione: string;
      daVerificare: boolean;
    }
  | { esito: "ocr_non_disponibile"; motivo: string }
  | { esito: "ocr_fallito"; motivo: string };

export type DisponibilitaOcr = {
  disponibile: boolean;
  motivo: string | null;
  lingueInstallate: string[];
};

// La disponibilità dei binari non cambia durante il processo: una verifica
// per configurazione di binari, poi cache.
const cacheDisponibilita = new Map<string, Promise<DisponibilitaOcr>>();

async function binarioRisponde(
  binario: string,
  argomenti: string[]
): Promise<{ presente: boolean; stdout: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(binario, argomenti, {
      timeout: 5_000,
    });
    return { presente: true, stdout: `${stdout}\n${stderr}` };
  } catch (errore: any) {
    if (errore?.code === "ENOENT") return { presente: false, stdout: "" };
    // Il binario esiste ma è uscito con errore (es. pdftoppm senza input):
    // per la disponibilità conta che risponda.
    return {
      presente: true,
      stdout: `${errore?.stdout ?? ""}\n${errore?.stderr ?? ""}`,
    };
  }
}

export function disponibilitaOcr(
  binari = configOcrDefault().binari
): Promise<DisponibilitaOcr> {
  const chiave = `${binari.pdftoppm}|${binari.tesseract}`;
  const esistente = cacheDisponibilita.get(chiave);
  if (esistente) return esistente;
  const verifica = (async (): Promise<DisponibilitaOcr> => {
    const [poppler, tesseract] = await Promise.all([
      binarioRisponde(binari.pdftoppm, ["-v"]),
      binarioRisponde(binari.tesseract, ["--list-langs"]),
    ]);
    if (!poppler.presente || !tesseract.presente) {
      const mancanti = [
        !poppler.presente ? binari.pdftoppm : null,
        !tesseract.presente ? binari.tesseract : null,
      ].filter(Boolean);
      return {
        disponibile: false,
        motivo: `Binario mancante: ${mancanti.join(", ")}. Installare tesseract e poppler (in produzione: aptPkgs in nixpacks.toml).`,
        lingueInstallate: [],
      };
    }
    const lingueInstallate = tesseract.stdout
      .split("\n")
      .map(riga => riga.trim())
      .filter(riga => /^[a-z_]{3,}$/.test(riga) && riga !== "osd" && riga !== "snum");
    return { disponibile: true, motivo: null, lingueInstallate };
  })();
  cacheDisponibilita.set(chiave, verifica);
  return verifica;
}

/** Solo per i test: azzera la cache di disponibilità. */
export function azzeraCacheOcrPerTest(): void {
  cacheDisponibilita.clear();
  cacheRisultati.clear();
}

export function lingueEffettive(
  richieste: string,
  installate: string[]
): { effettive: string[]; mancanti: string[] } {
  const volute = richieste
    .split("+")
    .map(lingua => lingua.trim())
    .filter(Boolean);
  const effettive = volute.filter(lingua => installate.includes(lingua));
  const mancanti = volute.filter(lingua => !installate.includes(lingua));
  return { effettive, mancanti };
}

/**
 * L'impronta della configurazione OCR che entra nell'idempotenza dei run:
 * versione, lingue effettive e DPI. "assente" quando l'OCR non può girare —
 * così un run `scansione_senza_testo` fatto senza OCR NON viene riusato
 * quando l'OCR diventa disponibile (o cambia lingua/configurazione).
 */
export async function firmaOcrCorrente(
  config = configOcrDefault()
): Promise<string> {
  if (!interruttoreAttivo("ocr")) return "assente";
  const disponibilita = await disponibilitaOcr(config.binari);
  if (!disponibilita.disponibile) return "assente";
  const { effettive } = lingueEffettive(
    config.lingue,
    disponibilita.lingueInstallate
  );
  if (effettive.length === 0) return "assente";
  return `pdf-ocr@${OCR_VERSIONE}|${effettive.join("+")}|${config.dpi}dpi`;
}

// Una sola pipeline OCR alla volta: il rendering e il riconoscimento sono
// CPU-intensivi e il server vive insieme al resto dell'app.
let codaOcr: Promise<unknown> = Promise.resolve();

// Piccola cache dei risultati per impronta byte + firma: il pannello dei
// candidati e i re-run con `forza` non devono rifare l'OCR dello stesso
// file. Solo testo e confidenze, mai immagini.
const cacheRisultati = new Map<string, EsitoOcr>();
const MAX_CACHE_RISULTATI = 20;

function parseTsv(tsv: string): PaginaOcr {
  const righe = tsv.split("\n");
  const parti: string[] = [];
  const confidenze: number[] = [];
  let ultimaRigaChiave = "";
  for (const riga of righe) {
    const colonne = riga.split("\t");
    if (colonne.length < 12 || colonne[0] !== "5") continue; // level 5 = parola
    const conf = Number(colonne[10]);
    const testo = colonne.slice(11).join("\t").trim();
    if (!testo) continue;
    const rigaChiave = `${colonne[2]}|${colonne[3]}|${colonne[4]}`; // blocco|par|riga
    if (ultimaRigaChiave && rigaChiave !== ultimaRigaChiave) parti.push("\n");
    else if (parti.length > 0) parti.push(" ");
    ultimaRigaChiave = rigaChiave;
    parti.push(testo);
    if (Number.isFinite(conf) && conf >= 0) confidenze.push(conf);
  }
  const testo = parti.join("").replace(/[ \t]+\n/g, "\n").trim();
  const confidenza = confidenze.length
    ? Math.round(confidenze.reduce((s, c) => s + c, 0) / confidenze.length)
    : 0;
  return { testo, confidenza, parole: confidenze.length };
}

export function richiedeRevisione(pagine: PaginaOcr[]): boolean {
  const conParole = pagine.filter(pagina => pagina.parole > 0);
  if (conParole.length === 0) return true;
  const media =
    conParole.reduce((somma, pagina) => somma + pagina.confidenza, 0) /
    conParole.length;
  return (
    media < SOGLIA_CONFIDENZA_MEDIA ||
    conParole.some(pagina => pagina.confidenza < SOGLIA_CONFIDENZA_PAGINA)
  );
}

export type EsitoRendering =
  | { esito: "ok"; immagini: Buffer[] }
  | { esito: "errore"; motivo: string };

/**
 * Le pagine di un PDF come PNG (pdftoppm, argomenti fissi, nessuna shell),
 * in una directory temporanea che sparisce sempre. Serve all'OCR locale e
 * alla lettura visiva con il modello, che vogliono la stessa immagine.
 */
export async function renderizzaPaginePng(
  bytes: Buffer,
  opzioni: {
    dpi: number;
    maxPagine: number;
    timeoutMs: number;
    numeroPagine?: number | null;
    binari?: Partial<ConfigOcr["binari"]>;
  }
): Promise<EsitoRendering> {
  const binari = { ...configOcrDefault().binari, ...opzioni.binari };
  if (opzioni.numeroPagine != null && opzioni.numeroPagine > opzioni.maxPagine) {
    return {
      esito: "errore",
      motivo: `Il documento ha ${opzioni.numeroPagine} pagine: oltre il limite di ${opzioni.maxPagine}.`,
    };
  }
  let cartella: string | null = null;
  try {
    cartella = await fs.mkdtemp(path.join(os.tmpdir(), "ruffino-pagine-"));
    const ingresso = path.join(cartella, "input.pdf");
    await fs.writeFile(ingresso, bytes);
    try {
      await execFileAsync(
        binari.pdftoppm,
        [
          "-r",
          String(opzioni.dpi),
          "-png",
          "-f",
          "1",
          "-l",
          String(Math.min(opzioni.numeroPagine ?? opzioni.maxPagine, opzioni.maxPagine)),
          ingresso,
          path.join(cartella, "pagina"),
        ],
        { timeout: Math.max(1, opzioni.timeoutMs) }
      );
    } catch (errore: any) {
      if (errore?.killed || errore?.signal) {
        return {
          esito: "errore",
          motivo: `Timeout durante il rendering delle pagine (${opzioni.timeoutMs} ms totali).`,
        };
      }
      return {
        esito: "errore",
        motivo: `Rendering PDF fallito: ${String(errore?.stderr || errore?.message || errore).slice(0, 300)}`,
      };
    }
    const nomi = (await fs.readdir(cartella))
      .filter(nome => nome.startsWith("pagina") && nome.endsWith(".png"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    if (nomi.length === 0) {
      return { esito: "errore", motivo: "Il rendering non ha prodotto pagine (PDF vuoto o corrotto)." };
    }
    if (nomi.length > opzioni.maxPagine) {
      return {
        esito: "errore",
        motivo: `Il documento ha più di ${opzioni.maxPagine} pagine: oltre il limite.`,
      };
    }
    const immagini: Buffer[] = [];
    for (const nome of nomi) immagini.push(await fs.readFile(path.join(cartella, nome)));
    return { esito: "ok", immagini };
  } catch (errore: any) {
    return {
      esito: "errore",
      motivo: `Errore di rendering: ${String(errore?.message ?? errore).slice(0, 300)}`,
    };
  } finally {
    if (cartella) await fs.rm(cartella, { recursive: true, force: true }).catch(() => {});
  }
}

/** Tesseract su UN'immagine già pronta (PNG/JPEG/…): argomenti fissi, nessuna shell. */
async function riconosciImmagine(
  percorso: string,
  lingue: string,
  config: ConfigOcr,
  timeoutMs: number
): Promise<{ pagina: PaginaOcr } | { errore: EsitoOcr }> {
  try {
    const { stdout } = await execFileAsync(
      config.binari.tesseract,
      [
        percorso,
        "stdout",
        "-l",
        lingue,
        // psm 6 (blocco uniforme) tiene ogni riga della tabella su una
        // riga di testo — codice, descrizione, quantità, prezzo — mentre
        // psm 3 spezzava le colonne in blocchi separati e le righe di
        // merce diventavano illeggibili. preserve_interword_spaces
        // conserva gli spazi fra le colonne (04/09/2026).
        "--psm",
        "6",
        "-c",
        "preserve_interword_spaces=1",
        "tsv",
      ],
      { timeout: Math.max(1, timeoutMs), maxBuffer: 32 * 1024 * 1024 }
    );
    return { pagina: parseTsv(stdout) };
  } catch (errore: any) {
    if (errore?.killed || errore?.signal) {
      return {
        errore: {
          esito: "ocr_fallito",
          motivo: `Timeout OCR sulla pagina (${config.timeoutPaginaMs} ms per pagina).`,
        },
      };
    }
    const dettaglio = String(errore?.stderr || errore?.message || errore);
    if (/Failed loading language|Tessdata|traineddata/i.test(dettaglio)) {
      return {
        errore: { esito: "ocr_fallito", motivo: `Lingua OCR mancante: ${dettaglio.slice(0, 200)}` },
      };
    }
    return {
      errore: { esito: "ocr_fallito", motivo: `OCR fallito: ${dettaglio.slice(0, 300)}` },
    };
  }
}

async function preparaOcr(
  config: ConfigOcr
): Promise<{ effettive: string[]; mancanti: string[] } | { errore: EsitoOcr }> {
  const disponibilita = await disponibilitaOcr(config.binari);
  if (!disponibilita.disponibile) {
    return {
      errore: {
        esito: "ocr_non_disponibile",
        motivo: disponibilita.motivo ?? "OCR non disponibile.",
      },
    };
  }
  const { effettive, mancanti } = lingueEffettive(config.lingue, disponibilita.lingueInstallate);
  if (effettive.length === 0) {
    return {
      errore: {
        esito: "ocr_fallito",
        motivo: `Lingue OCR non installate: ${config.lingue}. Disponibili: ${disponibilita.lingueInstallate.join(", ") || "nessuna"}.`,
      },
    };
  }
  return { effettive, mancanti };
}

async function eseguiOcrIsolato(
  bytes: Buffer,
  numeroPagine: number | null,
  config: ConfigOcr
): Promise<EsitoOcr> {
  if (numeroPagine != null && numeroPagine > config.maxPagine) {
    return {
      esito: "ocr_fallito",
      motivo: `Il documento ha ${numeroPagine} pagine: oltre il limite OCR di ${config.maxPagine}.`,
    };
  }
  const lingue = await preparaOcr(config);
  if ("errore" in lingue) return lingue.errore;
  const { effettive, mancanti } = lingue;

  const partenza = Date.now();
  const budgetResiduo = () =>
    config.timeoutTotaleMs - (Date.now() - partenza);
  const rendering = await renderizzaPaginePng(bytes, {
    dpi: config.dpi,
    maxPagine: config.maxPagine,
    timeoutMs: Math.max(1, Math.min(config.timeoutTotaleMs, budgetResiduo())),
    numeroPagine,
    binari: config.binari,
  });
  if (rendering.esito === "errore") return { esito: "ocr_fallito", motivo: rendering.motivo };

  let cartella: string | null = null;
  try {
    cartella = await fs.mkdtemp(path.join(os.tmpdir(), "ruffino-ocr-"));
    const pagine: PaginaOcr[] = [];
    for (const [indice, immagine] of rendering.immagini.entries()) {
      const residuo = budgetResiduo();
      if (residuo <= 0) {
        return {
          esito: "ocr_fallito",
          motivo: `Timeout OCR complessivo (${config.timeoutTotaleMs} ms) dopo ${pagine.length} pagine.`,
        };
      }
      const percorso = path.join(cartella, `pagina-${indice + 1}.png`);
      await fs.writeFile(percorso, immagine);
      const letta = await riconosciImmagine(
        percorso,
        effettive.join("+"),
        config,
        Math.min(config.timeoutPaginaMs, residuo)
      );
      if ("errore" in letta) {
        const motivo = letta.errore.esito === "ocr_fallito" ? letta.errore.motivo : "OCR fallito.";
        return { esito: "ocr_fallito", motivo: motivo.replace("sulla pagina", `sulla pagina ${pagine.length + 1}`) };
      }
      pagine.push(letta.pagina);
    }

    return {
      esito: "ocr_completato",
      pagine,
      lingue: effettive.join("+"),
      lingueMancanti: mancanti,
      dpi: config.dpi,
      versione: OCR_VERSIONE,
      daVerificare: richiedeRevisione(pagine),
    };
  } catch (errore: any) {
    return {
      esito: "ocr_fallito",
      motivo: `Errore OCR: ${String(errore?.message ?? errore).slice(0, 300)}`,
    };
  } finally {
    // La directory temporanea sparisce SEMPRE, anche su errore o timeout.
    if (cartella) {
      await fs.rm(cartella, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const ESTENSIONE_IMMAGINE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/tiff": "tif",
  "image/bmp": "bmp",
};

/** I formati di immagine che tesseract sa aprire (HEIC no: va convertito prima). */
export function immagineLeggibileDaOcr(mimeType: string): boolean {
  return (mimeType ?? "").toLowerCase() in ESTENSIONE_IMMAGINE;
}

/**
 * OCR di UNA foto o immagine (jpeg, png, webp…): la conferma d'ordine
 * fotografata e mandata via WhatsApp (04/09/2026: «Ordine fornitore
 * BODYTECH S.R.L..jpeg» restava non leggibile). Stessa pipeline delle
 * pagine, senza rendering.
 */
export async function eseguiOcrImmagine(
  bytes: Buffer,
  mimeType: string,
  opzioni?: { config?: Partial<ConfigOcr> }
): Promise<EsitoOcr> {
  const base = configOcrDefault();
  const config: ConfigOcr = {
    ...base,
    ...opzioni?.config,
    binari: { ...base.binari, ...opzioni?.config?.binari },
  };
  const estensione = ESTENSIONE_IMMAGINE[(mimeType ?? "").toLowerCase()];
  if (!estensione) {
    return { esito: "ocr_fallito", motivo: `Formato immagine non leggibile dall'OCR: ${mimeType || "sconosciuto"}.` };
  }
  const firma = await firmaOcrCorrente(config);
  const chiaveCache = `${createHash("sha256").update(bytes).digest("hex")}|${firma}|img`;
  const inCache = cacheRisultati.get(chiaveCache);
  if (inCache) return inCache;

  const esecuzione = codaOcr.then(async (): Promise<EsitoOcr> => {
    const lingue = await preparaOcr(config);
    if ("errore" in lingue) return lingue.errore;
    let cartella: string | null = null;
    try {
      cartella = await fs.mkdtemp(path.join(os.tmpdir(), "ruffino-ocr-img-"));
      const percorso = path.join(cartella, `immagine.${estensione}`);
      await fs.writeFile(percorso, bytes);
      const letta = await riconosciImmagine(
        percorso,
        lingue.effettive.join("+"),
        config,
        config.timeoutPaginaMs
      );
      if ("errore" in letta) return letta.errore;
      return {
        esito: "ocr_completato",
        pagine: [letta.pagina],
        lingue: lingue.effettive.join("+"),
        lingueMancanti: lingue.mancanti,
        dpi: 0,
        versione: OCR_VERSIONE,
        daVerificare: richiedeRevisione([letta.pagina]),
      };
    } catch (errore: any) {
      return { esito: "ocr_fallito", motivo: `Errore OCR: ${String(errore?.message ?? errore).slice(0, 300)}` };
    } finally {
      if (cartella) await fs.rm(cartella, { recursive: true, force: true }).catch(() => {});
    }
  });
  codaOcr = esecuzione.catch(() => {});
  const esito = await esecuzione;
  if (esito.esito === "ocr_completato") cacheRisultati.set(chiaveCache, esito);
  return esito;
}

export async function eseguiOcrPdf(
  bytes: Buffer,
  opzioni?: { numeroPagine?: number | null; config?: Partial<ConfigOcr> }
): Promise<EsitoOcr> {
  const base = configOcrDefault();
  const config: ConfigOcr = {
    ...base,
    ...opzioni?.config,
    binari: { ...base.binari, ...opzioni?.config?.binari },
  };
  const firma = await firmaOcrCorrente(config);
  const chiaveCache = `${createHash("sha256").update(bytes).digest("hex")}|${firma}`;
  const inCache = cacheRisultati.get(chiaveCache);
  if (inCache) return inCache;

  // Una pipeline alla volta: la coda serializza i run concorrenti.
  const esecuzione = codaOcr.then(() =>
    eseguiOcrIsolato(bytes, opzioni?.numeroPagine ?? null, config)
  );
  codaOcr = esecuzione.catch(() => {});
  const esito = await esecuzione;

  if (esito.esito === "ocr_completato") {
    cacheRisultati.set(chiaveCache, esito);
    if (cacheRisultati.size > MAX_CACHE_RISULTATI) {
      const primaChiave = cacheRisultati.keys().next().value;
      if (primaChiave) cacheRisultati.delete(primaChiave);
    }
  }
  return esito;
}
