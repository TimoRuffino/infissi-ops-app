// /economia — la situazione contabile dell'azienda in una pagina.
//
// Due schede: Panoramica (KPI + andamento mensile) e Fatture (quelle
// sincronizzate da Fatture in Cloud, con lo stato di riconciliazione e
// il collegamento manuale alla commessa). Le rate incassate diventano
// proposte da approvare — mai scritture automatiche.

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
import TarsPropostaCard from "@/components/TarsPropostaCard";
import CostiFicReview from "@/components/economia/CostiFicReview";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasRuolo, isDirezione } from "@/lib/roles";
import { formatEuroSimbolo } from "@/lib/euro";
import {
  Landmark,
  Link2,
  Loader2,
  EyeOff,
  RefreshCw,
  ShieldAlert,
  Check,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MESI = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];

const STATO_FATTURA: Record<string, { label: string; classe: string }> = {
  riconciliata: {
    label: "Riconciliata",
    classe: "bg-success hover:bg-success",
  },
  proposta: {
    label: "Proposta in attesa",
    classe: "bg-warning hover:bg-warning",
  },
  da_riconciliare: { label: "Da riconciliare", classe: "" },
  non_abbinabile: { label: "Non abbinabile", classe: "" },
  ignorata: { label: "Ignorata", classe: "" },
};

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "verde" | "rosso" | "ambra";
}) {
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={cn(
            "text-xl font-semibold tabular-nums",
            accent === "verde" && "text-success",
            accent === "rosso" && "text-danger",
            accent === "ambra" && "text-warning"
          )}
        >
          {value}
        </div>
        {hint && (
          <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Panoramica({ anno }: { anno: number }) {
  const q = trpc.economia.overview.useQuery({ anno });
  if (q.isLoading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
      </div>
    );
  }
  const d = q.data;
  if (!d) return null;

  const maxRiga = Math.max(
    1,
    ...d.mesi.map(m => Math.max(m.venditeNetto, m.incassi, m.acquistiNetto))
  );

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Contratti CRM</h2>
            <p className="text-xs text-text-3">
              Fotografia lorda di {d.crm.commesseAttive} commesse attive
            </p>
          </div>
          <Badge variant="outline">Fonte CRM</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi
            label="Pattuito lordo"
            value={formatEuroSimbolo(d.crm.pattuito)}
          />
          <Kpi
            label="Incassato CRM"
            value={formatEuroSimbolo(d.crm.incassato)}
            accent="verde"
          />
          <Kpi
            label="Da incassare"
            value={formatEuroSimbolo(d.crm.residuo)}
            accent="ambra"
          />
          <Kpi
            label="Stime costi CRM"
            value={formatEuroSimbolo(
              d.crm.costiManualiStimati + d.crm.costoPosaStimato
            )}
            hint="Non entrano nei totali effettivi FiC"
          />
        </div>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Vendite FiC · {anno}</h2>
            <p className="text-xs text-text-3">
              {d.vendite.fatture} fatture e {d.vendite.noteCredito} note di
              credito
            </p>
          </div>
          <Badge variant="outline">Competenza FiC</Badge>
        </div>
        {d.vendite.disponibile ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="Fatturato netto"
              value={formatEuroSimbolo(d.vendite.netto)}
            />
            <Kpi label="IVA" value={formatEuroSimbolo(d.vendite.iva)} />
            <Kpi label="Lordo" value={formatEuroSimbolo(d.vendite.lordo)} />
            <Kpi
              label="Incassato FiC"
              value={formatEuroSimbolo(d.vendite.incassato)}
              accent="verde"
            />
            <Kpi
              label="Da incassare FiC"
              value={formatEuroSimbolo(d.vendite.daIncassare)}
              accent="ambra"
            />
            <Kpi
              label="Da riconciliare"
              value={String(d.vendite.daRiconciliare)}
              hint="Fatture senza riscontro CRM"
              accent={d.vendite.daRiconciliare > 0 ? "ambra" : undefined}
            />
          </div>
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground text-center">
              Nessun documento emesso sincronizzato per questo anno.
            </CardContent>
          </Card>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Acquisti FiC · {anno}</h2>
            <p className="text-xs text-text-3">
              {d.acquisti.documenti} documenti ricevuti, al netto delle
              rettifiche
            </p>
          </div>
          <Badge variant={d.acquisti.dubbi > 0 ? "warning" : "outline"}>
            {d.acquisti.dubbi} dubbi
          </Badge>
        </div>
        {d.acquisti.disponibile ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="Costi netti"
              value={formatEuroSimbolo(d.acquisti.netto)}
              accent="rosso"
            />
            <Kpi label="IVA" value={formatEuroSimbolo(d.acquisti.iva)} />
            <Kpi label="Lordo" value={formatEuroSimbolo(d.acquisti.lordo)} />
            <Kpi
              label="Uscite pagate"
              value={formatEuroSimbolo(d.acquisti.pagato)}
              accent="rosso"
            />
            <Kpi
              label="Da pagare"
              value={formatEuroSimbolo(d.acquisti.daPagare)}
              accent="ambra"
            />
            <Kpi
              label="Valore da rivedere"
              value={formatEuroSimbolo(d.acquisti.importoDubbio)}
              hint="Escluso dal pareggio"
              accent={d.acquisti.dubbi > 0 ? "ambra" : undefined}
            />
          </div>
        ) : (
          <Card>
            <CardContent className="py-6 text-center text-sm text-text-3">
              Nessun documento ricevuto sincronizzato. Ricollega FiC con i nuovi
              permessi e avvia una sincronizzazione.
            </CardContent>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Andamento netto · {anno}</h2>
        <Card>
          {/* tabIndex: una regione che scorre dev'essere raggiungibile da
              tastiera, altrimenti chi non usa il mouse non vede le colonne
              oltre il bordo. */}
          <CardContent
            className="py-3 overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={`Andamento ${anno}`}
          >
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left font-normal py-1">Mese</th>
                  <th className="text-right font-normal">Vendite nette</th>
                  <th className="text-right font-normal">Incassi FiC</th>
                  <th className="text-right font-normal">Acquisti netti</th>
                  <th className="w-1/3"></th>
                </tr>
              </thead>
              <tbody>
                {d.mesi.map(m => (
                  <tr key={m.mese} className="border-t">
                    <td className="py-1.5">{MESI[m.mese - 1]}</td>
                    <td className="text-right tabular-nums">
                      {m.venditeNetto ? formatEuroSimbolo(m.venditeNetto) : "—"}
                    </td>
                    <td className="text-right tabular-nums text-success">
                      {m.incassi ? formatEuroSimbolo(m.incassi) : "—"}
                    </td>
                    <td className="text-right tabular-nums text-danger">
                      {m.acquistiNetto
                        ? formatEuroSimbolo(m.acquistiNetto)
                        : "—"}
                    </td>
                    <td className="pl-3">
                      <div className="flex gap-0.5 h-3 items-end">
                        <div
                          className="bg-primary/60 w-1/3 rounded-sm"
                          style={{
                            height: `${(m.venditeNetto / maxRiga) * 100}%`,
                          }}
                        />
                        <div
                          className="bg-success/70 w-1/3 rounded-sm"
                          style={{ height: `${(m.incassi / maxRiga) * 100}%` }}
                        />
                        <div
                          className="bg-danger/70 w-1/3 rounded-sm"
                          style={{
                            height: `${(m.acquistiNetto / maxRiga) * 100}%`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function RigaFattura({ f }: { f: any }) {
  const utils = trpc.useUtils();
  const [collega, setCollega] = useState(false);
  const [commessaSelezionata, setCommessaSelezionata] = useState<string | null>(
    null
  );
  const commesse = trpc.commesse.list.useQuery(undefined, { enabled: collega });
  const opzioniCommesse = (commesse.data ?? []).map((cm: any) => ({
    value: String(cm.id),
    label: `${cm.codice} — ${cm.cliente}`,
    keywords: `${cm.citta ?? ""} ${cm.cliente ?? ""}`,
  }));
  const destinazione = opzioniCommesse.find(
    cm => cm.value === commessaSelezionata
  );

  const chiudiCollegamento = () => {
    setCollega(false);
    setCommessaSelezionata(null);
  };

  const collegaMut = trpc.ficFatture.collega.useMutation({
    onSuccess: r => {
      toast.success(
        r.proposteCreate > 0
          ? `Collegata e PDF allegato — ${r.proposteCreate} proposte da approvare in Tars`
          : "Collegata e PDF allegato alla commessa"
      );
      chiudiCollegamento();
      utils.ficFatture.invalidate();
      utils.economia.invalidate();
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

  const s = STATO_FATTURA[f.stato] ?? { label: f.stato, classe: "" };
  return (
    <Card className={cn(f.stato === "ignorata" && "opacity-60")}>
      <CardContent className="py-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
              Fattura {f.numero}
              <span className="text-muted-foreground font-normal">
                {new Date(f.data).toLocaleDateString("it-IT")}
              </span>
              <Badge
                variant={s.classe ? "default" : "outline"}
                className={cn("text-xs", s.classe)}
              >
                {s.label}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">{f.clienteNome}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold tabular-nums">
              {formatEuroSimbolo(f.importoLordo)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              incassato {formatEuroSimbolo(f.incassato)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {f.commessaId != null ? (
            <Link
              href={`/commesse/${f.commessaId}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Link2 className="h-3 w-3" />
              {f.commessaCodice} — {f.commessaCliente}
              {f.collegataAMano ? " (a mano)" : ""}
            </Link>
          ) : (
            f.motivo && (
              <span className="text-xs text-muted-foreground italic">
                {f.motivo}
              </span>
            )
          )}
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              aria-expanded={collega}
              onClick={() => {
                if (collega) chiudiCollegamento();
                else setCollega(true);
              }}
            >
              <Link2 className="h-3 w-3 mr-1" />
              {f.commessaId != null ? "Sposta" : "Collega"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={ignoraMut.isPending}
              onClick={() =>
                ignoraMut.mutate({
                  ficId: f.id,
                  ignorata: f.stato !== "ignorata",
                })
              }
              title="Le fatture ignorate escono da riconciliazione e totali"
            >
              <EyeOff className="h-3 w-3 mr-1" />
              {f.stato === "ignorata" ? "Riprendi" : "Ignora"}
            </Button>
          </div>
        </div>

        {collega && (
          <div className="rounded-md border border-border/80 bg-muted/35 p-3 pb-16 sm:pb-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">
                  {f.commessaId != null ? "Sposta fattura" : "Collega fattura"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Destinazione
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={chiudiCollegamento}
                aria-label="Chiudi collegamento"
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
                commesse.isLoading
                  ? "Caricamento commesse…"
                  : "Cerca la commessa…"
              }
              searchPlaceholder="Cerca per codice, cliente o città…"
              emptyText="Nessuna commessa trovata"
            />

            {destinazione && (
              <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-sm">
                <Check className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium truncate">
                  {destinazione.label}
                </span>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-10"
                onClick={chiudiCollegamento}
                disabled={collegaMut.isPending}
              >
                Annulla
              </Button>
              <Button
                type="button"
                className="h-11 sm:h-10"
                disabled={!commessaSelezionata || collegaMut.isPending}
                onClick={() =>
                  collegaMut.mutate({
                    ficId: f.id,
                    commessaId: Number(commessaSelezionata),
                  })
                }
              >
                {collegaMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                {collegaMut.isPending
                  ? "Collegamento in corso…"
                  : "Conferma collegamento"}
              </Button>
            </div>
          </div>
        )}

        {f.propostaTars && <TarsPropostaCard proposta={f.propostaTars} />}
      </CardContent>
    </Card>
  );
}

function Fatture({ anno }: { anno: number }) {
  const q = trpc.ficFatture.list.useQuery({ anno });
  const [filtro, setFiltro] = useState<"tutte" | "da_sistemare">(
    "da_sistemare"
  );
  if (q.isLoading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" />
      </div>
    );
  }
  const rows = (q.data ?? []).filter((f: any) =>
    filtro === "tutte"
      ? true
      : f.stato === "da_riconciliare" ||
        f.stato === "non_abbinabile" ||
        f.stato === "proposta"
  );
  return (
    <div className="space-y-3">
      <Tabs value={filtro} onValueChange={v => setFiltro(v as any)}>
        <TabsList>
          <TabsTrigger value="da_sistemare">Da sistemare</TabsTrigger>
          <TabsTrigger value="tutte">Tutte ({q.data?.length ?? 0})</TabsTrigger>
        </TabsList>
      </Tabs>
      {rows.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {filtro === "da_sistemare"
              ? "Niente da sistemare: tutte le fatture sono riconciliate o in attesa di approvazione."
              : "Nessuna fattura sincronizzata per quest'anno."}
          </CardContent>
        </Card>
      )}
      {rows.map((f: any) => (
        <RigaFattura key={f.id} f={f} />
      ))}
    </div>
  );
}

export default function Economia() {
  const { user } = useAuth();
  const [anno, setAnno] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<"panoramica" | "fatture" | "acquisti">(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return requested === "fatture" || requested === "acquisti"
      ? requested
      : "panoramica";
  });

  // Dati economici: direzione e amministrazione, come da regola server.
  if (user && !isDirezione(user) && !hasRuolo(user, "amministrazione")) {
    return (
      <div className="py-16 text-center text-muted-foreground space-y-2">
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
        <div className="ml-auto flex gap-2 items-center">
          <Select value={String(anno)} onValueChange={v => setAnno(Number(v))}>
            <SelectTrigger
              className="h-9 w-[110px]"
              aria-label="Anno contabile"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[new Date().getFullYear(), new Date().getFullYear() - 1].map(
                a => (
                  <SelectItem key={a} value={String(a)}>
                    {a}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="panoramica">Panoramica</TabsTrigger>
          <TabsTrigger value="fatture">Fatture</TabsTrigger>
          <TabsTrigger value="acquisti">Acquisti</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "panoramica" && <Panoramica anno={anno} />}
      {tab === "fatture" && <Fatture anno={anno} />}
      {tab === "acquisti" && <CostiFicReview anno={anno} />}
    </div>
  );
}
