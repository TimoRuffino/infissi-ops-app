// server/fatture/sonda.ts
// La sonda degli stati SdI: legge `ei_status` da Fatture in Cloud per le
// fatture già inviate (o emesse in dry-run) e lo traduce nello stato del
// CRM (spec §7.5.8). Due ingressi sullo stesso lavoro: `aggiornaStatoFattura`
// per una fattura sola («Aggiorna stato», a richiesta) e `giroSonda` per
// tutte le sedi, chiamato ogni 15 minuti da `startSondaFattureWorker`.
//
// Nessuna regola di dominio nuova: la mappa ei_status → stato e la ripresa
// dell'archivio mancante sono le uniche decisioni di questo modulo. Il
// trasporto resta in `server/fic/emissione.ts`, la coreografia
// dell'emissione in `./emissione.ts`, di cui questo modulo riusa
// `archiviaFattura` (passi 7-8 di Task 9) e `contestoFicPerSede`.
import type { Fattura, StatoFattura } from "@shared/fatturazione/tipi";
import { creaClientFicEmissione, type ContestoFic } from "../fic/emissione";
import { interruttoreAttivo } from "../platform/interruttori";
import {
  archiviaFattura,
  contestoFicPerSede,
  type DipendenzeEmissione,
} from "./emissione";
import { getFattureRepository, type FattureRepository } from "./repository";

function repo(dip?: DipendenzeEmissione): FattureRepository {
  return dip?.repository ?? getFattureRepository();
}

function messaggio(errore: unknown): string {
  const testo = String((errore as any)?.message ?? errore ?? "").trim();
  return testo || "errore sconosciuto";
}

/** spec §7.5.8: ei_status di Fatture in Cloud → stato del CRM. Chiavi
 * assenti (`not_sent`, `missing`, sconosciute) e `null` non mappano a
 * nulla: la sonda le rilegge al giro successivo senza toccare lo stato. */
const MAPPA_EI_STATUS: Record<string, StatoFattura> = {
  attempt: "inviata",
  pending: "inviata",
  sent: "inviata",
  processing: "inviata",
  delivered: "consegnata",
  accepted: "consegnata",
  manual_accepted: "consegnata",
  discarded: "scartata",
  rejected: "rifiutata",
  manual_rejected: "rifiutata",
  not_delivered: "mancata_consegna",
  no_response: "mancata_consegna",
  error: "inviata",
};

const AVVISO_ERRORE_GESTIONE =
  "FiC segnala un errore di gestione: riprova l'invio o contatta il supporto";

/**
 * Pura: nessuna chiamata, nessuna scrittura. `avviso` è non nullo solo per
 * `error` (il motivo di uno scarto arriva da `motivoScarto`, non da qui —
 * `aggiornaStatoFattura` lo richiede a parte quando `stato === "scartata"`).
 */
export function mappaEiStatus(ei: string | null): {
  stato: StatoFattura | null;
  avviso: string | null;
} {
  const stato = ei == null ? null : (MAPPA_EI_STATUS[ei] ?? null);
  if (!stato) return { stato: null, avviso: null };
  return { stato, avviso: ei === "error" ? AVVISO_ERRORE_GESTIONE : null };
}

/**
 * Una fattura sola, a richiesta (bottone «Aggiorna stato») o dalla sonda.
 * `perId` è già isolato per sede: una fattura di un'altra sede non esiste,
 * e questo deve valere prima di ogni scrittura o evento — da qui il
 * controllo come primo passo, prima di risolvere anche solo il contesto FiC.
 *
 * Lo stato cambia solo se la mappa ne dà uno diverso da quello attuale:
 * un `ei_status` che conferma lo stato di partenza (es. "sent" mentre la
 * fattura è già «inviata») non scrive un evento. `eiStatusFic` invece è
 * sempre riscritto, anche senza cambio di stato: è il valore grezzo di FiC,
 * utile in diagnostica anche quando non sposta la fattura.
 *
 * L'archivio mancante (XML/PDF, passi 7-8 di Task 9) si ritenta ad ogni
 * chiamata in cui manca: stesse dipendenze iniettate, stessa idempotenza —
 * quello che c'è già non si riscarica. `eiErrore` è sempre riscritto alla
 * fine, come in `emettiFattura`: un avviso SdI o un problema d'archivio
 * risolto al giro successivo non deve restare appiccicato.
 */
