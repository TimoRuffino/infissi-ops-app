// Cercare un appuntamento nel calendario.
//
// Cerca in tutte le date, non nel periodo mostrato: si cerca proprio quello
// che non si vede, e filtrare il mese aperto sarebbe un filtro, non una
// ricerca. Per questo ogni risultato porta scritta la sua data — è
// l'informazione per cui si è cercato — e aprirlo ci porta sopra.

import { CalendarSearch, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CALENDAR_COLOR_MAP, CALENDARI } from "@/lib/calendario";
import { trpc } from "@/lib/trpc";

/** Sotto queste lettere ogni parola pesca mezzo calendario. */
const LETTERE_MINIME = 2;
/** Attesa prima di interrogare: si digita più veloce di così. */
const ATTESA_MS = 250;

const etichettaTipo = (tipo: string): string =>
  CALENDARI.find(c => c.key === tipo)?.label ?? tipo;

function dataLeggibile(data: string | null): string {
  if (!data) return "senza data";
  const d = new Date(`${data}T12:00:00`);
  if (Number.isNaN(d.getTime())) return data;
  const oggi = new Date();
  oggi.setHours(12, 0, 0, 0);
  const giorni = Math.round((d.getTime() - oggi.getTime()) / 86_400_000);
  if (giorni === 0) return "oggi";
  if (giorni === 1) return "domani";
  if (giorni === -1) return "ieri";
  return d.toLocaleDateString("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === oggi.getFullYear() ? {} : { year: "numeric" }),
  });
}

export type PlanningRicercaProps = {
  /** Apre l'appuntamento trovato: sposta il periodo e mostra la scheda. */
  onApri: (id: number, data: string | null) => void;
};

export default function PlanningRicerca({ onApri }: PlanningRicercaProps) {
  const [testo, setTesto] = useState("");
  const [differito, setDifferito] = useState("");
  const [aperto, setAperto] = useState(false);
  const contenitore = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDifferito(testo.trim()), ATTESA_MS);
    return () => clearTimeout(t);
  }, [testo]);

  const abbastanza = differito.length >= LETTERE_MINIME;
  const risultati = trpc.interventi.cerca.useQuery(
    { q: differito, limite: 20 },
    { enabled: abbastanza }
  );

  // Un clic fuori chiude l'elenco: senza, resta aperto sopra il calendario e
  // copre proprio quello che si è appena trovato.
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (!contenitore.current?.contains(e.target as Node)) setAperto(false);
    };
    document.addEventListener("mousedown", fuori);
    return () => document.removeEventListener("mousedown", fuori);
  }, [aperto]);

  const voci = useMemo(() => risultati.data ?? [], [risultati.data]);
  const mostraPannello = aperto && abbastanza;

  return (
    <div ref={contenitore} className="relative min-w-0 flex-1 lg:min-w-[10rem] lg:max-w-xs">
      <CalendarSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
      <Input
        value={testo}
        onChange={e => {
          setTesto(e.target.value);
          setAperto(true);
        }}
        onFocus={() => setAperto(true)}
        onKeyDown={e => {
          if (e.key === "Escape") {
            setAperto(false);
            e.currentTarget.blur();
          }
        }}
        // Nella barra restano ~175px: «Cerca un appuntamento…» ci si
        // troncherebbe a metà. L'icona è un calendario con la lente e
        // l'etichetta accessibile dice la frase intera.
        placeholder="Cerca…"
        aria-label="Cerca un appuntamento in tutto il calendario"
        className="min-h-11 pl-9 pr-9"
      />
      {testo ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Svuota la ricerca"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={() => {
            setTesto("");
            setDifferito("");
            setAperto(false);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}

      {mostraPannello ? (
        <div
          role="listbox"
          aria-label="Risultati della ricerca"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-80 overflow-y-auto rounded-[var(--radius-panel)] border border-border-soft bg-surface p-1 shadow-[var(--shadow-floating)] lg:min-w-[22rem]"
        >
          {risultati.isPending ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-text-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cerco…
            </p>
          ) : risultati.error ? (
            <p className="px-3 py-3 text-sm text-text-2">
              Ricerca non riuscita. Riprova.
            </p>
          ) : voci.length === 0 ? (
            <p className="px-3 py-3 text-sm text-text-2">
              Nessun appuntamento per «{differito}».
            </p>
          ) : (
            voci.map(voce => {
              const colore =
                CALENDAR_COLOR_MAP[voce.tipo] ?? "var(--color-cal-altro)";
              const dettagli = [voce.esecutore, voce.indirizzo]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={voce.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setAperto(false);
                    onApri(voce.id, voce.data);
                  }}
                  className="flex w-full min-w-0 flex-col gap-0.5 rounded-[var(--radius-control)] px-2 py-2 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/55"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colore }}
                    />
                    {/* La data è il motivo per cui si è cercato: sta in
                        evidenza, non in coda. */}
                    <span className="shrink-0 text-xs font-semibold capitalize text-text-1">
                      {dataLeggibile(voce.data)}
                    </span>
                    {voce.oraInizio ? (
                      <span className="shrink-0 text-xs tabular-nums text-text-2">
                        {voce.oraInizio}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-[11px] uppercase tracking-wide text-text-3">
                      {etichettaTipo(voce.tipo)}
                    </span>
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-text-1">
                    {voce.titolo || etichettaTipo(voce.tipo)}
                    {voce.commessaCodice ? (
                      <span className="codice-mono ml-2 text-text-3">
                        {voce.commessaCodice}
                      </span>
                    ) : null}
                  </span>
                  {dettagli ? (
                    <span className="min-w-0 truncate text-xs text-text-2">
                      {dettagli}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
