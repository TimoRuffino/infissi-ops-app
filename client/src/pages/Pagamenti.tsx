import { useMemo, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  FilterX,
  Plus,
  Search,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import BreakEvenPanel from "@/components/economia/BreakEvenPanel";
import FattureEmesseSezione from "@/components/fattura/FattureEmesseSezione";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import StatoChip from "@/components/StatoChip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { formatEuroSimbolo, parseEuroPositivo } from "@/lib/euro";
import { economicRoutePermissions } from "@/lib/operationalRoutes";
import { trpc } from "@/lib/trpc";
import { TIPO_PAGAMENTO_LABEL, tipoPagamentoSuggerito } from "./CommessaDetail";

const METODO_LABEL: Record<string, string> = {
  bonifico: "Bonifico",
  contanti: "Contanti",
  assegno: "Assegno",
  pos: "POS",
  finanziamento: "Finanziamento",
  altro: "Altro",
};

const FILTRI = [
  { id: "residuo", label: "Con residuo" },
  { id: "saldate", label: "Saldate" },
  { id: "sovrapagate", label: "Incassato in più" },
  { id: "senza", label: "Senza importo" },
  { id: "tutte", label: "Tutte" },
] as const;

type FiltroId = (typeof FILTRI)[number]["id"];

const fmtData = (iso: string | null) =>
  iso
    ? new Date(
        iso + (String(iso).length === 10 ? "T12:00:00" : "")
      ).toLocaleDateString("it-IT")
    : "—";

/**
 * Guardia della vista cassa: la pagina richiede `pagamento.read`, letto dal
 * capability set già committed da `OperationalContext` (nessuna seconda query
 * `permessi.mie`, nessun ruolo). Il componente autorizzato è l'unico a montare
 * le query: un deep-link non autorizzato non produce nemmeno le chiamate che il
 * server rifiuterebbe, e nessuna riga precedente resta nel DOM o nella cache
 * della route. Il confine vero resta il server.
 */
export default function Pagamenti() {
  const [, setLocation] = useLocation();
  const { capabilities, status: operationalStatus } = useOperationalContext();
  const permissions = economicRoutePermissions(
    operationalStatus === "ready" ? capabilities : null
  );

  if (!permissions.canReadPayments) {
    return (
      <div className="min-w-0 space-y-4 sm:space-y-5">
        <PageHeader
          variant="workbench"
          eyebrow="Cassa"
          title={
            <span className="inline-flex items-center gap-2">
              <Banknote className="h-6 w-6 text-primary" aria-hidden="true" />
              Pagamenti
            </span>
          }
          description="Incassi e saldi delle commesse della sede attiva."
        />
        <DataSurface
          density="compact"
          tone="sunken"
          state={{
            kind: "permission",
            title: "Vista cassa non disponibile",
            // Nessun dettaglio finanziario: né conteggi, né totali, né
            // riferimenti a commesse.
            description:
              "La lettura dei pagamenti richiede il permesso «lettura pagamenti». Se ti serve per lavoro, chiedila alla direzione.",
            action: (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setLocation("/")}
              >
                Torna alla dashboard
              </Button>
            ),
          }}
        />
      </div>
    );
  }

  return (
    <PagamentiAutorizzata canRecordPayments={permissions.canRecordPayments} />
  );
}

