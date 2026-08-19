// Banner Tars in scheda commessa: bottone "Analizza" + proposte pendenti
// inline. Il punto dove l'approvazione costa meno attenzione è la commessa
// che stai già guardando — il banner è ambra come le note della timeline.

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import TarsPropostaCard from "@/components/TarsPropostaCard";
import { Loader2, Sparkles } from "lucide-react";
import TarsAvatar from "@/components/TarsAvatar";
import { useState } from "react";
import { toast } from "sonner";

function quando(d: string | Date): string {
  const data = new Date(d);
  return data.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TarsBanner({ commessaId }: { commessaId: number }) {
  const utils = trpc.useUtils();
  const config = trpc.tars.config.get.useQuery(undefined, { retry: false });
  const pendenti = trpc.tars.proposte.list.useQuery(
    { stato: "pendente", commessaId },
    { retry: false }
  );
  // Ciò che Tars ha detto su questa commessa, dal registro esecuzioni: resta
  // qui domani e per chiunque apra la scheda, non solo per chi ha premuto
  // "Analizza" in questa sessione.
  const storico = trpc.tars.esecuzioni.perCommessa.useQuery(
    { commessaId, limit: 5 },
    { retry: false }
  );
  const decise = trpc.tars.proposte.list.useQuery(
    { commessaId },
    { retry: false }
  );
  const [domandaAperta, setDomandaAperta] = useState(false);
  const [domanda, setDomanda] = useState("");
  const [storicoAperto, setStoricoAperto] = useState(false);

  const analizza = trpc.tars.analizza.useMutation({
    onSuccess: (r) => {
      setDomandaAperta(false);
      setDomanda("");
      utils.tars.proposte.invalidate();
      utils.tars.esecuzioni.invalidate();
      if (r.proposte.length === 0) {
        // Nessuna proposta non è un fallimento: il referto sta nel banner,
        // qui basta dire dove guardare senza farlo sembrare un buco a vuoto.
        toast.info("Tars ha guardato la commessa: leggi l'esito qui sotto.");
      } else {
        toast.success(`Tars ha ${r.proposte.length} propost${r.proposte.length === 1 ? "a" : "e"}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // Tars spento o non configurato: nessun banner, zero rumore.
  if (!config.data?.attivo) return null;

  const proposteQui = pendenti.data ?? [];
  const analisi = storico.data ?? [];
  const ultima = analisi[0] ?? null;
  const precedenti = analisi.slice(1);
  // Le proposte già decise: restano visibili con il loro esito, così
  // "approvato" non è una cosa che è successa e nessuno ricorda.
  const storicoDeciso = (decise.data ?? []).filter(
    (p: any) => p.stato !== "pendente"
  );

  return (
    <div className="rounded-lg border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TarsAvatar size="sm" />
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

      {proposteQui.map((p: any) => (
        <TarsPropostaCard key={p.id} proposta={p} />
      ))}

      {/* Cosa ha detto, e com'è finita. L'ultima analisi sempre visibile:
          è il pezzo che prima sparìva al ricaricamento della pagina. */}
      {ultima && (
        <div className="rounded-md bg-background/70 border p-2.5 space-y-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>
              {ultima.trigger === "seguito"
                ? "Seguito di una decisione"
                : "Ultima analisi"}
            </span>
            <span>·</span>
            <span>{quando(ultima.createdAt)}</span>
            {ultima.utenteNome && <span>· chiesta da {ultima.utenteNome}</span>}
          </div>
          <p className="text-sm whitespace-pre-wrap">{ultima.riepilogo}</p>
        </div>
      )}

      {(precedenti.length > 0 || storicoDeciso.length > 0) && (
        <div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => setStoricoAperto((v) => !v)}
          >
            {storicoAperto
              ? "Nascondi lo storico"
              : `Storico Tars su questa commessa (${precedenti.length + storicoDeciso.length})`}
          </button>

          {storicoAperto && (
            <div className="mt-2 space-y-2">
              {precedenti.map((e: any) => (
                <div key={e.id} className="rounded-md bg-background/60 border p-2.5 space-y-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {quando(e.createdAt)}
                    {e.utenteNome ? ` · ${e.utenteNome}` : ""}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{e.riepilogo}</p>
                </div>
              ))}
              {storicoDeciso.map((p: any) => (
                <TarsPropostaCard key={p.id} proposta={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
