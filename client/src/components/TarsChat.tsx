// La chat con Tars.
//
// TarsChatPanel  — il pannello vero e proprio (messaggi + input), usato
//                  sia dal widget flottante sia dalla pagina /inbox.
// TarsChatFloating — il bottone in basso a destra, presente ovunque,
//                  che apre il pannello. Compare solo con Tars attivo.
//
// Gli "ordini" dati in chat diventano proposte: Tars le prepara, tu le
// approvi qui dentro con un click — e solo allora parte la mutation.

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import TarsAvatar from "@/components/TarsAvatar";
import TarsPropostaCard from "@/components/TarsPropostaCard";
import {
  AlertTriangle,
  Building2,
  Clock3,
  Loader2,
  MailSearch,
  RotateCcw,
  Send,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PlanProgress } from "@/components/tars/PlanProgress";

export function TarsChatPanel({ className }: { className?: string }) {
  const utils = trpc.useUtils();
  const messaggi = trpc.tars.chat.get.useQuery(undefined, { retry: false });
  const commandCenter = trpc.tars.commandCenter.get.useQuery(
    { limit: 4 },
    { retry: false, staleTime: 15_000 }
  );
  const [testo, setTesto] = useState("");
  const [testoInInvio, setTestoInInvio] = useState<string | null>(null);
  const [faseLavoro, setFaseLavoro] = useState(0);
  const fondoRef = useRef<HTMLDivElement>(null);

  const invia = trpc.tars.chat.invia.useMutation({
    onSuccess: () => {
      setTestoInInvio(null);
      utils.tars.chat.invalidate();
      utils.tars.proposte.invalidate();
    },
    onError: (e, variabili) => {
      setTestoInInvio(null);
      setTesto(variabili.testo);
      toast.error(e.message);
    },
  });
  const pulisci = trpc.tars.chat.pulisci.useMutation({
    onSuccess: () => utils.tars.chat.invalidate(),
  });

  const rows = messaggi.data ?? [];
  const currentPlans = [
    ...(commandCenter.data?.waitingQuestions ?? []),
    ...(commandCenter.data?.activePlans ?? []),
  ].slice(0, 2);

  // Sempre in fondo: è una chat, l'ultima cosa detta è quella che conta.
  useEffect(() => {
    fondoRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length, invia.isPending, faseLavoro]);

  useEffect(() => {
    if (!invia.isPending) {
      setFaseLavoro(0);
      return;
    }
    const timer = window.setInterval(
      () => setFaseLavoro(fase => (fase + 1) % 4),
      2400
    );
    return () => window.clearInterval(timer);
  }, [invia.isPending]);

  const inviaTesto = (valore: string) => {
    const t = valore.trim();
    if (!t || invia.isPending) return;
    setTestoInInvio(t);
    setTesto("");
    invia.mutate({ testo: t });
  };

  const submit = () => {
    inviaTesto(testo);
  };

  const suggerimenti = [
    {
      testo: "Dammi il quadro operativo dell'azienda e le priorità di oggi",
      icona: Building2,
    },
    {
      testo: "Quali commesse sono ferme da più di 10 giorni?",
      icona: Clock3,
    },
    {
      testo: "Ci sono comunicazioni importanti ancora da smistare?",
      icona: MailSearch,
    },
    {
      testo: "Quali incassi o fatture richiedono attenzione?",
      icona: WalletCards,
    },
  ];

  const fasi = [
    "Interrogo i registri della sede…",
    "Incrocio commesse, documenti e comunicazioni…",
    "Verifico contraddizioni e azioni già proposte…",
    "Preparo una risposta fondata sui dati…",
  ];

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {currentPlans.length > 0 && (
          <div
            className="divide-y border-y"
            aria-label="Obiettivi Tars in corso"
          >
            {currentPlans.map((plan: any) => (
              <PlanProgress key={plan.id} plan={plan} />
            ))}
          </div>
        )}
        {rows.length === 0 && !invia.isPending && (
          <div className="mx-auto max-w-lg pt-6 text-center text-sm text-muted-foreground space-y-4">
            <TarsAvatar size="lg" className="mx-auto" />
            <p className="font-semibold text-foreground">Da dove partiamo?</p>
            <p className="max-w-sm mx-auto leading-relaxed">
              Posso cercare nei registri operativi, confrontare i dati e
              preparare azioni da approvare.
            </p>
            <div className="grid gap-2 pt-1 text-left sm:grid-cols-2">
              {suggerimenti.map(({ testo: suggerimento, icona: Icona }) => (
                <button
                  key={suggerimento}
                  type="button"
                  className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-foreground shadow-xs transition-colors hover:border-primary/35 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                  onClick={() => inviaTesto(suggerimento)}
                >
                  <Icona className="h-4 w-4 shrink-0 text-primary" />
                  <span>{suggerimento}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {rows.map((m: any, i: number) => (
          <div key={i} className="space-y-2">
            {m.ruolo === "utente" ? (
              <div className="flex justify-end">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words">
                  {m.testo}
                </div>
              </div>
            ) : (
              <div className="flex gap-2 items-start">
                <TarsAvatar size="sm" className="mt-1" />
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words">
                  {m.testo}
                </div>
              </div>
            )}
            {(m.proposte ?? []).map((p: any) => (
              <div key={p.id} className="pl-8">
                <TarsPropostaCard
                  proposta={p}
                  onDecisa={() => utils.tars.chat.invalidate()}
                />
              </div>
            ))}
          </div>
        ))}

        {testoInInvio && (
          <div className="flex justify-end">
            <div className="bg-primary [background-image:var(--gradient-primary)] text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words">
              {testoInInvio}
            </div>
          </div>
        )}

        {invia.isPending && (
          <div className="flex gap-2 items-center" aria-live="polite">
            <TarsAvatar size="sm" pulse />
            <div className="min-w-0">
              <span className="block text-sm font-medium text-foreground">
                Tars sta lavorando
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {fasi[faseLavoro]}
              </span>
            </div>
          </div>
        )}
        {messaggi.isError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Impossibile caricare la conversazione.
          </div>
        )}
        <div ref={fondoRef} />
      </div>

      <div className="border-t p-2 flex gap-2 items-end shrink-0">
        <Textarea
          value={testo}
          onChange={e => setTesto(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Scrivi a Tars… (Invio per mandare)"
          rows={1}
          className="text-sm resize-none min-h-[38px] max-h-28"
          aria-label="Messaggio per Tars"
        />
        <Button
          size="icon"
          className="shrink-0"
          disabled={!testo.trim() || invia.isPending}
          onClick={submit}
          aria-label="Invia messaggio"
          title="Invia messaggio"
        >
          {invia.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
        {rows.length > 0 && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            title="Nuova conversazione"
            aria-label="Nuova conversazione"
            disabled={pulisci.isPending || invia.isPending}
            onClick={() => pulisci.mutate()}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function TarsChatFloating() {
  const config = trpc.tars.config.get.useQuery(undefined, { retry: false });
  const stats = trpc.tars.proposte.stats.useQuery(undefined, {
    retry: false,
    refetchInterval: 60_000,
  });
  const [aperta, setAperta] = useState(false);

  // Niente Tars, niente bolla: zero rumore per chi non lo usa.
  if (!config.data?.attivo) return null;

  return (
    <>
      {aperta && (
        <div className="fixed bottom-20 right-4 z-50 w-[min(400px,calc(100vw-2rem))] h-[min(560px,calc(100dvh-7rem))] bg-background border rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-[image:var(--gradient-soft)] shrink-0">
            <TarsAvatar size="md" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold leading-tight">Tars</div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                propone, tu approvi
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setAperta(false)}
              aria-label="Chiudi chat"
              title="Chiudi chat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <TarsChatPanel className="flex-1" />
        </div>
      )}

      <button
        onClick={() => setAperta(v => !v)}
        className="fixed bottom-4 right-4 z-50 rounded-full shadow-lg hover:scale-105 transition-transform"
        aria-label="Chat con Tars"
      >
        <div className="relative">
          <TarsAvatar size="lg" className="h-12 w-12" />
          {(stats.data?.pendenti ?? 0) > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full h-5 min-w-5 px-1 flex items-center justify-center">
              {stats.data!.pendenti}
            </span>
          )}
        </div>
      </button>
    </>
  );
}
