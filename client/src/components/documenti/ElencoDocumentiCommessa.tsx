// Il fascicolo della commessa: elenco dei documenti, caricamento con
// selezione del tipo, apertura, scarico, riclassifica ed eliminazione.
//
// Estratto tale e quale da `pages/CommessaDetail.tsx` (tab «File e
// documenti») perché il passo «Documenti» della fatturazione guidata mostra
// lo stesso fascicolo: stessi testi, stessi interruttori, stesse mutation e
// stesse invalidazioni. Nessuna logica nuova.
//
// Cosa resta fuori: i dialog che la pagina ospitante monta già per conto suo
// — «Collega a un ordine fornitore» (`CollegaOrdineDialog`), «Leggi il
// contratto» (`LeggiContrattoDialog`) e l'invio via email, che vuole i dati
// del cliente. Arrivano qui come callback: il pulsante compare solo se la
// callback c'è (e, per i due assistiti, solo con l'interruttore acceso).
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md §3.
import { useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Eye,
  File as FileIcon,
  FileText,
  Link2,
  Pencil,
  ScanText,
  Send,
  Trash2,
  Upload,
} from "lucide-react";

import ConfirmDialog from "@/components/ConfirmDialog";
import CaricaDocumentoDialog from "@/components/documenti/CaricaDocumentoDialog";
import FilePreviewDialog from "@/components/FilePreviewDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUGGESTED_TIPO_FOR_STATO, tipoDocColors } from "@/lib/documentiView";
import { trpc } from "@/lib/trpc";
import { DOC_TIPO_LABEL, docTipoLabel, type DocTipo } from "@shared/docTipi";

/**
 * Un documento del fascicolo come lo restituisce
 * `preventiviContratti.byCommessa` (i byte restano sul server: la lista
 * porta solo i metadati). Forma strutturale, così la query passa il suo
 * risultato senza conversioni.
 */
export type DocumentoFascicolo = {
  id: number;
  nome: string;
  tipo: string;
  mimeType: string;
  size: number;
  note: string | null;
  createdAt: Date | string;
  source?: string;
};

