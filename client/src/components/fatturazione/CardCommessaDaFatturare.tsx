// Card dell'elenco «Fatturazione» (piano 4, Task 3): una commessa da
// fatturare con cliente, codice, stato e giorni nello stato, numero di
// documenti, i quattro passi come pallini e — solo con `economia.read` —
// pattuito e fattura prevista. Il pulsante primario apre la pagina a passi
// della commessa (`/fatturazione/:id`, Task 5).
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §2 («Card») e §6 (client).
import { Link } from "wouter";
import {
  ETICHETTA_PASSO,
  ORDINE_PASSI,
  type CommessaDaFatturare,
} from "@shared/fatturazione/passi";

import StatoChip from "@/components/StatoChip";
import { Button } from "@/components/ui/button";
import {
  etichettaPulsante,
  giorniTesto,
  importiCard,
  tonoPasso,
} from "@/lib/fatturazioneView";
import { cn } from "@/lib/utils";

/**
 * Colore del pallino per tono. Mai il solo colore: ogni `<li>` porta anche
 * l'esito per esteso in `aria-label`/`title` (dot e didascalia sotto sono
 * `aria-hidden`, per non farlo annunciare due volte).
 */
const TONO_PALLINO: Record<ReturnType<typeof tonoPasso>, string> = {
  neutro: "border border-border-strong bg-surface",
  attivo: "bg-warning",
  ok: "bg-success",
  spento: "border border-dashed border-border-soft bg-surface-2",
};

export default function CardCommessaDaFatturare({
  commessa,
}: {
  commessa: CommessaDaFatturare;
}) {
  const importi = importiCard(commessa);
  const giorni = giorniTesto(commessa.giorniNelloStato);
  const daQuando = giorni === "—" ? giorni : `da ${giorni}`;
  const mostraImporti = importi.pattuito != null || importi.prevista != null;

  return (
    <article className="flex h-full min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-border-soft bg-surface p-4">
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-bold leading-5 text-text-1">
          {commessa.cliente}
        </h3>
        <span className="codice-mono text-xs text-text-3">
          {commessa.codice}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatoChip stato={commessa.stato} />
        <span className="text-xs text-text-3">{daQuando}</span>
      </div>

      <p className="text-xs text-text-2">
        {commessa.documenti.totale}{" "}
        {commessa.documenti.totale === 1 ? "documento" : "documenti"} (
        {commessa.documenti.contratti}{" "}
        {commessa.documenti.contratti === 1 ? "contratto" : "contratti"})
      </p>

      <ul
        role="list"
        aria-label="Passi della fatturazione"
        className="grid grid-cols-4 gap-1"
      >
        {ORDINE_PASSI.map(passo => {
          const esito = commessa.passi[passo];
          const etichettaEsito = esito.replace(/_/g, " ");
          return (
            <li
              key={passo}
              aria-label={`${ETICHETTA_PASSO[passo]}: ${etichettaEsito}`}
              title={`${ETICHETTA_PASSO[passo]}: ${etichettaEsito}`}
              className="flex min-w-0 flex-col items-center gap-1"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  TONO_PALLINO[tonoPasso(esito)]
                )}
              />
              <span
                aria-hidden="true"
                className="w-full truncate text-center text-[10px] leading-tight text-text-3"
              >
                {ETICHETTA_PASSO[passo]}
              </span>
            </li>
          );
        })}
      </ul>

      {mostraImporti ? (
        <p className="truncate text-xs text-text-2">
          {importi.pattuito != null ? `Pattuito ${importi.pattuito}` : null}
          {importi.pattuito != null && importi.prevista != null ? " · " : null}
          {importi.prevista != null
            ? `Fattura prevista ${importi.prevista}${
                importi.stima ? " (stima)" : ""
              }`
            : null}
        </p>
      ) : null}

      <Button
        asChild
        className="mt-auto min-h-11 w-full sm:w-auto sm:self-start"
      >
        <Link href={`/fatturazione/${commessa.commessaId}`}>
          {etichettaPulsante(commessa.passi)}
        </Link>
      </Button>
    </article>
  );
}
