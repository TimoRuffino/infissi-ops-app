// Lettura assistita del contratto PDF (piano 3): la proposta del modello si
// legge, si corregge e SOLO allora si applica al contratto strutturato.
//
// Come CollegaOrdineDialog, qui non parte niente da solo: ogni campo
// proposto arriva con la sua evidenza («pag. N — «frammento»») e col badge
// «da verificare» quando il modello non se la sente, i controlli stanno in
// testa e l'applicazione è un click dell'operatore. Il client non decide
// nulla: la disponibilità, i permessi e la verità del contratto restano del
// server (estrazioniContratto.stato → `disponibile`, `motivo`, `puoApplicare`).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, PencilLine, Plus, RefreshCw, ScanText, Trash2, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatEuro, parseEuroNonNegativo } from "@/lib/euro";
import { centToEuro, euroToCent } from "@shared/euroCent";
import {
  campiDaVerificare,
  erroriForm,
  parametriDaProposta,
  rateDefault,
  riepilogoControlli,
  rigaDaProposta,
  zonaPerRevisione,
  type CatalogoContratto,
  type RigaForm,
} from "@/lib/contrattoView";
import {
  DETRAZIONE_TIPI,
  type ContrattoInput,
  type DetrazioneTipo,
  type PattuitoTipo,
} from "@shared/limiti/tipi";
import type { CampoProposto, EvidenzaEstratta } from "@shared/contratti/estrazione";
import RigaContrattoEditor from "@/components/contratto/RigaContrattoEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATALOGO_VUOTO: CatalogoContratto = { prodotti: [], accessori: [], controtelai: [], opere: [] };

const ETICHETTA_DETRAZIONE: Record<DetrazioneTipo, string> = {
  nessuna: "Nessuna",
  ecobonus: "Ecobonus",
  ristrutturazione: "Ristrutturazione",
};

/** Limite del motivo dello scarto, come `estrazioniContratto.scarta`: un motivo è una riga. */
const MAX_MOTIVO_SCARTO = 300;

/** Il motivo arriva dal server con o senza punto finale: la frase ne vuole uno solo. */
function conPunto(testo: string): string {
  return testo.replace(/\.?$/, ".");
}

/** La nota che il lettore ha lasciato su una riga o sulla testata: si legge, non si modifica. */
function NotaDelLettore({ testo }: { testo: string | null }) {
  if (!testo) return null;
  return (
    <p className="text-[11px] leading-snug text-text-3 min-w-0 break-words">
      Nota del lettore: {testo}
    </p>
  );
}

/** Da dove viene il valore: la citazione del PDF, e la nota se il modello ne ha una. */
function EvidenzaCampo({ evidenza, nota }: { evidenza: EvidenzaEstratta | null; nota?: string | null }) {
  if (!evidenza && !nota) return null;
  return (
    <p className="text-[11px] leading-snug text-text-3 min-w-0 break-words">
      {evidenza && <span>pag. {evidenza.pagina} — «{evidenza.frammento}»</span>}
      {nota && <span className="block text-warning">{nota}</span>}
    </p>
  );
}

/**
 * Un campo della testata: etichetta, badge di verifica, il controllo vero e
 * sotto l'evidenza. Il badge non blocca niente — dice solo dove guardare
 * prima di applicare.
 */
function CampoLetto({
  etichetta,
  campo,
  htmlFor,
  children,
}: {
  etichetta: string;
  campo: CampoProposto<unknown>;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Label htmlFor={htmlFor} className="text-xs text-text-3">
          {etichetta}
        </Label>
        {campo.daVerificare && (
          <Badge variant="outline" className="text-[10px] border-warning/50 bg-warning-soft text-warning">
            da verificare
          </Badge>
        )}
      </div>
      {children}
      <EvidenzaCampo evidenza={campo.evidenza} nota={campo.nota} />
    </div>
  );
}

