// Banner Tars in scheda commessa: bottone "Analizza" + proposte pendenti
// inline. Il punto dove l'approvazione costa meno attenzione è la commessa
// che stai già guardando — il banner è ambra come le note della timeline.

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import TarsPropostaCard from "@/components/TarsPropostaCard";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function TarsBanner({ commessaId }: { commessaId: number }) {
  const utils = trpc.useUtils();
  const config = trpc.tars.config.get.useQuery(undefined, { retry: false });
  const pendenti = trpc.tars.proposte.list.useQuery(
    { stato: "pendente", commessaId },
    { retry: false }
  );
  const [domandaAperta, setDomandaAperta] = useState(false);
  const [domanda, setDomanda] = useState("");
  const [riepilogo, setRiepilogo] = useState<string | null>(null);

  const analizza = trpc.tars.analizza.useMutation({
    onSuccess: (r) => {
      setRiepilogo(r.riepilogo);
      setDomandaAperta(false);
      setDomanda("");
      utils.tars.proposte.invalidate();
      if (r.proposte.length === 0) {
        toast.info("Tars non ha proposte: " + (r.riepilogo ?? "nessuna azione necessaria"));
      } else {
        toast.success(`Tars ha ${r.proposte.length} propost${r.proposte.length === 1 ? "a" : "e"}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // Tars spento o non configurato: nessun banner, zero rumore.
  if (!config.data?.attivo) return null;

  const proposteQui = pendenti.data ?? [];

  return (
    <div className="rounded-lg border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-amber-600 dark:text-amber-500" />
          Tars
          {proposteQui.length > 0 && (
            <span className="text-muted-foreground font-normal">
              — {proposteQui.length} propost{proposteQui.length === 1 ? "a" : "e"} in attesa
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={analizza.isPending}
            onClick={() => setDomandaAperta((v) => !v)}
          >
            Chiedi
          </Button>
          <Button
            size="sm"
            disabled={analizza.isPending}
            onClick={() => analizza.mutate({ commessaId })}
          >
            {analizza.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1" />
            )}
            {analizza.isPending ? "Sta guardando…" : "Analizza"}
          </Button>
        </div>
      </div>

      {domandaAperta && (
        <div className="flex gap-2">
          <Textarea
            placeholder="Es. «Il cliente dice di aver pagato il secondo acconto: torna?»"
            value={domanda}
            onChange={(e) => setDomanda(e.target.value)}
            rows={2}
            className="text-sm bg-background"
          />
          <Button
            size="sm"
            disabled={analizza.isPending || !domanda.trim()}
            onClick={() => analizza.mutate({ commessaId, domanda: domanda.trim() })}
          >
            Invia
          </Button>
        </div>
      )}

      {riepilogo && proposteQui.length === 0 && (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{riepilogo}</p>
      )}

      {proposteQui.map((p: any) => (
        <TarsPropostaCard key={p.id} proposta={p} />
      ))}
    </div>
  );
}
