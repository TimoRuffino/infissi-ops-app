// /chat — la chat interna dell'ufficio.
//
// Due tipi di conversazione, e la differenza conta:
//   Generale  registro di sede. Nato per le azioni dell'agente (rimosso il
//             28/08/2026); oggi è il canale comune della sede. Si legge
//             per sapere cosa è successo, non per chiacchierare.
//   Diretta   fra due persone, di qualunque sede. Non appartiene a uno
//             showroom: segue le persone.
//
// Chat e notifiche sono due code distinte e restano tali: qui si discute e si
// risponde, nel Centro azioni (/notifiche) c'è quello che qualcuno deve fare.
// Una conversazione non è un compito, e una notifica non si commenta.
//
// Il refresh è a polling — con i volumi di un ufficio di poche persone una
// connessione dedicata sarebbe infrastruttura per niente.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/patterns/PageHeader";
import StatePanel from "@/components/patterns/StatePanel";
import {
  ArrowLeft,
  Bell,
  Bot,
  ExternalLink,
  Hash,
  Loader2,
  Plus,
  Search,
  Send,
  SmilePlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const INTERVALLO_AGGIORNAMENTO_MS = 5_000;
const EMOJI = ["👍", "🎉", "😂", "❤️", "👀", "🙏"] as const;

// Sotto i 1024px il workspace mostra un pane alla volta: elenco → conversazione.
const SINGLE_PANE_QUERY = "(max-width: 1023px)";

// Sei famiglie semantiche ad alto contrasto, già in coppia fondo/testo: la
// tinta esce dai token del sistema, non da un hex locale. Insieme alle
// iniziali aiutano a riconoscere l'autore senza dipendere dal solo colore.
const TINTE = [
  "bg-success text-on-success",
  "bg-info text-on-info",
  "bg-mora text-on-mora",
  "bg-warning text-on-warning",
  "bg-brand text-on-brand",
  "bg-focal text-on-focal",
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

function useMediaMatch(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
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

  const emojiPicker = (
    <div className="relative shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Aggiungi una reazione"
        aria-expanded={aperto}
        className="h-11 w-11 opacity-60 transition-opacity focus-visible:opacity-100 sm:h-8 sm:w-8 sm:opacity-0 sm:group-hover:opacity-100"
        onClick={() => setAperto(v => !v)}
      >
        <SmilePlus className="h-4 w-4" />
      </Button>
      {aperto && (
        <div
          className={cn(
            "absolute top-11 z-10 flex gap-0.5 rounded-[var(--radius-control)] border border-border-soft bg-surface p-1 shadow-[var(--shadow-floating)] sm:top-8",
            // Ancorato dal lato del messaggio, così non esce mai dallo schermo.
            mio ? "left-0" : "right-0"
          )}
        >
          {EMOJI.map(emoji => (
            <button
              key={emoji}
              type="button"
              aria-label={`Reagisci con ${emoji}`}
              className="grid h-11 w-11 place-items-center rounded-[var(--radius-control)] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-9"
              onClick={() =>
                reagisci.mutate({ messaggioId: messaggio.id, emoji })
              }
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        "group flex min-w-0 gap-2.5",
        attaccato ? "mt-0.5" : "mt-3",
        // I miei messaggi a destra, quelli degli altri a sinistra: è la
        // convenzione di ogni chat, e senza si legge tutto come un registro.
        mio && "flex-row-reverse"
      )}
    >
      {/* Sul proprio messaggio l'avatar non serve: sai chi sei. Lo spazio
          resta occupato solo per gli altri, così i blocchi restano allineati. */}
      {mio ? null : attaccato ? (
        <span className="w-8 shrink-0" aria-hidden="true" />
      ) : (
        <Avatar nome={messaggio.autoreNome} sistema={diSistema} />
      )}

      <div className={cn("min-w-0 flex-1", mio && "flex flex-col items-end")}>
        {!attaccato && (
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-baseline gap-2",
              mio && "justify-end"
            )}
          >
            {!mio && (
              <span className="text-xs font-semibold text-text-1">
                {messaggio.autoreNome}
              </span>
            )}
            <span className="text-[11px] text-text-3">
              {ora(messaggio.createdAt)}
            </span>
          </div>
        )}

        <div
          className={cn(
            "flex min-w-0 items-start gap-1.5",
            mio && "flex-row-reverse justify-start"
          )}
        >
          <div
            className={cn(
              "min-w-0 max-w-[min(44rem,100%)] whitespace-pre-wrap break-words rounded-[var(--radius-control)] px-3 py-2 text-sm",
              diSistema
                ? "border border-border-soft bg-surface-2 text-text-1"
                : mio
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-text-1"
            )}
          >
            {messaggio.testo}
          </div>
          {emojiPicker}
        </div>

        {Object.keys(reazioni).length > 0 && (
          <div className={cn("mt-1 flex flex-wrap gap-1", mio && "justify-end")}>
            {Object.entries(reazioni).map(([emoji, ids]) => {
              const mia = ioId != null && ids.includes(ioId);
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={mia}
                  aria-label={`${emoji}, ${ids.length} ${ids.length === 1 ? "persona" : "persone"}`}
                  className={cn(
                    "inline-flex h-11 items-center gap-1 rounded-full border px-2.5 text-xs tabular-nums sm:h-7 sm:px-2",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mia
                      ? "border-primary/50 bg-primary/10 text-text-1"
                      : "border-border-soft bg-surface-2 text-text-1 hover:bg-surface-2/70"
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
            className="mt-1 inline-flex min-h-11 items-center gap-1 text-[11px] text-accent-text hover:underline sm:min-h-0"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
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
  // Sul telefono il workspace è a un pane: si parte dall'elenco e si torna
  // indietro con un controllo visibile, non sperando nel gesto di sistema.
  const [vista, setVista] = useState<"elenco" | "conversazione">("elenco");
  const singlePane = useMediaMatch(SINGLE_PANE_QUERY);
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
      setVista("conversazione");
      utils.chat.canali.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const showList = !singlePane || vista === "elenco";
  const showThread = !singlePane || vista === "conversazione";

  const ultimoId = messaggi.data?.[messaggi.data.length - 1]?.id ?? 0;
  useEffect(() => {
    // Segnare letto un canale che non è a schermo (telefono, pane elenco)
    // farebbe sparire i non letti senza che nessuno li abbia visti.
    if (!showThread) return;
    if (!canaleAttivo || ultimoId === 0) return;
    if ((canaleAttivo.nonLetti ?? 0) === 0) return;
    segnaLetto.mutate({ canaleId: canaleAttivo.id, finoAId: ultimoId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canaleAttivo?.id, ultimoId, canaleAttivo?.nonLetti, showThread]);

  useEffect(() => {
    fondo.current?.scrollIntoView({ block: "end" });
  }, [ultimoId, canaleAttivo?.id, showThread]);

  const persone = (interlocutori.data ?? []).filter(p =>
    p.nome.toLowerCase().includes(cercaPersona.trim().toLowerCase())
  );

  const spedisci = () => {
    if (!canaleAttivo || !bozza.trim() || invia.isPending) return;
    invia.mutate({ canaleId: canaleAttivo.id, testo: bozza.trim() });
  };

  const apriCanale = (id: number) => {
    setCanaleId(id);
    setVista("conversazione");
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

  const elencoCanali = canali.data ?? [];
  const nonLettiTotali = elencoCanali.reduce(
    (somma, canale) => somma + (canale.nonLetti ?? 0),
    0
  );

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[560px] min-w-0 flex-col gap-3 overflow-hidden">
      <PageHeader
        variant="workbench"
        eyebrow="Comunicazione interna"
        title="Chat aziendale"
        description="Il canale generale è il registro della sede, le conversazioni dirette seguono le persone. Qui si discute: quello che qualcuno deve fare resta nel Centro azioni."
        busy={canali.isFetching}
        metadata={
          canali.isPending ? (
            <span>Conversazioni in caricamento…</span>
          ) : canali.isError ? (
            <span>Elenco conversazioni non disponibile</span>
          ) : (
            <>
              <span>
                <strong className="tabular-nums text-text-1">
                  {elencoCanali.length}
                </strong>{" "}
                {elencoCanali.length === 1
                  ? "conversazione"
                  : "conversazioni"}
              </span>
              <span>
                <strong className="tabular-nums text-text-1">
                  {nonLettiTotali}
                </strong>{" "}
                da leggere
              </span>
            </>
          )
        }
        secondaryActions={
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/notifiche">
              <Bell className="h-4 w-4" aria-hidden="true" />
              Centro azioni
            </Link>
          </Button>
        }
        primaryAction={
          <Button
            type="button"
            className="min-h-11"
            aria-expanded={nuovaChat}
            onClick={() => {
              setNuovaChat(v => !v);
              setVista("elenco");
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuova conversazione
          </Button>
        }
      />

      <section
        aria-label="Workspace chat"
        className={cn(
          "grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-border-soft bg-surface",
          showList && "lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.9fr)]"
        )}
      >
        {showList && (
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border-soft px-3 py-2.5">
              <h2 className="truncate text-sm font-bold text-text-1">
                Conversazioni
              </h2>
              {nonLettiTotali > 0 && (
                <Badge className="h-6 shrink-0 px-2 text-[11px] tabular-nums">
                  {nonLettiTotali} da leggere
                </Badge>
              )}
            </div>

            {nuovaChat && (
              <div className="min-w-0 space-y-2 border-b border-border-soft bg-surface-2 px-3 py-3">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-2">
                    Scrivi a una persona
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Chiudi la ricerca persone"
                    className="h-11 w-11 sm:h-9 sm:w-9"
                    onClick={() => {
                      setNuovaChat(false);
                      setCercaPersona("");
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="relative min-w-0">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                    aria-hidden="true"
                  />
                  <Input
                    autoFocus
                    aria-label="Cerca una persona"
                    value={cercaPersona}
                    onChange={e => setCercaPersona(e.target.value)}
                    placeholder="Cerca una persona…"
                    className="h-11 pl-8"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  {interlocutori.isLoading && (
                    <p className="flex items-center gap-2 py-1 text-xs text-text-3">
                      <Loader2
                        className="h-4 w-4 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                      Carico la rubrica interna…
                    </p>
                  )}
                  {interlocutori.isError && (
                    <p className="py-1 text-xs text-danger">
                      Rubrica non disponibile: {interlocutori.error.message}
                    </p>
                  )}
                  {!interlocutori.isLoading &&
                    !interlocutori.isError &&
                    persone.length === 0 && (
                      <p className="py-1 text-sm text-text-3">
                        {cercaPersona.trim()
                          ? "Nessuna persona con questo nome."
                          : "Nessun altro utente attivo."}
                      </p>
                    )}
                  {persone.map(p => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="outline"
                      className="h-auto min-h-12 w-full justify-start gap-2 px-2.5 py-1.5"
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
              </div>
            )}

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2">
              {canali.isPending ? (
                <StatePanel
                  kind="loading"
                  compact
                  title="Carico le conversazioni"
                  description="Recupero i canali della sede e le tue chat dirette."
                  rows={4}
                />
              ) : canali.isError ? (
                <StatePanel
                  kind="error"
                  compact
                  title="Conversazioni non caricate"
                  description={`La chat non ha risposto: ${canali.error.message}`}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => canali.refetch()}
                    >
                      Riprova
                    </Button>
                  }
                />
              ) : elencoCanali.length === 0 ? (
                <StatePanel
                  kind="empty"
                  compact
                  title="Nessuna conversazione"
                  description="Apri una chat diretta con un collega per iniziare."
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => setNuovaChat(true)}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Nuova conversazione
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-0.5">
                  {elencoCanali.map(canale => {
                    const attivo =
                      canale.id === canaleAttivo?.id && showThread;
                    const diretta = canale.tipo === "diretto";
                    return (
                      <li key={canale.id}>
                        <button
                          type="button"
                          onClick={() => apriCanale(canale.id)}
                          aria-current={attivo ? "true" : undefined}
                          className={cn(
                            "flex min-h-12 w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-2 py-2 text-left transition-colors",
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
                              <Hash className="h-4 w-4" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className={cn(
                                  "truncate text-sm text-text-1",
                                  canale.nonLetti > 0
                                    ? "font-semibold"
                                    : "font-medium"
                                )}
                              >
                                {canale.nome}
                              </span>
                              {canale.nonLetti > 0 && (
                                <Badge className="ml-auto h-5 shrink-0 px-1.5 text-[10px] tabular-nums">
                                  {canale.nonLetti > 9 ? "9+" : canale.nonLetti}
                                </Badge>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-text-3">
                              {canale.ultimo
                                ? `${canale.ultimo.autoreNome.split(" ")[0]}: ${canale.ultimo.testo}`
                                : diretta
                                  ? "Conversazione diretta"
                                  : "Registro della sede"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {showThread && (
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-col",
              showList && "border-border-soft lg:border-l"
            )}
          >
            <div className="flex min-w-0 items-center gap-2 border-b border-border-soft px-3 py-2.5">
              {singlePane && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Torna all'elenco conversazioni"
                  className="h-11 w-11 shrink-0"
                  onClick={() => setVista("elenco")}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
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
                <p className="truncate text-sm font-semibold text-text-1">
                  {canaleAttivo?.nome ?? "Nessuna conversazione"}
                </p>
                <p className="truncate text-[11px] text-text-3">
                  {canaleAttivo == null
                    ? "Scegli una conversazione dall'elenco."
                    : canaleAttivo.tipo === "generale"
                      ? "Registro della sede: lo leggono tutte le persone di questa sede."
                      : "Conversazione diretta: resta fra voi due, in qualunque sede lavoriate."}
                </p>
              </div>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-2">
              {canaleAttivo == null ? (
                <StatePanel
                  kind="empty"
                  compact
                  title="Nessuna conversazione aperta"
                  description="Scegli un canale o una persona dall'elenco per leggere i messaggi."
                />
              ) : messaggi.isLoading ? (
                <StatePanel
                  kind="loading"
                  compact
                  title="Carico i messaggi"
                  description="Recupero la conversazione selezionata."
                  rows={3}
                />
              ) : messaggi.isError ? (
                <StatePanel
                  kind="error"
                  compact
                  title="Messaggi non caricati"
                  description={`La chat non ha risposto: ${messaggi.error.message}`}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => messaggi.refetch()}
                    >
                      Riprova
                    </Button>
                  }
                />
              ) : righe.length === 0 ? (
                <StatePanel
                  kind="empty"
                  compact
                  title="Ancora nessun messaggio"
                  description="Scrivi il primo: resta visibile a chi legge questa conversazione."
                />
              ) : (
                righe.map(({ messaggio, giorno, attaccato }) => (
                  <div key={messaggio.id} className="min-w-0">
                    {giorno && (
                      <div className="my-3 flex items-center gap-3">
                        <span className="h-px flex-1 bg-border-soft" />
                        <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">
                          {giorno}
                        </span>
                        <span className="h-px flex-1 bg-border-soft" />
                      </div>
                    )}
                    <Messaggio
                      messaggio={messaggio}
                      mio={
                        messaggio.autoreId != null &&
                        messaggio.autoreId === ioId
                      }
                      attaccato={attaccato}
                      ioId={ioId}
                    />
                  </div>
                ))
              )}
              <div ref={fondo} />
            </div>

            {/* Il composer resta: `chat.invia` esiste davvero e la chat è
                l'unica superficie del CRM in cui si risponde. */}
            <div className="flex min-w-0 items-end gap-2 border-t border-border-soft px-3 py-2.5">
              <Textarea
                aria-label="Scrivi un messaggio"
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
                    : "Scegli prima una conversazione"
                }
                rows={2}
                className="min-h-12 resize-none"
                disabled={!canaleAttivo || invia.isPending}
              />
              <Button
                type="button"
                size="icon"
                className="h-12 w-12 shrink-0 sm:h-11 sm:w-11"
                aria-label={invia.isPending ? "Invio in corso" : "Invia messaggio"}
                disabled={!canaleAttivo || !bozza.trim() || invia.isPending}
                onClick={spedisci}
              >
                {invia.isPending ? (
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
