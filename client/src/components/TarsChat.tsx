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
import { Loader2, RotateCcw, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function TarsChatPanel({ className }: { className?: string }) {
  const utils = trpc.useUtils();
  const messaggi = trpc.tars.chat.get.useQuery(undefined, { retry: false });
  const [testo, setTesto] = useState("");
  const fondoRef = useRef<HTMLDivElement>(null);

  const invia = trpc.tars.chat.invia.useMutation({
    onSuccess: () => {
      utils.tars.chat.invalidate();
      utils.tars.proposte.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const pulisci = trpc.tars.chat.pulisci.useMutation({
    onSuccess: () => utils.tars.chat.invalidate(),
  });

  const rows = messaggi.data ?? [];

  // Sempre in fondo: è una chat, l'ultima cosa detta è quella che conta.
  useEffect(() => {
    fondoRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length, invia.isPending]);

  const submit = () => {
    const t = testo.trim();
    if (!t || invia.isPending) return;
    setTesto("");
    invia.mutate({ testo: t });
  };

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {rows.length === 0 && !invia.isPending && (
          <div className="text-center text-sm text-muted-foreground pt-8 space-y-3">
            <TarsAvatar size="lg" className="mx-auto" />
            <p className="font-medium text-foreground">Ciao, sono Tars.</p>
            <p className="max-w-[260px] mx-auto">
              Chiedimi dello stato di una commessa, o dammi un ordine.
              Preparo tutto, tu approvi.
            </p>
            <div className="flex flex-col gap-1.5 items-center pt-1">
              {[
                "Quali commesse sono ferme da più di 10 giorni?",
                "Ci sono mail da smistare?",
                "Chi non ha ancora pagato il saldo?",
              ].map((s) => (
                <button
                  key={s}
                  className="text-xs border rounded-full px-3 py-1.5 hover:bg-muted transition-colors"
                  onClick={() => invia.mutate({ testo: s })}
                >
                  {s}
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

        {invia.isPending && (
          <div className="flex gap-2 items-center">
            <TarsAvatar size="sm" pulse />
            <span className="text-sm text-muted-foreground">
              Tars sta guardando…
            </span>
          </div>
        )}
        <div ref={fondoRef} />
      </div>

      <div className="border-t p-2 flex gap-2 items-end shrink-0">
        <Textarea
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Scrivi a Tars… (Invio per mandare)"
          rows={1}
          className="text-sm resize-none min-h-[38px] max-h-28"
        />
        <Button
          size="icon"
          className="shrink-0"
          disabled={!testo.trim() || invia.isPending}
          onClick={submit}
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
          <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-gradient-to-r from-amber-500/10 to-transparent shrink-0">
            <TarsAvatar size="md" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold leading-tight">Tars</div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                propone, tu approvi
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setAperta(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <TarsChatPanel className="flex-1" />
        </div>
      )}

      <button
        onClick={() => setAperta((v) => !v)}
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
