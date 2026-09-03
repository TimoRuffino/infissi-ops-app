// Una riga sotto il banner dei documenti: dove siamo con contratto e limiti,
// visibile senza aprire le tab. Solo negli stati in cui conta.
import { trpc } from "@/lib/trpc";
import { riepilogoContratto } from "@/lib/contrattoView";
import { badgeStato } from "@/lib/limitiView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSignature } from "lucide-react";

export default function ContrattoStatoBanner({
  commessaId,
  stato,
  onApri,
}: {
  commessaId: number;
  stato: string;
  onApri: (tab: "prodotti" | "limiti") => void;
}) {
  const mostra = stato === "aggiornamento_contratto" || stato === "fatture_pagamento";
  const contratto = trpc.contratti.get.useQuery({ commessaId }, { enabled: mostra, retry: false });
  const computo = trpc.computo.ultimo.useQuery({ commessaId }, { enabled: mostra, retry: false });
  if (!mostra || !contratto.data || !computo.data) return null;
  const badge = badgeStato(computo.data);
  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap text-sm rounded-lg border border-border px-3 py-2 min-w-0">
      <FileSignature className="h-4 w-4 shrink-0" />
      <span className="min-w-0">
        {riepilogoContratto(contratto.data.contratto, contratto.data.righe.length)}
      </span>
      <Badge variant="outline">Limiti: {badge.testo}</Badge>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => onApri("prodotti")}
      >
        Contratto
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => onApri("limiti")}
      >
        Limiti
      </Button>
    </div>
  );
}
