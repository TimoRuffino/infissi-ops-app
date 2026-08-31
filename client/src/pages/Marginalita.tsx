import { useMemo, useState } from "react";
import { FilterX, Search, TrendingUp } from "lucide-react";
import { useLocation } from "wouter";

import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import StatoChip from "@/components/StatoChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatEuroSimbolo } from "@/lib/euro";
import { statoLabel } from "@/lib/stato";
import { trpc } from "@/lib/trpc";

// P0.2 — vista direzione sulla marginalità delle commesse attive.
// margine = pattuito − costi fornitore (no bozza/contestato) − costo posa.
//
// La guardia di route resta `RequireDirezione` in App.tsx: `economia.read` non
// apre questa pagina e qui non esiste nessun bypass di capability.

const DISCLAIMER =
  "Stima CRM, non contabilità: i valori derivano da pattuito, costi fornitore registrati e posa stimata.";

// Fascia colore condivisa con la card Economia: ≥30% ok, 15–30% attenzione,
// <15% problema, grigio = dati insufficienti. Il colore non è mai l'unico
// segnale: accanto c'è sempre la fascia scritta.
function toneFor(perc: number | null, incompleti: boolean) {
  if (incompleti || perc == null) return "text-text-3";
  if (perc >= 0.3) return "text-success";
  if (perc >= 0.15) return "text-warning";
  return "text-danger";
}

function fasciaLabel(perc: number | null, incompleti: boolean): string {
  if (incompleti) return "dati incompleti";
  if (perc == null) return "fascia non calcolabile";
  if (perc >= 0.3) return "in linea";
  if (perc >= 0.15) return "da tenere d'occhio";
  return "sotto soglia";
}

