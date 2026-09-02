import { interruttoreAttivo } from "../../platform/interruttori";
import type { ContestoRun } from "../strumenti/tipi";
import { REGISTRO_AZIONI } from "./registry";
import type { DescrittoreAzioneTars } from "./types";
import { ledgerEsecuzioniAutorevoleDisponibile } from "./executions";

function autorizzata(
  azione: DescrittoreAzioneTars,
  contesto: ContestoRun
): boolean {
  if (azione.rischio === "R4") return false;
  if (
    azione.rischio === "R1" &&
    process.env.NODE_ENV !== "test" &&
    !ledgerEsecuzioniAutorevoleDisponibile()
  ) {
    return false;
  }
  if (!Number.isInteger(contesto.sedeId) || contesto.sedeId <= 0) return false;
  if (azione.prerequisiti.direzione && !contesto.direzione) return false;
  if (!azione.capability.every(c => contesto.capability.has(c))) return false;
  return azione.interruttori.every(interruttoreAttivo);
}

function corrispondeAiSelettori(
  azione: DescrittoreAzioneTars,
  contesto: ContestoRun
): boolean {
  if (
    contesto.superficie &&
    !azione.prerequisiti.superfici.includes(contesto.superficie)
  ) {
    return false;
  }
  if (
    contesto.intento &&
    !azione.prerequisiti.intenti.includes(contesto.intento)
  ) {
    return false;
  }
  if (
    contesto.entitaAttiva &&
    azione.prerequisiti.entita.length > 0 &&
    !azione.prerequisiti.entita.includes(contesto.entitaAttiva.tipo)
  ) {
    return false;
  }
  return true;
}

/**
 * Catalogo deterministico e fail-closed: TUTTO ciò che il principal può
 * fare (sede, direzione, capability, flag), sempre. Dal 02/09/2026 («Tars
 * libero») nessuna potatura per superficie o intento: con una commessa
 * attiva Tars rispondeva «non ho lo strumento» pur avendolo, perché il
 * tool non dichiarava quella superficie. I selettori restano dati di
 * contesto per il modello, non un filtro.
 */
export function catalogoAzioniPerContesto(
  contesto: ContestoRun
): DescrittoreAzioneTars[] {
  return REGISTRO_AZIONI.filter(a => autorizzata(a, contesto));
}

/** Corrispondenza ai selettori: informativa (ordinamento, diagnostica), non un filtro. */
export function azioniPertinentiAlContesto(
  contesto: ContestoRun
): DescrittoreAzioneTars[] {
  return catalogoAzioniPerContesto(contesto).filter(a =>
    corrispondeAiSelettori(a, contesto)
  );
}
