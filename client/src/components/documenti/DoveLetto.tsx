// Il tasto «Dove l'ho letto» e la vignetta con il ritaglio della pagina
// (anteprime delle evidenze, 06/09/2026). Un componente solo per tutte le
// superfici: riceve documento ed evidenza (inline, oppure il nome del campo
// da leggere con `preventiviContratti.evidenzeDocumento`), disegna il tasto
// e la vignetta ancorata sopra, fa i conti del ritaglio con lib/anteprime.
//
// Regola d'onestà: la vignetta mostra ciò che l'estrattore ha davvero letto.
// Senza posizione mostra la pagina intera e lo dice; senza evidenza
// registrata lo dice e rimanda al PDF. Mai un ritaglio indovinato.
//
// Spec: docs/superpowers/specs/2026-09-06-anteprime-evidenze-design.md §2, §5.
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Maximize2, Minimize2, ScanSearch } from "lucide-react";
import type { CampoEvidenzaCosto, EvidenzaLetta, FonteTesto } from "@shared/documenti/evidenze";
import { trpc } from "@/lib/trpc";
import { formatEuroSimbolo } from "@/lib/euro";
import {
  calcolaRitaglio,
  etichettaFonte,
  etichettaGrado,
  larghezzaConsigliata,
  urlPaginaDocumento,
  urlPdfAllaPagina,
} from "@/lib/anteprime";
import { Button } from "@/components/ui/button";
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Altezza minima della riga letta nel ritaglio: il testo dell'interfaccia. */
const ALTEZZA_RIGA_MINIMA_PX = 13;
/** Tetto della vignetta: mai più del 45 % dello schermo. */
const FRAZIONE_ALTEZZA_MASSIMA = 0.45;

export type DoveLettoProps = {
  documentoId: number;
  /**
   * L'evidenza inline. `null` = il valore non ha evidenza (nessun tasto);
   * assente = si legge dal server per `campo`.
   */
  evidenza?: EvidenzaLetta | null;
  /** Il campo della lettura costo da mostrare, quando l'evidenza non è inline. */
  campo?: CampoEvidenzaCosto;
  fonte?: FonteTesto | null;
  confidenzaOcr?: number | null;
  /** Il valore come lo ha letto il sistema, se chi monta lo conosce. */
  valoreLetto?: string | null;
  /** Il valore che il dato ha oggi: se diverso da quello letto, la vignetta lo dice. */
  valoreAttuale?: string | null;
  /** Testo del tooltip e dell'aria-label, se serve più preciso. */
  etichetta?: string;
  className?: string;
};

function valoreLettoDaCampo(
  campo: CampoEvidenzaCosto | undefined,
  valori: { imponibile: number | null; fornitore: string | null; numeroOrdine: string | null; dataDocumento: string | null } | undefined
): string | null {
  if (!campo || !valori) return null;
  switch (campo) {
    case "imponibile":
      return valori.imponibile != null ? formatEuroSimbolo(valori.imponibile) : null;
    case "fornitore":
      return valori.fornitore;
    case "numeroConferma":
    case "riferimentoOrdine":
      return valori.numeroOrdine;
    case "dataDocumento":
      return valori.dataDocumento;
    default:
      return null;
  }
}

