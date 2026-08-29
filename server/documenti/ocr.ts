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
  const disponibilita = await disponibilitaOcr(config.binari);
  if (!disponibilita.disponibile) {
    return {
      esito: "ocr_non_disponibile",
      motivo: disponibilita.motivo ?? "OCR non disponibile.",
    };
  }
  const { effettive, mancanti } = lingueEffettive(
    config.lingue,
    disponibilita.lingueInstallate
  );
  if (effettive.length === 0) {
    return {
      esito: "ocr_fallito",
      motivo: `Lingue OCR non installate: ${config.lingue}. Disponibili: ${disponibilita.lingueInstallate.join(", ") || "nessuna"}.`,
    };
  }

  const partenza = Date.now();
  const budgetResiduo = () =>
    config.timeoutTotaleMs - (Date.now() - partenza);
  let cartella: string | null = null;
  try {
    cartella = await fs.mkdtemp(path.join(os.tmpdir(), "ruffino-ocr-"));
    const ingresso = path.join(cartella, "input.pdf");
    await fs.writeFile(ingresso, bytes);

    // Rendering pagina per pagina: argomenti fissi, nessuna shell.
    try {
      await execFileAsync(
        config.binari.pdftoppm,
        [
          "-r",
          String(config.dpi),
          "-png",
          "-f",
          "1",
          "-l",
          String(Math.min(numeroPagine ?? config.maxPagine, config.maxPagine)),
          ingresso,
          path.join(cartella, "pagina"),
        ],
        { timeout: Math.max(1, Math.min(config.timeoutTotaleMs, budgetResiduo())) }
      );
    } catch (errore: any) {
      if (errore?.killed || errore?.signal) {
        return {
          esito: "ocr_fallito",
          motivo: `Timeout durante il rendering delle pagine (${config.timeoutTotaleMs} ms totali).`,
        };
      }
      return {
        esito: "ocr_fallito",
        motivo: `Rendering PDF fallito: ${String(errore?.stderr || errore?.message || errore).slice(0, 300)}`,
      };
    }

    const immagini = (await fs.readdir(cartella))
      .filter(nome => nome.startsWith("pagina") && nome.endsWith(".png"))
      .sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );
    if (immagini.length === 0) {
      return {
        esito: "ocr_fallito",
        motivo: "Il rendering non ha prodotto pagine (PDF vuoto o corrotto).",
      };
    }
    if (immagini.length > config.maxPagine) {
      return {
        esito: "ocr_fallito",
        motivo: `Il documento ha più di ${config.maxPagine} pagine: oltre il limite OCR.`,
      };
    }

    const pagine: PaginaOcr[] = [];
    for (const immagine of immagini) {
      const residuo = budgetResiduo();
      if (residuo <= 0) {
        return {
          esito: "ocr_fallito",
          motivo: `Timeout OCR complessivo (${config.timeoutTotaleMs} ms) dopo ${pagine.length} pagine.`,
        };
      }
      try {
        const { stdout } = await execFileAsync(
          config.binari.tesseract,
          [
            path.join(cartella, immagine),
            "stdout",
            "-l",
            effettive.join("+"),
            "--psm",
            "3",
            "tsv",
          ],
          {
            timeout: Math.min(config.timeoutPaginaMs, residuo),
            maxBuffer: 32 * 1024 * 1024,
          }
        );
        pagine.push(parseTsv(stdout));
      } catch (errore: any) {
        if (errore?.killed || errore?.signal) {
          return {
            esito: "ocr_fallito",
            motivo: `Timeout OCR sulla pagina ${pagine.length + 1} (${config.timeoutPaginaMs} ms per pagina).`,
          };
        }
        const dettaglio = String(errore?.stderr || errore?.message || errore);
        if (/Failed loading language|Tessdata|traineddata/i.test(dettaglio)) {
          return {
            esito: "ocr_fallito",
            motivo: `Lingua OCR mancante: ${dettaglio.slice(0, 200)}`,
          };
        }
        return {
          esito: "ocr_fallito",
          motivo: `OCR fallito sulla pagina ${pagine.length + 1}: ${dettaglio.slice(0, 300)}`,
        };
      }
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
