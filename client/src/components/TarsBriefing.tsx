// Briefing deterministico di Tars (T4): promemoria di oggi, casi assegnati,
// segnalazioni shadow di sede. ZERO token: nessun run del modello, solo
// letture. Condiviso tra la pagina /tars e la colonna «Situazione» della
// Dashboard; con `enabled: false` la query non parte nemmeno (flag spento
// = zero richieste, zero errori console).
import {
  SmistamentoSituazione,
  smistamentoVuoto,
} from "@/components/tars/TarsSmistamento";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Clock, Pin } from "lucide-react";
import { useLocation } from "wouter";

export default function TarsBriefing({
  enabled,
  className = "",
}: {
  enabled: boolean;
  className?: string;
}) {
  const briefing = trpc.tars.briefing.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
    enabled,
  });
  const [, navigate] = useLocation();
  if (!enabled || !briefing.data) return null;
  const b = briefing.data;
  const vuoto =
    b.promemoriaOggi.length === 0 &&
    b.casiMiei.length === 0 &&
    (b.segnalazioni?.length ?? 0) === 0 &&
    smistamentoVuoto(b.smistamento);
  if (vuoto) {
    return (
      <p className={`text-xs text-text-3 ${className}`}>
        Situazione: nessun promemoria per oggi, nessun caso assegnato
        {b.segnalazioni != null ? ", nessuna segnalazione di sede" : ""}.
      </p>
    );
  }
  return (
    <div
      className={`space-y-2 rounded-md border border-border bg-surface-2 p-3 text-text-1 ${className}`}
    >
      <h2 className="text-xs font-semibold">Situazione di oggi</h2>
      {b.smistamento && !smistamentoVuoto(b.smistamento) && (
        <SmistamentoSituazione
          smistamento={b.smistamento}
          onApriLink={navigate}
          compatto
        />
      )}
      {b.promemoriaOggi.length > 0 && (
        <ul className="space-y-0.5">
          {b.promemoriaOggi.slice(0, 5).map(p => (
            <li key={p.id} className="text-xs flex items-start gap-1.5 min-w-0">
              <Clock className="h-3.5 w-3.5 shrink-0 mt-px text-text-3" />
              <span className="min-w-0 break-words">
                {p.remindAtLocale.slice(-5)} — {p.testo}
              </span>
            </li>
          ))}
        </ul>
      )}
      {b.casiMiei.length > 0 && (
        <ul className="space-y-0.5">
          {b.casiMiei.slice(0, 5).map(c => (
            <li key={c.id} className="text-xs flex items-start gap-1.5 min-w-0">
              <Pin className="h-3.5 w-3.5 shrink-0 mt-px text-text-3" />
              <button
                className="text-left hover:underline min-w-0 break-words"
                onClick={() => navigate(c.link)}
              >
                {c.titolo} <span className="text-text-3">({c.priorita})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(b.segnalazioni ?? []).length > 0 && (
        <ul className="space-y-0.5">
          {b.segnalazioni!.slice(0, 6).map((s, i) => (
            <li key={i} className="text-xs flex items-start gap-1.5 min-w-0">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-warning" />
              <button
                className="text-left hover:underline min-w-0 break-words"
                onClick={() => navigate(s.link)}
              >
                {s.titolo}
                {s.agganciataACasoAperto && (
                  <span className="text-text-3"> — già nel Centro Azioni</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
