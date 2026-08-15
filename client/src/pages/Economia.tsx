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
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MESI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

const STATO_FATTURA: Record<string, { label: string; classe: string }> = {
  riconciliata: { label: "Riconciliata", classe: "bg-green-600 hover:bg-green-600" },
  proposta: { label: "Proposta in attesa", classe: "bg-amber-500 hover:bg-amber-500" },
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
            accent === "verde" && "text-green-600 dark:text-green-500",
            accent === "rosso" && "text-red-600 dark:text-red-500",
            accent === "ambra" && "text-amber-600 dark:text-amber-500"
          )}
        >
          {value}
        </div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
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
    ...d.mesi.map((m) => Math.max(m.fatturato, m.incassi, m.costi))
  );

  return (
    <div className="space-y-4">
      {/* Commesse (CRM) */}
      <div>
        <h3 className="text-sm font-medium mb-2">
          Commesse attive ({d.crm.commesseAttive}, con pattuito{" "}
          {d.crm.commesseConPattuito})
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <Kpi label="Pattuito" value={formatEuroSimbolo(d.crm.pattuito)} />
          <Kpi
            label="Incassato"
            value={formatEuroSimbolo(d.crm.incassato)}
            accent="verde"
          />
          <Kpi
            label="Da incassare"
            value={formatEuroSimbolo(d.crm.residuo)}
            accent="ambra"
          />
          <Kpi
            label="Costi fornitore"
            value={formatEuroSimbolo(d.crm.costiFornitore)}
            accent="rosso"
          />
          <Kpi
            label="Costo posa"
            value={formatEuroSimbolo(d.crm.costoPosa)}
            accent="rosso"
          />
          <Kpi
            label="Margine lordo"
            value={formatEuroSimbolo(d.crm.margineLordo)}
            hint={
              d.crm.marginePerc != null
                ? `${Math.round(d.crm.marginePerc * 100)}% del pattuito`
                : undefined
            }
            accent={d.crm.margineLordo >= 0 ? "verde" : "rosso"}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Margine calcolato solo sulle commesse col pattuito: se i costi non
          sono registrati, i numeri sono ottimisti. Il dettaglio per commessa è
          in Marginalità.
        </p>
      </div>

      {/* Fatturazione (FIC) */}
      <div>
        <h3 className="text-sm font-medium mb-2">
          Fatturazione {anno} ({d.fic.fatture} fatture)
        </h3>
        {d.fic.disponibile ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kpi label="Fatturato" value={formatEuroSimbolo(d.fic.fatturato)} />
            <Kpi
              label="Incassato (FIC)"
              value={formatEuroSimbolo(d.fic.incassato)}
              accent="verde"
            />
            <Kpi
              label="Da incassare (FIC)"
              value={formatEuroSimbolo(d.fic.daIncassare)}
              accent="ambra"
            />
            <Kpi
              label="Da riconciliare"
              value={String(d.fic.daRiconciliare)}
              hint="fatture senza riscontro nel CRM"
              accent={d.fic.daRiconciliare > 0 ? "ambra" : undefined}
            />
          </div>
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground text-center">
              Nessuna fattura sincronizzata. Configura Fatture in Cloud in
              Impostazioni e premi «Sincronizza ora».
            </CardContent>
          </Card>
        )}
      </div>

      {/* Andamento mensile */}
      <div>
        <h3 className="text-sm font-medium mb-2">Andamento {anno}</h3>
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
                  <th className="text-right font-normal">Fatturato</th>
                  <th className="text-right font-normal">Incassi</th>
                  <th className="text-right font-normal">Costi</th>
                  <th className="w-1/3"></th>
                </tr>
              </thead>
              <tbody>
                {d.mesi.map((m) => (
                  <tr key={m.mese} className="border-t">
                    <td className="py-1.5">{MESI[m.mese - 1]}</td>
                    <td className="text-right tabular-nums">
                      {m.fatturato ? formatEuroSimbolo(m.fatturato) : "—"}
                    </td>
                    <td className="text-right tabular-nums text-green-600 dark:text-green-500">
                      {m.incassi ? formatEuroSimbolo(m.incassi) : "—"}
                    </td>
                    <td className="text-right tabular-nums text-red-600 dark:text-red-500">
                      {m.costi ? formatEuroSimbolo(m.costi) : "—"}
                    </td>
                    <td className="pl-3">
                      <div className="flex gap-0.5 h-3 items-end">
                        <div
                          className="bg-primary/60 w-1/3 rounded-sm"
                          style={{ height: `${(m.fatturato / maxRiga) * 100}%` }}
                        />
                        <div
                          className="bg-green-500/70 w-1/3 rounded-sm"
                          style={{ height: `${(m.incassi / maxRiga) * 100}%` }}
                        />
                        <div
                          className="bg-red-500/70 w-1/3 rounded-sm"
                          style={{ height: `${(m.costi / maxRiga) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RigaFattura({ f }: { f: any }) {
  const utils = trpc.useUtils();
  const [collega, setCollega] = useState(false);
  const commesse = trpc.commesse.list.useQuery(undefined, { enabled: collega });

  const collegaMut = trpc.ficFatture.collega.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.proposteCreate > 0
          ? `Collegata e PDF allegato — ${r.proposteCreate} proposte da approvare in Tars`
          : "Collegata e PDF allegato alla commessa"
      );
      setCollega(false);
      utils.ficFatture.invalidate();
      utils.economia.invalidate();
      utils.preventiviContratti.invalidate();
      utils.tars.proposte.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const ignoraMut = trpc.ficFatture.ignora.useMutation({
    onSuccess: () => {
      utils.ficFatture.invalidate();
      utils.economia.invalidate();
    },
    onError: (e) => toast.error(e.message),
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
              <span className="text-xs text-muted-foreground italic">{f.motivo}</span>
            )
          )}
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setCollega((v) => !v)}
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
                ignoraMut.mutate({ ficId: f.id, ignorata: f.stato !== "ignorata" })
              }
              title="Le fatture ignorate escono da riconciliazione e totali"
            >
              <EyeOff className="h-3 w-3 mr-1" />
              {f.stato === "ignorata" ? "Riprendi" : "Ignora"}
            </Button>
          </div>
        </div>

        {collega && (
          <SearchSelect
            value={f.commessaId != null ? String(f.commessaId) : null}
            onChange={(v: string) =>
              collegaMut.mutate({ ficId: f.id, commessaId: Number(v) })
            }
            options={(commesse.data ?? []).map((cm: any) => ({
              value: String(cm.id),
              label: `${cm.codice} — ${cm.cliente}`,
              keywords: cm.citta ?? "",
            }))}
            placeholder="Cerca la commessa…"
          />
        )}
      </CardContent>
    </Card>
  );
}

function Fatture({ anno }: { anno: number }) {
  const q = trpc.ficFatture.list.useQuery({ anno });
  const [filtro, setFiltro] = useState<"tutte" | "da_sistemare">("da_sistemare");
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
      : f.stato === "da_riconciliare" || f.stato === "non_abbinabile" || f.stato === "proposta"
  );
  return (
    <div className="space-y-3">
      <Tabs value={filtro} onValueChange={(v) => setFiltro(v as any)}>
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
  const [tab, setTab] = useState<"panoramica" | "fatture">("panoramica");

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

  const anni = [anno, anno - 1, anno - 2].filter(
    (a, i, arr) => arr.indexOf(a) === i
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Landmark className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Contabilità</h1>
        <div className="ml-auto flex gap-2 items-center">
          <Select value={String(anno)} onValueChange={(v) => setAnno(Number(v))}>
            <SelectTrigger className="h-9 w-[110px]" aria-label="Anno contabile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[new Date().getFullYear(), new Date().getFullYear() - 1].map((a) => (
                <SelectItem key={a} value={String(a)}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="panoramica">Panoramica</TabsTrigger>
          <TabsTrigger value="fatture">Fatture</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "panoramica" ? <Panoramica anno={anno} /> : <Fatture anno={anno} />}
    </div>
  );
}