export default function ElencoDocumentiCommessa({
  commessaId,
  stato,
  documenti,
  onLeggiContratto,
  onCollegaOrdine,
  onInviaEmail,
  onApriAnteprima,
  onCambiato,
  compatto = false,
}: {
  commessaId: number;
  /** Stato della commessa: sceglie il tipo suggerito all'apertura del caricamento. */
  stato?: string | null;
  /** `undefined` mentre la query carica: l'elenco resta vuoto, senza lo stato «Nessun documento». */
  documenti: DocumentoFascicolo[] | undefined;
  /** Apre il dialog di lettura assistita del contratto (montato da chi usa il componente). */
  onLeggiContratto?: (documento: DocumentoFascicolo) => void;
  /** Apre il collegamento assistito documento → ordine fornitore. */
  onCollegaOrdine?: (documento: DocumentoFascicolo) => void;
  /** Apre l'invio via email di preventivo o contratto (vuole i dati del cliente). */
  onInviaEmail?: (documento: DocumentoFascicolo) => void;
  /**
   * Anteprima ospitata da chi usa il componente. Senza questa callback il
   * componente monta la propria `FilePreviewDialog`: la scheda commessa ne
   * ha già una (la card economia apre i documenti da lì) e la passa per non
   * tenerne due aperte sullo stesso file.
   */
  onApriAnteprima?: (documento: DocumentoFascicolo) => void;
  /** Il fascicolo è cambiato (caricamento, riclassifica, eliminazione). */
  onCambiato?: () => void;
  /** Densità ridotta: il fascicolo dentro un passo guidato, non in una tab. */
  compatto?: boolean;
}) {
  const utils = trpc.useUtils();
  // Kill switch Document Intelligence e lettura del contratto: la UI
  // nasconde, il server decide. Stessa query (e stessa cache) della pagina.
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const collegamentoAttivo = Boolean(interruttori.data?.documentIntelligence);
  // La lettura del contratto PDF vive dietro due interruttori come la
  // fatturazione: senza contratto strutturato non c'è nulla da applicare.
  const estrazioneAttiva =
    Boolean(interruttori.data?.contrattoEstrazione) &&
    Boolean(interruttori.data?.limiti);

  // Il caricamento: `tipo` è il tipo preselezionato per QUESTA apertura —
  // c'è quando il dialog si apre dal suo pulsante (tipo suggerito dallo
  // stato), non quando si apre dal fascicolo vuoto.
  const [caricamento, setCaricamento] = useState<{
    aperto: boolean;
    tipo?: string;
  }>({ aperto: false });

  // Rinomina e riclassifica un documento gia caricato. Il tipo conta per il
  // doc gate: un contratto caricato come "altro" blocca un avanzamento
  // legittimo, e finora si poteva correggere solo ricaricando il file.
  const [rinominaDoc, setRinominaDoc] = useState<DocumentoFascicolo | null>(
    null
  );
  const [rinominaForm, setRinominaForm] = useState({ nome: "", tipo: "altro" });
  const [eliminaDoc, setEliminaDoc] = useState<DocumentoFascicolo | null>(null);
  // Anteprima interna: usata solo quando chi ospita il componente non ne
  // offre una propria con `onApriAnteprima`.
  const [anteprima, setAnteprima] = useState<{
    id: number;
    nome: string;
    mimeType: string;
    url: string;
  } | null>(null);

  const tipoSuggerito = stato ? SUGGESTED_TIPO_FOR_STATO[stato] : undefined;

  // Il fascicolo muove il margine: una conferma d'ordine che entra, esce o
  // cambia tipo fa nascere o sparire il costo fornitore (03/09/2026).
  const aggiornaEconomia = () => {
    utils.commesse.margine.invalidate(commessaId);
    utils.commesse.marginalita.invalidate();
  };
  const deleteDocumento = trpc.preventiviContratti.delete.useMutation({
    onSuccess: () => {
      utils.preventiviContratti.invalidate();
      aggiornaEconomia();
      setEliminaDoc(null);
      onCambiato?.();
    },
  });
  const rinominaDocumento = trpc.preventiviContratti.update.useMutation({
    onSuccess: () => {
      utils.preventiviContratti.invalidate();
      aggiornaEconomia();
      setRinominaDoc(null);
      toast.success("Documento aggiornato");
      onCambiato?.();
    },
    onError: e => toast.error(e.message ?? "Modifica non riuscita"),
  });

  function documentoFileUrl(docId: number, download = false): string {
    return `/api/documenti/${docId}/file${download ? "?download=1" : ""}`;
  }

  function downloadDocumento(docId: number) {
    const a = document.createElement("a");
    a.href = documentoFileUrl(docId, true);
    a.click();
  }

  function apriAnteprima(d: DocumentoFascicolo) {
    if (onApriAnteprima) {
      onApriAnteprima(d);
      return;
    }
    setAnteprima({
      id: d.id,
      nome: d.nome,
      mimeType: d.mimeType,
      url: documentoFileUrl(d.id),
    });
  }

  return (
    <div className={compatto ? "space-y-3" : "space-y-4"}>
      <div className="flex justify-end">
        <CaricaDocumentoDialog
          commessaId={commessaId}
          open={caricamento.aperto}
          onOpenChange={aperto =>
            setCaricamento(aperto ? { aperto, tipo: tipoSuggerito } : { aperto })
          }
          tipoIniziale={caricamento.tipo}
          tipoSuggerito={tipoSuggerito}
          onCaricato={onCambiato}
          trigger={
            <Button size="sm">
              <Upload className="h-4 w-4 mr-1" />
              Carica file
            </Button>
          }
        />
      </div>

      {documenti?.length === 0 ? (
        <div
          className={`flex flex-col items-center gap-2 text-center ${
            compatto ? "py-8" : "py-12"
          }`}
        >
          <FileText className="h-9 w-9 text-text-3" />
          <p className="text-[15px] font-semibold">Nessun documento</p>
          <p className="text-sm text-text-2 max-w-xs">
            Qui compariranno preventivi, contratti, fatture e foto. Usa il
            pulsante per caricare un file.
          </p>
          <Button size="sm" variant="outline" onClick={() => setCaricamento({ aperto: true })}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Carica file
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          {documenti?.map(d => (
            <Card key={d.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {d.nome}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${tipoDocColors[d.tipo] ?? ""}`}
                      >
                        {docTipoLabel(d.tipo)}
                      </Badge>
                      {d.source === "fic" && (
                        <Badge variant="outline" className="text-[10px]">
                          Fatture in Cloud
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>
                        {d.size >= 1024 * 1024
                          ? `${(d.size / (1024 * 1024)).toFixed(1)} MB`
                          : `${(d.size / 1024).toFixed(1)} KB`}
                      </span>
                      <span>
                        {new Date(d.createdAt).toLocaleDateString("it-IT")}
                      </span>
                    </div>
                    {d.note && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {d.note}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {(d.mimeType === "application/pdf" ||
                    d.mimeType?.startsWith("image/") ||
                    d.mimeType?.startsWith("video/")) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Anteprima"
                      aria-label={`Anteprima ${d.nome}`}
                      onClick={() => apriAnteprima(d)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {onInviaEmail &&
                    (d.tipo === "preventivo" || d.tipo === "contratto") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-info hover:text-info hover:bg-info-soft"
                      title="Invia via email"
                      aria-label={`Invia ${d.nome} via email`}
                      onClick={() => onInviaEmail(d)}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Scarica"
                    aria-label={`Scarica ${d.nome}`}
                    onClick={() => downloadDocumento(d.id)}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  {onCollegaOrdine &&
                    (d.mimeType ?? "").toLowerCase().includes("pdf") &&
                    collegamentoAttivo && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Collega a un ordine fornitore"
                      aria-label={`Collega ${d.nome} a un ordine fornitore`}
                      onClick={() => onCollegaOrdine(d)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {onLeggiContratto &&
                    d.tipo === "contratto" &&
                    (d.mimeType ?? "").toLowerCase().includes("pdf") &&
                    estrazioneAttiva && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Leggi il contratto"
                      aria-label={`Leggi il contratto ${d.nome}`}
                      onClick={() => onLeggiContratto(d)}
                    >
                      <ScanText className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Rinomina o cambia tipo"
                    aria-label={`Rinomina ${d.nome}`}
                    onClick={() => {
                      setRinominaDoc(d);
                      setRinominaForm({ nome: d.nome, tipo: d.tipo });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-danger hover:text-danger hover:bg-danger-soft"
                    aria-label={`Elimina ${d.nome}`}
                    onClick={() => setEliminaDoc(d)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Anteprima propria: solo quando chi ospita il componente non ne
          offre già una (v. `onApriAnteprima`). */}
      {!onApriAnteprima && (
        <FilePreviewDialog
          preview={anteprima}
          onClose={() => setAnteprima(null)}
          onDownload={() => anteprima && downloadDocumento(anteprima.id)}
        />
      )}

      <ConfirmDialog
        open={!!eliminaDoc}
        onOpenChange={open => !open && setEliminaDoc(null)}
        title="Eliminare documento?"
        description={`Stai per eliminare "${eliminaDoc?.nome ?? ""}". Questa azione non puo essere annullata.`}
        destructive
        confirmLabel="Elimina"
        onConfirm={() => {
          if (!eliminaDoc) return;
          deleteDocumento.mutate(eliminaDoc.id);
        }}
      />

      <Dialog
        open={!!rinominaDoc}
        onOpenChange={open => !open && setRinominaDoc(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rinomina documento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome file</Label>
              <Input
                value={rinominaForm.nome}
                onChange={e =>
                  setRinominaForm({ ...rinominaForm, nome: e.target.value })
                }
                placeholder="Documento d'identita Rossi Mario.pdf"
              />
              <p className="text-[11px] text-muted-foreground">
                Il nome e libero: tienici l&apos;estensione del file.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo documento</Label>
              <Select
                value={rinominaForm.tipo}
                onValueChange={v => setRinominaForm({ ...rinominaForm, tipo: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TIPO_LABEL).map(([tipo, label]) => (
                    <SelectItem key={tipo} value={tipo}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRinominaDoc(null)}>
              Annulla
            </Button>
            <Button
              disabled={!rinominaForm.nome.trim() || rinominaDocumento.isPending}
              onClick={() =>
                rinominaDoc &&
                rinominaDocumento.mutate({
                  id: rinominaDoc.id,
                  nome: rinominaForm.nome.trim(),
                  tipo: rinominaForm.tipo as DocTipo,
                })
              }
            >
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
