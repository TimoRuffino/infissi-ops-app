// Passo 1 del percorso «Fatturazione guidata»: il fascicolo della commessa.
//
// È lo stesso elenco della scheda commessa (`ElencoDocumentiCommessa`) —
// stessi file, stesso caricamento, stesse azioni — dentro la cornice del
// percorso: intestazione, una riga di guida, «Avanti» attivo solo quando il
// passo è fatto. Qui il fascicolo non porta né l'invio via email né il
// collegamento a un ordine fornitore: in questo percorso si guarda il
// contratto, il resto si fa dalla scheda commessa.
//
// Chi è «fatto» lo decide il server (`fatturazioneGuidata.passi`, §4.1 della
// specifica: esiste un contratto strutturato oppure almeno un documento di
// tipo «contratto»); questo componente lo riceve e basta. Dopo un
// caricamento o una lettura applicata chiama `onCambiato` perché la pagina
// rilegga i passi.
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §3 (passo 1) e §6 (client).
import { useState } from "react";

import LeggiContrattoDialog from "@/components/contratto/LeggiContrattoDialog";
import ElencoDocumentiCommessa from "@/components/documenti/ElencoDocumentiCommessa";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import type { EsitoPasso } from "@shared/fatturazione/passi";

export default function PassoDocumenti({
  commessaId,
  passo,
  onAvanti,
  onCambiato,
}: {
  commessaId: number;
  /** Esito del passo secondo il server: «Avanti» si apre solo su `fatto`. */
  passo: EsitoPasso;
  onAvanti: () => void;
  /** Il fascicolo è cambiato: la pagina rilegga i passi. */
  onCambiato?: () => void;
}) {
  // Lettura assistita del contratto PDF (piano 3): la proposta si rivede in
  // un dialog e si applica al contratto strutturato, mai da sola.
  const [leggiDoc, setLeggiDoc] = useState<{ id: number; nome: string } | null>(
    null
  );

  // Kill switch: la lettura del contratto vive dietro due interruttori come
  // nella scheda commessa — senza contratto strutturato non c'è nulla da
  // applicare. La UI nasconde, il server decide.
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const estrazioneAttiva =
    Boolean(interruttori.data?.contrattoEstrazione) &&
    Boolean(interruttori.data?.limiti);

  const documenti = trpc.preventiviContratti.byCommessa.useQuery(commessaId);
  // Lo stato della commessa sceglie il tipo suggerito al caricamento: in
  // questo percorso è quasi sempre «Contratto» o «Fattura».
  const commessa = trpc.commesse.byId.useQuery(commessaId);
  const statoCommessa: string | undefined = commessa.data?.stato ?? undefined;

  const fatto = passo === "fatto";

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="passo-documenti">
      <header className="min-w-0 space-y-1">
        <h2
          id="passo-documenti"
          className="text-[15px] font-bold leading-5 text-text-1"
        >
          1 · Documenti
        </h2>
        <p className="text-sm text-text-2">
          Carica il contratto firmato e leggilo per proporre il contratto
          strutturato.
        </p>
      </header>

      <ElencoDocumentiCommessa
        commessaId={commessaId}
        stato={statoCommessa}
        documenti={documenti.data}
        onLeggiContratto={d => setLeggiDoc({ id: d.id, nome: d.nome })}
        onCambiato={onCambiato}
        compatto
      />

      <footer className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        {!fatto && (
          <p id="passo-documenti-avanti" className="text-xs text-text-3">
            Per proseguire serve un documento di tipo «Contratto» nel fascicolo.
          </p>
        )}
        <Button
          className="min-h-11 sm:w-auto"
          disabled={!fatto}
          aria-describedby={fatto ? undefined : "passo-documenti-avanti"}
          onClick={onAvanti}
        >
          Avanti
        </Button>
      </footer>

      {/* Lettura assistita del contratto PDF: proposta, revisione, applicazione */}
      {estrazioneAttiva && (
        <LeggiContrattoDialog
          commessaId={commessaId}
          documento={leggiDoc}
          onClose={() => setLeggiDoc(null)}
          // Applicata (o «Compila a mano»): il contratto strutturato ora
          // esiste, la pagina rilegge i passi e «Avanti» si apre.
          onApplicato={() => onCambiato?.()}
        />
      )}
    </section>
  );
}
