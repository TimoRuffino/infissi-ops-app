import { useMemo, useState } from "react";
import { ClipboardCheck, FilterX, Search } from "lucide-react";
import { useLocation } from "wouter";

import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import StatoChip from "@/components/StatoChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";

// Registro delle conferme d'ordine della sede (direzione 03/09/2026 sera:
// «crea un registro delle conf. ordine archiviate automaticamente»). Ogni
// riga dice chi ha messo la conferma nel fascicolo e cosa ne è nato: il
// costo del margine e la merce in arrivo a magazzino.

type FiltroOrigine = "tutte" | "automatiche" | "manuali";

const FILTRI: Array<{ key: FiltroOrigine; label: string }> = [
  { key: "tutte", label: "Tutte" },
  { key: "automatiche", label: "Automatiche" },
  { key: "manuali", label: "A mano o con Tars" },
];

const ORIGINE_LABEL: Record<string, string> = {
  automatico: "Automatica",
  smistamento: "Smistamento Tars",
  tars: "Tars su richiesta",
  mail: "Dai Messaggi",
  upload: "Dalla scheda",
  fic: "Fatture in Cloud",
};

function origineTone(origine: string): "default" | "secondary" | "outline" {
  if (origine === "automatico" || origine === "smistamento") return "default";
  if (origine === "tars") return "secondary";
  return "outline";
}

function costoTesto(costo: { stato: string; importo: number | null }): string {
  if (costo.stato === "registrato" && costo.importo != null) {
    return formatEuroSimbolo(costo.importo);
  }
  switch (costo.stato) {
    case "senza_imponibile":
      return "senza imponibile: a mano";
    case "non_leggibile":
      return "PDF non leggibile: a mano";
    case "da_ocr":
      return "scansione, in coda OCR";
    case "rimosso_a_mano":
      return "tolto a mano";
    case "errore":
      return "lettura fallita";
    case "collegato":
      return "collegato a un costo manuale";
    default:
      return "in attesa di lettura";
  }
}

function dataIt(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso) : iso;
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("it-IT");
}

function apriFile(link: string) {
  window.open(link, "_blank", "noopener,noreferrer");
}

