// /economia — la situazione contabile dell'azienda in una pagina.
//
// Panoramica contabile, riconciliazione fatture e revisione acquisti FiC.
// Le rate incassate diventano proposte da approvare — mai scritture
// automatiche.

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
import EconomiaPanoramica from "@/components/economia/EconomiaPanoramica";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasRuolo, isDirezione } from "@/lib/roles";
import { formatEuroSimbolo } from "@/lib/euro";
import {
  Landmark,
  Link2,
  Loader2,
  EyeOff,
  ShieldAlert,
  Check,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  ignorata: { label: "Esclusa dalla riconciliazione", classe: "" },
};

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
    <Card className={cn(f.stato === "ignorata" && "border-dashed")}>
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
              title="Esclude solo dalla riconciliazione: la fattura resta nei totali FiC"
            >
              <EyeOff className="h-3 w-3 mr-1" />
              {f.stato === "ignorata"
                ? "Riprendi riconciliazione"
                : "Escludi dalla riconciliazione"}
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

      {tab === "panoramica" && <EconomiaPanoramica anno={anno} />}
      {tab === "fatture" && <Fatture anno={anno} />}
      {tab === "acquisti" && <CostiFicReview anno={anno} />}
    </div>
  );
}
