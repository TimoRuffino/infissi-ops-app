// /inbox — la coda proposte di Tars, più il registro esecuzioni (direzione).
// La sessione dedicata del mattino: decidere tutto in pochi click.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TarsPropostaCard from "@/components/TarsPropostaCard";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  History,
  Inbox,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";
import TarsAvatar from "@/components/TarsAvatar";
import { TarsChatPanel } from "@/components/TarsChat";
import { toast } from "sonner";
import { metricheUtilizzoTars } from "@/lib/tarsUsage";

const numeroCompatto = new Intl.NumberFormat("it-IT", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function costoBreve(value: number) {
  if (value === 0) return "$0";
  if (value < 0.01) return `<$0,01`;
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function dataBreve(value: Date | string | null | undefined) {
  if (!value) return "Mai";
  const d = new Date(value);
  const ore = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (ore < 1) return "Adesso";
  if (ore < 24) return `${ore}h fa`;
  const giorni = Math.floor(ore / 24);
  if (giorni < 7) return `${giorni}g fa`;
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

function Indicatore({
  icona: Icona,
  etichetta,
  valore,
  dettaglio,
}: {
  icona: typeof Activity;
  etichetta: string;
  valore: string | number;
  dettaglio: string;
}) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icona className="h-3.5 w-3.5 text-primary" />
        <span>{etichetta}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-foreground">
          {valore}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {dettaglio}
        </span>
      </div>
    </div>
  );
}

function LinkCommessa({ commessaId }: { commessaId: number | null }) {
  const commessa = trpc.commesse.byId.useQuery(commessaId ?? 0, {
    enabled: commessaId != null,
  });
  if (commessaId == null) return null;
  return (
    <Link
      href={`/commesse/${commessaId}`}
      className="text-xs text-primary hover:underline"
    >
      {commessa.data?.codice ?? `Commessa #${commessaId}`}
      {commessa.data?.cliente ? ` · ${commessa.data.cliente}` : ""}
    </Link>
  );
}

function ElencoProposte({ stato }: { stato?: "pendente" }) {
  const proposte = trpc.tars.proposte.list.useQuery(
    stato ? { stato } : undefined
  );
  const rows = (proposte.data ?? []).filter((p: any) =>
    stato ? true : p.stato !== "pendente"
  );

  if (proposte.isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Caricamento…
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">
          {stato === "pendente"
            ? "Nessuna proposta in attesa. Tars non ha nulla da chiederti."
            : "Ancora nessuna decisione registrata."}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((p: any) => (
        <TarsPropostaCard key={p.id} proposta={p} />
      ))}
    </div>
  );
}