export default function ConfermeOrdine() {
  const [, setLocation] = useLocation();
  const [filtro, setFiltro] = useState<FiltroOrigine>("tutte");
  const [search, setSearch] = useState("");
  const registro = trpc.preventiviContratti.registroConferme.useQuery({ origine: filtro });

  const righe = registro.data ?? [];
  const filtrate = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return righe;
    return righe.filter(r =>
      [r.nome, r.commessa?.codice, r.commessa?.cliente, r.archiviatoDa]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    );
  }, [righe, search]);

  const automatiche = righe.filter(r => r.origine === "automatico" || r.origine === "smistamento").length;
  const hasActiveFilters = filtro !== "tutte" || search.trim() !== "";

  const statoElenco: StatePanelProps | undefined = registro.isError
    ? {
        kind: "error",
        title: "Registro non disponibile",
        description: registro.error?.message ?? "Riprova tra poco.",
        action: (
          <Button size="sm" variant="outline" onClick={() => void registro.refetch()}>
            Riprova
          </Button>
        ),
      }
    : registro.isPending
      ? { kind: "loading", title: "Carico il registro", description: "Un momento." }
      : filtrate.length === 0
        ? {
            kind: "empty",
            title: hasActiveFilters
              ? "Nessuna conferma corrisponde ai filtri"
              : "Nessuna conferma d'ordine nei fascicoli",
            description: hasActiveFilters
              ? "Cambia filtro o ricerca per vedere le altre conferme della sede."
              : "Quando una conferma entra in un fascicolo (a mano, da Tars o da sola) compare qui con il costo e la merce che ne sono nati.",
          }
        : undefined;

  return (
    <div className="page-stack min-w-0">
      <PageHeader
        variant="workbench"
        eyebrow="Ordini e cantiere"
        title={
          <span className="inline-flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" aria-hidden="true" />
            Registro conferme d'ordine
          </span>
        }
        description="Ogni conferma nel fascicolo: chi l'ha archiviata, il costo imponibile che ha portato al margine e la merce in arrivo scritta a magazzino."
        busy={registro.isFetching}
        metadata={
          registro.isPending ? (
            <span className="text-sm text-text-3">Carico…</span>
          ) : (
            <span className="text-sm tabular-nums text-text-2">
              {righe.length} conferme · {automatiche} automatiche
            </span>
          )
        }
      />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca per file, commessa, cliente, utente"
            className="pl-8"
            aria-label="Cerca nel registro"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Origine">
          {FILTRI.map(f => (
            <Button
              key={f.key}
              size="sm"
              variant={filtro === f.key ? "default" : "outline"}
              onClick={() => setFiltro(f.key)}
              aria-pressed={filtro === f.key}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFiltro("tutte");
              setSearch("");
            }}
          >
            <FilterX className="mr-1 h-4 w-4" aria-hidden="true" />
            Azzera
          </Button>
        ) : null}
        <span className="ml-auto whitespace-nowrap text-sm tabular-nums text-text-2">
          {filtrate.length} in elenco
        </span>
      </div>

      <section className="min-w-0" aria-label="Registro conferme d'ordine">
        <DataSurface
          density="compact"
          tone="sunken"
          state={statoElenco}
          footer="Le conferme «automatiche» sono archiviate dalla regola delle conferme certe (mail già collegata alla commessa e file che si dichiara conferma) o dallo smistamento di Tars. Il costo è l'imponibile letto dal PDF; la merce sono le righe riconosciute, modificabili in Magazzino."
        >
          {/* Desktop: tabella densa. */}
          <div className="hidden min-w-0 lg:block">
            <Table className="table-fixed">
              <colgroup>
                <col className="w-[10%]" />
                <col className="w-[22%]" />
                <col className="w-[22%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[20%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Conferma</TableHead>
                  <TableHead>Commessa</TableHead>
                  <TableHead>Origine</TableHead>
                  <TableHead className="text-right">Costo imponibile</TableHead>
                  <TableHead>Merce a magazzino</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrate.map(r => (
                  <TableRow key={r.documentoId}>
                    <TableCell className="tabular-nums text-text-2">{dataIt(r.createdAt)}</TableCell>
                    <TableCell className="overflow-hidden">
                      <button
                        type="button"
                        className="block max-w-full truncate rounded-[var(--radius-control)] text-left text-text-1 underline-offset-2 hover:underline"
                        onClick={() => apriFile(r.link)}
                        title="Apri il file"
                      >
                        {r.nome}
                      </button>
                      {r.archiviatoDa ? (
                        <span className="block truncate text-xs text-text-3">da {r.archiviatoDa}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      {r.commessa ? (
                        <button
                          type="button"
                          className="flex min-w-0 max-w-full flex-col items-start rounded-[var(--radius-control)] text-left"
                          onClick={() => setLocation(`/commesse/${r.commessa!.id}`)}
                        >
                          <span className="codice-mono text-xs text-text-3">{r.commessa.codice}</span>
                          <span className="block w-full truncate text-text-1">{r.commessa.cliente}</span>
                          <StatoChip stato={r.commessa.stato} />
                        </button>
                      ) : (
                        <span className="text-text-3">commessa non trovata</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={origineTone(r.origine)} className="text-[10px]">
                        {ORIGINE_LABEL[r.origine] ?? r.origine}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{costoTesto(r.costo)}</TableCell>
                    <TableCell className="text-text-2">
                      {r.merce.righe > 0
                        ? `${r.merce.righe} ${r.merce.righe === 1 ? "riga" : "righe"} · consegna ${dataIt(r.merce.dataConsegna)}${
                            r.merce.arrivate > 0 ? ` · ${r.merce.arrivate} arrivate` : ""
                          }`
                        : "nessuna riga"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Sotto lg: una card per conferma, nessuna colonna nascosta. */}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:hidden">
            {filtrate.map(r => (
              <div
                key={r.documentoId}
                className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft bg-surface p-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-text-1"
                    onClick={() => apriFile(r.link)}
                  >
                    {r.nome}
                  </button>
                  <Badge variant={origineTone(r.origine)} className="shrink-0 text-[10px]">
                    {ORIGINE_LABEL[r.origine] ?? r.origine}
                  </Badge>
                </div>
                {r.commessa ? (
                  <button
                    type="button"
                    className="mt-1 flex min-w-0 w-full flex-col items-start text-left"
                    onClick={() => setLocation(`/commesse/${r.commessa!.id}`)}
                  >
                    <span className="codice-mono text-xs text-text-3">{r.commessa.codice}</span>
                    <span className="block w-full truncate text-sm text-text-1">{r.commessa.cliente}</span>
                  </button>
                ) : null}
                <dl className="mt-2 grid gap-1 text-xs text-text-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="text-text-3">Data</dt>
                    <dd className="tabular-nums">{dataIt(r.createdAt)}</dd>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="text-text-3">Costo imponibile</dt>
                    <dd className="tabular-nums">{costoTesto(r.costo)}</dd>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="text-text-3">Merce</dt>
                    <dd className="text-right">
                      {r.merce.righe > 0
                        ? `${r.merce.righe} righe · ${dataIt(r.merce.dataConsegna)}`
                        : "nessuna riga"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </DataSurface>
      </section>
    </div>
  );
}
