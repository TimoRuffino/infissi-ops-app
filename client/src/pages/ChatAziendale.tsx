// /chat — la chat interna dell'ufficio.
//
// Due tipi di conversazione, e la differenza conta:
//   Generale  registro di sede. Ci finiscono le azioni che Tars esegue da
//             solo e le decisioni degli operatori sulle proposte. Si legge
//             per sapere cosa è successo, non per chiacchierare.
//   Diretta   fra due persone, o con Tars quando ti assegna qualcosa.
//
// Nessuna sezione decorativa: è una lista di canali, una lista di messaggi e
// una casella di testo. Il refresh è a polling — con i volumi di un ufficio
// di poche persone una connessione dedicata sarebbe infrastruttura per
// niente, e la campanella copre già il caso "CRM chiuso".

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Hash,
  Loader2,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Send,
  Bot,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const INTERVALLO_AGGIORNAMENTO_MS = 5_000;

function oraBreve(valore: string | Date): string {
  const data = new Date(valore);
  const oggi = new Date();
  const stessoGiorno = data.toDateString() === oggi.toDateString();
  return stessoGiorno
    ? data.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : data.toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function iniziali(nome: string): string {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(parola => parola[0]?.toUpperCase() ?? "")
    .join("");
}

function Messaggio({
  messaggio,
  mio,
}: {
  messaggio: any;
  mio: boolean;
}) {
  const diSistema = messaggio.autoreId == null;
  return (
    <div className={cn("flex gap-2.5", mio && "flex-row-reverse")}>
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
          diSistema
            ? "bg-primary/10 text-primary"
            : mio
              ? "bg-primary text-primary-foreground"
              : "bg-surface-2 text-text-2"
        )}
        aria-hidden
      >
        {diSistema ? <Bot className="h-4 w-4" /> : iniziali(messaggio.autoreNome)}
      </span>
      <div className={cn("min-w-0 max-w-[min(42rem,80%)]", mio && "text-right")}>
        <div
          className={cn(
            "flex items-baseline gap-2 flex-wrap",
            mio && "justify-end"
          )}
        >
          <span className="text-xs font-medium">{messaggio.autoreNome}</span>
          <span className="text-[11px] text-text-3">
            {oraBreve(messaggio.createdAt)}
          </span>
        </div>
        <div
          className={cn(
            "mt-1 inline-block rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words text-left",
            diSistema
              ? "bg-surface-2 border border-border"
              : mio
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2"
          )}
        >
          {messaggio.testo}
        </div>
        {(messaggio.commessaId || messaggio.link) && (
          <div className={cn("mt-1 flex gap-2", mio && "justify-end")}>
            <Link
              href={
                messaggio.commessaId
                  ? `/commesse/${messaggio.commessaId}`
                  : messaggio.link
              }
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {messaggio.commessaId ? "Apri commessa" : "Apri"}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatAziendale() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [canaleId, setCanaleId] = useState<number | null>(null);
  const [bozza, setBozza] = useState("");
  const [cercaPersona, setCercaPersona] = useState("");
  const [nuovaChat, setNuovaChat] = useState(false);
  const fondo = useRef<HTMLDivElement | null>(null);

  // `retry: false`: se la chat e' rotta lo si deve vedere subito. Con i retry
  // di default piu' il refetch ogni 5 secondi, un errore persistente teneva
  // `isLoading` sempre vero e la pagina restava a girare senza dire niente —
  // che e' il modo peggiore di fallire.
  const canali = trpc.chat.canali.useQuery(undefined, {
    refetchInterval: INTERVALLO_AGGIORNAMENTO_MS,
    retry: false,
  });
  const interlocutori = trpc.chat.interlocutori.useQuery(undefined, {
    enabled: nuovaChat,
  });

  // Il generale è sempre presente: è il canale che il server garantisce.
  const canaleAttivo = useMemo(() => {
    const elenco = canali.data ?? [];
    return (
      elenco.find(c => c.id === canaleId) ??
      elenco.find(c => c.tipo === "generale") ??
      elenco[0] ??
      null
    );
  }, [canali.data, canaleId]);

  const messaggi = trpc.chat.messaggi.useQuery(
    { canaleId: canaleAttivo?.id ?? 0 },
    {
      enabled: canaleAttivo != null,
      refetchInterval: INTERVALLO_AGGIORNAMENTO_MS,
      retry: false,
    }
  );

  const invia = trpc.chat.invia.useMutation({
    onSuccess: () => {
      setBozza("");
      utils.chat.messaggi.invalidate();
      utils.chat.canali.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const segnaLetto = trpc.chat.segnaLetto.useMutation({
    onSuccess: () => utils.chat.canali.invalidate(),
  });
  const apriDiretta = trpc.chat.apriDiretta.useMutation({
    onSuccess: canale => {
      setCanaleId(canale.id);
      setNuovaChat(false);
      setCercaPersona("");
      utils.chat.canali.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  // Aprire un canale lo marca letto fino all'ultimo messaggio visto.
  const ultimoId = messaggi.data?.[messaggi.data.length - 1]?.id ?? 0;
  useEffect(() => {
    if (!canaleAttivo || ultimoId === 0) return;
    if ((canaleAttivo.nonLetti ?? 0) === 0) return;
    segnaLetto.mutate({ canaleId: canaleAttivo.id, finoAId: ultimoId });
    // `segnaLetto` è stabile per riferimento nella lifetime della pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canaleAttivo?.id, ultimoId, canaleAttivo?.nonLetti]);

  useEffect(() => {
    fondo.current?.scrollIntoView({ block: "end" });
  }, [ultimoId, canaleAttivo?.id]);

  const persone = (interlocutori.data ?? []).filter(p =>
    p.nome.toLowerCase().includes(cercaPersona.trim().toLowerCase())
  );

  const spedisci = () => {
    if (!canaleAttivo || !bozza.trim()) return;
    invia.mutate({ canaleId: canaleAttivo.id, testo: bozza.trim() });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <MessageSquare className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Chat aziendale</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-9"
          onClick={() => setNuovaChat(v => !v)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Nuova conversazione
        </Button>
      </div>

      {nuovaChat && (
        <Card>
          <CardContent className="py-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input
                autoFocus
                value={cercaPersona}
                onChange={e => setCercaPersona(e.target.value)}
                placeholder="Cerca una persona della sede…"
                className="h-9 pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {interlocutori.isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-text-3" />
              )}
              {!interlocutori.isLoading && persone.length === 0 && (
                <p className="text-sm text-text-3 py-1">
                  Nessun altro utente attivo in questa sede.
                </p>
              )}
              {persone.map(p => (
                <Button
                  key={p.id}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9"
                  disabled={apriDiretta.isPending}
                  onClick={() => apriDiretta.mutate({ utenteId: p.id })}
                >
                  {p.nome}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(canali.error || messaggi.error) && (
        <Card className="border-l-[3px] border-l-danger">
          <CardContent className="flex items-start gap-2 py-3">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-danger"
              aria-hidden="true"
            />
            <div className="min-w-0 text-sm">
              <p className="font-medium">La chat non ha risposto.</p>
              <p className="mt-0.5 break-words text-xs text-text-3">
                {canali.error?.message ?? messaggi.error?.message}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        {/* Canali */}
        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardContent className="p-2">
            {canali.isLoading && (
              <div className="py-8 text-center">
                <Loader2 className="h-4 w-4 mx-auto animate-spin text-text-3" />
              </div>
            )}
            {!canali.isLoading && (canali.data ?? []).length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-text-3">
                {canali.error
                  ? "Nessun canale caricato."
                  : "Nessun canale disponibile."}
              </p>
            )}
            <ul className="space-y-0.5">
              {(canali.data ?? []).map(canale => {
                const attivo = canale.id === canaleAttivo?.id;
                return (
                  <li key={canale.id}>
                    <button
                      type="button"
                      onClick={() => setCanaleId(canale.id)}
                      aria-current={attivo ? "true" : undefined}
                      className={cn(
                        "w-full min-w-0 rounded-md px-2.5 py-2 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        attivo ? "bg-surface-2" : "hover:bg-surface-2/60"
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        {canale.tipo === "generale" ? (
                          <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <Hash className="h-3.5 w-3.5 shrink-0 text-text-3" />
                        )}
                        <span className="truncate text-sm font-medium">
                          {canale.nome}
                        </span>
                        {canale.nonLetti > 0 && (
                          <Badge className="ml-auto h-5 shrink-0 px-1.5 text-[10px]">
                            {canale.nonLetti > 9 ? "9+" : canale.nonLetti}
                          </Badge>
                        )}
                      </span>
                      {canale.ultimo && (
                        <span className="mt-0.5 block truncate text-xs text-text-3">
                          {canale.ultimo.testo}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {/* Conversazione */}
        <Card className="min-w-0">
          <CardContent className="flex h-[min(70vh,40rem)] flex-col gap-3 p-3">
            <div className="flex items-center gap-2 border-b border-border/60 pb-2">
              {canaleAttivo?.tipo === "generale" ? (
                <Pin className="h-4 w-4 text-primary" />
              ) : (
                <Hash className="h-4 w-4 text-text-3" />
              )}
              <span className="text-sm font-semibold truncate">
                {canaleAttivo?.nome ?? "—"}
              </span>
              {canaleAttivo?.tipo === "generale" && (
                <span className="text-xs text-text-3 truncate">
                  approvazioni e azioni automatiche di Tars
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {messaggi.isLoading && (
                <div className="py-8 text-center">
                  <Loader2 className="h-4 w-4 mx-auto animate-spin text-text-3" />
                </div>
              )}
              {!messaggi.isLoading && (messaggi.data ?? []).length === 0 && (
                <p className="py-8 text-center text-sm text-text-3">
                  Nessun messaggio in questa conversazione.
                </p>
              )}
              {(messaggi.data ?? []).map(m => (
                <Messaggio
                  key={m.id}
                  messaggio={m}
                  mio={m.autoreId != null && m.autoreId === user?.id}
                />
              ))}
              <div ref={fondo} />
            </div>

            <div className="flex items-end gap-2 border-t border-border/60 pt-2">
              <Textarea
                value={bozza}
                onChange={e => setBozza(e.target.value)}
                onKeyDown={e => {
                  // Invio manda, Maiusc+Invio va a capo: è la convenzione che
                  // tutti si aspettano da una chat.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    spedisci();
                  }
                }}
                placeholder={`Scrivi in ${canaleAttivo?.nome ?? "…"}`}
                rows={2}
                className="min-h-[2.75rem] resize-none"
                disabled={!canaleAttivo}
              />
              <Button
                type="button"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Invia messaggio"
                disabled={!canaleAttivo || !bozza.trim() || invia.isPending}
                onClick={spedisci}
              >
                {invia.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
