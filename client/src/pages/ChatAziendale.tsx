// /chat — la chat interna dell'ufficio.
//
// Due tipi di conversazione, e la differenza conta:
//   Generale  registro di sede. Ci finiscono le azioni che Tars esegue da
//             solo e le decisioni degli operatori sulle proposte. Si legge
//             per sapere cosa è successo, non per chiacchierare.
//   Diretta   fra due persone, di qualunque sede. Non appartiene a uno
//             showroom: segue le persone.
//
// Il refresh è a polling — con i volumi di un ufficio di poche persone una
// connessione dedicata sarebbe infrastruttura per niente.

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
  Bot,
  ExternalLink,
  Hash,
  Loader2,
  MessageSquare,
  Pin,
  Plus,
  Search,
  Send,
  SmilePlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const INTERVALLO_AGGIORNAMENTO_MS = 5_000;
const EMOJI = ["👍", "🎉", "😂", "❤️", "👀", "🙏"] as const;

// Sei tinte distinguibili anche da chi confonde rosso e verde, tutte leggibili
// sul chiaro e sullo scuro. L'avatar non è decorazione: in una lista di
// messaggi il colore è ciò che fa riconoscere l'autore prima di leggerne il
// nome.
const TINTE = [
  "bg-[#2F6F4E] text-white",
  "bg-[#1F5E86] text-white",
  "bg-[#7A3E8F] text-white",
  "bg-[#A8541B] text-white",
  "bg-[#8A1F3D] text-white",
  "bg-[#3F4C8C] text-white",
];

function tintaPer(nome: string): string {
  let hash = 0;
  for (let i = 0; i < nome.length; i++) {
    hash = (hash * 31 + nome.charCodeAt(i)) >>> 0;
  }
  return TINTE[hash % TINTE.length];
}