function RegistroEsecuzioni() {
  const esecuzioni = trpc.tars.esecuzioni.list.useQuery({ limit: 30 });
  const rows = esecuzioni.data ?? [];
  if (esecuzioni.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Caricamento registro…
      </div>
    );
  }
  if (esecuzioni.isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-8 text-center">
        <p className="text-sm font-medium text-destructive">
          Il registro di Tars non è disponibile
        </p>
        <p className="max-w-lg text-xs text-muted-foreground">
          {esecuzioni.error.message}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => esecuzioni.refetch()}
          disabled={esecuzioni.isFetching}
        >
          <RefreshCw
            className={`h-4 w-4 ${esecuzioni.isFetching ? "animate-spin" : ""}`}
          />
          Riprova
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Nessuna esecuzione registrata.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((e: any) => {
        const uso = metricheUtilizzoTars(e);
        return (
          <Card key={e.id} className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm flex items-center gap-2">
                  Esecuzione #{e.id}
                  <Badge
                    variant={e.esito === "ok" ? "secondary" : "destructive"}
                  >
                    {e.esito}
                  </Badge>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString("it-IT")} ·{" "}
                  {Math.round(e.durataMs / 1000)}s
                  {e.fascicoloPrecaricato ? " · fascicolo pronto" : ""}
                  {e.toolCacheHits > 0
                    ? ` · ${e.toolCacheHits} letture riusate`
                    : ""}
                  {e.proposteDuplicateBloccate > 0
                    ? ` · ${e.proposteDuplicateBloccate} doppioni bloccati`
                    : ""}
                  {e.utenteNome ? ` · ${e.utenteNome}` : ""}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-muted/55 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{e.modello}</span>
                <span>{e.strumenti.length} strumenti</span>
                <span>{numeroCompatto.format(uso.tokenTotali)} token</span>
                <span>{uso.cacheReadPercent}% dalla cache</span>
                {uso.cacheWrite > 0 && (
                  <span>
                    {numeroCompatto.format(uso.cacheWrite)} scritti in cache
                  </span>
                )}
                <span>{costoBreve(e.costoStimatoUsd)}</span>
                {e.profiloStrumenti && (
                  <span>profilo {e.profiloStrumenti}</span>
                )}
              </div>
              <LinkCommessa commessaId={e.commessaId} />
              {e.riepilogo && (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {e.riepilogo}
                </p>
              )}
              {e.errore && <p className="text-destructive">{e.errore}</p>}
              {e.strumenti.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    Strumenti chiamati
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-4 list-disc">
                    {e.strumenti.map((s: any, i: number) => (
                      <li key={i}>
                        <span className="font-mono">{s.nome}</span>
                        {"  "}
                        <span className="opacity-70">
                          {JSON.stringify(s.input)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function TarsInbox() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const stats = trpc.tars.proposte.stats.useQuery();
  const config = trpc.tars.config.get.useQuery(undefined, { retry: false });
  const direzione = isDirezione(user);
  const audit = trpc.tars.auditProcessi.esegui.useMutation({
    onSuccess: risultato => {
      toast.success(
        risultato.proposte.length > 0
          ? `${risultato.proposte.length} miglioramenti pronti da valutare`
          : "Audit completato: nessun nuovo miglioramento necessario"
      );
      utils.tars.invalidate();
    },
    onError: errore => toast.error(errore.message),
  });
  const attivo = config.data?.attivo ?? false;
  const auditAttivo = config.data?.auditProcessiAttivo ?? false;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <TarsAvatar size="lg" className="h-11 w-11" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold leading-tight">Tars</h1>
              <span
                className={`h-2 w-2 rounded-full ${attivo ? "bg-success" : "bg-muted-foreground"}`}
                aria-label={attivo ? "Tars attivo" : "Tars spento"}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Cervello operativo della sede
            </p>
          </div>
          {(stats.data?.pendenti ?? 0) > 0 && (
            <Badge>{stats.data!.pendenti} in attesa</Badge>
          )}
        </div>
        {direzione && (
          <Button
            variant="outline"
            disabled={!attivo || !auditAttivo || audit.isPending}
            onClick={() => audit.mutate()}
          >
            {audit.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Analizza i processi
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-4 lg:divide-x lg:divide-border">
        <Indicatore
          icona={Inbox}
          etichetta="Da decidere"
          valore={stats.data?.pendenti ?? 0}
          dettaglio={`${stats.data?.miglioramentiPendenti ?? 0} sui processi`}
        />
        <Indicatore
          icona={CheckCircle2}
          etichetta="Affidabilità"
          valore={
            stats.data?.tassoApprovazione != null
              ? `${stats.data.tassoApprovazione}%`
              : "—"
          }
          dettaglio={`${stats.data?.decisioni90Giorni ?? 0} decisioni`}
        />
        <Indicatore
          icona={ShieldCheck}
          etichetta="Doppioni evitati"
          valore={stats.data?.duplicatiBloccati ?? 0}
          dettaglio="prima della coda"
        />
        <Indicatore
          icona={Clock3}
          etichetta="Ultimo audit"
          valore={dataBreve(config.data?.ultimoAuditProcessiAt)}
          dettaglio={auditAttivo ? "automatico" : "disattivato"}
        />
      </div>

      <Tabs defaultValue="chat">
        <TabsList
          className={
            direzione
              ? "grid w-full grid-cols-4 sm:w-fit"
              : "grid w-full grid-cols-3 sm:w-fit"
          }
        >
          <TabsTrigger
            value="chat"
            className="min-w-0 gap-1 px-1.5 text-xs sm:px-3 sm:text-sm"
          >
            <MessageCircle className="hidden h-3.5 w-3.5 shrink-0 min-[360px]:block" />
            Chat
          </TabsTrigger>
          <TabsTrigger
            value="pendenti"
            className="min-w-0 gap-1 px-1.5 text-xs sm:px-3 sm:text-sm"
          >
            <BrainCircuit className="hidden h-3.5 w-3.5 shrink-0 min-[360px]:block" />
            Decisioni
            {(stats.data?.pendenti ?? 0) > 0 && (
              <Badge className="ml-0.5 hidden h-4 min-w-4 px-1 text-[10px] min-[360px]:inline-flex">
                {stats.data!.pendenti}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="decise"
            className="min-w-0 gap-1 px-1.5 text-xs sm:px-3 sm:text-sm"
          >
            <CheckCircle2 className="hidden h-3.5 w-3.5 shrink-0 min-[360px]:block" />
            Storico
          </TabsTrigger>
          {direzione && (
            <TabsTrigger
              value="registro"
              className="min-w-0 gap-1 px-1.5 text-xs sm:px-3 sm:text-sm"
            >
              <History className="hidden h-3.5 w-3.5 shrink-0 min-[360px]:block" />
              Registro
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="chat" className="mt-4">
          <div className="flex h-[calc(100dvh-25rem)] min-h-[360px] flex-col overflow-hidden rounded-lg border bg-card shadow-xs sm:h-[calc(100dvh-21rem)] sm:min-h-[420px]">
            <TarsChatPanel className="flex-1" />
          </div>
        </TabsContent>
        <TabsContent value="pendenti" className="mt-4">
          <ElencoProposte stato="pendente" />
        </TabsContent>
        <TabsContent value="decise" className="mt-4">
          <ElencoProposte />
        </TabsContent>
        {direzione && (
          <TabsContent value="registro" className="mt-4">
            <RegistroEsecuzioni />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
