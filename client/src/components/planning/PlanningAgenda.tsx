import { CalendarClock, Clock, Lock, MapPin, Users as UsersIcon } from "lucide-react";

import {
  CALENDAR_COLOR_MAP,
  CALENDAR_SOFT_MAP,
  toDateStr,
} from "@/lib/calendario";

/** Intervento CRM già arricchito dal contenitore: l'agenda non fa lookup. */
export type PlanningAgendaItem = {
  id: number;
  /** `YYYY-MM-DD` */
  data: string;
  tipo: string;
  tipoLabel: string;
  titolo: string;
  /** "09:00 – 11:00", "09:00" oppure null quando l'ora non è definita. */
  orario: string | null;
  squadra: string | null;
  indirizzo: string | null;
  /** Solo se diverso da `pianificato`: altrimenti è rumore su ogni riga. */
  stato: string | null;
};

/** Evento Google in sola lettura: nessuna azione di scrittura. */
export type PlanningAgendaExternalItem = {
  id: string;
  data: string;
  titolo: string;
  orario: string;
  fonte: string;
  /** Colore identità della sorgente esterna (dato runtime, non un token). */
  colore: string;
  indirizzo: string | null;
};

export type PlanningAgendaProps = {
  items: ReadonlyArray<PlanningAgendaItem>;
  externalItems?: ReadonlyArray<PlanningAgendaExternalItem>;
  /** `intervento.plan`: abilita solo l'invito a modificare data e ora. */
  canReschedule: boolean;
  onOpenIntervento: (id: number) => void;
  onOpenExternal?: (id: string) => void;
};

type Giorno = {
  data: string;
  crm: PlanningAgendaItem[];
  esterni: PlanningAgendaExternalItem[];
};

function etichettaGiorno(data: string): string {
  return new Date(`${data}T12:00:00`).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function raggruppaPerGiorno(
  items: ReadonlyArray<PlanningAgendaItem>,
  esterni: ReadonlyArray<PlanningAgendaExternalItem>
): Giorno[] {
  const mappa = new Map<string, Giorno>();
  const giorno = (data: string): Giorno => {
    const esistente = mappa.get(data);
    if (esistente) return esistente;
    const nuovo: Giorno = { data, crm: [], esterni: [] };
    mappa.set(data, nuovo);
    return nuovo;
  };
  for (const item of items) giorno(item.data).crm.push(item);
  for (const item of esterni) giorno(item.data).esterni.push(item);
  return [...mappa.values()].sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Vista lista degli appuntamenti sotto `lg`: una card per intervento, ognuna
 * un `button` che apre lo sheet — è l'alternativa da tastiera al drag del
 * calendario desktop.
 */
export default function PlanningAgenda({
  items,
  externalItems = [],
  canReschedule,
  onOpenIntervento,
  onOpenExternal,
}: PlanningAgendaProps) {
  const giorni = raggruppaPerGiorno(items, externalItems);
  const oggi = toDateStr(new Date());
  // Su 375px «Squadra A — Rossi Franco» e «Via Garibaldi 14, La Spezia» sulla
  // stessa riga si tagliano tutt'e due a metà. Si tolgono le parti che si
  // ripetono su ogni appuntamento — il caposquadra e la città della sede — e
  // resta quella che distingue un lavoro dall'altro.
  const soloNome = (s: string | null) => (s ? s.split(" — ")[0] : s);
  const soloVia = (s: string | null) => (s ? s.split(", ")[0] : s);

  return (
    <ol className="min-w-0 space-y-4">
      {giorni.map(giorno => (
        <li key={giorno.data} className="min-w-0 space-y-2">
          <h3 className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-text-3">
            <span className="min-w-0 truncate">
              {etichettaGiorno(giorno.data)}
            </span>
            {giorno.data === oggi ? (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                Oggi
              </span>
            ) : null}
          </h3>

          <ul className="min-w-0 space-y-2">
            {giorno.crm.map(item => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenIntervento(item.id)}
                  className="flex min-h-12 w-full min-w-0 flex-col gap-0.5 rounded-[var(--radius-control)] border border-border-soft bg-surface py-2 pl-3 pr-2.5 text-left shadow-[var(--shadow-raised)] outline-none transition-colors hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/55"
                  style={{
                    // La stessa barra del calendario desktop: il tipo si
                    // riconosce di sfuggita, uguale su tutte le viste.
                    boxShadow: `inset 3px 0 0 0 ${
                      CALENDAR_COLOR_MAP[item.tipo] ?? "var(--color-cal-altro)"
                    }`,
                  }}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className="shrink-0 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor:
                          CALENDAR_SOFT_MAP[item.tipo] ??
                          "var(--color-cal-altro-soft)",
                        color:
                          CALENDAR_COLOR_MAP[item.tipo] ??
                          "var(--color-cal-altro)",
                      }}
                    >
                      {item.tipoLabel}
                    </span>
                    {item.orario ? (
                      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs font-bold text-text-1">
                        <Clock className="h-3 w-3" />
                        {item.orario}
                      </span>
                    ) : null}
                    {item.stato ? (
                      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-text-3">
                        {item.stato}
                      </span>
                    ) : canReschedule ? (
                      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent-text">
                        <CalendarClock className="h-3 w-3 shrink-0" />
                        Data e ora
                      </span>
                    ) : null}
                  </span>

                  {/* Il chip dice già il tipo: se il titolo è solo il tipo
                      ripetuto (evento senza cliente né nota), tacerlo. */}
                  {item.titolo !== item.tipoLabel && (
                    <span className="min-w-0 truncate text-sm font-semibold text-text-1">
                      {item.titolo}
                    </span>
                  )}

                  {/* Squadra e indirizzo su una riga: sono due dettagli brevi
                      e su uno schermo stretto due righe da venti caratteri
                      costano quanto un secondo appuntamento visibile. */}
                  {item.squadra || item.indirizzo ? (
                    <span className="flex min-w-0 items-center gap-2 text-xs text-text-2">
                      {item.squadra ? (
                        <span className="flex min-w-0 shrink items-center gap-1">
                          <UsersIcon className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate">
                            {soloNome(item.squadra)}
                          </span>
                        </span>
                      ) : null}
                      {item.indirizzo ? (
                        <span className="flex min-w-0 shrink items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate">
                            {soloVia(item.indirizzo)}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}

            {giorno.esterni.map(item => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenExternal?.(item.id)}
                  className="flex min-h-12 w-full min-w-0 flex-col gap-1 rounded-[var(--radius-control)] border border-dashed border-border-soft bg-surface p-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/55"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${item.colore} 16%, var(--color-surface))`,
                        color: `color-mix(in srgb, ${item.colore} 75%, var(--color-text-1))`,
                      }}
                    >
                      <Lock className="h-2.5 w-2.5" />
                      Google
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs font-bold text-text-1">
                      <Clock className="h-3 w-3" />
                      {item.orario}
                    </span>
                  </span>

                  <span className="min-w-0 truncate text-sm font-semibold text-text-1">
                    {item.titolo}
                  </span>

                  {item.indirizzo ? (
                    <span className="flex min-w-0 items-center gap-1 text-xs text-text-2">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 truncate">{item.indirizzo}</span>
                    </span>
                  ) : null}

                  <span className="text-xs text-text-3">{item.fonte}</span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
