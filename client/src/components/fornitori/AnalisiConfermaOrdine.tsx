// Pannello «Conferma d'ordine (PDF)» dentro la scheda ordine (D7, slice 1).
//
// L'operatore sceglie un PDF dal fascicolo della commessa dell'ordine e lo
// fa analizzare: campi estratti con evidenza (pagina e frammento) e
// differenze rispetto all'ordine, classificate per gravità. Nessun bottone
// scrive su commesse o ordini: le decisioni restano alle persone (le azioni
// proposte con approvazione sono una slice successiva del piano D7).

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileSearch, Loader2, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const GRAVITA_CLASSI: Record<string, string> = {
  alta: "bg-danger-soft text-danger",
  media: "bg-warning-soft text-warning",
  bassa: "bg-surface-2 text-text-3",
};

// Etichette oneste: un PDF senza testo riconosciuto NON è stato
// analizzato. Con l'OCR locale (slice 4) una scansione può diventare
// «Analizzata (OCR)», sempre con le sue confidenze; se resta senza testo,
// il motivo spiega perché e non viene mai presentata come riuscita.
const STATO_LABEL: Record<string, string> = {
  analizzata: "Analizzata",
  scansione_senza_testo: "Scansione: contenuto NON analizzato",
  illeggibile: "File illeggibile: contenuto NON analizzato",
  non_supportato: "Formato non supportato: contenuto NON analizzato",
  errore: "Errore",
};

function etichettaStato(run: any): string {
  if (run.stato !== "analizzata") return STATO_LABEL[run.stato] ?? run.stato;
  if (run.parser !== "pdf-ocr") return "Analizzata";
  return run.daVerificare
    ? "Analizzata con OCR — DA VERIFICARE"
    : "Analizzata con OCR";
}

function Evidenza({ evidenza }: { evidenza: any }) {
  if (!evidenza) return null;
  return (
    <p className="text-[11px] text-text-3 mt-0.5">
      pag. {evidenza.pagina} — «{evidenza.frammento}»
    </p>
  );
}

