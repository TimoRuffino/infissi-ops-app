// Chi esegue un intervento, e quando la sua assenza è un problema.
//
// Sta in `shared/` perché la stessa regola serve a due lati che devono dire
// la stessa cosa: il server la applica scrivendo (un rilievo non conserva una
// squadra di posa), la Dashboard la usa per decidere cosa mettere in «Da fare
// oggi». Duplicarla vorrebbe dire un elenco che chiede di assegnare qualcuno
// a un lavoro che il server considera già assegnato — ed è già successo.

export const TIPI_INTERVENTO = [
  "rilievo",
  "posa",
  "assistenza",
  "consegna",
  "appuntamento",
  "riunione",
  "ferie",
  "altro",
] as const;
export type TipoIntervento = (typeof TIPI_INTERVENTO)[number];

/**
 * I tipi per cui «chi lo fa» è una domanda sensata.
 *
 * Un lavoro in cantiere senza nessuno assegnato blocca la giornata e va
 * segnalato. Ferie, riunioni e appuntamenti no: sono voci di agenda, non
 * lavoro da mandare a qualcuno. Chiedere «assegna la squadra» per le ferie di
 * un collega è rumore, e il rumore insegna a ignorare l'elenco.
 */
export const TIPI_CON_ESECUTORE = [
  "rilievo",
  "posa",
  "assistenza",
  "consegna",
] as const satisfies readonly TipoIntervento[];

export type Esecutore = {
  squadraId: number | null;
  tecnicoId: number | null;
};

/**
 * Chi esegue l'intervento, secondo il tipo.
 *
 * Un rilievo lo fa un tecnico dei rilievi; una posa, un'assistenza o una
 * consegna una squadra di posa. Sono due insiemi di persone diversi, quindi
 * due campi diversi: tenerli entrambi pieni vorrebbe dire che un rilievo è
 * assegnato a una squadra che non lo farà mai, e prima o poi qualcuno ci va.
 */
export function esecutorePerTipo(input: {
  tipo?: string | null;
  squadraId?: number | null;
  tecnicoId?: number | null;
}): Esecutore {
  if (input.tipo === "rilievo") {
    return { squadraId: null, tecnicoId: input.tecnicoId ?? null };
  }
  return { squadraId: input.squadraId ?? null, tecnicoId: null };
}

/**
 * Manca chi lo esegue, e per questo tipo è un problema.
 *
 * Guardare solo `squadraId` faceva risultare scoperto ogni rilievo con il
 * tecnico già assegnato: per un rilievo la squadra è vuota per costruzione.
 */
export function senzaEsecutore(intervento: {
  tipo?: string | null;
  squadraId?: number | null;
  tecnicoId?: number | null;
}): boolean {
  const tipo = intervento.tipo ?? "";
  if (!(TIPI_CON_ESECUTORE as readonly string[]).includes(tipo)) return false;
  const { squadraId, tecnicoId } = esecutorePerTipo(intervento);
  return squadraId == null && tecnicoId == null;
}

/**
 * Il titolo vero dentro la nota scritta dalla migrazione Google.
 *
 * La nota è `Importato dal calendario Google «<calendario>»: <titolo>`: il
 * prefisso è identico su ogni riga importata, quindi mostrarlo come titolo
 * vuol dire un calendario in cui tutti gli appuntamenti si chiamano uguale.
 * Torna `null` per le note scritte a mano, che non hanno quella forma.
 */
export function titoloDaNotaImportata(
  nota: string | null | undefined
): string | null {
  if (!nota) return null;
  const m = /^Importato dal calendario Google «[^»]*»:\s*([\s\S]+)$/.exec(
    String(nota).trim()
  );
  const titolo = m?.[1]?.trim().split("\n")[0]?.trim();
  return titolo ? titolo : null;
}