function iniziali(nome: string): string {
  return (
    nome
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(parola => parola[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function ora(valore: string | Date): string {
  return new Date(valore).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function etichettaGiorno(valore: string | Date): string {
  const data = new Date(valore);
  const oggi = new Date();
  const ieri = new Date(oggi);
  ieri.setDate(oggi.getDate() - 1);
  if (data.toDateString() === oggi.toDateString()) return "Oggi";
  if (data.toDateString() === ieri.toDateString()) return "Ieri";
  return data.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function Avatar({ nome, sistema }: { nome: string; sistema: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
        sistema ? "bg-primary/15 text-primary" : tintaPer(nome)
      )}
    >
      {sistema ? <Bot className="h-4 w-4" /> : iniziali(nome)}
    </span>
  );
}

function Messaggio({
  messaggio,
  mio,
  attaccato,
  ioId,
}: {
  messaggio: any;
  mio: boolean;
  /** Segue un messaggio dello stesso autore: niente avatar né nome. */
  attaccato: boolean;
  ioId: number | null;
}) {
  const utils = trpc.useUtils();
  const [aperto, setAperto] = useState(false);
  const diSistema = messaggio.autoreId == null;
  const reazioni: Record<string, number[]> = messaggio.reazioni ?? {};

  const reagisci = trpc.chat.reagisci.useMutation({
    onSuccess: () => {
      utils.chat.messaggi.invalidate();
      setAperto(false);
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className={cn("group flex gap-2.5", attaccato ? "mt-0.5" : "mt-3")}>
      {attaccato ? (
        <span className="w-8 shrink-0" aria-hidden="true" />
      ) : (
        <Avatar nome={messaggio.autoreNome} sistema={diSistema} />
      )}

      <div className="min-w-0 flex-1">
        {!attaccato && (
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xs font-semibold">
              {messaggio.autoreNome}
            </span>
            <span className="text-[11px] text-text-3">
              {ora(messaggio.createdAt)}
            </span>
          </div>
        )}

        <div className="flex items-start gap-1.5">
          <div
            className={cn(
              "min-w-0 max-w-[min(44rem,100%)] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
              diSistema
                ? "border border-border bg-surface-2"
                : mio
                  ? "bg-primary/10"
                  : "bg-surface-2"
            )}
          >
            {messaggio.testo}
          </div>

          {/* Il comando compare all'hover su desktop e resta sempre
              raggiungibile da tastiera e su touch. */}
          <div className="relative shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Aggiungi una reazione"
              aria-expanded={aperto}
              className="h-7 w-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-60"
              onClick={() => setAperto(v => !v)}
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </Button>
            {aperto && (
              <div className="absolute right-0 top-8 z-10 flex gap-0.5 rounded-md border border-border bg-surface p-1 shadow-md">
                {EMOJI.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Reagisci con ${emoji}`}
                    className="grid h-8 w-8 place-items-center rounded hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      reagisci.mutate({
                        messaggioId: messaggio.id,
                        emoji,
                      })
                    }
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {Object.keys(reazioni).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(reazioni).map(([emoji, ids]) => {
              const mia = ioId != null && ids.includes(ioId);
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={mia}
                  aria-label={`${emoji}, ${ids.length} ${ids.length === 1 ? "persona" : "persone"}`}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs tabular-nums",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mia
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-surface-2 hover:bg-surface-2/70"
                  )}
                  onClick={() =>
                    reagisci.mutate({
                      messaggioId: messaggio.id,
                      emoji: emoji as any,
                    })
                  }
                >
                  <span>{emoji}</span>
                  <span className="text-text-3">{ids.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {(messaggio.commessaId || messaggio.link) && (
          <Link
            href={
              messaggio.commessaId
                ? `/commesse/${messaggio.commessaId}`
                : messaggio.link
            }
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {messaggio.commessaId ? "Apri commessa" : "Apri"}
          </Link>
        )}
      </div>
    </div>
  );
}

export default function ChatAziendale() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const ioId = user?.id ?? null;
  const [canaleId, setCanaleId] = useState<number | null>(null);
  const [bozza, setBozza] = useState("");
  const [cercaPersona, setCercaPersona] = useState("");
  const [nuovaChat, setNuovaChat] = useState(false);
  const fondo = useRef<HTMLDivElement | null>(null);

  const canali = trpc.chat.canali.useQuery(undefined, {
    refetchInterval: INTERVALLO_AGGIORNAMENTO_MS,
    retry: false,
  });
  const interlocutori = trpc.chat.interlocutori.useQuery(undefined, {
    enabled: nuovaChat,
  });

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
      utils.chat.nonLetti.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const segnaLetto = trpc.chat.segnaLetto.useMutation({
    onSuccess: () => {
      utils.chat.canali.invalidate();
      utils.chat.nonLetti.invalidate();
    },
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

  const ultimoId = messaggi.data?.[messaggi.data.length - 1]?.id ?? 0;
  useEffect(() => {
    if (!canaleAttivo || ultimoId === 0) return;
    if ((canaleAttivo.nonLetti ?? 0) === 0) return;
    segnaLetto.mutate({ canaleId: canaleAttivo.id, finoAId: ultimoId });
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

  // Un messaggio è "attaccato" al precedente quando è dello stesso autore
  // entro cinque minuti: senza, una risposta di tre righe diventa tre
  // intestazioni identiche e la conversazione si legge come un registro.
  const righe = useMemo(() => {
    const elenco = messaggi.data ?? [];
    let giornoCorrente = "";
    return elenco.map((m, i) => {
      const precedente = i > 0 ? elenco[i - 1] : null;
      const giorno = etichettaGiorno(m.createdAt);
      const nuovoGiorno = giorno !== giornoCorrente;
      giornoCorrente = giorno;
      const vicino =
        precedente != null &&
        new Date(m.createdAt).getTime() -
          new Date(precedente.createdAt).getTime() <
          5 * 60_000;
      return {
        messaggio: m,
        giorno: nuovoGiorno ? giorno : null,
        attaccato:
          !nuovoGiorno &&
          vicino &&
          precedente?.autoreId === m.autoreId &&
          precedente?.autoreNome === m.autoreNome,
      };
    });
  }, [messaggi.data]);

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
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                aria-hidden="true"
              />
              <Input
                autoFocus
                value={cercaPersona}
                onChange={e => setCercaPersona(e.target.value)}
                placeholder="Cerca una persona…"
                className="h-10 pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {interlocutori.isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-text-3" />
              )}
              {!interlocutori.isLoading && persone.length === 0 && (
                <p className="py-1 text-sm text-text-3">
                  Nessun altro utente attivo.
                </p>
              )}
              {persone.map(p => (
                <Button
                  key={p.id}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 justify-start gap-2 px-2.5 py-1.5"
                  disabled={apriDiretta.isPending}
                  onClick={() => apriDiretta.mutate({ utenteId: p.id })}
                >
                  <Avatar nome={p.nome} sistema={false} />
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-xs font-medium">
                      {p.nome}
                    </span>
                    {/* La sede compare solo quando è diversa dalla tua: è
                        l'informazione che spiega perché non la incroci. */}
                    {p.sede && (
                      <span className="block truncate text-[11px] font-normal text-text-3">
                        {p.sede}
                      </span>
                    )}
                  </span>
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
                const diretta = canale.tipo === "diretto";
                return (
                  <li key={canale.id}>
                    <button
                      type="button"
                      onClick={() => setCanaleId(canale.id)}
                      aria-current={attivo ? "true" : undefined}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        attivo ? "bg-surface-2" : "hover:bg-surface-2/60"
                      )}
                    >
                      {diretta ? (
                        <Avatar
                          nome={canale.nome}
                          sistema={canale.altroUtenteId === 0}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
                        >
                          <Pin className="h-4 w-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "truncate text-sm",
                              canale.nonLetti > 0
                                ? "font-semibold"
                                : "font-medium"
                            )}
                          >
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
                            {canale.ultimo.autoreNome.split(" ")[0]}:{" "}
                            {canale.ultimo.testo}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardContent className="flex h-[min(70vh,42rem)] flex-col gap-3 p-3">
            <div className="flex items-center gap-2 border-b border-border/60 pb-2">
              {canaleAttivo?.tipo === "diretto" ? (
                <Avatar
                  nome={canaleAttivo.nome}
                  sistema={canaleAttivo.altroUtenteId === 0}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
                >
                  <Hash className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {canaleAttivo?.nome ?? "—"}
                </p>
                {canaleAttivo?.tipo === "generale" && (
                  <p className="truncate text-[11px] text-text-3">
                    Approvazioni e azioni automatiche di Tars
                  </p>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {messaggi.isLoading && (
                <div className="py-8 text-center">
                  <Loader2 className="h-4 w-4 mx-auto animate-spin text-text-3" />
                </div>
              )}
              {!messaggi.isLoading && righe.length === 0 && (
                <p className="py-10 text-center text-sm text-text-3">
                  Ancora nessun messaggio. Scrivi il primo.
                </p>
              )}
              {righe.map(({ messaggio, giorno, attaccato }) => (
                <div key={messaggio.id}>
                  {giorno && (
                    <div className="my-3 flex items-center gap-3">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">
                        {giorno}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  <Messaggio
                    messaggio={messaggio}
                    mio={
                      messaggio.autoreId != null && messaggio.autoreId === ioId
                    }
                    attaccato={attaccato}
                    ioId={ioId}
                  />
                </div>
              ))}
              <div ref={fondo} />
            </div>

            <div className="flex items-end gap-2 border-t border-border/60 pt-2">
              <Textarea
                value={bozza}
                onChange={e => setBozza(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    spedisci();
                  }
                }}
                placeholder={
                  canaleAttivo
                    ? `Scrivi a ${canaleAttivo.nome}… (Invio manda, Maiusc+Invio va a capo)`
                    : "…"
                }
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