export default function LeggiContrattoDialog({
  commessaId,
  documento,
  onClose,
  onApplicato,
}: {
  commessaId: number;
  documento: { id: number; nome: string } | null;
  onClose: () => void;
  /** Porta l'operatore al contratto strutturato: dopo l'applicazione e dopo «Compila a mano». */
  onApplicato: () => void;
}) {
  const utils = trpc.useUtils();
  const aperto = documento != null;
  const documentoId = documento?.id ?? 0;

  const stato = trpc.estrazioniContratto.stato.useQuery(
    { commessaId, documentoId },
    { enabled: aperto, retry: false }
  );
  const ultima = stato.data?.ultima ?? null;
  const proposta = ultima?.stato === "proposta" ? ultima.proposta : null;

  // Catalogo DEI per le voci delle righe: stessa query della tab Contratto,
  // tenuta in cache (non dipende dalla commessa).
  const catalogoQ = trpc.contratti.catalogo.useQuery(undefined, {
    enabled: proposta != null,
    staleTime: Infinity,
    retry: false,
  });
  // Il contratto già salvato serve a due cose sole: dire la zona climatica
  // vera (la deriva il server dal comune, il client non la calcola) e
  // avvisare che applicare SOSTITUISCE quello che c'è.
  const contrattoQ = trpc.contratti.get.useQuery(
    { commessaId },
    { enabled: proposta != null, retry: false }
  );
  // Chi ha applicato: solo per scriverne il nome nel riepilogo.
  const utentiQ = trpc.utenti.list.useQuery(undefined, {
    enabled: ultima?.stato === "applicata",
    staleTime: 300_000,
  });

  const [parametri, setParametri] = useState<ContrattoInput | null>(null);
  const [righe, setRighe] = useState<RigaForm[]>([]);
  const [avvertenzeRighe, setAvvertenzeRighe] = useState<Record<string, string[]>>({});
  const [pattuitoTesto, setPattuitoTesto] = useState("");
  const [posaTesto, setPosaTesto] = useState("");
  const [quoteTesto, setQuoteTesto] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState("");
  // Quale proposta è stata caricata nel form: senza questo ogni refetch
  // riscriverebbe sopra le correzioni dell'operatore.
  const [caricata, setCaricata] = useState<number | null>(null);

  useEffect(() => {
    if (!aperto) return;
    if (!ultima || !proposta || caricata === ultima.id) return;
    const p = parametriDaProposta(proposta, ultima.documentoId);
    const nuove = proposta.righe.map(rigaDaProposta);
    setParametri(p);
    setRighe(nuove);
    // Le avvertenze della riga stanno sulla chiave, non sull'indice: una
    // riga rimossa non deve spostare gli avvisi di quelle sotto.
    setAvvertenzeRighe(
      Object.fromEntries(nuove.map((r, i) => [r.chiave, proposta.righe[i]?.avvertenze ?? []]))
    );
    setPattuitoTesto(formatEuro(centToEuro(p.pattuitoCent)));
    setPosaTesto(p.posaCent != null ? formatEuro(centToEuro(p.posaCent)) : "");
    setQuoteTesto({});
    setCaricata(ultima.id);
  }, [aperto, ultima, proposta, caricata]);

  const azzera = () => {
    setParametri(null);
    setRighe([]);
    setAvvertenzeRighe({});
    setPattuitoTesto("");
    setPosaTesto("");
    setQuoteTesto({});
    setMotivo("");
    setCaricata(null);
  };

  const ricarica = () => utils.estrazioniContratto.stato.invalidate({ commessaId, documentoId });

  const esegui = trpc.estrazioniContratto.esegui.useMutation({
    onSuccess: ({ riusata }) => {
      // Una rilettura riparte dalla proposta del server: le correzioni in
      // corso decadono, ed è quello che «Rileggi» promette.
      setCaricata(null);
      void ricarica();
      toast.success(riusata ? "Proposta già pronta per questo documento" : "Contratto letto");
    },
    onError: e => toast.error(e.message ?? "Lettura non riuscita"),
  });

  const applica = trpc.estrazioniContratto.applica.useMutation({
    onSuccess: (esito, variabili) => {
      void utils.contratti.get.invalidate({ commessaId: variabili.commessaId });
      void utils.estrazioniContratto.stato.invalidate({ commessaId: variabili.commessaId, documentoId });
      // Il contratto cambia: il computo salvato e il pattuito specchiato
      // sulla commessa non sono più quelli (come fa `contratti.salva`).
      void utils.computo.ultimo.invalidate({ commessaId: variabili.commessaId });
      void utils.commesse.invalidate();
      toast.success("Contratto applicato");
      esito.avvertenze.forEach(a => toast.warning(a));
      onApplicato();
    },
    onError: e => toast.error(e.message ?? "Applicazione non riuscita"),
  });

  const scarta = trpc.estrazioniContratto.scarta.useMutation({
    onSuccess: () => {
      setCaricata(null);
      void ricarica();
      setMotivo("");
      toast.success("Proposta scartata");
    },
    onError: e => toast.error(e.message ?? "Scarto non riuscito"),
  });

  const catalogo: CatalogoContratto = catalogoQ.data ?? CATALOGO_VUOTO;
  // P3-R30: la zona del contratto salvato vale qui solo se parla dello stesso
  // cantiere della proposta; altrimenti il badge e il filtro del catalogo DEI
  // mostrerebbero prezzi di un altro comune.
  const zona = proposta ? zonaPerRevisione(proposta, contrattoQ.data?.contratto) : null;
  const disponibile = stato.data?.disponibile ?? false;
  const puoApplicare = stato.data?.puoApplicare ?? false;
  const occupato = esegui.isPending || applica.isPending || scarta.isPending;
  const controlli = proposta ? riepilogoControlli(proposta.controlli) : { errori: [], avvisi: [] };
  const daVerificare = proposta ? campiDaVerificare(proposta) : [];
  const errori = parametri ? erroriForm(parametri, righe) : [];

  const aggiorna = (patch: Partial<ContrattoInput>) =>
    setParametri(prev => (prev ? { ...prev, ...patch } : prev));
  const cambiaRate = (rate: ContrattoInput["rate"]) => {
    setQuoteTesto({});
    aggiorna({ rate });
  };

  const leggi = (forza: boolean) => esegui.mutate({ commessaId, documentoId, forza });

  return (
    <Dialog
      open={aperto}
      onOpenChange={open => {
        if (!open) {
          azzera();
          onClose();
        }
      }}
    >
      <DialogContent className="flex flex-col gap-0 p-0 w-full max-w-none h-[100dvh] max-h-[100dvh] rounded-none overflow-hidden sm:h-auto sm:max-h-[88vh] sm:max-w-4xl sm:rounded-[var(--radius-dialog)]">
        {/* pr-12: la X del dialog sta in alto a destra, il nome del file non le finisce sotto. */}
        <DialogHeader className="shrink-0 space-y-1 border-b border-border-soft px-4 py-3 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanText className="h-4 w-4 shrink-0" />
            Leggi il contratto
          </DialogTitle>
          <DialogDescription className="text-xs text-text-3 min-w-0 break-words">
            {documento?.nome}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto px-4 py-3 space-y-4">
          {stato.isLoading && (
            <div className="py-6 grid place-items-center">
              <Loader2 className="h-5 w-5 animate-spin text-text-3" />
            </div>
          )}
          {stato.error && <p className="text-sm text-danger">{stato.error.message}</p>}

          {/* P3-R31: senza nessuna lettura precedente il pannello è la via
              d'uscita («Compila a mano»); con una proposta già letta è solo
              una riga informativa — il contratto lo si scrive comunque da
              qui, applicando la proposta, e un pulsante che porta altrove
              sopra una proposta applicabile è un invito sbagliato. */}
          {stato.data && !disponibile && ultima && (
            <p className="rounded-md border border-warning/40 bg-warning-soft/40 p-3 text-sm">
              Lettura automatica non disponibile:{" "}
              {conPunto(stato.data.motivo ?? "il servizio di lettura non è raggiungibile")} La proposta
              esistente resta rivedibile; «Rileggi» è disattivato.
            </p>
          )}

          {stato.data && !disponibile && !ultima && (
            <div className="rounded-md border border-warning/40 bg-warning-soft/40 p-3 space-y-2">
              <p className="text-sm">
                Lettura automatica non disponibile:{" "}
                {stato.data.motivo ?? "il servizio di lettura non è raggiungibile."}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  // Stessa destinazione dell'applicazione — la tab Contratto —
                  // ma senza proposta: il contratto si scrive a mano.
                  onApplicato();
                  azzera();
                  onClose();
                }}
              >
                <PencilLine className="h-4 w-4 mr-1" /> Compila a mano
              </Button>
            </div>
          )}

          {stato.data && disponibile && !ultima && (
            <div className="space-y-2 py-4 text-center">
              <p className="text-sm text-text-3">
                Questo documento non è ancora stato letto. La lettura propone righe e testata:
                nulla viene salvato finché non applichi.
              </p>
              <Button disabled={!puoApplicare || occupato} onClick={() => leggi(false)}>
                {esegui.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Lettura in corso… (fino a due
                    minuti per le scansioni)
                  </>
                ) : (
                  <>
                    <ScanText className="h-4 w-4 mr-1" /> Leggi il contratto
                  </>
                )}
              </Button>
              {!puoApplicare && (
                <p className="text-xs text-text-3">Non hai il permesso di leggere e applicare il contratto.</p>
              )}
            </div>
          )}

          {ultima?.stato === "applicata" && (
            <div className="rounded-md border border-success/40 bg-success-soft/40 p-3 text-sm space-y-1">
              <p className="flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0 text-success" />
                Proposta applicata
                {ultima.applicataAt && ` il ${new Date(ultima.applicataAt).toLocaleDateString("it-IT")}`}
                {(() => {
                  const u = utentiQ.data?.find((x: { id: number }) => x.id === ultima.applicataBy);
                  return u ? ` da ${u.nome} ${u.cognome}` : "";
                })()}
              </p>
              <p className="text-xs text-text-3">
                Il contratto strutturato è quello applicato: si corregge dalla tab Contratto.
                «Rileggi» propone una nuova lettura dello stesso PDF, senza toccare il contratto.
              </p>
            </div>
          )}

          {ultima?.stato === "scartata" && (
            <div className="rounded-md border border-border p-3 text-sm space-y-1">
              <p className="flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0 text-text-3" />
                Proposta scartata
                {ultima.scartataMotivo ? `: ${ultima.scartataMotivo}` : "."}
              </p>
              <p className="text-xs text-text-3">
                Nessun contratto è stato modificato. «Rileggi» ne propone una nuova.
              </p>
            </div>
          )}

          {proposta && parametri && (
            <>
              <p className="text-[11px] text-text-3 min-w-0">
                Letta il {new Date(ultima!.createdAt).toLocaleDateString("it-IT")}
                {ultima!.modello ? ` con ${ultima!.modello}` : ""}
                {ultima!.pagine != null ? ` · ${ultima!.pagine} pagine` : ""}
                {ultima!.ocr ? " · da scansione (OCR)" : ""}
              </p>

              {controlli.errori.length > 0 && (
                <ul className="text-xs text-danger list-disc pl-4 space-y-0.5" aria-live="polite">
                  {controlli.errori.map(e => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {controlli.avvisi.length > 0 && (
                <ul className="text-xs text-warning list-disc pl-4 space-y-0.5">
                  {controlli.avvisi.map(a => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
              {proposta.avvertenze.map(a => (
                <p key={a} className="text-xs text-warning">
                  {a}
                </p>
              ))}
              {daVerificare.length > 0 && (
                <p className="text-xs text-text-3">
                  Da verificare sul PDF: <span className="text-warning">{daVerificare.join(", ")}</span>.
                </p>
              )}
              {/* P3-R29: la nota di testata (quel che il lettore ha letto ma
                  non è entrato in nessun campo) finora non si vedeva da
                  nessuna parte. */}
              <NotaDelLettore testo={proposta.note} />
              {contrattoQ.data?.contratto && (
                <p className="text-xs text-warning">
                  Un contratto esiste già ({contrattoQ.data.righe.length}{" "}
                  {contrattoQ.data.righe.length === 1 ? "riga" : "righe"}): applicando lo sostituisci.
                </p>
              )}

              {/* Testata */}
              <section aria-label="Testata del contratto letto" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <CampoLetto etichetta="Pattuito €" campo={proposta.pattuitoCent} htmlFor="lettura-pattuito">
                  <Input
                    id="lettura-pattuito"
                    inputMode="decimal"
                    value={pattuitoTesto}
                    disabled={!puoApplicare}
                    onChange={e => {
                      setPattuitoTesto(e.target.value);
                      const euro = parseEuroNonNegativo(e.target.value);
                      if (euro != null) aggiorna({ pattuitoCent: euroToCent(euro) });
                      else if (e.target.value.trim() === "") aggiorna({ pattuitoCent: 0 });
                    }}
                    onBlur={() => {
                      const euro = parseEuroNonNegativo(pattuitoTesto);
                      setPattuitoTesto(formatEuro(euro ?? centToEuro(parametri.pattuitoCent)));
                    }}
                  />
                </CampoLetto>

                <CampoLetto etichetta="Il pattuito è" campo={proposta.pattuitoTipo}>
                  <Select
                    value={parametri.pattuitoTipo}
                    disabled={!puoApplicare}
                    onValueChange={v => aggiorna({ pattuitoTipo: v as PattuitoTipo })}
                  >
                    <SelectTrigger aria-label="Tipo di pattuito">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lordo">Lordo, IVA inclusa</SelectItem>
                      <SelectItem value="imponibile">Imponibile, IVA esclusa</SelectItem>
                    </SelectContent>
                  </Select>
                </CampoLetto>

                <CampoLetto etichetta="Posa" campo={proposta.posaInclusa}>
                  <Label className="flex items-center gap-2 h-9 text-sm">
                    <Switch
                      checked={parametri.posaInclusa}
                      disabled={!puoApplicare}
                      aria-label="Posa inclusa nel prezzo"
                      onCheckedChange={v => {
                        if (!v) setPosaTesto("");
                        aggiorna({ posaInclusa: v, posaCent: v ? parametri.posaCent : null });
                      }}
                    />
                    inclusa nel prezzo
                  </Label>
                </CampoLetto>

                {parametri.posaInclusa && (
                  <CampoLetto etichetta="Prezzo posa (€)" campo={proposta.posaCent} htmlFor="lettura-posa">
                    <Input
                      id="lettura-posa"
                      inputMode="decimal"
                      value={posaTesto}
                      disabled={!puoApplicare}
                      onChange={e => {
                        setPosaTesto(e.target.value);
                        const euro = parseEuroNonNegativo(e.target.value);
                        if (euro != null) aggiorna({ posaCent: euroToCent(euro) });
                        else if (e.target.value.trim() === "") aggiorna({ posaCent: null });
                      }}
                      onBlur={() => {
                        const euro = parseEuroNonNegativo(posaTesto);
                        setPosaTesto(euro != null ? formatEuro(euro) : "");
                        aggiorna({ posaCent: euro != null ? euroToCent(euro) : null });
                      }}
                    />
                  </CampoLetto>
                )}

                <CampoLetto
                  etichetta="Comune del cantiere"
                  campo={proposta.comuneCantiere}
                  htmlFor="lettura-comune"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <Input
                      id="lettura-comune"
                      className="min-w-[8rem] flex-1"
                      value={parametri.comuneCantiere ?? ""}
                      disabled={!puoApplicare}
                      onChange={e => aggiorna({ comuneCantiere: e.target.value || null })}
                    />
                    <Badge variant="outline" className="shrink-0">
                      {zona ? `zona ${zona}` : "zona calcolata all'applicazione"}
                    </Badge>
                  </div>
                </CampoLetto>

                <CampoLetto etichetta="Piano" campo={proposta.piano} htmlFor="lettura-piano">
                  <Input
                    id="lettura-piano"
                    type="number"
                    value={parametri.piano ?? ""}
                    disabled={!puoApplicare}
                    onChange={e => aggiorna({ piano: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </CampoLetto>

                <CampoLetto etichetta="Data firma" campo={proposta.dataFirma} htmlFor="lettura-firma">
                  <Input
                    id="lettura-firma"
                    type="date"
                    value={parametri.dataFirma ?? ""}
                    disabled={!puoApplicare}
                    onChange={e => aggiorna({ dataFirma: e.target.value || null })}
                  />
                </CampoLetto>

                <CampoLetto etichetta="Detrazione" campo={proposta.detrazioneTipo}>
                  <Select
                    value={parametri.detrazioneTipo}
                    disabled={!puoApplicare}
                    onValueChange={v => aggiorna({ detrazioneTipo: v as DetrazioneTipo })}
                  >
                    <SelectTrigger aria-label="Tipo di detrazione">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DETRAZIONE_TIPI.map(t => (
                        <SelectItem key={t} value={t}>
                          {ETICHETTA_DETRAZIONE[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CampoLetto>
              </section>

              {/* Rate lette dal contratto */}
              <section aria-label="Rate lette dal contratto" className="space-y-2 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">Rate</span>
                  {proposta.rate.daVerificare && (
                    <Badge variant="outline" className="text-[10px] border-warning/50 bg-warning-soft text-warning">
                      da verificare
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {parametri.rate.reduce((s, r) => s + r.quotaPct, 0)}% del pattuito
                  </span>
                  {puoApplicare && parametri.rate.length === 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => cambiaRate(rateDefault())}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> 50/40/10
                    </Button>
                  )}
                </div>
                <EvidenzaCampo evidenza={proposta.rate.evidenza} nota={proposta.rate.nota} />
                {parametri.rate.map((rata, i) => (
                  <div
                    key={rata.numero}
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 items-center text-sm md:grid-cols-[2.5rem_5rem_5rem_minmax(0,1fr)_2.25rem]"
                  >
                    <span className="tabular-nums text-text-3">{rata.numero}ª</span>
                    <Input
                      inputMode="decimal"
                      aria-label={`Quota in percento della rata ${rata.numero}`}
                      placeholder="%"
                      value={quoteTesto[rata.numero] ?? String(rata.quotaPct)}
                      disabled={!puoApplicare}
                      onChange={e => {
                        const testo = e.target.value;
                        setQuoteTesto(q => ({ ...q, [rata.numero]: testo }));
                        const quota = parseEuroNonNegativo(testo);
                        if (quota != null) {
                          aggiorna({
                            rate: parametri.rate.map((r, j) =>
                              j === i ? { ...r, quotaPct: Math.min(100, quota) } : r
                            ),
                          });
                        }
                      }}
                      onBlur={() =>
                        setQuoteTesto(q => {
                          const resto = { ...q };
                          delete resto[rata.numero];
                          return resto;
                        })
                      }
                    />
                    <Input
                      type="number"
                      aria-label={`Giorni della rata ${rata.numero}`}
                      placeholder="giorni"
                      value={rata.giorni ?? ""}
                      disabled={!puoApplicare}
                      onChange={e =>
                        aggiorna({
                          rate: parametri.rate.map((r, j) =>
                            j === i ? { ...r, giorni: e.target.value === "" ? null : Number(e.target.value) } : r
                          ),
                        })
                      }
                    />
                    <Input
                      className="col-span-3 md:col-span-1"
                      aria-label={`Descrizione della rata ${rata.numero}`}
                      placeholder="Descrizione"
                      value={rata.descrizione ?? ""}
                      disabled={!puoApplicare}
                      onChange={e =>
                        aggiorna({
                          rate: parametri.rate.map((r, j) =>
                            j === i ? { ...r, descrizione: e.target.value || null } : r
                          ),
                        })
                      }
                    />
                    {puoApplicare && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-danger hover:text-danger hover:bg-danger-soft"
                        aria-label={`Rimuovi la rata ${rata.numero}`}
                        onClick={() =>
                          cambiaRate(
                            parametri.rate.filter((_, j) => j !== i).map((r, j) => ({ ...r, numero: j + 1 }))
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </section>

              {/* Righe lette */}
              <section aria-label="Righe lette dal contratto" className="space-y-2 min-w-0">
                <span className="text-sm font-medium">Righe lette ({righe.length})</span>
                {righe.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nessuna riga letta: applicando salveresti solo la testata.
                  </p>
                )}
                {righe.map((r, i) => (
                  <div key={r.chiave} className="space-y-1 min-w-0">
                    <EvidenzaCampo evidenza={r.evidenza} />
                    {(avvertenzeRighe[r.chiave] ?? []).map(a => (
                      <p key={a} className="text-[11px] text-warning">
                        {a}
                      </p>
                    ))}
                    {/* P3-R29: accessori non riconosciuti e oscuranti abbinati
                        finiscono qui, e l'editor della riga non li mostra: si
                        salverebbero senza che nessuno li abbia mai letti. */}
                    <NotaDelLettore testo={r.note} />
                    <RigaContrattoEditor
                      riga={r}
                      indice={i}
                      puoModificare={puoApplicare}
                      zona={zona}
                      catalogo={catalogo}
                      onChange={patch =>
                        setRighe(prev => prev.map(x => (x.chiave === r.chiave ? { ...x, ...patch } : x)))
                      }
                      onRimuovi={() => setRighe(prev => prev.filter(x => x.chiave !== r.chiave))}
                    />
                  </div>
                ))}
              </section>

              {errori.length > 0 && (
                <ul className="text-xs text-danger list-disc pl-4 space-y-0.5" aria-live="polite">
                  {errori.map(e => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {stato.data && (ultima != null || disponibile) && (
          <div className="shrink-0 border-t border-border-soft px-4 py-3 flex flex-wrap items-end justify-end gap-2 min-w-0">
            {proposta && puoApplicare && (
              <div className="space-y-0.5 flex-1 min-w-[10rem]">
                <Label htmlFor="lettura-motivo" className="text-[11px] text-text-3">
                  Motivo dello scarto (facoltativo)
                </Label>
                <Input
                  id="lettura-motivo"
                  value={motivo}
                  maxLength={MAX_MOTIVO_SCARTO}
                  onChange={e => setMotivo(e.target.value)}
                  placeholder="Es. è il preventivo, non il contratto"
                />
              </div>
            )}
            {ultima && (
              <Button
                variant="outline"
                disabled={!puoApplicare || !disponibile || occupato}
                title={!disponibile ? (stato.data.motivo ?? undefined) : undefined}
                onClick={() => leggi(true)}
              >
                {esegui.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                {esegui.isPending ? "Lettura in corso…" : "Rileggi"}
              </Button>
            )}
            {proposta && (
              <Button
                variant="dangerGhost"
                disabled={!puoApplicare || occupato}
                onClick={() =>
                  scarta.mutate({ estrazioneId: ultima!.id, motivo: motivo.trim() || undefined })
                }
              >
                <XCircle className="h-4 w-4 mr-1" /> Scarta
              </Button>
            )}
            {proposta && parametri && (
              <Button
                disabled={!puoApplicare || occupato || errori.length > 0}
                onClick={() =>
                  applica.mutate({
                    commessaId,
                    estrazioneId: ultima!.id,
                    contratto: parametri,
                    righe: righe.map(({ chiave: _chiave, ...resto }) => resto),
                  })
                }
              >
                {applica.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Applica al contratto
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
