import { useEffect, useRef, useState } from "react";
import { Bug, ImagePlus, Lightbulb, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  pesoLeggibile,
  preparaImmagine,
  tipoAmmesso,
  type ImmagineAllegata,
} from "@/lib/feedbackImmagine";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type TipoFeedback = "bug" | "consiglio";

const TESTO_MINIMO = 10;
const TESTO_MASSIMO = 4000;

const SCELTE: {
  tipo: TipoFeedback;
  etichetta: string;
  spiega: string;
  icona: typeof Bug;
}[] = [
  {
    tipo: "bug",
    etichetta: "Qualcosa non funziona",
    spiega: "Un errore, un dato sbagliato, una pagina che non si apre.",
    icona: Bug,
  },
  {
    tipo: "consiglio",
    etichetta: "Ho un consiglio",
    spiega: "Un'idea, un passaggio scomodo, qualcosa che manca.",
    icona: Lightbulb,
  },
];

export type FeedbackDialogProps = {
  aperto: boolean;
  onCambiaApertura: (aperto: boolean) => void;
  /** Con quale scelta si apre: il menu può già saperlo. */
  tipoIniziale?: TipoFeedback;
};

/**
 * Il modulo della segnalazione. Chiede due cose — di che si tratta e che
 * cosa è successo — e allega un'immagine se serve. Tutto il resto (azienda,
 * sede, utente, pagina, browser) lo mette il server: è la parte che nessuno
 * scrive mai e senza cui una segnalazione non si riproduce.
 */
