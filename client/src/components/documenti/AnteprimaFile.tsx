// L'anteprima di un file, ovunque serva (08/09/2026, mandato della
// direzione: «devo sempre poter aprire il file e avere un'anteprima»,
// «devo poter vedere l'anteprima dei file inviati su whatsapp»).
//
// Un componente solo per i documenti del fascicolo e per gli allegati dei
// messaggi: cambia solo l'indirizzo. PDF nel riquadro, immagini a schermo,
// video e vocali con i loro comandi, e in ogni caso il tasto per aprirlo in
// una scheda.
//
// Regola d'onestà: un allegato può non esserci più — Meta scarta i media
// WhatsApp dopo circa trenta giorni e la casella di posta può essere stata
// staccata. In quel caso il riquadro dice cosa è successo, con le parole
// del server, invece di mostrare un rettangolo bianco.

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type FileDaVedere = {
  nome: string;
  mimeType: string;
  /** L'indirizzo che serve i byte: documento del fascicolo o allegato. */
  url: string;
  /** Riga sotto il titolo: fornitore, data, commessa, mittente… */
  sottotitolo?: string | null;
  /** Una riga in fondo: cosa porta il file, chi lo ha mandato… */
  note?: string | null;
};

type Contenuto =
  | { stato: "carico" }
  | { stato: "pronto"; src: string }
  | { stato: "assente"; motivo: string };

export default function AnteprimaFile({
  file,
  onClose,
}: {
  file: FileDaVedere | null;
  onClose: () => void;
}) {
  const [contenuto, setContenuto] = useState<Contenuto>({ stato: "carico" });
  const url = file?.url ?? null;

  // I byte si chiedono una volta e si tengono come blob: così l'anteprima
  // non fa una seconda richiesta e l'errore del server si può leggere.
  useEffect(() => {
    if (!url) return;
    let vivo = true;
    let creato: string | null = null;
    setContenuto({ stato: "carico" });
    void (async () => {
      try {
        const risposta = await fetch(url, { credentials: "same-origin" });
        if (!risposta.ok) {
          const corpo = await risposta.json().catch(() => null);
          if (!vivo) return;
          setContenuto({
            stato: "assente",
            motivo:
              (corpo as any)?.error ??
              `Il file non è disponibile (errore ${risposta.status}).`,
          });
          return;
        }
        const blob = await risposta.blob();
        if (!vivo) return;
        creato = URL.createObjectURL(blob);
        setContenuto({ stato: "pronto", src: creato });
      } catch {
        if (vivo) setContenuto({ stato: "assente", motivo: "Il file non si è caricato." });
      }
    })();
    return () => {
      vivo = false;
      if (creato) URL.revokeObjectURL(creato);
    };
  }, [url]);

  const mime = file?.mimeType ?? "";
  const immagine = mime.startsWith("image/");
  const video = mime.startsWith("video/");
  const audio = mime.startsWith("audio/");
  const pdf = mime === "application/pdf";

  return (
    <Dialog open={file != null} onOpenChange={v => (!v ? onClose() : undefined)}>
      <DialogContent className="flex h-[88vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-3 overflow-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle className="min-w-0 break-words text-base [overflow-wrap:anywhere]">
            {file?.nome ?? "Anteprima"}
          </DialogTitle>
          <DialogDescription className="min-w-0 break-words">
            {file?.sottotitolo ?? ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-[var(--radius-control)] border border-border-soft bg-surface-2">
          {file == null ? null : contenuto.stato === "carico" ? (
            <span className="inline-flex items-center gap-2 p-6 text-sm text-text-3">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              Carico il file…
            </span>
          ) : contenuto.stato === "assente" ? (
            <p className="max-w-prose p-6 text-sm text-text-2">{contenuto.motivo}</p>
          ) : immagine ? (
            <img
              src={contenuto.src}
              alt={`Anteprima di ${file.nome}`}
              className="mx-auto block max-h-full max-w-full object-contain"
            />
          ) : video ? (
            <video src={contenuto.src} controls className="max-h-full max-w-full" />
          ) : audio ? (
            <audio src={contenuto.src} controls className="w-full max-w-lg p-6" />
          ) : pdf ? (
            <iframe
              title={`Anteprima di ${file.nome}`}
              src={contenuto.src}
              className="h-full w-full border-0"
            />
          ) : (
            <p className="max-w-prose p-6 text-sm text-text-2">
              Questo tipo di file ({mime || "sconosciuto"}) non si vede qui dentro. Aprilo in
              una scheda per leggerlo.
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="min-h-11">
            <a href={file?.url ?? "#"} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Apri in una scheda
            </a>
          </Button>
          {file?.note ? (
            <span className="min-w-0 break-words text-xs text-text-3">{file.note}</span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
