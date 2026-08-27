// /economia — la situazione contabile dell'azienda in una pagina.
//
// Quattro perimetri, in ordine di quanto spesso vengono guardati:
//   Andamento    come sta andando l'anno
//   Fatture      quali fatture non hanno ancora una commessa o un incasso
//   Costi fissi  quanto costa tenere aperta l'azienda ogni mese
//   Acquisti     classificare i documenti ricevuti
//
// Le due code operative — Fatture e Acquisti — portano il conteggio nella
// linguetta: senza, per sapere se c'era lavoro bisognava aprirle.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SearchSelect from "@/components/SearchSelect";
import { Input } from "@/components/ui/input";
import TarsPropostaCard from "@/components/TarsPropostaCard";
import CostiFicReview from "@/components/economia/CostiFicReview";
import CostiFissi from "@/components/economia/CostiFissi";
import EconomiaPanoramica from "@/components/economia/EconomiaPanoramica";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasRuolo, isDirezione } from "@/lib/roles";
import { formatEuroSimbolo } from "@/lib/euro";
import {
  AlertTriangle,
  Landmark,
  Link2,
  Unlink,
  Loader2,
  EyeOff,
  ShieldAlert,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATO_FATTURA: Record<string, { label: string; classe: string }> = {
  riconciliata: { label: "Riconciliata", classe: "bg-success hover:bg-success" },
  proposta: { label: "Proposta Tars", classe: "bg-warning hover:bg-warning" },
  da_riconciliare: { label: "Incasso da registrare", classe: "" },
  non_abbinabile: { label: "Senza commessa", classe: "" },
  ignorata: { label: "Esclusa", classe: "" },
};

// I filtri sono code di lavoro, non categorie: ognuno risponde a "cosa devo
// fare adesso". `tutte` resta in fondo perché è la vista di controllo, non
// quella operativa.
const FILTRI = [
  {
    id: "da_collegare",
    label: "Senza commessa",
    tiene: (f: any) => f.stato === "non_abbinabile",
  },
  {
    id: "da_riconciliare",
    label: "Incassi da registrare",
    tiene: (f: any) => f.stato === "da_riconciliare" || f.stato === "proposta",
  },
  {
    id: "riconciliate",
    label: "A posto",
    tiene: (f: any) => f.stato === "riconciliata",
  },
  {
    // Lo storico collegato con le regole vecchie: una fattura su una commessa
    // di un altro cliente non si distingue da sola dalle altre "a posto".
    id: "da_controllare",
    label: "Da controllare",
    tiene: (f: any) => Boolean(f.avvisoCollegamento),
  },
  { id: "escluse", label: "Escluse", tiene: (f: any) => f.stato === "ignorata" },
  { id: "tutte", label: "Tutte", tiene: () => true },
] as const;

type FiltroId = (typeof FILTRI)[number]["id"];

function RigaFattura({ f }: { f: any }) {
  const utils = trpc.useUtils();
  const [cercaAperta, setCercaAperta] = useState(false);
  const [commessaSelezionata, setCommessaSelezionata] = useState<string | null>(
    null
  );
  const commesse = trpc.commesse.list.useQuery(undefined, {
    enabled: cercaAperta,
  });
  const opzioniCommesse = (commesse.data ?? []).map((cm: any) => ({
    value: String(cm.id),
    label: `${cm.codice} — ${cm.cliente}`,
    keywords: `${cm.citta ?? ""} ${cm.cliente ?? ""}`,
  }));

  const chiudiCerca = () => {
    setCercaAperta(false);
    setCommessaSelezionata(null);
  };

  const collegaMut = trpc.ficFatture.collega.useMutation({
    onSuccess: r => {
      toast.success(
        r.pdf.stato === "archiviata"
          ? "Collegata · incassi riconciliati · PDF archiviato"
          : r.pdf.stato === "errore"
            ? "Collegata · PDF da ritentare"
            : "Collegata · incassi riconciliati"
      );
      chiudiCerca();
      utils.ficFatture.invalidate();
      utils.economia.invalidate();
      utils.commesse.invalidate();
      utils.preventiviContratti.invalidate();
      utils.tars.proposte.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const ignoraMut = trpc.ficFatture.ignora.useMutation({
    onSuccess: () => {
      utils.ficFatture.invalidate();
      utils.economia.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const collega = (commessaId: number) =>
    collegaMut.mutate({ ficId: f.id, commessaId });

  const s = STATO_FATTURA[f.stato] ?? { label: f.stato, classe: "" };
  const candidati: any[] = f.candidati ?? [];

  return (
    <Card className={cn(f.stato === "ignorata" && "border-dashed opacity-75")}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap text-sm font-medium">
              <span>Fattura {f.numero}</span>
              <span className="font-normal text-text-3">
                {new Date(f.data).toLocaleDateString("it-IT")}
              </span>
              <Badge
                variant={s.classe ? "default" : "outline"}
                className={cn("text-[10px]", s.classe)}
              >
                {s.label}
              </Badge>
            </div>
            <p className="truncate text-sm text-text-3">{f.clienteNome}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-semibold tabular-nums">
              {formatEuroSimbolo(f.importoLordo)}
            </p>
            <p className="text-xs tabular-nums text-text-3">
              incassato {formatEuroSimbolo(f.incassato)}
            </p>
          </div>
        </div>

        {f.commessaId != null && (
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/commesse/${f.commessaId}`}
              className="inline-flex min-w-0 items-center gap-1 text-xs text-primary hover:underline"
            >
              <Link2 aria-hidden="true" className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {f.commessaCodice} — {f.commessaCliente}
              </span>
            </Link>
            <Badge variant="outline" className="text-[10px]">
              {f.collegataAMano ? "Manuale" : "Automatico"}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                f.pdfSync?.stato === "errore" && "border-warning text-warning",
                f.pdfSync?.stato === "archiviata" &&
                  "border-success/50 text-success"
              )}
            >
              {f.pdfSync?.stato === "archiviata"
                ? "PDF archiviato"
                : f.pdfSync?.stato === "errore"
                  ? "PDF da ritentare"
                  : "PDF in attesa"}
            </Badge>
          </div>
        )}

        {f.avvisoCollegamento && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-2.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <p className="min-w-0">
              Collegata a {f.commessaCodice} ma {f.avvisoCollegamento}. Se la
              fattura non è di questa commessa, scollegala: pattuito e incassi
              tornano alle fatture rimaste.
            </p>
          </div>
        )}

        {/* I candidati li ha già calcolati il matcher per decidere. Mostrarli
            trasforma una ricerca a mano in un click, e il motivo accanto dice
            perché il server li propone — così la scelta resta dell'operatore
            invece di essere un atto di fede. */}
        {f.commessaId == null && f.stato !== "ignorata" && candidati.length > 0 && (
          <div className="space-y-1.5 rounded-md border border-border bg-surface-2 p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-text-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {candidati.every(c => c.incerto)
                ? "Da confermare a mano"
                : candidati.length === 1
                  ? "Una commessa combacia"
                  : `${candidati.length} commesse combaciano`}
            </p>
            <div className="flex flex-col gap-1.5">
              {candidati.map(c => (
                <Button
                  key={c.commessaId}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start gap-2 px-2.5 py-2 text-left sm:min-h-10"
                  disabled={collegaMut.isPending}
                  onClick={() => collega(c.commessaId)}
                >
                  <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {c.codice}
                      {c.cliente ? ` — ${c.cliente}` : ""}
                    </span>
                    <span className="block truncate text-[11px] font-normal text-text-3">
                      {c.motivo}
                    </span>
                    {/* Il dubbio va detto qui, accanto al pulsante che lo
                        ignorerebbe: e' l'unico punto in cui serve. */}
                    {c.dubbio && (
                      <span className="block truncate text-[11px] font-normal text-warning">
                        Attenzione: {c.dubbio}
                      </span>
                    )}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {f.commessaId == null && candidati.length === 0 && f.motivo && (
          <p className="text-xs italic text-text-3">{f.motivo}</p>
        )}

        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            aria-expanded={cercaAperta}
            onClick={() => (cercaAperta ? chiudiCerca() : setCercaAperta(true))}
          >
            <Search className="mr-1 h-3 w-3" />
            {f.commessaId != null ? "Sposta" : "Cerca commessa"}
          </Button>
          {f.commessaId != null && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              disabled={collegaMut.isPending}
              title="Toglie la fattura dalla commessa: il PDF esce dal fascicolo, pattuito e incassi si ricalcolano"
              onClick={() => collegaMut.mutate({ ficId: f.id, commessaId: null })}
            >
              <Unlink className="mr-1 h-3 w-3" />
              Scollega
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-8 text-xs"
            disabled={ignoraMut.isPending}
            title="Esclude solo dalla riconciliazione: la fattura resta nei totali"
            onClick={() =>
              ignoraMut.mutate({
                ficId: f.id,
                ignorata: f.stato !== "ignorata",
              })
            }
          >
            <EyeOff className="mr-1 h-3 w-3" />
            {f.stato === "ignorata" ? "Riprendi" : "Escludi"}
          </Button>
        </div>

        {cercaAperta && (
          <div className="space-y-2 rounded-md border border-border bg-surface-2 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">
                {f.commessaId != null ? "Sposta su" : "Collega a"}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={chiudiCerca}
                aria-label="Chiudi ricerca commessa"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <SearchSelect
              value={commessaSelezionata}
              onChange={setCommessaSelezionata}
              options={opzioniCommesse}
              disabled={commesse.isLoading || collegaMut.isPending}
              placeholder={
                commesse.isLoading ? "Caricamento…" : "Cerca la commessa…"
              }
              searchPlaceholder="Codice, cliente o città…"
              emptyText="Nessuna commessa trovata"
            />
            <Button
              type="button"
              className="h-10 w-full"
              disabled={!commessaSelezionata || collegaMut.isPending}
              onClick={() => collega(Number(commessaSelezionata))}
            >
              {collegaMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" />
              )}
              Collega
            </Button>
          </div>
        )}

        {f.propostaTars && <TarsPropostaCard proposta={f.propostaTars} />}
      </CardContent>
    </Card>
  );
}

/** Testo su cui si cerca una fattura: quello che una persona ricorda di lei. */
function testoRicerca(f: any): string {
  return [
    f.numero,
    f.clienteNome,
    f.commessaCodice,
    f.commessaCliente,
    // L'importo si cerca come lo si legge: "1.220" e "1220" devono trovare
    // la stessa fattura.
    String(f.importoLordo ?? ""),
    String(f.importoLordo ?? "").replace(".", ","),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function Fatture({ anno }: { anno: number }) {
  const utils = trpc.useUtils();
  const q = trpc.ficFatture.list.useQuery({ anno });
  const [filtro, setFiltro] = useState<FiltroId>("da_collegare");
  const [cerca, setCerca] = useState("");
  const tutte = q.data ?? [];

  const riallinea = trpc.ficFatture.riconciliaOra.useMutation({
    onSuccess: r => {
      toast.success(
        r.collegate > 0
          ? `${r.collegate} fatture collegate · ${r.pattuitiAggiornati} pattuiti aggiornati`
          : "Nessuna fattura era collegabile senza ambiguità"
      );
      utils.ficFatture.invalidate();
      utils.commesse.invalidate();
      utils.economia.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const conteggi = Object.fromEntries(
    FILTRI.map(f => [f.id, tutte.filter(f.tiene).length])
  ) as Record<FiltroId, number>;

  if (q.isLoading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="h-5 w-5 mx-auto animate-spin text-text-3" />
      </div>
    );
  }

  // Cercare significa avere in mente UNA fattura: la ricerca scavalca il
  // filtro, altrimenti si trova niente e si dà la colpa alla ricerca.
  const termine = cerca.trim().toLowerCase();
  const inRicerca = termine.length > 0;
  const attivo = FILTRI.find(f => f.id === filtro) ?? FILTRI[0];
  const righe = inRicerca
    ? tutte.filter(f => testoRicerca(f).includes(termine))
    : tutte.filter(attivo.tiene);

  const totale = righe.reduce(
    (somma: number, f: any) => somma + (f.importoLordo ?? 0),
    0
  );
  const conCandidati = tutte.filter(
    f => f.stato === "non_abbinabile" && (f.candidati ?? []).length > 0
  ).length;
  // Solo quelle che il riallineamento collegherebbe davvero: un candidato
  // unico ma incerto resta una decisione umana, e contarlo qui prometteva un
  // collegamento che non sarebbe avvenuto.
  const inequivocabili = tutte.filter(
    f =>
      f.stato === "non_abbinabile" &&
      (f.candidati ?? []).length === 1 &&
      !f.candidati[0].incerto
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
            aria-hidden="true"
          />
          <Input
            value={cerca}
            onChange={e => setCerca(e.target.value)}
            placeholder="Numero, cliente, commessa, importo…"
            aria-label="Cerca fra le fatture"
            className="h-10 pl-8 pr-8"
          />
          {inRicerca && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2"
              aria-label="Azzera la ricerca"
              onClick={() => setCerca("")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {inequivocabili > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10 shrink-0"
            disabled={riallinea.isPending}
            title="Collega solo le fatture con un unico candidato: le ambigue restano da decidere"
            onClick={() => riallinea.mutate()}
          >
            {riallinea.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            Collega le {inequivocabili} sicure
          </Button>
        )}
      </div>

      {/* Filtri come chip: si vede quanta coda c'è in ognuno senza aprirli. */}
      <div
        role="group"
        aria-label="Filtra le fatture"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {FILTRI.map(f => (
          <Button
            key={f.id}
            type="button"
            size="sm"
            variant={!inRicerca && filtro === f.id ? "default" : "outline"}
            aria-pressed={!inRicerca && filtro === f.id}
            className={cn("h-9 shrink-0", inRicerca && "opacity-60")}
            onClick={() => {
              setCerca("");
              setFiltro(f.id);
            }}
          >
            {f.label}
            <Badge
              variant={!inRicerca && filtro === f.id ? "secondary" : "outline"}
              className="ml-1.5 text-[10px]"
            >
              {conteggi[f.id]}
            </Badge>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-xs text-text-3">
          {inRicerca
            ? `${righe.length} fatture per «${cerca.trim()}», su tutto il ${anno}`
            : filtro === "da_collegare" && conCandidati > 0
              ? `${conCandidati} hanno già una commessa suggerita: basta un click sul candidato.`
              : `${righe.length} fatture`}
        </p>
        {righe.length > 0 && (
          <p className="text-xs tabular-nums text-text-3">
            totale{" "}
            <span className="font-semibold text-text-2">
              {formatEuroSimbolo(totale)}
            </span>
          </p>
        )}
      </div>

      {righe.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-3">
            {inRicerca
              ? `Nessuna fattura per «${cerca.trim()}».`
              : filtro === "da_collegare"
                ? "Ogni fattura ha la sua commessa."
                : filtro === "da_riconciliare"
                  ? "Nessun incasso da registrare."
                  : "Nessuna fattura in questa vista."}
          </CardContent>
        </Card>
      )}

      {righe.map((f: any) => (
        <RigaFattura key={f.id} f={f} />
      ))}
    </div>
  );
}

export default function Economia() {
  const { user } = useAuth();
  const [anno, setAnno] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<
    "panoramica" | "fatture" | "fissi" | "acquisti"
  >(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return requested === "fatture" ||
      requested === "acquisti" ||
      requested === "fissi"
      ? requested
      : "panoramica";
  });

  const puoVedere =
    !user || isDirezione(user) || hasRuolo(user, "amministrazione");

  // I conteggi delle due code stanno nelle linguette: aprire un tab per
  // scoprire che è vuoto è il costo che questa pagina faceva pagare ogni volta.
  const fatture = trpc.ficFatture.list.useQuery(
    { anno },
    { enabled: puoVedere }
  );
  const costi = trpc.ficCosti.list.useQuery(
    { anno, classificazione: "dubbio" },
    { enabled: puoVedere }
  );
  // L'arretrato di TUTTI gli anni: 265 documenti del 2025 non comparivano da
  // nessuna parte finché non si cambiava l'anno a mano, e nessuno aveva un
  // motivo per cambiarlo.
  const arretrati = trpc.ficCosti.arretrati.useQuery(undefined, {
    enabled: puoVedere,
  });
  const fattureAperte = (fatture.data ?? []).filter(
    (f: any) => f.stato === "non_abbinabile" || f.stato === "da_riconciliare"
  ).length;
  const costiDubbi = (costi.data ?? []).length;
  const arretratoTotale = (arretrati.data ?? []).reduce(
    (somma: number, voce: any) => somma + voce.daClassificare + voce.senzaCommessa,
    0
  );
  const anniConDati = Array.from(
    new Set<number>([
      new Date().getFullYear(),
      new Date().getFullYear() - 1,
      ...(arretrati.data ?? []).map((voce: any) => voce.anno),
      anno,
    ])
  ).sort((a, b) => b - a);

  if (!puoVedere) {
    return (
      <div className="py-16 text-center text-text-3 space-y-2">
        <ShieldAlert className="h-8 w-8 mx-auto opacity-50" />
        <p className="text-sm">
          Solo direzione e amministrazione possono vedere i dati economici.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Landmark className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Contabilità</h1>
        <div className="ml-auto flex items-center gap-2">
          <Select value={String(anno)} onValueChange={v => setAnno(Number(v))}>
            <SelectTrigger className="h-9 w-[110px]" aria-label="Anno contabile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {anniConDati.map(a => (
                <SelectItem key={a} value={String(a)}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="panoramica">Andamento</TabsTrigger>
          <TabsTrigger value="fatture" className="gap-1.5">
            Fatture
            {fattureAperte > 0 && (
              <Badge variant="warning" className="text-[10px]">
                {fattureAperte}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="fissi">Costi fissi</TabsTrigger>
          <TabsTrigger value="acquisti" className="gap-1.5">
            Acquisti
            {/* Il badge parla di TUTTI gli anni: contare solo quello aperto
                nascondeva l'arretrato invece di segnalarlo. */}
            {arretratoTotale > 0 && (
              <Badge variant="warning" className="text-[10px]">
                {costiDubbi > 0 && costiDubbi !== arretratoTotale
                  ? `${costiDubbi}/${arretratoTotale}`
                  : arretratoTotale}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "panoramica" && <EconomiaPanoramica anno={anno} />}
      {tab === "fatture" && <Fatture anno={anno} />}
      {tab === "fissi" && <CostiFissi />}
      {tab === "acquisti" && (
        <CostiFicReview anno={anno} onCambiaAnno={setAnno} />
      )}
    </div>
  );
}