function PagamentiAutorizzata({
  canRecordPayments,
}: {
  canRecordPayments: boolean;
}) {
  const [, setLocation] = useLocation();
  const commesse = trpc.commesse.list.useQuery({});
  const recenti = trpc.commesse.pagamentiRecenti.useQuery({ limit: 12 });
  const utils = trpc.useUtils();
  // Kill switch della fatturazione dal contratto: senza i limiti non esiste
  // il computo su cui le fatture nascono, quindi servono entrambi. La UI
  // nasconde la sezione, il server decide comunque.
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const fatturazioneAttiva = Boolean(
    interruttori.data?.fatturazione && interruttori.data?.limiti
  );

  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<FiltroId>("residuo");
  // "tutti" resta il default: questa pagina serve a incassare, e un residuo
  // del 2025 è esattamente quello che non va nascosto per distrazione.
  const [anno, setAnno] = useState<string>("tutti");
  const [regFor, setRegFor] = useState<any>(null);
  const [pForm, setPForm] = useState({
    importo: "",
    data: new Date().toISOString().split("T")[0],
    metodo: "bonifico",
    tipo: "",
    note: "",
  });

  const addPagamento = trpc.commesse.addPagamento.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setRegFor(null);
      setPForm(f => ({ ...f, importo: "", note: "" }));
      toast.success("Acconto registrato");
    },
    onError: e => toast.error(e.message ?? "Registrazione non riuscita"),
  });

  const tutteAttive = useMemo(
    () =>
      (commesse.data ?? []).filter(
        (c: any) => !c.archivedAt && c.stato !== "archiviata"
      ),
    [commesse.data]
  );

  const anni = useMemo(() => {
    const trovati = new Set<number>();
    for (const c of tutteAttive as any[]) {
      const a = c?.anno ?? null;
      if (a != null) trovati.add(a);
    }
    return Array.from(trovati).sort((a, b) => b - a);
  }, [tutteAttive]);

  // Anno scelto: filtra TUTTO, righe e totali insieme. Un totale che parla di
  // un perimetro diverso dall'elenco sotto è peggio di nessun totale.
  const attive = useMemo(
    () =>
      anno === "tutti"
        ? tutteAttive
        : tutteAttive.filter((c: any) => (c?.anno ?? null) === Number(anno)),
    [tutteAttive, anno]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return attive
      .map((c: any) => {
        const tot = c.importoTotale ?? null;
        const inc = c.importoIncassato ?? 0;
        const residuo = (tot ?? 0) - inc;
        return {
          c,
          tot,
          inc,
          residuo,
          pct: tot ? Math.min(100, Math.round((inc / tot) * 100)) : 0,
        };
      })
      .filter(({ c, tot, residuo }) => {
        if (
          q &&
          !`${c.codice ?? ""} ${c.cliente ?? ""}`.toLowerCase().includes(q)
        ) {
          return false;
        }
        if (filtro === "residuo") return !!tot && residuo > 0;
        if (filtro === "saldate") return !!tot && residuo === 0;
        if (filtro === "sovrapagate") return !!tot && residuo < 0;
        if (filtro === "senza") return !tot;
        return true;
      })
      .sort((a, b) => b.residuo - a.residuo);
  }, [attive, search, filtro]);

  const kpi = useMemo(() => {
    const conImporto = attive.filter((c: any) => c.importoTotale);
    const tot = conImporto.reduce(
      (s: number, c: any) => s + (c.importoTotale ?? 0),
      0
    );
    const inc = conImporto.reduce(
      (s: number, c: any) => s + (c.importoIncassato ?? 0),
      0
    );
    // Da incassare = somma dei residui POSITIVI commessa per commessa: sugli
    // aggregati una commessa incassata in eccesso cancellava il debito di
    // un'altra, e il totale usciva più basso del vero.
    let residuo = 0;
    let eccedenza = 0;
    let sovrapagate = 0;
    for (const c of conImporto as any[]) {
      const d = (c.importoTotale ?? 0) - (c.importoIncassato ?? 0);
      if (d > 0) residuo += d;
      else if (d < 0) {
        eccedenza += -d;
        sovrapagate++;
      }
    }
    return {
      tot,
      inc,
      residuo,
      eccedenza,
      sovrapagate,
      senza: attive.length - conImporto.length,
    };
  }, [attive]);

  const filtriVisibili = FILTRI.filter(
    f => f.id !== "sovrapagate" || kpi.sovrapagate > 0
  );

  const hasActiveFilters =
    !!search.trim() || filtro !== "residuo" || anno !== "tutti";

  function azzeraFiltri() {
    setSearch("");
    setFiltro("residuo");
    setAnno("tutti");
  }

  const chip = (p: number) => {
    if (!regFor?.tot) return;
    const val = Math.min(
      Math.round(regFor.tot * p),
      Math.max(0, regFor.residuo)
    );
    setPForm(f => ({ ...f, importo: String(val) }));
  };

  const importoRegistrabile = parseEuroPositivo(pForm.importo);

  // Stato della lettura, condiviso da sintesi ed elenco: finché le commesse
  // non sono state lette — o la lettura è fallita — al posto dei totali va
  // mostrato lo stato, mai un «€ 0,00» che nessuno ha calcolato.
  const statoLettura: StatePanelProps | undefined = commesse.isPending
    ? {
        kind: "loading",
        title: "Carico la cassa",
        description: "Recupero le commesse attive della sede.",
        rows: 3,
      }
    : commesse.isError
      ? {
          kind: "error",
          title: "Cassa non caricata",
          description:
            "Non è stato possibile leggere le commesse della sede. Nessun importo è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => commesse.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : undefined;

  const statoElenco: StatePanelProps | undefined =
    statoLettura ??
    (rows.length === 0
      ? {
          kind: "empty",
          title: hasActiveFilters
            ? "Nessuna commessa per questo filtro"
            : "Nessuna commessa attiva in questa sede",
          description: hasActiveFilters
            ? "Cambia filtro, anno o ricerca per vedere le altre commesse della sede."
            : "Quando una commessa verrà aperta la troverai qui con il suo saldo.",
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
        eyebrow="Cassa"
        title={
          <span className="inline-flex items-center gap-2">
            <Banknote className="h-6 w-6 text-primary" aria-hidden="true" />
            Pagamenti
          </span>
        }
        description="Incassi e saldi delle commesse attive della sede."
        busy={commesse.isFetching}
        metadata={
          <>
            {commesse.isPending ? (
              <span>Conteggio commesse in caricamento…</span>
            ) : commesse.isError ? (
              <span>Conteggio commesse non disponibile</span>
            ) : (
              <>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {attive.length}
                  </strong>{" "}
                  {attive.length === 1 ? "commessa attiva" : "commesse attive"}
                </span>
                <span>
                  {anno === "tutti"
                    ? "tutti gli anni di apertura"
                    : `aperte nel ${anno}`}
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {kpi.senza}
                  </strong>{" "}
                  senza importo pattuito
                </span>
              </>
            )}
            {commesse.isFetching && !commesse.isPending ? (
              <span role="status">Aggiornamento in corso…</span>
            ) : null}
          </>
        }
      />

      {fatturazioneAttiva && <FattureEmesseSezione />}

      <DataSurface
        density="compact"
        tone="default"
        title="Situazione cassa"
        description={
          anno === "tutti"
            ? "Somma delle commesse attive della sede, tutti gli anni."
            : `Somma delle commesse attive aperte nel ${anno}.`
        }
        state={statoLettura}
      >
        <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2">
            <dt className="eyebrow text-text-3">Pattuito</dt>
            <dd className="mt-1 truncate text-xl font-bold tabular-nums text-text-1">
              {formatEuroSimbolo(kpi.tot)}
            </dd>
          </div>
          <div className="min-w-0 rounded-[var(--radius-control)] border border-success/30 bg-success-soft px-3 py-2">
            <dt className="eyebrow text-success">Incassato</dt>
            <dd className="mt-1 truncate text-xl font-bold tabular-nums text-success">
              {formatEuroSimbolo(kpi.inc)}
            </dd>
          </div>
          <div className="min-w-0 rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft px-3 py-2">
            <dt className="eyebrow text-warning">Da incassare</dt>
            <dd className="mt-1 truncate text-xl font-bold tabular-nums text-warning">
              {formatEuroSimbolo(kpi.residuo)}
            </dd>
          </div>
          {kpi.sovrapagate > 0 ? (
            <div className="min-w-0 rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2">
              <dt className="eyebrow text-danger">Incassato in più</dt>
              <dd className="mt-1 truncate text-xl font-bold tabular-nums text-danger">
                {formatEuroSimbolo(kpi.eccedenza)}
              </dd>
              <dd className="text-xs text-danger">
                su {kpi.sovrapagate}{" "}
                {kpi.sovrapagate === 1 ? "commessa" : "commesse"}
              </dd>
            </div>
          ) : (
            <div className="min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2">
              <dt className="eyebrow text-text-3">Senza importo</dt>
              <dd className="mt-1 truncate text-xl font-bold tabular-nums text-text-2">
                {kpi.senza}
              </dd>
            </div>
          )}
        </dl>
      </DataSurface>

      <BreakEvenPanel onReview={() => setLocation("/economia?tab=acquisti")} />

      {(recenti.data?.length ?? 0) > 0 ? (
        <DataSurface density="compact" tone="sunken" title="Ultimi incassi">
          <ul className="flex min-w-0 flex-wrap gap-2">
            {recenti.data!.map((p: any) => (
              <li key={`${p.commessaId}-${p.id}`} className="min-w-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 max-w-full justify-start gap-1.5"
                  onClick={() => setLocation(`/commesse/${p.commessaId}`)}
                >
                  <span className="font-bold tabular-nums text-success">
                    {formatEuroSimbolo(p.importo)}
                  </span>
                  <span className="min-w-0 truncate text-text-2">
                    {p.cliente}
                  </span>
                  <span className="tabular-nums text-text-3">
                    {fmtData(p.data)}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </DataSurface>
      ) : null}

      <div className="sticky top-0 z-20 border-b border-border-soft bg-surface px-1 py-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1 lg:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                aria-hidden="true"
              />
              <Input
                aria-label="Cerca commesse in cassa"
                placeholder="Cerca codice o cliente…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="min-h-11 pl-9"
              />
            </div>
            <Select value={anno} onValueChange={setAnno}>
              <SelectTrigger
                className="min-h-11 w-full lg:w-40"
                aria-label="Anno di apertura"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti gli anni</SelectItem>
                {anni.map(a => (
                  <SelectItem key={a} value={String(a)}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div
            role="group"
            aria-label="Filtra le commesse"
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {filtriVisibili.map(f => (
              <Button
                key={f.id}
                type="button"
                variant={filtro === f.id ? "default" : "outline"}
                size="sm"
                aria-pressed={filtro === f.id}
                className="min-h-11"
                onClick={() => setFiltro(f.id)}
              >
                {f.label}
              </Button>
            ))}
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
              {rows.length} in elenco
            </span>
          </div>
        </div>
      </div>

      <section className="min-w-0" aria-label="Saldi delle commesse">
        <DataSurface density="compact" tone="sunken" state={statoElenco}>
          <ul className="grid min-w-0 gap-2">
            {rows.map(({ c, tot, inc, residuo, pct }) => (
              <li
                key={c.id}
                className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft bg-surface"
              >
                <div className="flex min-w-0 flex-col gap-3 p-3 lg:flex-row lg:items-center">
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => setLocation(`/commesse/${c.id}`)}
                  >
                    <span className="codice-mono shrink-0 text-[11px] text-text-3">
                      {c.codice}
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold text-text-1">
                      {c.cliente}
                    </span>
                    <StatoChip stato={c.stato} className="shrink-0" />
                  </button>

                  {tot ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 lg:justify-end">
                      <div className="min-w-0 text-right">
                        <p className="eyebrow text-text-3">Pattuito</p>
                        <p className="truncate text-sm font-semibold tabular-nums text-text-1">
                          {formatEuroSimbolo(tot)}
                        </p>
                      </div>
                      <div className="hidden w-40 min-w-0 md:block">
                        <div className="mb-1 flex justify-between text-[10px] tabular-nums text-text-3">
                          <span>{pct}% incassato</span>
                          <span>{formatEuroSimbolo(inc)}</span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Incassato su ${c.codice}`}
                          className="h-2 overflow-hidden rounded-full bg-surface-2"
                        >
                          <div
                            className={`h-full ${residuo > 0 ? "bg-warning" : "bg-success"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="min-w-0 text-right">
                        <p className="eyebrow text-text-3">Residuo</p>
                        {residuo > 0 ? (
                          <p className="truncate text-base font-bold tabular-nums text-warning">
                            {formatEuroSimbolo(residuo)}
                          </p>
                        ) : residuo < 0 ? (
                          /* Incassato oltre il pattuito: mostrarlo come
                             "Saldata" faceva sparire l'eccedenza. */
                          <p className="truncate text-sm font-bold tabular-nums text-danger">
                            {formatEuroSimbolo(-residuo)} in più
                          </p>
                        ) : (
                          <p className="inline-flex items-center gap-1 text-sm font-bold text-success">
                            <CheckCircle2
                              className="h-4 w-4"
                              aria-hidden="true"
                            />{" "}
                            Saldata
                          </p>
                        )}
                      </div>
                      {/* Registrare è una capability a sé: `pagamento.read`
                          non la concede, e senza di essa la CTA non esiste. */}
                      {canRecordPayments && residuo > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11 shrink-0"
                          onClick={() => {
                            setRegFor({ c, tot, residuo });
                            setPForm({
                              importo: "",
                              data: new Date().toISOString().split("T")[0],
                              metodo: "bonifico",
                              tipo: tipoPagamentoSuggerito(c.nPagamenti ?? 0),
                              note: "",
                            });
                          }}
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          Acconto
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-text-3">
                      Nessun importo pattuito — impostalo dalla scheda commessa
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </DataSurface>
      </section>

      {/* Registrazione acconto: montata solo con `pagamento.record`, come il
          router. Non esiste nessun input `importoIncassato`: il totale
          incassato deriva dal registro pagamenti, non si scrive a mano. */}
      {canRecordPayments ? (
        <Dialog open={!!regFor} onOpenChange={o => !o && setRegFor(null)}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-sm">
                Registra acconto · {regFor?.c?.codice} — {regFor?.c?.cliente}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Registra un acconto sulla commessa selezionata.
              </DialogDescription>
            </DialogHeader>
            {regFor ? (
              <div className="grid gap-3 py-1">
                <p className="text-xs text-text-2">
                  Residuo attuale:{" "}
                  <span className="font-bold text-warning">
                    {formatEuroSimbolo(regFor.residuo)}
                  </span>{" "}
                  su {formatEuroSimbolo(regFor.tot)}
                </p>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {[0.5, 0.4, 0.1].map(p => (
                    <Button
                      key={p}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => chip(p)}
                    >
                      {Math.round(p * 100)}%
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    onClick={() =>
                      setPForm(f => ({
                        ...f,
                        importo: String(regFor.residuo),
                        tipo: "saldo",
                      }))
                    }
                  >
                    <Wallet className="h-4 w-4" aria-hidden="true" />
                    Salda tutto
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="acconto-importo">Importo € *</Label>
                    <Input
                      id="acconto-importo"
                      autoFocus
                      inputMode="decimal"
                      value={pForm.importo}
                      onChange={e =>
                        setPForm({ ...pForm, importo: e.target.value })
                      }
                      aria-invalid={
                        (pForm.importo.trim().length > 0 &&
                          importoRegistrabile == null) ||
                        undefined
                      }
                      className="min-h-11 tabular-nums"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="acconto-data">Data</Label>
                    <Input
                      id="acconto-data"
                      type="date"
                      value={pForm.data}
                      onChange={e =>
                        setPForm({ ...pForm, data: e.target.value })
                      }
                      className="min-h-11"
                    />
                  </div>
                </div>
                {pForm.importo.trim().length > 0 &&
                importoRegistrabile == null ? (
                  <p role="alert" className="text-xs text-danger">
                    Importo non leggibile: usa cifre positive come 1.500,00.
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Metodo</Label>
                    <Select
                      value={pForm.metodo}
                      onValueChange={v => setPForm({ ...pForm, metodo: v })}
                    >
                      <SelectTrigger
                        aria-label="Metodo di pagamento"
                        className="min-h-11"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(METODO_LABEL).map(([k, l]) => (
                          <SelectItem key={k} value={k}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tipo</Label>
                    <Select
                      value={pForm.tipo || "__none"}
                      onValueChange={v =>
                        setPForm({ ...pForm, tipo: v === "__none" ? "" : v })
                      }
                    >
                      <SelectTrigger
                        aria-label="Tipo di rata"
                        className="min-h-11"
                      >
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">—</SelectItem>
                        {Object.entries(TIPO_PAGAMENTO_LABEL).map(([k, l]) => (
                          <SelectItem key={k} value={k}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="acconto-nota">Nota</Label>
                  <Input
                    id="acconto-nota"
                    placeholder="Facoltativa"
                    value={pForm.note}
                    onChange={e => setPForm({ ...pForm, note: e.target.value })}
                    className="min-h-11"
                  />
                </div>
                {addPagamento.error ? (
                  <p
                    role="alert"
                    className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                  >
                    {addPagamento.error.message}
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="min-h-12"
                  disabled={
                    importoRegistrabile == null || addPagamento.isPending
                  }
                  onClick={() =>
                    addPagamento.mutate({
                      commessaId: regFor.c.id,
                      importo: importoRegistrabile!,
                      data: pForm.data || null,
                      metodo: pForm.metodo as any,
                      tipo: (pForm.tipo || null) as any,
                      note: pForm.note.trim() || undefined,
                    })
                  }
                >
                  {addPagamento.isPending
                    ? "Registrazione…"
                    : "Registra acconto"}
                </Button>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
