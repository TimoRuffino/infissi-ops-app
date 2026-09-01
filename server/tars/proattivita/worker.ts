// Worker dell'osservatore (T6): consuma i draft già riconciliati dal
// Centro Azioni e li persiste come osservazioni deduplicate, a ritmo
// macchina e a costo zero (nessun modello). Fail-closed su flag e
// repository; un errore qui non deve MAI rompere il reconcile.

import type { ActionCaseDraft } from "../../actionCenter/types";
import { tarsAttivo } from "../../platform/interruttori";
import { derivaOsservazione } from "./rules";
import {
  repositoryOsservazioniAutorevoleDisponibile,
  repositoryOsservazioniCorrente,
  type RepositoryOsservazioni,
} from "./repository";
import {
  parseModalitaOsservatore,
  type EsitoOsservazione,
  type ModalitaOsservatore,
} from "./types";

export function modalitaOsservatore(): ModalitaOsservatore {
  return parseModalitaOsservatore(process.env.TARS_OBSERVER_MODE);
}

/** L'osservatore scrive (shadow o active); espone solo in active. */
export function osservatoreScrive(): boolean {
  return (
    tarsAttivo("tarsProactive") && repositoryOsservazioniAutorevoleDisponibile()
  );
}

export function osservatoreEspone(): boolean {
  return osservatoreScrive() && modalitaOsservatore() === "active";
}

export async function osservaDaReconcile(input: {
  sedeId: number;
  drafts: readonly ActionCaseDraft[];
  now: Date;
  repository?: RepositoryOsservazioni;
}): Promise<EsitoOsservazione | null> {
  if (!osservatoreScrive()) return null;
  const repository = input.repository ?? repositoryOsservazioniCorrente();
  const esito: EsitoOsservazione = {
    aperte: 0,
    aggiornate: 0,
    invariate: 0,
    riaperte: 0,
    autoRisolte: 0,
    scartatePerMaterialita: 0,
  };
  // TUTTI i casi vivi della sede (anche sotto materialità): un caso ancora
  // esistente non auto-risolve la sua osservazione; il detector corrente
  // permette di chiudere le righe di detector dismessi (revisione R2#4).
  const casiVivi = new Map<string, string>();
  for (const draft of input.drafts) {
    if (draft.sedeId !== input.sedeId) continue;
    casiVivi.set(draft.canonicalKey, draft.nextAction.sourceKind);
  }
  for (const draft of input.drafts) {
    if (draft.sedeId !== input.sedeId) continue;
    const nuova = derivaOsservazione(draft);
    if (!nuova) {
      esito.scartatePerMaterialita += 1;
      continue;
    }
    const upsert = await repository.upsert(nuova, input.now);
    switch (upsert.esito) {
      case "aperta":
        esito.aperte += 1;
        break;
      case "aggiornata":
        esito.aggiornate += 1;
        break;
      case "riaperta":
        esito.riaperte += 1;
        break;
      default:
        esito.invariate += 1;
    }
  }
  esito.autoRisolte = await repository.risolviAssenti({
    sedeId: input.sedeId,
    casiVivi,
    now: input.now,
  });
  if (esito.aperte || esito.aggiornate || esito.riaperte || esito.autoRisolte) {
    console.info("[tars-osservatore]", {
      modalita: modalitaOsservatore(),
      sedeId: input.sedeId,
      ...esito,
    });
  }
  return esito;
}
