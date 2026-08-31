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

// ── Helper di periodo ────────────────────────────────────────────────────────
// Vivevano dentro Planning.tsx e non erano raggiungibili dai componenti della
// route (toolbar, agenda). Stessa implementazione, una sola definizione.

/** Data locale in formato `YYYY-MM-DD` (mai UTC: il calendario è locale). */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Lunedì della settimana che contiene `d`. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay(); // 0=Dom
  const diff = (dow === 0 ? -6 : 1) - dow;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

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
