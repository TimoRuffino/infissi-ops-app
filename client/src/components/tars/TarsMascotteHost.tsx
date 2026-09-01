// Mascotte di Tars nella shell, in basso a destra. Il click apre una
// domanda rapida: campo, invio su tars.invia, risposta in chiaro.
//
// Qui NON si approva nulla. Le proposte materiali (L3) restano su /tars, che
// resta l'unica superficie dove un umano le conferma: duplicare i pulsanti di
// approvazione in un widget flottante moltiplicherebbe i modi di dire «sì» a
// un effetto reale. Da qui si può solo chiedere e leggere.
//
// Gating identico alla pagina: capability tars.use + interruttore tars. A
// flag spento il componente non esiste e nessuna query parte.
import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowUpRight, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";

import { MascotteTars } from "@/components/tars/MascotteTars";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { useIsMobile } from "@/hooks/useMobile";
import { etichettaMascotte } from "@/lib/mascotteTars";
import { trpc } from "@/lib/trpc";

export function TarsMascotteHost() {
  const [, setLocation] = useLocation();
  const { capabilities } = useOperationalContext();
  const isMobile = useIsMobile();
  const [aperto, setAperto] = useState(false);
  const [messaggio, setMessaggio] = useState("");
  const [conversazioneId, setConversazioneId] = useState<number | null>(null);
  const [risposta, setRisposta] = useState<string | null>(null);

  const puoUsareTars = capabilities?.has("tars.use") ?? false;
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const tarsAcceso = Boolean((interruttori.data as any)?.tars);

  const utils = trpc.useUtils();
  const invia = trpc.tars.invia.useMutation({
    onSuccess: esito => {
      setMessaggio("");
      setConversazioneId(esito.conversazioneId);
      setRisposta(esito.testo);
      utils.tars.turni.invalidate({ conversazioneId: esito.conversazioneId });
      utils.tars.conversazioni.invalidate();
      if (esito.stato === "degradato") {
        // Il motivo lo dice il server (budget, limite, modello irraggiungibile).
        toast.warning(esito.testo);
      }
    },
    onError: e => toast.error(e.message ?? "Invio non riuscito"),
  });

  // Su mobile la BottomNav occupa tutta la fascia bassa: la mascotte ci
  // finirebbe sopra, e il pannello coprirebbe mezzo schermo.
  if (!puoUsareTars || !tarsAcceso || isMobile) return null;

  const etichetta = etichettaMascotte(aperto);

  const spedisci = () => {
    const testo = messaggio.trim();
    if (!testo || invia.isPending) return;
    invia.mutate({
      messaggio: testo,
      conversazioneId: conversazioneId ?? undefined,
    });
  };

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex items-end gap-3">
      {aperto ? (
        <div className="pointer-events-auto mb-2 w-[22rem] rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">Chiedi a Tars</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setAperto(false)}
              aria-label="Chiudi"
            >
              <X className="size-4" />
            </Button>
          </div>

          {risposta ? (
            <div className="max-h-56 overflow-y-auto border-b border-border px-3 py-2 text-sm whitespace-pre-wrap">
              {risposta}
            </div>
          ) : null}

          <div className="p-3">
            <Textarea
              value={messaggio}
              onChange={e => setMessaggio(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  spedisci();
                }
              }}
              placeholder="Scrivi una domanda…"
              rows={3}
              className="resize-none"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setLocation("/tars")}
                className="inline-flex items-center gap-1 text-xs text-text-3 underline-offset-2 hover:underline"
              >
                Apri la conversazione
                <ArrowUpRight className="size-3" />
              </button>
              <Button
                size="sm"
                onClick={spedisci}
                disabled={!messaggio.trim() || invia.isPending}
              >
                {invia.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Invia
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <MascotteTars
        attiva={aperto}
        onClick={() => setAperto(v => !v)}
        etichetta={etichetta}
        className="pointer-events-auto h-36 w-24"
      />
    </div>
  );
}

export default TarsMascotteHost;
