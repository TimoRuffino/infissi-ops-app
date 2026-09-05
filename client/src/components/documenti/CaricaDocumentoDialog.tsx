// Il caricamento di un file nel fascicolo della commessa: tipo, file, note.
//
// Estratto tale e quale dalla tab «File e documenti» di
// `pages/CommessaDetail.tsx`. Vive da solo perché due posti lo aprono e uno
// dei due sta fuori dalle tab: il banner del gate documentale («Manca un
// documento» → «Carica file») resta visibile su ogni tab, mentre l'elenco
// del fascicolo viene smontato quando la tab non è attiva. Un solo dialog
// dentro l'elenco lascerebbe quel pulsante senza effetto.
//
// L'apertura è controllata da chi lo monta; `tipoIniziale` sceglie il tipo
// solo quando c'è (il banner passa il tipo mancante, l'elenco il tipo
// suggerito dallo stato), altrimenti il modulo resta com'era.
import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  COMMESSA_UPLOAD_ACCEPT,
  COMMESSA_UPLOAD_MAX_MB,
  erroreUploadCommessa,
  normalizzaMimeUploadCommessa,
} from "@shared/commessaUpload";
import { DOC_TIPO_LABEL } from "@shared/docTipi";

export default function CaricaDocumentoDialog({
  commessaId,
  open,
  onOpenChange,
  tipoIniziale,
  tipoSuggerito,
  trigger,
  onCaricato,
}: {
  commessaId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tipo preselezionato all'apertura; assente = si tiene quello di prima. */
  tipoIniziale?: string;
  /**
   * Il tipo che lo stato della commessa si aspetta: solo su quello compare
   * l'avviso «sbloccherà l'avanzamento». Non coincide sempre col tipo
   * preselezionato — uno stato può richiedere due documenti (preventivo e
   * contratto) e il banner del gate apre sul primo che manca.
   */
  tipoSuggerito?: string;
  /** Il pulsante che apre il dialog, quando chi lo monta ne vuole uno. */
  trigger?: ReactNode;
  /** Caricamento riuscito: il fascicolo è cambiato. */
  onCaricato?: () => void;
}) {
  const utils = trpc.useUtils();
  // Id unici per istanza (piano 4): il banner del gate documentale e
  // l'elenco del fascicolo possono montare due istanze di questo dialog
  // insieme su /commesse/:id — id statici duplicherebbero `id`/`for` nel DOM.
  const idBase = useId();
  const fileInputId = `${idBase}-file`;
  const helpId = `${idBase}-help`;
  const erroreId = `${idBase}-errore`;
  const [form, setForm] = useState({
    file: null as File | null,
    tipo: "preventivo" as string,
    note: "",
  });
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  // Preset tipo to the state-required document when the user opens the
  // upload dialog — one less click in 90% of cases.
  useEffect(() => {
    if (!open) return;
    setErrore(null);
    if (tipoIniziale) setForm(prev => ({ ...prev, tipo: tipoIniziale }));
  }, [open, tipoIniziale]);

  async function handleUpload() {
    if (!form.file) return;
    const file = form.file;
    const mimeType = normalizzaMimeUploadCommessa(file.name, file.type);
    const erroreFile = erroreUploadCommessa(file.size, mimeType);
    if (erroreFile) {
      setErrore(erroreFile);
      return;
    }
    setErrore(null);
    setInCorso(true);
    try {
      const response = await fetch(
        `/api/commesse/${commessaId}/documenti/file`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
            "X-File-Mime-Type": encodeURIComponent(mimeType),
            "X-Document-Type": form.tipo,
            ...(form.note
              ? { "X-File-Note": encodeURIComponent(form.note) }
              : {}),
          },
          body: file,
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Caricamento non riuscito.");
      }
      await utils.preventiviContratti.invalidate();
      // Il fascicolo muove il margine: una conferma d'ordine che entra, esce
      // o cambia tipo fa nascere o sparire il costo fornitore (03/09/2026).
      utils.commesse.margine.invalidate(commessaId);
      utils.commesse.marginalita.invalidate();
      onOpenChange(false);
      setForm({ file: null, tipo: "preventivo", note: "" });
      setErrore(null);
      toast.success("File caricato nella commessa");
      onCaricato?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Caricamento non riuscito.";
      setErrore(message);
      toast.error("Caricamento non riuscito", { description: message });
    } finally {
      setInCorso(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Carica file</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="space-y-1.5">
            <Label>Tipo documento</Label>
            <Select
              value={form.tipo}
              onValueChange={v => setForm({ ...form, tipo: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              {/* La lista arriva da @shared/docTipi, la stessa che
                  il router usa per l'enum e per il gate: un tipo
                  nuovo compare qui senza doverlo ricopiare. */}
              <SelectContent>
                {Object.entries(DOC_TIPO_LABEL).map(([tipo, label]) => (
                  <SelectItem key={tipo} value={tipo}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tipoSuggerito && form.tipo === tipoSuggerito && (
              <p className="text-[11px] text-success bg-success-soft border border-success/40 rounded px-2 py-1">
                Tipo suggerito per lo stato corrente — caricando questo file si
                sbloccher&agrave; l&apos;avanzamento
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={fileInputId}>
              File (max {COMMESSA_UPLOAD_MAX_MB} MB)
            </Label>
            <Input
              id={fileInputId}
              type="file"
              accept={COMMESSA_UPLOAD_ACCEPT}
              aria-invalid={!!errore}
              aria-describedby={
                errore ? `${helpId} ${erroreId}` : helpId
              }
              onChange={e => {
                const file = e.target.files?.[0] ?? null;
                const erroreFile = file
                  ? erroreUploadCommessa(
                      file.size,
                      normalizzaMimeUploadCommessa(file.name, file.type)
                    )
                  : null;
                setErrore(erroreFile);
                setForm({
                  ...form,
                  file,
                });
              }}
            />
            <p id={helpId} className="text-xs text-muted-foreground">
              PDF, immagini, documenti e video MP4, MOV o WebM.
            </p>
            {errore && (
              <p id={erroreId} role="alert" className="text-xs text-destructive">
                {errore}
              </p>
            )}
            {form.file && (
              <p className="text-xs text-muted-foreground">
                {form.file.name} —{" "}
                {form.file.size >= 1024 * 1024
                  ? `${(form.file.size / (1024 * 1024)).toFixed(1)} MB`
                  : `${(form.file.size / 1024).toFixed(1)} KB`}
              </p>
            )}
            {inCorso && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                I file grandi possono richiedere qualche minuto. Non chiudere la
                pagina.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea
              rows={2}
              value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <Button
            onClick={handleUpload}
            disabled={!form.file || !!errore || inCorso}
          >
            {inCorso ? "Caricamento..." : "Carica"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
