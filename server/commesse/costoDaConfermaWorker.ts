// Il worker che rende retroattiva la regola «la conferma d'ordine porta il
// costo»: legge le conferme già nei fascicoli prima del 03/09/2026 (caso
// Tesconi) e quelle che l'aggancio ha lasciato in sospeso — scansioni da
// OCR, errori transitori dello storage. A lotti piccoli, ogni minuto, con
// un solo giro alla volta: l'OCR è locale ma tiene il processore per minuti.

import {
  documentiConfermaOrdine,
  type Documento,
} from "../routers/preventiviContratti";
import { registraCostoDaConferma } from "./costoDaConferma";
import {
  ESITI_TERMINALI,
  TENTATIVI_MASSIMI_LETTURA,
  VERSIONE_LETTURA_COSTO,
} from "./letturaCostoTipi";

const RITARDO_BOOT_MS = 30_000;
const INTERVALLO_MS = 60_000;
export const LOTTO_PER_GIRO = 10;

/** Una conferma va (ri)letta quando nessuno l'ha decisa con la versione e i byte correnti. */
export function daLeggere(documento: Documento): boolean {
  const lettura = documento.letturaCosto ?? null;
  if (!lettura) return true;
  if (lettura.versione !== VERSIONE_LETTURA_COSTO) return true;
  if ((lettura.checksum ?? null) !== (documento.checksum ?? null)) return true;
  if (ESITI_TERMINALI.has(lettura.esito)) return false;
  if (lettura.esito === "da_ocr") return true;
  if (lettura.esito === "errore") return lettura.tentativi < TENTATIVI_MASSIMI_LETTURA;
  return false;
}

function quando(documento: Documento): number {
  const t = new Date(documento.createdAt as any).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Le più recenti prima: sono le commesse vive, quelle di cui si guarda il margine. */
export function documentiDaLeggere(limite = LOTTO_PER_GIRO): Documento[] {
  return documentiConfermaOrdine()
    .filter(daLeggere)
    .sort((a, b) => quando(b) - quando(a))
    .slice(0, Math.max(0, limite));
}

export type EsitoGiroCosti = {
  esaminati: number;
  registrati: number;
  collegati: number;
  senzaImponibile: number;
  nonLeggibili: number;
  daOcr: number;
  errori: number;
  /** Quante conferme restano da leggere dopo questo giro. */
  rimaste: number;
};

export async function eseguiGiroCostiDaConferma(input?: {
  limite?: number;
  ocr?: boolean;
}): Promise<EsitoGiroCosti> {
  const esito: EsitoGiroCosti = {
    esaminati: 0,
    registrati: 0,
    collegati: 0,
    senzaImponibile: 0,
    nonLeggibili: 0,
    daOcr: 0,
    errori: 0,
    rimaste: 0,
  };
  for (const documento of documentiDaLeggere(input?.limite)) {
    esito.esaminati += 1;
    try {
      const letto = await registraCostoDaConferma({
        documentoId: documento.id,
        ocr: input?.ocr ?? true,
      });
      switch (letto.esito) {
        case "registrato":
          esito.registrati += 1;
          break;
        case "collegato":
          esito.collegati += 1;
          break;
        case "senza_imponibile":
          esito.senzaImponibile += 1;
          break;
        case "non_leggibile":
          esito.nonLeggibili += 1;
          break;
        case "da_ocr":
          esito.daOcr += 1;
          break;
        case "errore":
          esito.errori += 1;
          break;
        default:
          break;
      }
    } catch (errore) {
      esito.errori += 1;
      console.error("[costo-da-conferma] lettura fallita", {
        documentoId: documento.id,
        message: errore instanceof Error ? errore.message : "unknown",
      });
    }
  }
  esito.rimaste = documentiConfermaOrdine().filter(daLeggere).length;
  return esito;
}

export function costoDaConfermaWorkerAttivo(): boolean {
  return (process.env.COSTO_DA_CONFERMA_WORKER ?? "on").trim().toLowerCase() !== "off";
}

let inCorso = false;

async function giro(): Promise<void> {
  if (inCorso) return;
  inCorso = true;
  try {
    const esito = await eseguiGiroCostiDaConferma();
    if (esito.esaminati > 0) console.info("[costo-da-conferma] giro", esito);
  } catch (errore) {
    console.error("[costo-da-conferma] giro fallito", {
      message: errore instanceof Error ? errore.message : "unknown",
    });
  } finally {
    inCorso = false;
  }
}

export function startCostoDaConfermaWorker(): void {
  if (!costoDaConfermaWorkerAttivo()) {
    console.info("[costo-da-conferma] spento (COSTO_DA_CONFERMA_WORKER=off)");
    return;
  }
  const boot = setTimeout(() => void giro(), RITARDO_BOOT_MS);
  boot.unref?.();
  const timer = setInterval(() => void giro(), INTERVALLO_MS);
  timer.unref?.();
  console.info("[costo-da-conferma] attivo", {
    lotto: LOTTO_PER_GIRO,
    intervalloMs: INTERVALLO_MS,
    daLeggere: documentiConfermaOrdine().filter(daLeggere).length,
  });
}