export default function FeedbackDialog({
  aperto,
  onCambiaApertura,
  tipoIniziale = "bug",
}: FeedbackDialogProps) {
  const [location] = useLocation();
  const [tipo, setTipo] = useState<TipoFeedback>(tipoIniziale);
  const [testo, setTesto] = useState("");
  const [immagine, setImmagine] = useState<ImmagineAllegata | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const testoRef = useRef<HTMLTextAreaElement>(null);
  // La pagina si legge all'APERTURA: se poi qualcuno naviga con il dialogo
  // aperto, la segnalazione riguarda comunque il punto da cui è partita.
  const paginaRef = useRef(location);

  const invia = trpc.feedback.invia.useMutation({
    onSuccess: () => {
      toast.success("Segnalazione inviata", {
        description: "Grazie: il supporto Wyndoor l'ha ricevuta e ti risponde per email.",
      });
      onCambiaApertura(false);
    },
    onError: e => setErrore(e.message),
  });

  useEffect(() => {
    if (!aperto) return;
    paginaRef.current = location;
    setTipo(tipoIniziale);
    setTesto("");
    setImmagine(null);
    setErrore(null);
    setPreparando(false);
    invia.reset();
    // `location` volutamente fuori: si fotografa all'apertura, non a ogni
    // cambio di rotta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aperto, tipoIniziale]);

  const allega = async (file: File | null | undefined) => {
    if (!file) return;
    setErrore(null);
    setPreparando(true);
    try {
      setImmagine(await preparaImmagine(file));
    } catch (e) {
      setImmagine(null);
      setErrore(e instanceof Error ? e.message : "Non riesco a leggere questa immagine.");
    } finally {
      setPreparando(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Incollare la schermata è il gesto naturale dopo ⌘⇧4 o Stamp: senza
  // questo, l'unica strada sarebbe salvare il file e ripescarlo.
  const incolla = (evento: React.ClipboardEvent) => {
    const file = Array.from(evento.clipboardData?.files ?? []).find(f =>
      tipoAmmesso(f.type)
    );
    if (!file) return;
    evento.preventDefault();
    void allega(file);
  };

  const testoPulito = testo.trim();
  const troppoCorto = testoPulito.length < TESTO_MINIMO;
  const inCorso = invia.isPending || preparando;

  const spedisci = () => {
    if (troppoCorto || inCorso) return;
    setErrore(null);
    invia.mutate({
      tipo,
      testo: testoPulito,
      pagina: paginaRef.current || null,
      immagine: immagine
        ? {
            nome: immagine.nome,
            tipo: immagine.tipo,
            contenutoBase64: immagine.contenutoBase64,
          }
        : null,
    });
  };

  return (
    <Dialog open={aperto} onOpenChange={onCambiaApertura}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto sm:max-w-lg"
        onPaste={incolla}
        // Radix porta il fuoco sul primo elemento attivabile — il pulsante di
        // chiusura — e chi apre il modulo si trova a scrivere nel vuoto. Il
        // cursore va dove si scrive.
        onOpenAutoFocus={evento => {
          evento.preventDefault();
          testoRef.current?.focus();
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle>Scrivi al supporto Wyndoor</DialogTitle>
          <DialogDescription>
            Arriva a chi sviluppa il gestionale. Azienda, sede, pagina e browser
            li alleghiamo noi: raccontaci solo che cosa è successo.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div role="radiogroup" aria-label="Tipo di segnalazione" className="grid gap-2 sm:grid-cols-2">
            {SCELTE.map(scelta => {
              const Icona = scelta.icona;
              const scelto = tipo === scelta.tipo;
              return (
                <button
                  key={scelta.tipo}
                  type="button"
                  role="radio"
                  aria-checked={scelto}
                  onClick={() => setTipo(scelta.tipo)}
                  className={cn(
                    "flex min-h-11 min-w-0 items-start gap-2.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)]",
                    scelto
                      ? "border-primary bg-brand-soft text-text-1"
                      : "border-border-soft bg-surface hover:bg-surface-2"
                  )}
                >
                  <Icona
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      scelto ? "text-accent-text" : "text-text-3"
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-5">
                      {scelta.etichetta}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 text-text-3">
                      {scelta.spiega}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="feedback-testo">
              {tipo === "bug" ? "Che cosa è successo?" : "Che cosa miglioreresti?"}
            </Label>
            <Textarea
              id="feedback-testo"
              ref={testoRef}
              value={testo}
              onChange={e => setTesto(e.target.value.slice(0, TESTO_MASSIMO))}
              rows={6}
              placeholder={
                tipo === "bug"
                  ? "Es. salvo la conferma d'ordine e la commessa resta vuota. Succede da stamattina, su tutte le commesse."
                  : "Es. nell'elenco fatture servirebbe un filtro per fornitore."
              }
              className="min-h-32 resize-y"
            />
            <p className="text-xs text-text-3">
              {troppoCorto
                ? `Ancora ${TESTO_MINIMO - testoPulito.length} caratteri: due righe bastano, ma servono.`
                : `${testoPulito.length} / ${TESTO_MASSIMO} caratteri.`}
            </p>
          </div>

          <div className="min-w-0 space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={e => void allega(e.target.files?.[0])}
            />
            {immagine ? (
              <div className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-2">
                <img
                  src={immagine.anteprima}
                  alt="Anteprima dell'immagine allegata"
                  className="h-14 w-20 shrink-0 rounded-md border border-border-soft object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-1">{immagine.nome}</p>
                  <p className="text-xs text-text-3">{pesoLeggibile(immagine.byte)}</p>
                </div>
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  onClick={() => setImmagine(null)}
                  aria-label="Togli l'immagine allegata"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                disabled={preparando}
                onClick={() => fileRef.current?.click()}
              >
                {preparando ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                )}
                {preparando ? "Preparo l'immagine…" : "Allega un'immagine (facoltativo)"}
              </Button>
            )}
            <p className="text-xs text-text-3">
              Puoi anche incollare qui una schermata copiata. Massimo 2 MB: la
              rimpiccioliamo noi prima di spedirla.
            </p>
          </div>

          {errore ? (
            <p role="alert" className="text-sm text-danger">
              {errore}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambiaApertura(false)}
            disabled={invia.isPending}
          >
            Annulla
          </Button>
          <Button type="button" onClick={spedisci} disabled={troppoCorto || inCorso}>
            {invia.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {invia.isPending ? "Invio…" : "Invia al supporto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
