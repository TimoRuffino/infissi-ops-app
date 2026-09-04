// Sezione «Fatture emesse dal CRM» della pagina Cassa: l'elenco dei documenti
// che questo CRM ha generato dal contratto, per la sede attiva. Non sostituisce
// le fatture importate da Fatture in Cloud (quelle vivono in Economia): qui si
// vedono solo le fatture nate qui dentro, col loro stato SdI.
//
// Nessun calcolo: `fatture.lista` filtra per sede lato server, ordina dalla più
// recente e torna i documenti senza righe. Il filtro di stato e quello di tipo
// viaggiano nella query, così il tetto di 50 conta sulle fatture che si vedono.
import { useState } from "react";
import { FileText } from "lucide-react";
import { Link } from "wouter";

import { STATI_FATTURA, TIPI_FATTURA } from "@shared/fatturazione/tipi";
import type { StatoFattura, TipoFattura } from "@shared/fatturazione/tipi";
import { badgeStatoFattura } from "@/lib/fatturaView";
import { formatCent } from "@/lib/limitiView";
import { trpc } from "@/lib/trpc";
import { permessoNegato } from "@/lib/trpcErrors";
import DataSurface from "@/components/patterns/DataSurface";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const VARIANTE_BADGE = {
  neutro: "outline",
  ok: "success",
  attenzione: "warning",
  errore: "danger",
} as const;

const TUTTI = "tutti";

const ETICHETTA_TIPO: Record<TipoFattura, string> = {
  fattura: "Fatture",
  nota_credito: "Note di credito",
};

/** Quante fatture chiedere: la Cassa è una vista di lavoro, non un archivio. */
const LIMITE = 50;

const fmtData = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("it-IT") : "—";

export default function FattureEmesseSezione() {
  const [stato, setStato] = useState<StatoFattura | typeof TUTTI>(TUTTI);
  const [tipo, setTipo] = useState<TipoFattura | typeof TUTTI>(TUTTI);

  const q = trpc.fatture.lista.useQuery(
    {
      limite: LIMITE,
      ...(stato === TUTTI ? {} : { stati: [stato] }),
      ...(tipo === TUTTI ? {} : { tipo }),
    },
    { retry: false }
  );

  // La pagina Cassa è aperta anche a chi non legge le fatture: un FORBIDDEN
  // non è un guasto, è una sezione che non riguarda questo utente.
  if (permessoNegato(q.error)) return null;

  const fatture = q.data ?? [];
  const filtriAttivi = stato !== TUTTI || tipo !== TUTTI;

  const stateElenco: StatePanelProps | undefined = q.isPending
    ? {
        kind: "loading",
        title: "Carico le fatture",
        description: "Recupero i documenti emessi dal CRM per questa sede.",
        rows: 3,
      }
    : q.isError
      ? {
          kind: "error",
          title: "Fatture non caricate",
          description:
            "Non è stato possibile leggere le fatture della sede. Nessun documento è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void q.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : fatture.length === 0
        ? {
            kind: "empty",
            title: filtriAttivi
              ? "Nessuna fattura per questo filtro"
              : "Nessuna fattura emessa dal CRM in questa sede",
            description: filtriAttivi
              ? "Cambia stato o tipo per vedere gli altri documenti della sede."
              : "Le fatture generate dal contratto compariranno qui, con il loro stato SdI.",
            action: filtriAttivi ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setStato(TUTTI);
                  setTipo(TUTTI);
                }}
              >
                Azzera i filtri
              </Button>
            ) : undefined,
          }
        : undefined;

  return (
    <DataSurface
      density="compact"
      tone="default"
      title="Fatture emesse dal CRM"
      description="Documenti generati dal contratto per la sede attiva, dal più recente."
      toolbar={
        <>
          <Select
            value={stato}
            onValueChange={v => setStato(v as StatoFattura | typeof TUTTI)}
          >
            <SelectTrigger
              className="min-h-11 w-full sm:w-52"
              aria-label="Filtra per stato della fattura"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TUTTI}>Tutti gli stati</SelectItem>
              {STATI_FATTURA.map(s => (
                <SelectItem key={s} value={s}>
                  {badgeStatoFattura(s, false).testo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={tipo}
            onValueChange={v => setTipo(v as TipoFattura | typeof TUTTI)}
          >
            <SelectTrigger
              className="min-h-11 w-full sm:w-40"
              aria-label="Filtra per tipo di documento"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TUTTI}>Tutti i tipi</SelectItem>
              {TIPI_FATTURA.map(t => (
                <SelectItem key={t} value={t}>
                  {ETICHETTA_TIPO[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
      state={stateElenco}
    >
      {/* Desktop: tabella. Mobile: le stesse fatture come card. */}
      <div className="hidden min-w-0 overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Numero</TableHead>
              <TableHead className="w-28">Data</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="w-36">Commessa</TableHead>
              <TableHead className="w-32 text-right">Totale</TableHead>
              <TableHead className="w-56">Stato</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fatture.map(f => {
              const badge = badgeStatoFattura(f.stato, f.inviataDryRun);
              return (
                <TableRow key={f.id}>
                  <TableCell className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <FileText
                        className="size-3.5 shrink-0 text-text-3"
                        aria-hidden="true"
                      />
                      <span className="truncate font-semibold">
                        {f.numero ?? "in bozza"}
                      </span>
                    </span>
                    {f.tipo === "nota_credito" && (
                      <span className="block text-xs text-text-3">
                        nota di credito
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-text-2">
                    {fmtData(f.data)}
                  </TableCell>
                  <TableCell className="min-w-0">
                    <span className="block truncate">
                      {f.clienteNome ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-0">
                    <Link
                      href={`/commesse/${f.commessaId}`}
                      className="inline-flex min-h-11 min-w-0 items-center text-primary hover:underline"
                    >
                      <span className="codice-mono truncate text-[11px]">
                        {f.commessaCodice ?? `#${f.commessaId}`}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatCent(f.totaleCent)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={VARIANTE_BADGE[badge.tono]}>
                        {badge.testo}
                      </Badge>
                      {f.inviataDryRun && (
                        <Badge variant="warning">prova SdI</Badge>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="grid min-w-0 gap-2 md:hidden">
        {fatture.map(f => {
          const badge = badgeStatoFattura(f.stato, f.inviataDryRun);
          return (
            <li
              key={f.id}
              className="min-w-0 space-y-2 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3"
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">
                  {f.tipo === "nota_credito" ? "Nota di credito " : "Fattura "}
                  {f.numero ?? "in bozza"}
                </span>
                <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
                  {formatCent(f.totaleCent)}
                </span>
              </div>
              <p className="min-w-0 truncate text-sm text-text-2">
                {f.clienteNome ?? "—"}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={VARIANTE_BADGE[badge.tono]}>
                  {badge.testo}
                </Badge>
                {f.inviataDryRun && <Badge variant="warning">prova SdI</Badge>}
                <span className="tabular-nums text-xs text-text-3">
                  {fmtData(f.data)}
                </span>
              </div>
              <Link
                href={`/commesse/${f.commessaId}`}
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft px-3 text-sm font-semibold hover:bg-surface-2"
              >
                <FileText
                  className="size-4 shrink-0 text-text-3"
                  aria-hidden="true"
                />
                <span className="codice-mono min-w-0 flex-1 truncate text-[11px]">
                  {f.commessaCodice ?? `#${f.commessaId}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </DataSurface>
  );
}