export default function Marginalita() {
  const [, setLocation] = useLocation();
  // La query esiste solo dietro la guardia direzione della route: una visita
  // diretta di chi non è direzione non arriva a montare questo componente.
  const rows = trpc.commesse.marginalita.useQuery();

  const [search, setSearch] = useState("");
  const [statoFiltro, setStatoFiltro] = useState("tutte");
  const [sortBy, setSortBy] = useState<"margine" | "perc" | "pattuito">("perc");

  const data = rows.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data
      .filter((r: any) => {
        if (q && !`${r.codice} ${r.cliente}`.toLowerCase().includes(q)) {
          return false;
        }
        if (statoFiltro !== "tutte" && r.stato !== statoFiltro) return false;
        return true;
      })
      .sort((a: any, b: any) => {
        // Righe con dati incompleti sempre in fondo.
        if (a.datiIncompleti !== b.datiIncompleti) {
          return a.datiIncompleti ? 1 : -1;
        }
        if (sortBy === "margine") {
          return (b.margineLordo ?? 0) - (a.margineLordo ?? 0);
        }
        if (sortBy === "pattuito") return (b.ricavi ?? 0) - (a.ricavi ?? 0);
        // % crescente: i problemi in cima.
        return (a.marginePerc ?? 0) - (b.marginePerc ?? 0);
      });
  }, [data, search, statoFiltro, sortBy]);

  const kpi = useMemo(() => {
    const completi = data.filter((r: any) => !r.datiIncompleti);
    const margineTot = completi.reduce(
      (s: number, r: any) => s + (r.margineLordo ?? 0),
      0
    );
    const ricaviTot = completi.reduce(
      (s: number, r: any) => s + (r.ricavi ?? 0),
      0
    );
    return {
      margineTot,
      percMedia: ricaviTot > 0 ? margineTot / ricaviTot : null,
      completi: completi.length,
      incompleti: data.length - completi.length,
    };
  }, [data]);

  // Aggregati per fornitore / venditore / mese di apertura, dai soli dati
  // completi (i "senza ordini" falserebbero le medie al 100%).
  const aggregati = useMemo(() => {
    const completi = data.filter((r: any) => !r.datiIncompleti);
    const perFornitore = new Map<
      string,
      { costi: number; commesse: Set<number> }
    >();
    const perVenditore = new Map<
      string,
      { margine: number; ricavi: number; n: number }
    >();
    const perMese = new Map<
      string,
      { margine: number; ricavi: number; n: number }
    >();
    for (const r of completi as any[]) {
      for (const co of r.costi ?? []) {
        const nome = co.fornitore || "Senza fornitore";
        const f = perFornitore.get(nome) ?? { costi: 0, commesse: new Set() };
        f.costi += co.importo ?? 0;
        f.commesse.add(r.id);
        perFornitore.set(nome, f);
      }
      const vKey = r.assegnatoNome ?? "Non assegnata";
      const v = perVenditore.get(vKey) ?? { margine: 0, ricavi: 0, n: 0 };
      v.margine += r.margineLordo ?? 0;
      v.ricavi += r.ricavi ?? 0;
      v.n++;
      perVenditore.set(vKey, v);
      const mKey = (r.dataApertura ?? "").slice(0, 7) || "—";
      const m = perMese.get(mKey) ?? { margine: 0, ricavi: 0, n: 0 };
      m.margine += r.margineLordo ?? 0;
      m.ricavi += r.ricavi ?? 0;
      m.n++;
      perMese.set(mKey, m);
    }
    return {
      fornitori: Array.from(perFornitore.entries())
        .map(([nome, x]) => ({ nome, costi: x.costi, n: x.commesse.size }))
        .sort((a, b) => b.costi - a.costi)
        .slice(0, 8),
      venditori: Array.from(perVenditore.entries())
        .map(([nome, x]) => ({
          nome,
          margine: x.margine,
          perc: x.ricavi > 0 ? x.margine / x.ricavi : null,
          n: x.n,
        }))
        .sort((a, b) => b.margine - a.margine),
      mesi: Array.from(perMese.entries())
        .map(([mese, x]) => ({
          mese,
          margine: x.margine,
          perc: x.ricavi > 0 ? x.margine / x.ricavi : null,
          n: x.n,
        }))
        .sort((a, b) => b.mese.localeCompare(a.mese))
        .slice(0, 6),
    };
  }, [data]);

  const statiPresenti = useMemo(
    () => Array.from(new Set(data.map((r: any) => r.stato))) as string[],
    [data]
  );

  const hasActiveFilters =
    !!search.trim() || statoFiltro !== "tutte" || sortBy !== "perc";

  function azzeraFiltri() {
    setSearch("");
    setStatoFiltro("tutte");
    setSortBy("perc");
  }

  // Stato della lettura, condiviso da KPI ed elenco: un margine che non è
  // stato ancora calcolato non è «€ 0,00», e zero commesse complete non è un
  // dato finché la query non ha risposto.
  const statoLettura: StatePanelProps | undefined = rows.isPending
    ? {
        kind: "loading",
        title: "Calcolo la marginalità",
        description: "Recupero pattuito, costi registrati e posa stimata.",
        rows: 3,
      }
    : rows.isError
      ? {
          kind: "error",
          title: "Marginalità non caricata",
          description:
            "Non è stato possibile leggere le commesse della sede. Nessun dato è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => rows.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : undefined;

  const statoElenco: StatePanelProps | undefined =
    statoLettura ??
    (filtered.length === 0
      ? {
          kind: "empty",
          title: hasActiveFilters
            ? "Nessuna commessa corrisponde ai filtri correnti"
            : "Nessuna commessa da mostrare",
          description: hasActiveFilters
            ? "Cambia ricerca o stato per vedere le altre commesse della sede."
            : "Registra il totale pattuito e gli ordini fornitore per vedere i margini.",
          action: hasActiveFilters ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={azzeraFiltri}
            >
              <FilterX className="h-4 w-4" aria-hidden="true" /> Azzera i filtri
            </Button>
          ) : undefined,
        }
      : undefined);

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Direzione"
        title={
          <span className="inline-flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" aria-hidden="true" />
            Marginalità stimata
          </span>
        }
        description="Pattuito lordo meno costi fornitore registrati e posa stimata, commessa per commessa."
        busy={rows.isFetching}
        warning={DISCLAIMER}
        metadata={
          <>
            {rows.isPending ? (
              <span>Conteggio commesse in caricamento…</span>
            ) : rows.isError ? (
              <span>Conteggio commesse non disponibile</span>
            ) : (
              <>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {kpi.completi}
                  </strong>{" "}
                  con dati completi
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {kpi.incompleti}
                  </strong>{" "}
                  con dati incompleti
                </span>
              </>
            )}
            {rows.isFetching && !rows.isPending ? (
              <span role="status">Aggiornamento in corso…</span>
            ) : null}
          </>
        }
      />

      <DataSurface
        density="compact"
        tone="default"
        title="Margine stimato del perimetro completo"
        description="Solo le commesse con pattuito e costi registrati: le incomplete resterebbero al 100% e falserebbero la media."
        state={statoLettura}
      >
        <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="min-w-0 rounded-[var(--radius-control)] border border-success/30 bg-success-soft px-3 py-2">
            <dt className="eyebrow text-success">Margine stimato</dt>
            <dd className="mt-1 truncate text-xl font-bold tabular-nums text-success">
              {formatEuroSimbolo(kpi.margineTot)}
            </dd>
          </div>
          <div className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2">
            <dt className="eyebrow text-text-3">Margine medio</dt>
            <dd className="mt-1 truncate text-xl font-bold tabular-nums text-text-1">
              {kpi.percMedia != null
                ? `${Math.round(kpi.percMedia * 100)}%`
                : "Non calcolabile"}
            </dd>
          </div>
          <div className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2">
            <dt className="eyebrow text-text-3">Con dati completi</dt>
            <dd className="mt-1 truncate text-xl font-bold tabular-nums text-text-1">
              {kpi.completi}
            </dd>
          </div>
          <div className="min-w-0 rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft px-3 py-2">
            <dt className="eyebrow text-warning">Dati incompleti</dt>
            <dd className="mt-1 truncate text-xl font-bold tabular-nums text-warning">
              {kpi.incompleti}
            </dd>
          </div>
        </dl>
      </DataSurface>

      <div className="sticky top-0 z-20 border-b border-border-soft bg-surface/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1 lg:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              aria-hidden="true"
            />
            <Input
              aria-label="Cerca commesse"
              className="min-h-11 pl-9"
              placeholder="Cerca codice o cliente…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Select value={statoFiltro} onValueChange={setStatoFiltro}>
            <SelectTrigger
              aria-label="Filtro stato"
              className="min-h-11 lg:w-52"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tutte">Tutti gli stati</SelectItem>
              {statiPresenti.map(s => (
                <SelectItem key={s} value={s}>
                  {statoLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
            <SelectTrigger
              aria-label="Ordinamento"
              className="min-h-11 lg:w-60"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="perc">% margine (peggiori prima)</SelectItem>
              <SelectItem value="margine">
                Margine € (maggiori prima)
              </SelectItem>
              <SelectItem value="pattuito">
                Pattuito € (maggiori prima)
              </SelectItem>
            </SelectContent>
          </Select>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              onClick={azzeraFiltri}
            >
              <FilterX className="h-4 w-4" aria-hidden="true" /> Pulisci
            </Button>
          ) : null}
          <span className="ml-auto whitespace-nowrap text-sm tabular-nums text-text-2">
            {filtered.length} in elenco
          </span>
        </div>
      </div>

      <section className="min-w-0" aria-label="Marginalità per commessa">
        <DataSurface
          density="compact"
          tone="sunken"
          state={statoElenco}
          footer={DISCLAIMER}
        >
          {/* Desktop: tabella densa. */}
          <div className="hidden min-w-0 lg:block">
            <Table className="table-fixed">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[11%]" />
                <col className="w-[24%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>Commessa</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Pattuito</TableHead>
                  <TableHead className="text-right">Costi fornitore</TableHead>
                  <TableHead className="text-right">Posa</TableHead>
                  <TableHead className="text-right">Margine stimato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r: any) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setLocation(`/commesse/${r.id}`)}
                  >
                    <TableCell className="overflow-hidden">
                      <button
                        type="button"
                        className="min-w-0 rounded-[var(--radius-control)] text-left"
                        onClick={e => {
                          e.stopPropagation();
                          setLocation(`/commesse/${r.id}`);
                        }}
                      >
                        <span className="block truncate codice-mono text-xs text-text-3">
                          {r.codice}
                        </span>
                        <span
                          className="block truncate font-semibold text-text-1"
                          title={r.cliente || undefined}
                        >
                          {r.cliente}
                        </span>
                      </button>
                      <span className="mt-1 block truncate text-[11px] text-text-3">
                        {r.assegnatoNome ?? "Non assegnata"}
                      </span>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <StatoChip stato={r.stato} />
                    </TableCell>
                    <TableCell className="overflow-hidden text-right tabular-nums text-text-1">
                      {r.ricavi != null
                        ? formatEuroSimbolo(r.ricavi)
                        : "Non pattuito"}
                    </TableCell>
                    <TableCell className="overflow-hidden text-right tabular-nums text-text-2">
                      {formatEuroSimbolo(r.costiFornitore)}
                    </TableCell>
                    <TableCell className="overflow-hidden text-right tabular-nums text-text-2">
                      {r.costoPosa != null
                        ? formatEuroSimbolo(r.costoPosa)
                        : "Non stimata"}
                    </TableCell>
                    <TableCell className="overflow-hidden text-right">
                      {r.datiIncompleti ? (
                        <span className="flex flex-wrap items-center justify-end gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            Dati incompleti
                          </Badge>
                          <span className="text-[11px] text-text-3">
                            margine non stimabile
                          </span>
                        </span>
                      ) : (
                        <span className="flex flex-col items-end">
                          <span
                            className={`font-semibold tabular-nums ${toneFor(
                              r.marginePerc,
                              false
                            )}`}
                          >
                            {formatEuroSimbolo(r.margineLordo ?? 0)}
                            {r.marginePerc != null
                              ? ` (${Math.round(r.marginePerc * 100)}%)`
                              : ""}
                          </span>
                          {/* Il colore non basta: la fascia è anche scritta. */}
                          <span className="text-[11px] text-text-3">
                            {fasciaLabel(r.marginePerc, false)}
                          </span>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Sotto lg: una card per commessa, nessuna colonna nascosta. */}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:hidden">
            {filtered.map((r: any) => (
              <div
                key={r.id}
                className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft bg-surface"
              >
                <button
                  type="button"
                  className="flex min-h-12 w-full min-w-0 flex-col items-start gap-1 p-3 text-left"
                  onClick={() => setLocation(`/commesse/${r.id}`)}
                >
                  <span className="codice-mono text-xs text-text-3">
                    {r.codice}
                  </span>
                  <span className="block w-full truncate text-[15px] font-semibold text-text-1">
                    {r.cliente}
                  </span>
                  <StatoChip stato={r.stato} />
                </button>
                <dl className="grid gap-1.5 px-3 pb-3 text-xs text-text-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="text-text-3">Pattuito</dt>
                    <dd className="tabular-nums">
                      {r.ricavi != null
                        ? formatEuroSimbolo(r.ricavi)
                        : "Non pattuito"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="text-text-3">Costi fornitore</dt>
                    <dd className="tabular-nums">
                      {formatEuroSimbolo(r.costiFornitore)}
                    </dd>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="text-text-3">Posa</dt>
                    <dd className="tabular-nums">
                      {r.costoPosa != null
                        ? formatEuroSimbolo(r.costoPosa)
                        : "Non stimata"}
                    </dd>
                  </div>
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <dt className="text-text-3">Margine stimato</dt>
                    <dd className="flex flex-col items-end">
                      {r.datiIncompleti ? (
                        <>
                          <Badge variant="outline" className="text-[10px]">
                            Dati incompleti
                          </Badge>
                          <span className="text-[11px] text-text-3">
                            margine non stimabile
                          </span>
                        </>
                      ) : (
                        <>
                          <span
                            className={`font-semibold tabular-nums ${toneFor(
                              r.marginePerc,
                              false
                            )}`}
                          >
                            {formatEuroSimbolo(r.margineLordo ?? 0)}
                            {r.marginePerc != null
                              ? ` (${Math.round(r.marginePerc * 100)}%)`
                              : ""}
                          </span>
                          <span className="text-[11px] text-text-3">
                            {fasciaLabel(r.marginePerc, false)}
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="text-text-3">Assegnata a</dt>
                    <dd className="min-w-0 truncate">
                      {r.assegnatoNome ?? "Non assegnata"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </DataSurface>
      </section>

      {kpi.completi > 0 ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          <DataSurface
            density="compact"
            tone="sunken"
            title="Costi per fornitore"
            description="Somma dei costi registrati sulle commesse con dati completi."
          >
            <dl className="grid min-w-0 gap-1.5 text-sm">
              {aggregati.fornitori.map(f => (
                <div
                  key={f.nome}
                  className="flex min-w-0 items-center justify-between gap-2"
                >
                  <dt className="min-w-0 truncate text-text-2">
                    {f.nome}
                    <span className="ml-1 text-xs text-text-3">
                      ({f.n} {f.n === 1 ? "commessa" : "commesse"})
                    </span>
                  </dt>
                  <dd className="shrink-0 font-medium tabular-nums text-text-1">
                    {formatEuroSimbolo(f.costi)}
                  </dd>
                </div>
              ))}
            </dl>
          </DataSurface>

          <DataSurface
            density="compact"
            tone="sunken"
            title="Margine per venditore"
            description="Solo commesse con dati completi."
          >
            <dl className="grid min-w-0 gap-1.5 text-sm">
              {aggregati.venditori.map(v => (
                <div
                  key={v.nome}
                  className="flex min-w-0 items-center justify-between gap-2"
                >
                  <dt className="min-w-0 truncate text-text-2">
                    {v.nome}
                    <span className="ml-1 text-xs text-text-3">
                      ({v.n} {v.n === 1 ? "commessa" : "commesse"})
                    </span>
                  </dt>
                  <dd
                    className={`shrink-0 font-medium tabular-nums ${toneFor(v.perc, false)}`}
                  >
                    {formatEuroSimbolo(v.margine)}
                    {v.perc != null ? ` (${Math.round(v.perc * 100)}%)` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          </DataSurface>

          <DataSurface
            density="compact"
            tone="sunken"
            title="Margine per mese di apertura"
            description="Ultimi sei mesi con commesse complete."
          >
            <dl className="grid min-w-0 gap-1.5 text-sm">
              {aggregati.mesi.map(m => (
                <div
                  key={m.mese}
                  className="flex min-w-0 items-center justify-between gap-2"
                >
                  <dt className="min-w-0 truncate text-text-2">
                    {m.mese}
                    <span className="ml-1 text-xs text-text-3">
                      ({m.n} {m.n === 1 ? "commessa" : "commesse"})
                    </span>
                  </dt>
                  <dd
                    className={`shrink-0 font-medium tabular-nums ${toneFor(m.perc, false)}`}
                  >
                    {formatEuroSimbolo(m.margine)}
                    {m.perc != null ? ` (${Math.round(m.perc * 100)}%)` : ""}
                  </dd>
                </div>
              ))}
            </dl>
          </DataSurface>
        </div>
      ) : null}
    </div>
  );
}
