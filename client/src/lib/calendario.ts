// Tipi di calendario: un'unica definizione.
//
// Prima ogni pagina aveva la sua mappa di hex, e non coincidevano: "posa" era
// verde nella Dashboard e arancio nel Planning, "assistenza" ambra di là e
// viola di qua. Un colore che serve a riconoscere il tipo senza leggere deve
// dire la stessa cosa ovunque, e deve seguire il tema — gli hex scritti a mano
// restavano identici anche in dark mode.

export type TipoCalendario = "rilievo" | "posa" | "assistenza" | "altro";

export const CALENDARI: ReadonlyArray<{
  key: TipoCalendario;
  label: string;
  /** Variabile CSS: segue il tema, a differenza di un hex. */
  color: string;
  soft: string;
}> = [
  { key: "rilievo", label: "Rilievo", color: "var(--color-cal-rilievo)", soft: "var(--color-cal-rilievo-soft)" },
  { key: "posa", label: "Posa", color: "var(--color-cal-posa)", soft: "var(--color-cal-posa-soft)" },
  { key: "assistenza", label: "Interventi/Regolazioni", color: "var(--color-cal-assistenza)", soft: "var(--color-cal-assistenza-soft)" },
  { key: "altro", label: "Altro", color: "var(--color-cal-altro)", soft: "var(--color-cal-altro-soft)" },
];

export const CALENDAR_COLOR_MAP: Record<string, string> = Object.fromEntries(
  CALENDARI.map((c) => [c.key, c.color])
);

export const CALENDAR_SOFT_MAP: Record<string, string> = Object.fromEntries(
  CALENDARI.map((c) => [c.key, c.soft])
);

/** I sette stati commessa, per il donut: stessa palette dei badge. */
export const COLORI_STATO_COMMESSA = [
  "var(--color-st-preventivo)",
  "var(--color-st-misure)",
  "var(--color-st-contratto)",
  "var(--color-st-ordine)",
  "var(--color-st-produzione)",
  "var(--color-st-pagamento)",
  "var(--color-st-chiusura)",
];