export async function aggiornaStatoFattura(
  input: {
    sedeId: number;
    id: number;
    actorUserId: number | null;
  } & DipendenzeEmissione
): Promise<{ fattura: Fattura; cambiato: boolean }> {
  const repository = repo(input);
  const now = input.now?.() ?? new Date();
  const client = input.client ?? creaClientFicEmissione();

  let fattura = await repository.perId(input.sedeId, input.id);
  if (!fattura) {
    throw new Error("NOT_FOUND: Fattura non trovata.");
  }
  if (fattura.ficDocumentId == null) {
    throw new Error(
      `PRECONDIZIONE: la fattura #${fattura.id} non ha un documento su Fatture in Cloud: emettila prima di sondarne lo stato.`
    );
  }

  const ctx = await (input.contesto ?? contestoFicPerSede)(input.sedeId);
  const documento = await client.leggiDocumento(ctx, fattura.ficDocumentId);
  const eiStatus = documento.ei_status;
  const mappa = mappaEiStatus(eiStatus);
  const statoPrecedente = fattura.stato;
  const cambiato = mappa.stato != null && mappa.stato !== statoPrecedente;

  // Lo scarto porta un motivo dedicato: sostituisce l'avviso generico
  // (che per `discarded` è comunque null, v. `mappaEiStatus`).
  let eiErroreSdi = mappa.avviso;
  if (mappa.stato === "scartata") {
    eiErroreSdi = await client.motivoScarto(ctx, fattura.ficDocumentId);
  }

  fattura = await repository.aggiornaStato({
    sedeId: input.sedeId,
    id: fattura.id,
    patch: cambiato
      ? { eiStatusFic: eiStatus, stato: mappa.stato! }
      : { eiStatusFic: eiStatus },
    now,
  });

  if (cambiato) {
    await repository.appendEvento({
      fatturaId: fattura.id,
      sedeId: input.sedeId,
      tipo: mappa.stato === "scartata" ? "scarto" : "stato_sdi",
      payload: { da: statoPrecedente, a: mappa.stato, eiStatus },
      actorUserId: input.actorUserId,
    });
  }

  const problemiArchivio: string[] = [];
  if (fattura.xmlStorageKey == null || fattura.pdfStorageKey == null) {
    const archivio = await archiviaFattura({
      ...input,
      fattura,
      ctx,
      repository,
      client,
      now: () => now,
    });
    fattura = archivio.fattura;
    problemiArchivio.push(...archivio.problemi);
  }

  fattura = await repository.aggiornaStato({
    sedeId: input.sedeId,
    id: fattura.id,
    patch: {
      eiErrore:
        [eiErroreSdi, ...problemiArchivio].filter(Boolean).join(" ") || null,
    },
    now,
  });

  return { fattura, cambiato };
}

/**
 * Un giro su tutte le sedi. Risolve `getCfg` + `accessTokenFic` (via
 * `contestoFicPerSede`, o l'iniettato `contesto`) UNA volta per sede, non
 * per fattura: una sede senza collegamento fa fallire tutte le sue righe
 * con lo stesso errore invece di ritentare il token ad ogni fattura.
 * Gli errori restano isolati per fattura — una che fallisce non ferma le
 * altre — e il log non porta mai il token, solo l'id e il messaggio.
 */
export async function giroSonda(
  dip: DipendenzeEmissione = {}
): Promise<{ controllate: number; cambiate: number; errori: number }> {
  const repository = repo(dip);
  const risolviContesto = dip.contesto ?? contestoFicPerSede;
  const righe = await repository.daSondare();

  const perSede = new Map<number, typeof righe>();
  for (const riga of righe) {
    const lista = perSede.get(riga.sedeId);
    if (lista) lista.push(riga);
    else perSede.set(riga.sedeId, [riga]);
  }

  let controllate = 0;
  let cambiate = 0;
  let errori = 0;

  for (const [sedeId, righeSede] of perSede) {
    let ctx: ContestoFic | null = null;
    let erroreContesto = "";
    try {
      ctx = await risolviContesto(sedeId);
    } catch (errore) {
      erroreContesto = messaggio(errore);
    }

    for (const riga of righeSede) {
      controllate++;
      if (!ctx) {
        errori++;
        console.error(`[fatture] sonda fattura #${riga.id}: ${erroreContesto}`);
        continue;
      }
      try {
        const esito = await aggiornaStatoFattura({
          ...dip,
          sedeId,
          id: riga.id,
          actorUserId: null,
          contesto: async () => ctx!,
        });
        if (esito.cambiato) cambiate++;
      } catch (errore) {
        errori++;
        console.error(
          `[fatture] sonda fattura #${riga.id}: ${messaggio(errore)}`
        );
      }
    }
  }

  return { controllate, cambiate, errori };
}

const INTERVALLO_MS = 15 * 60 * 1000;
const PRIMO_GIRO_MS = 40_000;

let timer: NodeJS.Timeout | null = null;
let inCorso = false;

/**
 * Stesso pattern di `server/tars/followup/worker.ts`: `setInterval` +
 * flag `inCorso` (un giro lento non si accavalla col successivo) +
 * `unref` (non tiene vivo il processo da solo), primo giro anticipato via
 * `setTimeout`. Attivo solo con `interruttoreAttivo("fatturazione")`: il
 * kill switch si controlla ad ogni tick, non una volta sola all'avvio.
 */
export function startSondaFattureWorker(): void {
  if (timer) return;
  const tick = async () => {
    if (inCorso || !interruttoreAttivo("fatturazione")) return;
    inCorso = true;
    try {
      await giroSonda();
    } catch (errore) {
      console.error("[fatture] sonda:", messaggio(errore));
    } finally {
      inCorso = false;
    }
  };
  timer = setInterval(() => void tick(), INTERVALLO_MS);
  timer.unref?.();
  setTimeout(() => void tick(), PRIMO_GIRO_MS).unref?.();
}

/** Solo test/hot-reload: azzera il timer, come il suo pari in followup/worker.ts. */
export function stopSondaFattureWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