export default function DoveLetto({
  documentoId,
  evidenza,
  campo,
  fonte,
  confidenzaOcr,
  valoreLetto,
  valoreAttuale,
  etichetta = "Dove l'ho letto",
  className,
}: DoveLettoProps) {
  const [aperto, setAperto] = useState(false);
  const interruttori = trpc.platform.interruttori.useQuery(undefined, { staleTime: 300_000 });
  const attivo = Boolean(interruttori.data?.anteprimeEvidenze);
  const inline = evidenza !== undefined;

  // In modalità «campo» l'evidenza si legge dal server, solo all'apertura.
  const lettura = trpc.preventiviContratti.evidenzeDocumento.useQuery(
    { documentoId },
    { enabled: attivo && aperto && !inline && !!campo, staleTime: 60_000 }
  );
  const evidenzaRisolta: EvidenzaLetta | null = inline
    ? (evidenza ?? null)
    : campo === "riscontro"
      ? (lettura.data?.evidenze?.riscontro?.[0] ?? null)
      : campo
        ? (lettura.data?.evidenze?.[campo] as EvidenzaLetta | null | undefined) ?? null
        : null;
  const fonteDalServer = lettura.data?.fonteTesto;
  const fonteRisolta: FonteTesto | null =
    fonte ?? (fonteDalServer && fonteDalServer !== "nessuna" ? fonteDalServer : null);
  const lettoRisolto = valoreLetto ?? valoreLettoDaCampo(campo, lettura.data?.valori);

  if (!attivo) return null;
  if (inline && !evidenza) return null;

  const pagina = evidenzaRisolta?.pagina ?? 1;
  const urlPagina = urlPaginaDocumento(documentoId, pagina);

  return (
    <Popover open={aperto} onOpenChange={setAperto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-7 w-7 shrink-0 text-text-3 hover:text-text-1 ${className ?? ""}`}
          title={etichetta}
          aria-label={etichetta}
          onMouseEnter={() => {
            // Prefetch: al click l'immagine è già scaricata.
            if (evidenzaRisolta) new Image().src = urlPagina;
          }}
        >
          <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        collisionPadding={12}
        // Il pannello si stringe sul contenuto: la larghezza la decide la
        // vignetta (fra 480 e 640 px, mai oltre il 92 % dello schermo).
        className="w-auto max-w-[92vw] p-2 text-text-1"
      >
        <PopoverArrow className="fill-popover" width={14} height={7} />
        {aperto && (
          <Vignetta
            documentoId={documentoId}
            evidenza={evidenzaRisolta}
            inCaricamento={!inline && !!campo && lettura.isLoading}
            erroreLettura={!inline && !!campo && lettura.isError}
            fonte={fonteRisolta}
            confidenzaOcr={confidenzaOcr ?? null}
            valoreLetto={lettoRisolto}
            valoreAttuale={valoreAttuale ?? null}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function Vignetta({
  documentoId,
  evidenza,
  inCaricamento,
  erroreLettura,
  fonte,
  confidenzaOcr,
  valoreLetto,
  valoreAttuale,
}: {
  documentoId: number;
  evidenza: EvidenzaLetta | null;
  inCaricamento: boolean;
  erroreLettura: boolean;
  fonte: FonteTesto | null;
  confidenzaOcr: number | null;
  valoreLetto: string | null;
  valoreAttuale: string | null;
}) {
  const [paginaIntera, setPaginaIntera] = useState(false);
  const [misure, setMisure] = useState<{ w: number; h: number } | null>(null);
  const [erroreImmagine, setErroreImmagine] = useState(false);
  const scatola = useRef<HTMLDivElement | null>(null);
  const [larghezzaVista, setLarghezzaVista] = useState(0);
  const [altezzaMassima, setAltezzaMassima] = useState(320);

  const pagina = evidenza?.pagina ?? 1;
  const posizione = evidenza?.area ?? null;
  const url = urlPaginaDocumento(documentoId, pagina);

  // La larghezza della vista: fra 480 e 640 px, mai oltre il 92 % dello
  // schermo meno il bordo del pannello; la pagina intera prende il massimo.
  // Il tetto in altezza è il 45 % dello schermo.
  useEffect(() => {
    const misura = () => {
      const larghezzaSchermo = typeof window !== "undefined" ? window.innerWidth : 480;
      const consigliata = paginaIntera
        ? 640
        : misure
          ? larghezzaConsigliata({
              posizione,
              larghezzaImmagine: misure.w,
              altezzaImmagine: misure.h,
              altezzaRigaMinima: ALTEZZA_RIGA_MINIMA_PX,
            })
          : 480;
      const larghezza = Math.min(consigliata, Math.floor(larghezzaSchermo * 0.92) - 20);
      setLarghezzaVista(Math.max(200, larghezza));
      setAltezzaMassima(
        Math.max(160, Math.floor((typeof window !== "undefined" ? window.innerHeight : 800) * FRAZIONE_ALTEZZA_MASSIMA) - 96)
      );
    };
    misura();
    window.addEventListener("resize", misura);
    return () => window.removeEventListener("resize", misura);
  }, [misure, posizione, paginaIntera]);

  // Pagina intera: la scatola scorre, e parte dal punto in cui sta il frammento.
  useEffect(() => {
    if (paginaIntera && scatola.current && ritaglioCorrente.current) {
      scatola.current.scrollTop = ritaglioCorrente.current.offsetY;
      scatola.current.scrollLeft = 0;
    }
  }, [paginaIntera, misure]);

  useEffect(() => {
    setMisure(null);
    setErroreImmagine(false);
    setPaginaIntera(false);
  }, [url]);

  const ritaglio = useMemo(
    () =>
      misure && larghezzaVista > 0
        ? calcolaRitaglio({
            posizione,
            paginaIntera,
            larghezzaImmagine: misure.w,
            altezzaImmagine: misure.h,
            larghezzaVista,
            altezzaMassima,
            altezzaRigaMinima: ALTEZZA_RIGA_MINIMA_PX,
          })
        : null,
    [misure, larghezzaVista, altezzaMassima, posizione, paginaIntera]
  );
  const ritaglioCorrente = useRef(ritaglio);
  ritaglioCorrente.current = ritaglio;
  // Misure dell'immagine resa alla scala del ritaglio: la pagina intera vive
  // in questo spazio e scorre dentro la scatola.
  const larghezzaResa = misure && ritaglio ? misure.w * ritaglio.scala : 0;
  const altezzaResa = misure && ritaglio ? misure.h * ritaglio.scala : 0;

  const apriPdf = () => {
    window.open(urlPdfAllaPagina(documentoId, pagina), "_blank", "noopener,noreferrer");
  };

  const grado = posizione?.grado ?? null;
  const senzaEvidenza = !evidenza && !inCaricamento;

  return (
    <div className="space-y-1.5 min-w-0" style={{ width: larghezzaVista ? `${larghezzaVista}px` : undefined }}>
      <p className="text-[11px] leading-snug text-text-3 min-w-0">
        {inCaricamento
          ? "Cerco dove l'ho letto…"
          : senzaEvidenza
            ? "Nessuna evidenza registrata per questo valore: rileggi la conferma o apri il PDF."
            : `pag. ${pagina} · ${etichettaFonte(fonte, confidenzaOcr)} · ${
                paginaIntera ? "pagina intera" : etichettaGrado(grado)
              }${grado === "pagina" && !paginaIntera ? " (posizione non trovata su questa pagina)" : ""}`}
      </p>

      {!senzaEvidenza && !erroreLettura && (
        <div
          ref={scatola}
          className={`relative max-w-full rounded-md border border-border bg-surface-2 ${
            paginaIntera ? "overflow-auto" : "overflow-hidden"
          }`}
          style={{
            width: larghezzaVista ? `${larghezzaVista}px` : "100%",
            height: ritaglio ? `${Math.round(ritaglio.altezza)}px` : "120px",
          }}
        >
          {!misure && !erroreImmagine && (
            <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />
          )}
          {erroreImmagine ? (
            <p className="p-3 text-xs text-text-2">Anteprima non disponibile: apri il PDF.</p>
          ) : (
            // La pagina resa alla scala del ritaglio, con il rettangolo nello
            // stesso spazio: nel ritaglio si sposta di offset, nella pagina
            // intera resta ferma e la scatola scorre.
            <div
              className="relative"
              style={{
                width: larghezzaResa ? `${larghezzaResa}px` : undefined,
                height: altezzaResa ? `${altezzaResa}px` : undefined,
                transform:
                  ritaglio && !paginaIntera
                    ? `translate(${-ritaglio.offsetX}px, ${-ritaglio.offsetY}px)`
                    : undefined,
                visibility: ritaglio ? "visible" : "hidden",
              }}
            >
              <img
                src={url}
                alt={`Pagina ${pagina} del documento, ritaglio della zona letta`}
                draggable={false}
                className="block max-w-none select-none"
                style={{
                  width: larghezzaResa ? `${larghezzaResa}px` : undefined,
                  height: altezzaResa ? `${altezzaResa}px` : undefined,
                }}
                onLoad={e => setMisure({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setErroreImmagine(true)}
              />
              {ritaglio?.rettangolo && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10"
                  style={{
                    left: `${ritaglio.rettangolo.left + ritaglio.offsetX - 2}px`,
                    top: `${ritaglio.rettangolo.top + ritaglio.offsetY - 2}px`,
                    width: `${ritaglio.rettangolo.width + 4}px`,
                    height: `${ritaglio.rettangolo.height + 4}px`,
                  }}
                />
              )}
            </div>
          )}
          {/* Bordi sfumati (c'è altro a sinistra/destra): ombre interne, niente gradienti fuori da DataSurface. */}
          {ritaglio?.sfumaSinistra && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-8"
              style={{ boxShadow: "inset 24px 0 16px -12px var(--surface-2)" }}
            />
          )}
          {ritaglio?.sfumaDestra && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-8"
              style={{ boxShadow: "inset -24px 0 16px -12px var(--surface-2)" }}
            />
          )}
        </div>
      )}

      {erroreLettura && (
        <p className="text-xs text-danger">Non riesco a leggere le evidenze di questo documento.</p>
      )}

      {evidenza && (
        <p className="text-[11px] leading-snug text-text-2 min-w-0 break-words">
          «{evidenza.frammento}»
        </p>
      )}
      {valoreLetto && valoreAttuale && valoreLetto !== valoreAttuale && (
        <p className="text-[11px] leading-snug text-warning min-w-0">
          Letto {valoreLetto}, oggi {valoreAttuale}: il valore è stato corretto dopo la lettura.
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {evidenza && posizione && posizione.grado !== "pagina" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setPaginaIntera(v => !v)}
          >
            {paginaIntera ? (
              <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {paginaIntera ? "Solo il ritaglio" : "Pagina intera"}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={apriPdf}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {`Apri PDF alla pagina ${pagina}`}
        </Button>
      </div>
    </div>
  );
}
