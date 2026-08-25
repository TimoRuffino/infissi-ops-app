import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TrendingUp, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import StatoChip from "@/components/StatoChip";
import { statoLabel } from "@/lib/stato";
import { formatEuro } from "@/lib/euro";

// P0.2 — vista direzione sulla marginalità delle commesse attive.
// margine = pattuito − costi fornitore (no bozza/contestato) − costo posa.

const fmt = formatEuro;

// Fascia colore condivisa con la card Economia: ≥30% ok, 15–30% attenzione,
// <15% problema, grigio = dati insufficienti.
function toneFor(perc: number | null, incompleti: boolean) {
  if (incompleti || perc == null) return "text-text-3";
  if (perc >= 0.3) return "text-success";
  if (perc >= 0.15) return "text-warning";
  return "text-danger";
}

export default function Marginalita() {
  const [, setLocation] = useLocation();
  const rows = trpc.commesse.marginalita.useQuery();

  const [search, setSearch] = useState("");
  const [statoFiltro, setStatoFiltro] = useState("tutte");
  const [sortBy, setSortBy] = useState<"margine" | "perc" | "pattuito">("perc");

  const data = rows.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data
      .filter((r: any) => {
        if (q && !`${r.codice} ${r.cliente}`.toLowerCase().includes(q)) return false;
        if (statoFiltro !== "tutte" && r.stato !== statoFiltro) return false;
        return true;
      })
      .sort((a: any, b: any) => {
        // Righe con dati incompleti sempre in fondo.
        if (a.datiIncompleti !== b.datiIncompleti) return a.datiIncompleti ? 1 : -1;
        if (sortBy === "margine") return (b.margineLordo ?? 0) - (a.margineLordo ?? 0);
        if (sortBy === "pattuito") return (b.ricavi ?? 0) - (a.ricavi ?? 0);
        return (a.marginePerc ?? 0) - (b.marginePerc ?? 0); // % crescente: i problemi in cima
      });
  }, [data, search, statoFiltro, sortBy]);

  const kpi = useMemo(() => {
    const completi = data.filter((r: any) => !r.datiIncompleti);
    const margineTot = completi.reduce((s: number, r: any) => s + (r.margineLordo ?? 0), 0);
    const ricaviTot = completi.reduce((s: number, r: any) => s + (r.ricavi ?? 0), 0);
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
    const perFornitore = new Map<string, { costi: number; commesse: Set<number> }>();
    const perVenditore = new Map<string, { margine: number; ricavi: number; n: number }>();
    const perMese = new Map<string, { margine: number; ricavi: number; n: number }>();
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

  return (
    <div className="space-y-4">
      {/* Header + KPI */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Marginalità stimata
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Stima CRM: pattuito lordo meno costi manuali e posa stimata
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Card className="px-3 py-2 gap-0 border-success/30">
            <div className="eyebrow !text-success">Margine stimato</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-success">
              € {fmt(kpi.margineTot)}
            </div>
          </Card>
          <Card className="px-3 py-2 gap-0">
            <div className="eyebrow">Margine medio</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums">
              {kpi.percMedia != null ? `${Math.round(kpi.percMedia * 100)}%` : "—"}
            </div>
          </Card>
          <Card className="px-3 py-2 gap-0">
            <div className="eyebrow">Con dati</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums">
              {kpi.completi}
            </div>
          </Card>
          <Card className="px-3 py-2 gap-0 border-warning/30">
            <div className="eyebrow !text-warning">Dati incompleti</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-warning">
              {kpi.incompleti}
            </div>
          </Card>
        </div>
      </div>

      {/* Filtri */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
          <Input
            className="pl-8 w-64"
            placeholder="Cerca codice o cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statoFiltro} onValueChange={setStatoFiltro}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutte">Tutti gli stati</SelectItem>
            {statiPresenti.map((s) => (
              <SelectItem key={s} value={s}>
                {statoLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="perc">% margine (peggiori prima)</SelectItem>
            <SelectItem value="margine">Margine € (maggiori prima)</SelectItem>
            <SelectItem value="pattuito">Pattuito € (maggiori prima)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-text-3 ml-auto">{filtered.length} commesse</span>
      </div>

      {/* Tabella commesse */}
      {rows.isLoading ? (
        <div className="text-text-3 text-sm py-8 text-center">Caricamento...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-text-3 text-sm">
            Nessuna commessa da mostrare — registra il totale pattuito e gli
            ordini fornitore per vedere i margini.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border bg-surface-2">
                <th className="eyebrow font-semibold px-3 sm:px-4 py-2.5">Commessa</th>
                <th className="eyebrow font-semibold px-4 py-2.5 hidden md:table-cell">Stato</th>
                <th className="eyebrow font-semibold px-4 py-2.5 text-right hidden sm:table-cell">Pattuito</th>
                <th className="eyebrow font-semibold px-4 py-2.5 text-right hidden lg:table-cell">Costi forn.</th>
                <th className="eyebrow font-semibold px-4 py-2.5 text-right hidden lg:table-cell">Posa</th>
                <th className="eyebrow font-semibold px-3 sm:px-4 py-2.5 text-right">Margine</th>
                <th className="eyebrow font-semibold px-4 py-2.5 hidden xl:table-cell">Assegnata</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: any) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-0 hover:bg-surface-2 cursor-pointer h-12"
                  onClick={() => setLocation(`/commesse/${r.id}`)}
                >
                  <td className="px-3 sm:px-4">
                    <span className="codice-mono text-xs text-text-3 mr-2">{r.codice}</span>
                    <span className="font-medium text-text-1">{r.cliente}</span>
                  </td>
                  <td className="px-4 hidden md:table-cell">
                    <StatoChip stato={r.stato} />
                  </td>
                  <td className="px-4 text-right tabular-nums hidden sm:table-cell">
                    {r.ricavi != null ? `€ ${fmt(r.ricavi)}` : "—"}
                  </td>
                  <td className="px-4 text-right tabular-nums text-text-2 hidden lg:table-cell">
                    € {fmt(r.costiFornitore)}
                  </td>
                  <td className="px-4 text-right tabular-nums text-text-2 hidden lg:table-cell">
                    {r.costoPosa != null ? `€ ${fmt(r.costoPosa)}` : "—"}
                  </td>
                  <td className={`px-3 sm:px-4 text-right tabular-nums font-semibold ${toneFor(r.marginePerc, r.datiIncompleti)}`}>
                    {r.datiIncompleti ? (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        dati incompleti
                      </Badge>
                    ) : (
                      <>
                        € {fmt(r.margineLordo ?? 0)}
                        {r.marginePerc != null && (
                          <span className="text-xs ml-1">({Math.round(r.marginePerc * 100)}%)</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 text-text-2 hidden xl:table-cell">
                    {r.assegnatoNome ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Aggregati */}
      {kpi.completi > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="py-3 px-4">
              <p className="eyebrow mb-2">Costi per fornitore</p>
              <div className="space-y-1.5">
                {aggregati.fornitori.map((f) => (
                  <div key={f.nome} className="flex justify-between text-sm">
                    <span className="text-text-2 truncate">
                      {f.nome}
                      <span className="text-text-3 text-xs ml-1">({f.n})</span>
                    </span>
                    <span className="tabular-nums font-medium">€ {fmt(f.costi)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <p className="eyebrow mb-2">Margine per venditore</p>
              <div className="space-y-1.5">
                {aggregati.venditori.map((v) => (
                  <div key={v.nome} className="flex justify-between text-sm">
                    <span className="text-text-2 truncate">
                      {v.nome}
                      <span className="text-text-3 text-xs ml-1">({v.n})</span>
                    </span>
                    <span className={`tabular-nums font-medium ${toneFor(v.perc, false)}`}>
                      € {fmt(v.margine)}
                      {v.perc != null && (
                        <span className="text-xs ml-1">({Math.round(v.perc * 100)}%)</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <p className="eyebrow mb-2">Margine per mese di apertura</p>
              <div className="space-y-1.5">
                {aggregati.mesi.map((m) => (
                  <div key={m.mese} className="flex justify-between text-sm">
                    <span className="text-text-2">
                      {m.mese}
                      <span className="text-text-3 text-xs ml-1">({m.n})</span>
                    </span>
                    <span className={`tabular-nums font-medium ${toneFor(m.perc, false)}`}>
                      € {fmt(m.margine)}
                      {m.perc != null && (
                        <span className="text-xs ml-1">({Math.round(m.perc * 100)}%)</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
