// /inbox — la coda proposte di Tars, più il registro esecuzioni (direzione).
// La sessione dedicata del mattino: decidere tutto in pochi click.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TarsPropostaCard from "@/components/TarsPropostaCard";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { Bot, History, Inbox } from "lucide-react";
import { Link } from "wouter";

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
  const rows = (proposte.data ?? []).filter(
    (p: any) => (stato ? true : p.stato !== "pendente")
  );

  if (proposte.isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Caricamento…</p>;
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
        <div key={p.id} className="space-y-1">
          <LinkCommessa commessaId={p.commessaId} />
          <TarsPropostaCard proposta={p} />
        </div>
      ))}
    </div>
  );
}

function RegistroEsecuzioni() {
  const esecuzioni = trpc.tars.esecuzioni.list.useQuery({ limit: 30 });
  const rows = esecuzioni.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Nessuna esecuzione registrata.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((e: any) => (
        <Card key={e.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm flex items-center gap-2">
                Esecuzione #{e.id}
                <Badge variant={e.esito === "ok" ? "secondary" : "destructive"}>
                  {e.esito}
                </Badge>
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {new Date(e.createdAt).toLocaleString("it-IT")} ·{" "}
                {Math.round(e.durataMs / 1000)}s · {e.strumenti.length} strumenti ·{" "}
                {e.tokensIn + e.tokensOut} token
                {e.utenteNome ? ` · ${e.utenteNome}` : ""}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <LinkCommessa commessaId={e.commessaId} />
            {e.riepilogo && (
              <p className="whitespace-pre-wrap text-muted-foreground">{e.riepilogo}</p>
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
                      <span className="opacity-70">{JSON.stringify(s.input)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function TarsInbox() {
  const { user } = useAuth();
  const stats = trpc.tars.proposte.stats.useQuery();
  const direzione = isDirezione(user);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Tars — Proposte</h1>
        {(stats.data?.pendenti ?? 0) > 0 && (
          <Badge>{stats.data!.pendenti} in attesa</Badge>
        )}
      </div>

      <Tabs defaultValue="pendenti">
        <TabsList>
          <TabsTrigger value="pendenti">In attesa</TabsTrigger>
          <TabsTrigger value="decise">Decise</TabsTrigger>
          {direzione && (
            <TabsTrigger value="registro">
              <History className="h-3.5 w-3.5 mr-1" />
              Registro
            </TabsTrigger>
          )}
        </TabsList>
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