export default function AnalisiConfermaOrdine({
  ordineId,
  commessaId,
}: {
  ordineId: number;
  commessaId: number;
}) {
  const [aperto, setAperto] = useState(false);
  const [documentoId, setDocumentoId] = useState<string>("");
  const utils = trpc.useUtils();
  // Kill switch: superficie nascosta quando la DI è spenta (il server
  // rifiuta comunque ogni chiamata con PRECONDITION_FAILED).
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });

  const runs = trpc.analisiDocumenti.perOrdine.useQuery(
    { ordineId },
    { enabled: aperto }
  );
  const documenti = trpc.preventiviContratti.byCommessa.useQuery(commessaId, {
    enabled: aperto,
  });
  const analizza = trpc.analisiDocumenti.analizzaConferma.useMutation({
    onSuccess: ({ riusata }) => {
      utils.analisiDocumenti.perOrdine.invalidate({ ordineId });
      toast.success(
        riusata
          ? "Documento già analizzato: mostrato il risultato esistente"
          : "Analisi completata"
      );
    },
    onError: e => toast.error(e.message ?? "Analisi non riuscita"),
  });
  const genera = trpc.proposte.genera.useMutation({
    onSuccess: ({ motivo, proposte }) => {
      utils.proposte.perOrdine.invalidate({ ordineId });
      if (motivo) toast.info(motivo);
      else
        toast.success(
          proposte[0]?.riusata
            ? "Proposta già esistente: decidila dal pannello «Proposte dall'analisi»"
            : "Proposta creata: approvala e applicala dal pannello «Proposte dall'analisi»"
        );
    },
    onError: e => toast.error(e.message ?? "Generazione non riuscita"),
  });

  const pdfDelFascicolo = (documenti.data ?? []).filter((doc: any) =>
    (doc.mimeType ?? "").toLowerCase().includes("pdf")
  );
  const ultimo: any = runs.data?.[0] ?? null;
  const estrazione = ultimo?.estrazione ?? null;

  if (!interruttori.data?.documentIntelligence) return null;

  if (!aperto) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => setAperto(true)}
      >
        <FileSearch className="h-3.5 w-3.5 mr-1" />
        Conferma d'ordine (PDF)
      </Button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <FileSearch className="h-4 w-4 text-text-3 shrink-0" />
        <span className="text-xs font-semibold">Conferma d'ordine</span>
        <Select value={documentoId} onValueChange={setDocumentoId}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="Scegli un PDF dal fascicolo…" />
          </SelectTrigger>
          <SelectContent>
            {pdfDelFascicolo.map((doc: any) => (
              <SelectItem key={doc.id} value={String(doc.id)}>
                {doc.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8"
          disabled={!documentoId || analizza.isPending}
          onClick={() =>
            analizza.mutate({ ordineId, documentoId: Number(documentoId) })
          }
        >
          {analizza.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Analizza"
          )}
        </Button>
        {ultimo && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            disabled={analizza.isPending}
            onClick={() =>
              analizza.mutate({
                ordineId,
                documentoId: ultimo.documentoId,
                forza: true,
              })
            }
            title="Rianalizza il documento conservando i run precedenti"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {pdfDelFascicolo.length === 0 && !documenti.isLoading && (
        <p className="text-xs text-text-3">
          Nessun PDF nel fascicolo della commessa: carica prima la conferma
          come documento (tipo «Conferma ordine»).
        </p>
      )}

      {ultimo && (
        <div className="space-y-2">
          <p className="text-xs">
            <span className="font-medium">{ultimo.documentoNome}</span>{" "}
            <span
              className={
                ultimo.daVerificare ? "text-warning" : "text-text-3"
              }
            >
              · {etichettaStato(ultimo)}
              {ultimo.pagine ? ` · ${ultimo.pagine} pagine` : ""}
              {ultimo.ocr ? ` · confidenza ${ultimo.ocr.confidenzaMedia}%` : ""}
            </span>
          </p>
          {ultimo.motivoStato && (
            <p className="text-xs text-warning">{ultimo.motivoStato}</p>
          )}
          {(ultimo.avvertenze ?? []).map((avvertenza: string, i: number) => (
            <p key={i} className="text-[11px] text-warning">
              {avvertenza}
            </p>
          ))}

          {estrazione && (
            <div className="grid gap-1 text-xs sm:grid-cols-2">
              <div>
                <span className="text-text-3">Riferimento ordine: </span>
                {estrazione.riferimentoOrdine ? (
                  <>
                    <span className="font-medium">
                      {estrazione.riferimentoOrdine.valore}
                    </span>
                    <Evidenza
                      evidenza={estrazione.riferimentoOrdine.evidenza}
                    />
                  </>
                ) : (
                  <span className="text-warning">non citato</span>
                )}
              </div>
              <div>
                <span className="text-text-3">Consegna dichiarata: </span>
                {estrazione.dateConsegna[0] ? (
                  <>
                    <span className="font-medium">
                      {estrazione.dateConsegna[0].valore}
                    </span>
                    <Evidenza evidenza={estrazione.dateConsegna[0].evidenza} />
                  </>
                ) : estrazione.settimaneConsegna[0] ? (
                  <span className="font-medium">
                    settimana {estrazione.settimaneConsegna[0].valore}
                  </span>
                ) : (
                  <span className="text-text-3">non trovata</span>
                )}
              </div>
              {estrazione.numeroConferma && (
                <div>
                  <span className="text-text-3">Numero conferma: </span>
                  <span className="font-medium">
                    {estrazione.numeroConferma.valore}
                  </span>
                </div>
              )}
              {estrazione.totaleDocumento && (
                <div>
                  <span className="text-text-3">Totale documento: </span>
                  <span className="font-medium tabular-nums">
                    {estrazione.totaleDocumento.valore.toFixed(2)}
                  </span>
                  <Evidenza evidenza={estrazione.totaleDocumento.evidenza} />
                </div>
              )}
            </div>
          )}

          {ultimo.stato === "analizzata" && (
            <div className="space-y-1">
              {ultimo.differenze.length === 0 ? (
                <p className="text-xs text-success">
                  Nessuna differenza rilevata rispetto all'ordine.
                </p>
              ) : (
                ultimo.differenze.map((differenza: any, indice: number) => (
                  <div key={indice} className="text-xs flex gap-2 items-start">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${GRAVITA_CLASSI[differenza.gravita] ?? ""}`}
                    >
                      {differenza.gravita}
                    </span>
                    <span>
                      {differenza.dettaglio}
                      <Evidenza evidenza={differenza.evidenza} />
                    </span>
                  </div>
                ))
              )}
              <p className="text-[11px] text-text-3">
                L'analisi non modifica ordine o commessa: verifica le
                differenze e aggiorna i dati dalle schede.
              </p>
              {ultimo.differenze.some(
                (d: any) => d.tipo === "consegna_diversa"
              ) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={genera.isPending}
                  onClick={() =>
                    genera.mutate({
                      ordineId,
                      documentoId: ultimo.documentoId,
                    })
                  }
                >
                  Proponi l'aggiornamento della data di consegna
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
