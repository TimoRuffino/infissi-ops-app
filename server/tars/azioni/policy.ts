import { interruttoreAttivo } from "../../platform/interruttori";
import type { ContestoRun } from "../strumenti/tipi";
import { REGISTRO_AZIONI } from "./registry";
import type { DescrittoreAzioneTars } from "./types";

function autorizzata(
  azione: DescrittoreAzioneTars,
  contesto: ContestoRun
): boolean {
  if (azione.rischio === "R4") return false;
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
 * Catalogo deterministico e fail-closed. Senza selettori conserva il profilo
 * storico; con selettori lo restringe. Il fallback R0 scatta soltanto quando
 * nessuna azione registrata descrive quel profilo, non quando una candidata è
 * stata negata da capability, ruolo o flag.
 */
export function catalogoAzioniPerContesto(
  contesto: ContestoRun
): DescrittoreAzioneTars[] {
  const haSelettori = Boolean(
    contesto.superficie || contesto.intento || contesto.entitaAttiva
  );
  const candidate = haSelettori
    ? REGISTRO_AZIONI.filter(a => corrispondeAiSelettori(a, contesto))
    : [...REGISTRO_AZIONI];
  if (candidate.length > 0) {
    return candidate.filter(a => autorizzata(a, contesto));
  }
  return REGISTRO_AZIONI.filter(
    a => a.fallbackSicuro && a.rischio === "R0" && autorizzata(a, contesto)
  );
}
