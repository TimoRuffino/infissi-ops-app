// Una riga sotto il banner dei documenti: dove siamo con contratto e limiti,
// visibile senza aprire le tab. Solo negli stati in cui conta.
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { riepilogoContratto } from "@/lib/contrattoView";
import { badgeStato } from "@/lib/limitiView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileSignature, ReceiptText, ScanText } from "lucide-react";

export default function ContrattoStatoBanner({
  commessaId,
  stato,
  flagAttivo,
  documentoContratto = null,
  onLeggi,
}: {
  commessaId: number;
  stato: string;
  /** Le procedure vivono dietro FLAG_LIMITI: senza flag non si chiamano. */
  flagAttivo: boolean;
  /** Il PDF del contratto nel fascicolo, quando c'è: senza, niente lettura da proporre. */
  documentoContratto?: { id: number; nome: string } | null;
  /** Presente solo dietro FLAG_CONTRATTO_ESTRAZIONE (lo decide la pagina). */
  onLeggi?: (documento: { id: number; nome: string }) => void;
}) {
  const mostra =
    flagAttivo && (stato === "aggiornamento_contratto" || stato === "fatture_pagamento");
  const contratto = trpc.contratti.get.useQuery({ commessaId }, { enabled: mostra, retry: false });
  const computo = trpc.computo.ultimo.useQuery({ commessaId }, { enabled: mostra, retry: false });
  if (!mostra || !contratto.data || !computo.data) return null;
  const badge = badgeStato(computo.data);
  // Il PDF è nel fascicolo ma il contratto strutturato non esiste ancora:
  // il passo che manca è leggerlo, non «aprire il contratto» e trovarlo vuoto.
  const daLeggere = contratto.data.contratto == null && documentoContratto != null && onLeggi != null;
  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap text-sm rounded-lg border border-border px-3 py-2 min-w-0">
      <FileSignature className="h-4 w-4 shrink-0" />
      <span className="min-w-0">
        {daLeggere
          ? "Contratto caricato, non ancora letto"
          : riepilogoContratto(contratto.data.contratto, contratto.data.righe.length)}
      </span>
      <Badge variant="outline">Limiti: {badge.testo}</Badge>
      {daLeggere && (
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 px-2 text-xs"
          onClick={() => onLeggi(documentoContratto)}
        >
          <ScanText className="h-3.5 w-3.5 mr-1" />
          Leggi il contratto
        </Button>
      )}
      {/* Nessun `?passo=`: la pagina a passi atterra da sola sul prossimo
          passo del server (`passoIniziale`, P4-R8), o sull'ultimo a
          percorso concluso — indovinarlo qui duplicherebbe una logica che
          il server già possiede (P4-R9). */}
      <Button asChild variant="outline" size="sm" className="min-h-11">
        <Link href={`/fatturazione/${commessaId}`}>
          <ReceiptText className="h-4 w-4" aria-hidden="true" />
          Apri fatturazione
        </Link>
      </Button>
    </div>
  );
}
