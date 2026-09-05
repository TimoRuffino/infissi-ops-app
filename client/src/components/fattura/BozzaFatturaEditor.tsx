// L'editor della bozza di fattura: importi di beni e servizi, righe scritte
// a mano, riequilibrio dei beni, scadenze, diciture e note. Nessun calcolo
// qui — il riepilogo, il markup e i limiti li rifà il server a ogni
// `aggiornaBozza`, quindi i numeri mostrati sono sempre quelli salvati e il
// salvataggio è esplicito (`StickyActionBar` con `dirty`).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Scale,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import type { inferRouterInputs } from "@trpc/server";

import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { DICITURE, type ChiaveDicitura } from "@shared/fatturazione/diciture";
import type { RigaFattura } from "@shared/fatturazione/tipi";
import {
  azionePerControllo,
  DICITURE_SELEZIONABILI,
  ETICHETTA_DICITURA,
  ETICHETTA_TIPO_RIGA,
  indicatoreLimite,
  raggruppaRighe,
  riepilogoControlli,
  riepilogoView,
  testoDicitura,
  type AzioneControllo,
} from "@/lib/fatturaView";
import {
  formatEuro,
  formatEuroSimbolo,
  parseEuroNonNegativo,
} from "@/lib/euro";
import { hrefPasso } from "@/lib/fatturazioneView";
import { formatCent } from "@/lib/limitiView";
import ConfirmDialog from "@/components/ConfirmDialog";
import DataSurface from "@/components/patterns/DataSurface";
import StickyActionBar from "@/components/patterns/StickyActionBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import ScadenzeEditor, {
  scadenzaDaServer,
  scadenzaInput,
  type ScadenzaForm,
} from "@/components/fattura/ScadenzeEditor";

/** La modifica accettata dal router: si legge dal contratto, non si riscrive a mano. */
type ModificaBozza =
  inferRouterInputs<AppRouter>["fatture"]["aggiornaBozza"]["modifica"];

/** I passi dell'emissione, come li chiama `server/fatture/emissione.ts`. */
const ETICHETTA_PASSO: Record<string, string> = {
  validazione: "Validazione",
  cliente_fic: "Cliente su Fatture in Cloud",
  documento_fic: "Documento su Fatture in Cloud",
  confronto_totali: "Confronto dei totali",
  xml: "XML",
  invio: "Invio allo SdI",
  archivio: "Archiviazione PDF/XML",
  documento_fascicolo: "Documento nel fascicolo",
  timeline: "Timeline della commessa",
};

/** Righe con un importo che l'operatore può correggere (D-A: i derivati li rifà il risolutore). */
function correggibile(r: RigaFattura): boolean {
  return !r.derivata && (r.tipo === "bene" || r.tipo === "servizio");
}
/** Righe nate a mano in bozza (R18): le sole che si possono togliere davvero. */
function scrittaAMano(r: RigaFattura): boolean {
  return (
    correggibile(r) && r.rigaCommessaId == null && r.voceComputoCodice == null
  );
}

type RigaAggiunta = {
  chiave: string;
  tipo: "bene" | "servizio";
  descrizione: string;
  importoTesto: string;
  beneSignificativo: boolean;
};

/** Quante righe accetta `aggiornaBozza` in una modifica (MAX_RIGHE_AGGIUNTE lato server). */
const MAX_RIGHE_AGGIUNTE = 20;

function centDaTesto(testo: string): number | null {
  const euro = parseEuroNonNegativo(testo);
  return euro == null ? null : Math.round(euro * 100);
}

/**
 * I campi vivi di una riga in bozza: l'input dell'importo con la sua
 * normalizzazione, l'indicatore di limite e il pulsante di rimozione.
 *
 * Torna i tre pezzi separati invece di un sottoalbero perché la tabella li
 * mette in tre celle diverse e la card mobile li impila: la logica sta qui
 * una volta sola, alle due viste restano le rispettive strutture.
 */
function RigaBozzaCampi({
  r,
  testo,
  puoModificare,
  inRimozione,
  classeInput,
  classeBottone,
  onImporto,
  onNormalizza,
  onRimozione,
}: {
  r: RigaFattura;
  testo: string;
  puoModificare: boolean;
  inRimozione: boolean;
  classeInput: string;
  classeBottone: string;
  onImporto: (testo: string) => void;
  onNormalizza: () => void;
  onRimozione: () => void;
}): { importo: ReactNode; indicatore: ReactNode; rimozione: ReactNode } {
  const indicatore = indicatoreLimite(r);
  const modificabile = correggibile(r) && puoModificare && !inRimozione;
  return {
    importo: modificabile ? (
      <Input
        inputMode="decimal"
        className={classeInput}
        aria-label={`Importo di ${r.descrizione}`}
        value={testo}
        onChange={e => onImporto(e.target.value)}
        onBlur={onNormalizza}
      />
    ) : (
      <span className="tabular-nums">{formatCent(r.importoCent)}</span>
    ),
    // `block`: sulla card mobile l'indicatore è figlio diretto di uno
    // `space-y-2`, e un margine verticale su un elemento inline non produce
    // spazio. Dentro la cella della tabella il rendering non cambia.
    // Un badge, non una frase: «entro il limite (€ 1.234,00)» ripetuto su
    // ogni riga era una colonna di testo. Il numero resta nel tooltip.
    indicatore: indicatore.testo ? (
      <Badge
        variant={indicatore.stato === "ok" ? "success" : "warning"}
        className="block w-fit"
        title={indicatore.testo}
      >
        {indicatore.stato === "ok"
          ? "entro il limite"
          : indicatore.testo.replace("oltre il limite di", "oltre di")}
      </Badge>
    ) : null,
    rimozione:
      puoModificare && scrittaAMano(r) ? (
        <Button
          variant="ghost"
          size="icon"
          className={`${classeBottone} text-danger hover:text-danger hover:bg-danger-soft`}
          aria-label={
            inRimozione
              ? `Ripristina ${r.descrizione}`
              : `Rimuovi ${r.descrizione}`
          }
          onClick={onRimozione}
        >
          {inRimozione ? (
            <Undo2 className="h-4 w-4" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      ) : null,
  };
}

export default function BozzaFatturaEditor({
  commessaId,
  fatturaId,
  puoModificare,
  puoEmettere,
  dryRun,
  onAnnullata,
  onCambiato,
}: {
  commessaId: number;
  fatturaId: number;
  puoModificare: boolean;
  puoEmettere: boolean;
  /** Da `fatture.perCommessa`: dichiarato sempre nella conferma di emissione. */
  dryRun: boolean;
  onAnnullata: () => void;
  /**
   * L'emissione ha cambiato lo stato della fattura: chi monta l'editor
   * (il percorso guidato del piano 4) rilegge i propri passi. L'annullamento
   * passa già da `onAnnullata`. Assente: nessuno ascolta, niente cambia.
   */
  onCambiato?: () => void;
}) {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const dettaglio = trpc.fatture.byId.useQuery(
    { id: fatturaId },
    { retry: false }
  );
  const validazioni = trpc.fatture.validazioni.useQuery(
    { id: fatturaId },
    { retry: false }
  );

  const [importi, setImporti] = useState<Record<number, string>>({});
  const [aggiunte, setAggiunte] = useState<RigaAggiunta[]>([]);
  const [rimosse, setRimosse] = useState<number[]>([]);
  const [scadenze, setScadenze] = useState<ScadenzaForm[]>([]);
  const [scadenzeToccate, setScadenzeToccate] = useState(false);
  const [diciture, setDiciture] = useState<ChiaveDicitura[]>([]);
  const [cantiere, setCantiere] = useState("");
  const [note, setNote] = useState("");
  const [scavalco, setScavalco] = useState({ attivo: false, motivo: "" });
  const [sporco, setSporco] = useState(false);

  const [dialogoRiga, setDialogoRiga] = useState(false);
  const [nuovaRiga, setNuovaRiga] = useState<RigaAggiunta | null>(null);
  const [dialogoRiequilibrio, setDialogoRiequilibrio] = useState(false);
  const [markupTesto, setMarkupTesto] = useState("0,00");
  const [confermaEmissione, setConfermaEmissione] = useState(false);
  const [confermaRigenera, setConfermaRigenera] = useState(false);
  const [confermaAnnulla, setConfermaAnnulla] = useState(false);
  // Confronto con la fattura vera (studio 05/09): hook PRIMA delle uscite
  // anticipate qui sotto, altrimenti l'ordine cambia fra un render e l'altro
  // (React #310, visto in produzione).
  const [mostraConfronto, setMostraConfronto] = useState(false);
  const confronto = trpc.fatture.confrontaConFic.useQuery({ id: fatturaId }, { enabled: mostraConfronto, retry: false });
  // Chiavi React delle righe aggiunte: un contatore per montaggio, non di
  // modulo — due editor aperti non si rubano i numeri.
  const contatoreAggiunte = useRef(0);

  // Il form segue il server finché l'operatore non tocca niente: dopo un
  // salvataggio il server rinumera le righe, quindi ripartire dai suoi dati
  // è l'unico modo di non scrivere su un `ordine` che non esiste più.
  useEffect(() => {
    if (!dettaglio.data || sporco) return;
    const f = dettaglio.data.fattura;
    setImporti(
      Object.fromEntries(
        f.righe
          .filter(correggibile)
          .map(r => [r.ordine, formatEuro(r.importoCent / 100)])
      )
    );
    setAggiunte([]);
    setRimosse([]);
    setScadenze(f.scadenze.map((s, i) => scadenzaDaServer(s, `srv-${i}`)));
    setScadenzeToccate(false);
    setDiciture(f.diciture.filter((d): d is ChiaveDicitura => d in DICITURE));
    setCantiere(f.intestazioneCantiere ?? "");
    setNote(f.note ?? "");
    setScavalco({ attivo: f.scavalcoLimiti, motivo: f.scavalcoMotivo ?? "" });
  }, [dettaglio.data, sporco]);

  function ricarica(): void {
    setSporco(false);
    void utils.fatture.byId.invalidate({ id: fatturaId });
    void utils.fatture.validazioni.invalidate({ id: fatturaId });
    void utils.fatture.perCommessa.invalidate({ commessaId });
  }

  /** Il conflitto ottimistico non è un errore da leggere: è una bozza da ricaricare. */
  function segnalaErrore(errore: unknown): void {
    const e = errore as { message?: string; data?: { code?: string } | null };
    if (e.data?.code === "CONFLICT") {
      toast.error("Bozza modificata altrove: ricarica.");
      ricarica();
      return;
    }
    toast.error(e.message ?? "Operazione non riuscita.");
  }

  const salva = trpc.fatture.aggiornaBozza.useMutation({
    onSuccess: esito => {
      utils.fatture.byId.setData({ id: fatturaId }, prev =>
        prev
          ? { ...prev, fattura: esito.fattura, controlli: esito.controlli }
          : prev
      );
      ricarica();
      toast.success("Bozza salvata");
    },
    onError: segnalaErrore,
  });

  const rigenera = trpc.fatture.rigeneraBozza.useMutation({
    onSuccess: esito => {
      ricarica();
      toast.success("Bozza rigenerata dal contratto");
      esito.avvertenze.forEach(a => toast.warning(a));
    },
    onError: segnalaErrore,
  });

  const emetti = trpc.fatture.emetti.useMutation({
    onSuccess: esito => {
      ricarica();
      onCambiato?.();
      const falliti = esito.passi.filter(p => p.esito === "errore");
      if (falliti.length === 0) {
        toast.success(
          esito.fattura.numero
            ? `Fattura ${esito.fattura.numero} emessa`
            : "Fattura emessa"
        );
      } else {
        falliti.forEach(p =>
          toast.error(
            `${ETICHETTA_PASSO[p.passo] ?? p.passo}: ${p.dettaglio ?? "passo non riuscito"}`
          )
        );
      }
    },
    onError: segnalaErrore,
  });

  const annulla = trpc.fatture.annullaBozza.useMutation({
    onSuccess: () => {
      ricarica();
      toast.success("Bozza annullata");
      onAnnullata();
    },
    onError: segnalaErrore,
  });

  if (dettaglio.isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-6">Caricamento bozza…</p>
    );
  }
  if (dettaglio.error) {
    return (
      <p className="text-sm text-danger py-6">{dettaglio.error.message}</p>
    );
  }
  if (!dettaglio.data) return null;

  const f = dettaglio.data.fattura;
  const gruppi = raggruppaRighe(f.righe);
  const controlli = validazioni.data?.controlli ?? [];
  const { errori, avvisi } = riepilogoControlli(controlli);
  // Controlli non arrivati non vuol dire «tutto a posto»: senza il loro
  // esito l'emissione resta chiusa e il pannello lo dice, invece di
  // rassicurare con un elenco vuoto.
  const validazioniKo = validazioni.isError;
  const emettibile = !validazioniKo && (validazioni.data?.emettibile ?? false);
  const inCorso =
    salva.isPending ||
    rigenera.isPending ||
    emetti.isPending ||
    annulla.isPending;
  const haBeniSignificativi = f.righe.some(
    r => r.tipo === "bene" && r.beneSignificativo && !r.derivata
  );
  const erroriDiLimite = controlli.some(
    c => c.esito === "errore" && c.codice.startsWith("limite_")
  );
  const mostraScavalco = puoEmettere && (erroriDiLimite || scavalco.attivo);
  const scavalcoIncompleto = scavalco.attivo && scavalco.motivo.trim() === "";

  /**
   * Dove porta un controllo. Il pannello elencava i problemi come testo e
   * l'operatore doveva sapere da solo in quale pagina stesse il rimedio:
   * ogni riga ha ora il suo pulsante, e questa è la sua mano.
   */
  function eseguiAzione(azione: AzioneControllo): void {
    switch (azione.tipo) {
      case "passo":
        // Contratto e limiti si sistemano nel loro passo del percorso
        // guidato (piano 4): le tab della commessa sono in sola lettura.
        setLocation(hrefPasso(commessaId, azione.passo));
        return;
      case "cliente": {
        const id = f.clienteSnapshot?.clienteId;
        if (id == null) {
          toast.error("La bozza non è legata a un cliente: rigenerala.");
          return;
        }
        setLocation(`/clienti/${id}`);
        return;
      }
      case "impostazioni":
        setLocation("/integrazioni#fatturazione");
        return;
      case "campo": {
        const el = document.getElementById(azione.id);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (el instanceof HTMLElement && "focus" in el) el.focus({ preventScroll: true });
        return;
      }
      case "riequilibrio":
        setMarkupTesto("0,00");
        setDialogoRiequilibrio(true);
        return;
    }
  }
  const azioneDisponibile = (a: AzioneControllo | null): boolean => a != null;

  /**
   * L'elenco dei controlli con il pulsante accanto. Sta in una funzione
   * perché compare in due posti: in cima alla colonna principale quando c'è
   * qualcosa da risolvere (è la cosa più importante della pagina, non una
   * nota a margine) e nella colonna laterale quando restano solo avvisi.
   */
  const elencoControlli = (soloEsiti: Array<"errore" | "avviso">) => {
    const voci = controlli.filter(c => soloEsiti.includes(c.esito as "errore" | "avviso"));
    if (voci.length === 0) return null;
    return (
      <ul className="space-y-1.5" aria-label={soloEsiti.includes("errore") ? "Da risolvere prima di emettere" : "Avvisi"}>
        {voci.map((c, i) => {
          const azione = azionePerControllo(c.codice);
          return (
            <li
              key={`${c.codice}-${i}`}
              className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm ${
                c.esito === "errore"
                  ? "border-danger/30 bg-danger-soft/60 text-text-1"
                  : "border-warning/30 bg-warning-soft/60 text-text-1"
              }`}
            >
              <span className="min-w-0 flex-1">{c.messaggio}</span>
              {azioneDisponibile(azione) && azione && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={() => eseguiAzione(azione)}
                >
                  {azione.etichetta}
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  /**
   * Cosa mandare al server: solo i campi davvero cambiati. Le scadenze si
   * mandano solo se toccate (il server, quando mancano, le tiene o le rifà
   * dalle rate del contratto) e lo scavalco solo se cambiato, perché ogni
   * invio scrive un evento nel registro.
   */
  function costruisciModifica(): ModificaBozza {
    const righe = f.righe.filter(correggibile).flatMap(r => {
      const cent = centDaTesto(importi[r.ordine] ?? "");
      if (cent == null || cent === r.importoCent) return [];
      return [{ ordine: r.ordine, importoCent: cent }];
    });
    const modifica: ModificaBozza = {};
    if (righe.length > 0) modifica.righe = righe;
    if (aggiunte.length > 0) {
      modifica.righeAggiunte = aggiunte.map(a => ({
        tipo: a.tipo,
        descrizione: a.descrizione.trim(),
        importoCent: centDaTesto(a.importoTesto) ?? 0,
        // L'aliquota segue il tipo: il server rifiuta qualunque altra coppia.
        aliquota: a.tipo === "bene" ? (22 as const) : (10 as const),
        beneSignificativo: a.tipo === "bene" && a.beneSignificativo,
      }));
    }
    if (rimosse.length > 0) modifica.righeRimosse = rimosse;
    if (scadenzeToccate) modifica.scadenze = scadenze.map(scadenzaInput);
    if (note !== (f.note ?? "")) modifica.note = note.trim() || null;
    if (cantiere !== (f.intestazioneCantiere ?? "")) {
      modifica.intestazioneCantiere = cantiere.trim() || null;
    }
    const dicitureCambiate =
      diciture.length !== f.diciture.length ||
      diciture.some(d => !f.diciture.includes(d));
    if (dicitureCambiate) modifica.diciture = diciture;
    if (
      scavalco.attivo !== f.scavalcoLimiti ||
      scavalco.motivo !== (f.scavalcoMotivo ?? "")
    ) {
      modifica.scavalcoLimiti = {
        attivo: scavalco.attivo,
        motivo: scavalco.motivo.trim() || null,
      };
    }
    return modifica;
  }

  function invia(extra?: ModificaBozza): void {
    salva.mutate({
      id: fatturaId,
      revisione: f.revisione,
      modifica: { ...costruisciModifica(), ...extra },
    });
  }

  const tocca = () => setSporco(true);

  /** I campi vivi di una riga: i callback si scrivono qui una volta sola. */
  const campiDi = (
    r: RigaFattura,
    classeInput: string,
    classeBottone: string
  ) =>
    RigaBozzaCampi({
      r,
      testo: importi[r.ordine] ?? "",
      puoModificare,
      inRimozione: rimosse.includes(r.ordine),
      classeInput,
      classeBottone,
      onImporto: t => {
        tocca();
        setImporti(prev => ({ ...prev, [r.ordine]: t }));
      },
      onNormalizza: () =>
        setImporti(prev => ({
          ...prev,
          [r.ordine]: formatEuro(
            (centDaTesto(prev[r.ordine] ?? "") ?? r.importoCent) / 100
          ),
        })),
      onRimozione: () => {
        tocca();
        setRimosse(prev =>
          prev.includes(r.ordine)
            ? prev.filter(o => o !== r.ordine)
            : [...prev, r.ordine]
        );
      },
    });

  return (
    <div className="space-y-4 mt-4 min-w-0">
      <div className="grid gap-4 min-w-0 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5 min-w-0">
          {/* Cosa blocca l'emissione, in testa e non a margine: è l'unica
              cosa che l'operatore deve sistemare per andare avanti. */}
          <div id="fattura-controlli" className="scroll-mt-24 min-w-0">
            {validazioniKo ? (
              <DataSurface
                density="compact"
                tone="sunken"
                title="Controlli non disponibili"
                description={validazioni.error?.message ?? "errore sconosciuto"}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-fit"
                  disabled={validazioni.isFetching}
                  onClick={() => void validazioni.refetch()}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {validazioni.isFetching ? "Riprovo…" : "Riprova"}
                </Button>
              </DataSurface>
            ) : errori.length > 0 ? (
              <DataSurface
                density="compact"
                tone="sunken"
                title={`Prima di emettere: ${errori.length} ${errori.length === 1 ? "cosa" : "cose"} da risolvere`}
                description="Ogni riga porta dove si sistema. Torna qui quando hai finito: i controlli si rifanno da soli."
              >
                {elencoControlli(["errore"])}
              </DataSurface>
            ) : null}
          </div>

          {/* Righe per gruppo: beni, servizi, derivate, note */}
          <div id="fattura-righe" className="scroll-mt-24 space-y-5 min-w-0">
          {gruppi.map(g => {
            const mostraBeneSig = g.chiave === "beni";
            return (
              <section
                key={g.chiave}
                aria-label={g.titolo}
                className="space-y-2 min-w-0"
              >
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-sm font-medium">{g.titolo}</h3>
                  <span className="ml-auto text-sm font-semibold tabular-nums">
                    {formatCent(g.totaleCent)}
                  </span>
                </div>

                {/* Desktop: tabella. Mobile: le stesse righe come card. */}
                <div className="hidden md:block min-w-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Descrizione</TableHead>
                        {mostraBeneSig && (
                          <TableHead className="w-28">Bene sig.</TableHead>
                        )}
                        <TableHead className="w-32 text-right">
                          Importo
                        </TableHead>
                        <TableHead className="w-16 text-right">IVA</TableHead>
                        <TableHead className="w-56">Limite</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.righe.map(r => {
                        const inRimozione = rimosse.includes(r.ordine);
                        const campi = campiDi(
                          r,
                          "h-9 text-right tabular-nums",
                          "h-8 w-8"
                        );
                        return (
                          <TableRow
                            key={r.ordine}
                            className={
                              inRimozione ? "opacity-60 line-through" : ""
                            }
                          >
                            <TableCell className="min-w-0">
                              <span className="whitespace-pre-line">
                                {r.descrizione}
                              </span>
                              {g.chiave === "derivate" && (
                                <span className="ml-2 text-xs text-text-3">
                                  {ETICHETTA_TIPO_RIGA[r.tipo]}
                                </span>
                              )}
                              {r.derivata && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 align-middle"
                                  title="La calcola il sistema: si rifà a ogni salvataggio, non si modifica a mano."
                                >
                                  calcolata
                                </Badge>
                              )}
                            </TableCell>
                            {mostraBeneSig && (
                              <TableCell>
                                {/* Uno switch spento sembrava un comando rotto: è
                                    un'informazione che viene dal contratto. */}
                                {r.tipo === "bene" && r.beneSignificativo && (
                                  <Badge
                                    variant="info"
                                    title="Bene significativo, dal contratto"
                                  >
                                    significativo
                                  </Badge>
                                )}
                              </TableCell>
                            )}
                            <TableCell className="text-right">
                              {campi.importo}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-text-2">
                              {r.aliquota == null ? "—" : `${r.aliquota} %`}
                            </TableCell>
                            <TableCell>{campi.indicatore}</TableCell>
                            <TableCell>{campi.rimozione}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <ul className="space-y-2 md:hidden min-w-0">
                  {g.righe.map(r => {
                    const inRimozione = rimosse.includes(r.ordine);
                    const campi = campiDi(
                      r,
                      "h-11 text-right tabular-nums",
                      "h-9 w-9 shrink-0"
                    );
                    return (
                      <li
                        key={r.ordine}
                        className={`rounded-lg border border-border p-3 space-y-2 min-w-0 ${
                          inRimozione ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <p
                            className={`min-w-0 flex-1 text-sm whitespace-pre-line ${
                              inRimozione ? "line-through" : ""
                            }`}
                          >
                            {r.descrizione}
                          </p>
                          {r.derivata && (
                            <Badge
                              variant="outline"
                              className="shrink-0"
                              title="La calcola il sistema: si rifà a ogni salvataggio."
                            >
                              calcolata
                            </Badge>
                          )}
                          {campi.rimozione}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs text-text-2">
                          <span>{ETICHETTA_TIPO_RIGA[r.tipo]}</span>
                          <span>
                            {r.aliquota == null
                              ? "senza IVA"
                              : `${r.aliquota} %`}
                          </span>
                          {r.tipo === "bene" && r.beneSignificativo && (
                            <Badge variant="info">significativo</Badge>
                          )}
                        </div>
                        <div className="text-right text-sm font-semibold">
                          {campi.importo}
                        </div>
                        {campi.indicatore}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {/* Righe scritte a mano non ancora salvate */}
          {aggiunte.length > 0 && (
            <section
              aria-label="Righe da aggiungere"
              className="space-y-2 min-w-0"
            >
              <h3 className="text-sm font-medium">Righe da aggiungere</h3>
              <ul className="space-y-2">
                {aggiunte.map(a => (
                  <li
                    key={a.chiave}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm min-w-0"
                  >
                    <Badge variant="outline" className="shrink-0">
                      {a.tipo === "bene" ? "Bene" : "Servizio"}
                    </Badge>
                    <span className="min-w-0 truncate">{a.descrizione}</span>
                    <span className="ml-auto shrink-0 tabular-nums">
                      {formatEuroSimbolo(
                        (centDaTesto(a.importoTesto) ?? 0) / 100
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-danger hover:text-danger hover:bg-danger-soft"
                      aria-label={`Togli la riga ${a.descrizione}`}
                      onClick={() =>
                        setAggiunte(prev =>
                          prev.filter(x => x.chiave !== a.chiave)
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {puoModificare && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={aggiunte.length >= MAX_RIGHE_AGGIUNTE}
                title={
                  aggiunte.length >= MAX_RIGHE_AGGIUNTE
                    ? `Non più di ${MAX_RIGHE_AGGIUNTE} righe aggiunte per salvataggio.`
                    : undefined
                }
                onClick={() => {
                  setNuovaRiga({
                    chiave: `aggiunta-${(contatoreAggiunte.current += 1)}`,
                    tipo: "bene",
                    descrizione: "",
                    importoTesto: "0,00",
                    beneSignificativo: false,
                  });
                  setDialogoRiga(true);
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Aggiungi riga
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                disabled={!haBeniSignificativi || inCorso}
                title={
                  haBeniSignificativi
                    ? undefined
                    : "Senza beni significativi non c'è nulla da riequilibrare."
                }
                onClick={() => {
                  setMarkupTesto("0,00");
                  setDialogoRiequilibrio(true);
                }}
              >
                <Scale className="h-4 w-4 mr-1" /> Riequilibra i beni
              </Button>
            </div>
          )}
          </div>

          <div id="fattura-scadenze" className="scroll-mt-24 min-w-0">
          <ScadenzeEditor
            scadenze={scadenze}
            totaleCent={f.totaleCent}
            disabilitato={!puoModificare}
            onChange={s => {
              tocca();
              setScadenzeToccate(true);
              setScadenze(s);
            }}
          />
          </div>

          {/* Diciture, cantiere, note */}
          <section
            id="fattura-diciture"
            aria-label="Testi della fattura"
            className="scroll-mt-24 space-y-3 min-w-0"
          >
            <h3 className="text-sm font-medium">Diciture e testi</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {DICITURE_SELEZIONABILI.map(chiave => (
                <Label
                  key={chiave}
                  htmlFor={`dicitura-${chiave}`}
                  className="flex items-start gap-2 text-sm font-normal min-w-0"
                >
                  <Checkbox
                    id={`dicitura-${chiave}`}
                    className="mt-0.5"
                    checked={diciture.includes(chiave)}
                    disabled={!puoModificare}
                    onCheckedChange={v => {
                      tocca();
                      setDiciture(prev =>
                        v === true
                          ? [...prev, chiave]
                          : prev.filter(x => x !== chiave)
                      );
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-text-1">
                      {ETICHETTA_DICITURA[chiave]}
                    </span>
                    <span className="block whitespace-pre-line text-xs leading-5 text-text-3">
                      {testoDicitura(chiave)}
                    </span>
                  </span>
                </Label>
              ))}
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="intestazione-cantiere"
                className="text-xs text-text-3"
              >
                Intestazione cantiere
              </Label>
              <Input
                id="intestazione-cantiere"
                maxLength={300}
                value={cantiere}
                disabled={!puoModificare}
                placeholder="Via, numero, CAP e comune del cantiere"
                onChange={e => {
                  tocca();
                  setCantiere(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="note-fattura" className="text-xs text-text-3">
                Note in calce
              </Label>
              <Textarea
                id="note-fattura"
                rows={3}
                maxLength={1000}
                value={note}
                disabled={!puoModificare}
                onChange={e => {
                  tocca();
                  setNote(e.target.value);
                }}
              />
            </div>
          </section>
        </div>

        {/* Colonna destra a 1024: riepilogo e controlli. Sotto, su mobile. */}
        <aside className="space-y-3 min-w-0">
          <DataSurface density="compact" tone="sunken" title="Riepilogo">
            <dl className="space-y-1 text-sm">
              {riepilogoView(f).map(riga => (
                <div
                  key={riga.etichetta}
                  className="flex items-baseline gap-2 min-w-0"
                >
                  <dt className="min-w-0 text-text-2">{riga.etichetta}</dt>
                  <dd
                    className={`ml-auto tabular-nums font-medium ${
                      riga.tono === "errore"
                        ? "text-danger"
                        : riga.tono === "attenzione"
                          ? "text-warning"
                          : ""
                    }`}
                  >
                    {riga.valore}
                  </dd>
                </div>
              ))}
            </dl>
            {sporco ? (
              // I totali li rifà il server: finché non si salva sono quelli
              // di prima. Dirlo in grigio in fondo non bastava — si
              // cambiava una cifra e il totale restava fermo senza capire
              // perché. Ora lo dice a colori, e il ricalcolo è a un click.
              <div className="space-y-2 rounded-[var(--radius-control)] border border-warning/40 bg-warning-soft px-3 py-2">
                <p className="text-xs text-text-1">
                  Modifiche non salvate: i totali qui sopra sono fermi
                  all'ultimo salvataggio.
                </p>
                {puoModificare && (
                  <Button
                    size="sm"
                    className="h-9 w-full"
                    disabled={inCorso || scavalcoIncompleto}
                    onClick={() => invia()}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    {salva.isPending ? "Ricalcolo…" : "Ricalcola e salva"}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-3">
                Totali calcolati dal server all'ultimo salvataggio.
              </p>
            )}
          </DataSurface>

          <DataSurface
            density="compact"
            tone="sunken"
            title="Controlli"
            description={
              validazioniKo
                ? "Non disponibili: vedi in alto."
                : validazioni.isLoading || !validazioni.data
                  ? "Verifica in corso…"
                  : errori.length > 0
                    ? `${errori.length} da risolvere, elencati in alto.`
                    : avvisi.length === 0
                      ? "Nessun problema aperto: la fattura è emettibile."
                      : `Emettibile. ${avvisi.length} ${avvisi.length === 1 ? "avviso" : "avvisi"} da leggere.`
            }
          >
            {avvisi.length > 0 && elencoControlli(["avviso"])}

            {mostraScavalco && (
              <div className="space-y-2 border-t border-border-soft pt-2">
                <Label
                  htmlFor="scavalco-limiti"
                  className="flex items-start gap-2 text-sm font-normal"
                >
                  <Checkbox
                    id="scavalco-limiti"
                    className="mt-0.5"
                    checked={scavalco.attivo}
                    disabled={!puoModificare}
                    onCheckedChange={v => {
                      tocca();
                      setScavalco(prev => ({ ...prev, attivo: v === true }));
                    }}
                  />
                  <span className="min-w-0">
                    Procedi oltre i limiti del computo
                  </span>
                </Label>
                {scavalco.attivo && (
                  <Input
                    aria-label="Motivo dello scavalco dei limiti"
                    placeholder="Motivo (obbligatorio)"
                    maxLength={300}
                    value={scavalco.motivo}
                    disabled={!puoModificare}
                    onChange={e => {
                      tocca();
                      setScavalco(prev => ({
                        ...prev,
                        motivo: e.target.value,
                      }));
                    }}
                  />
                )}
                <p className="text-xs text-text-3">
                  Lo scavalco resta scritto nel registro della fattura, con il
                  motivo.
                </p>
              </div>
            )}
          </DataSurface>

          {/* Studio 05/09/2026: la bozza contro la fattura vera della stessa
              commessa su Fatture in Cloud, voce per voce. A richiesta: una
              lettura su FiC per confronto. */}
          <DataSurface density="compact" tone="sunken" title="Fattura vera a confronto">
            {!mostraConfronto ? (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setMostraConfronto(true)}>
                Confronta con Fatture in Cloud
              </Button>
            ) : confronto.isPending ? (
              <p className="text-sm text-text-2">Leggo la fattura su Fatture in Cloud…</p>
            ) : confronto.isError ? (
              <p className="text-sm text-danger">{confronto.error.message}</p>
            ) : !confronto.data?.fic ? (
              <p className="text-sm text-text-2">Nessuna fattura di questo cliente su Fatture in Cloud negli ultimi 180 giorni.</p>
            ) : (
              <div className="space-y-2 min-w-0">
                <p className="text-xs text-text-3">
                  Fattura {confronto.data.fic.numero} del {confronto.data.fic.data}
                  {confronto.data.fic.collegata ? " (collegata a questa commessa)" : " (stesso cliente, non collegata)"} · lordo {formatCent(confronto.data.fic.lordoCent)}
                </p>
                <dl className="space-y-2 text-sm">
                  {confronto.data.voci.filter(v => v.crmCent !== 0 || v.ficCent !== 0).map(v => (
                    <div key={v.voce} className="min-w-0">
                      <dt className="text-text-2">{v.etichetta}</dt>
                      <dd className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
                        <span>bozza {formatCent(v.crmCent)}</span>
                        <span className={v.deltaCent === 0 ? "text-text-3" : v.deltaCent > 0 ? "text-success" : "text-warning"}>
                          vera {formatCent(v.ficCent)}{v.deltaCent !== 0 ? ` (${v.deltaCent > 0 ? "+" : "−"}${formatCent(Math.abs(v.deltaCent))})` : ""}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-text-3">Scarto = fattura vera meno bozza. {confronto.data.nonClassificate.length > 0 ? `Righe non classificate: ${confronto.data.nonClassificate.join("; ")}` : ""}</p>
              </div>
            )}
          </DataSurface>
        </aside>
      </div>

      <div id="fattura-azioni" className="scroll-mt-24" />
      <StickyActionBar
        busy={inCorso}
        dirty={sporco}
        status={
          <>
            {sporco ? "Modifiche non salvate." : "Bozza allineata al server."}
            {sporco && scadenzeToccate && (
              <>
                {" "}
                Le scadenze si verificano contro il totale ricalcolato: se cambi
                anche gli importi, salva e poi correggile.
              </>
            )}
            {scavalcoIncompleto &&
              " Lo scavalco dei limiti richiede un motivo."}
          </>
        }
        destructive={
          puoModificare ? (
            <Button
              variant="ghost"
              className="h-11 text-danger hover:text-danger hover:bg-danger-soft sm:h-10"
              disabled={inCorso}
              onClick={() => setConfermaAnnulla(true)}
            >
              Annulla bozza
            </Button>
          ) : undefined
        }
        secondary={
          <>
            {/* Stampa della bozza: copia di lavoro, non documento fiscale. */}
            <Button
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => window.open(`/fatture/${f.id}/stampa`, "_blank", "noopener")}
            >
              <Printer className="h-4 w-4 mr-1" /> Stampa
            </Button>
            {puoModificare && f.tipo !== "nota_credito" && (
              <Button
                variant="outline"
                className="h-11 sm:h-10"
                disabled={inCorso}
                onClick={() => setConfermaRigenera(true)}
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Rigenera dal contratto
              </Button>
            )}
            {puoModificare && (
              <Button
                className="h-11 sm:h-10"
                disabled={!sporco || inCorso || scavalcoIncompleto}
                onClick={() => invia()}
              >
                <Save className="h-4 w-4 mr-1" />
                {salva.isPending ? "Salvataggio…" : "Salva bozza"}
              </Button>
            )}
          </>
        }
        primary={
          puoEmettere ? (
            <Button
              className="h-11 sm:h-10"
              disabled={!emettibile || sporco || inCorso}
              title={
                validazioniKo
                  ? "Controlli non disponibili."
                  : sporco
                    ? "Salva la bozza prima di emetterla."
                    : emettibile
                      ? undefined
                      : "Ci sono controlli da risolvere."
              }
              onClick={() => setConfermaEmissione(true)}
            >
              <Send className="h-4 w-4 mr-1" /> Emetti
            </Button>
          ) : (
            <span className="text-xs text-text-3">
              L'emissione richiede il permesso di emettere fatture.
            </span>
          )
        }
      />

      {/* Nuova riga scritta a mano */}
      <Dialog
        open={dialogoRiga}
        onOpenChange={aperto => {
          setDialogoRiga(aperto);
          if (!aperto) setNuovaRiga(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Aggiungi una riga alla bozza</DialogTitle>
          </DialogHeader>
          {nuovaRiga && (
            <div className="space-y-3 min-w-0">
              <div className="space-y-1">
                <Label className="text-xs text-text-3">Tipo</Label>
                <Select
                  value={nuovaRiga.tipo}
                  onValueChange={v =>
                    setNuovaRiga({
                      ...nuovaRiga,
                      tipo: v as "bene" | "servizio",
                    })
                  }
                >
                  <SelectTrigger aria-label="Tipo della riga">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bene">Bene (IVA 22 %)</SelectItem>
                    <SelectItem value="servizio">
                      Servizio (IVA 10 %)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="riga-descrizione"
                  className="text-xs text-text-3"
                >
                  Descrizione
                </Label>
                <Input
                  id="riga-descrizione"
                  maxLength={300}
                  value={nuovaRiga.descrizione}
                  onChange={e =>
                    setNuovaRiga({ ...nuovaRiga, descrizione: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="riga-importo" className="text-xs text-text-3">
                  Importo €
                </Label>
                <Input
                  id="riga-importo"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={nuovaRiga.importoTesto}
                  onChange={e =>
                    setNuovaRiga({ ...nuovaRiga, importoTesto: e.target.value })
                  }
                />
              </div>
              {nuovaRiga.tipo === "bene" && (
                <Label className="flex items-center gap-2 text-sm font-normal">
                  <Switch
                    checked={nuovaRiga.beneSignificativo}
                    aria-label="La riga è un bene significativo"
                    onCheckedChange={v =>
                      setNuovaRiga({ ...nuovaRiga, beneSignificativo: v })
                    }
                  />
                  bene significativo
                </Label>
              )}
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row">
            <Button
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => setDialogoRiga(false)}
            >
              Annulla
            </Button>
            <Button
              className="h-11 sm:h-10"
              disabled={!nuovaRiga || nuovaRiga.descrizione.trim() === ""}
              onClick={() => {
                if (!nuovaRiga) return;
                tocca();
                setAggiunte(prev => [...prev, nuovaRiga]);
                setDialogoRiga(false);
                setNuovaRiga(null);
              }}
            >
              Aggiungi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Riequilibrio dei beni significativi (D-A) */}
      <Dialog open={dialogoRiequilibrio} onOpenChange={setDialogoRiequilibrio}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Riequilibra i beni</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 min-w-0">
            <p className="text-sm text-text-2">
              Le righe dei beni significativi vengono scalate in proporzione
              finché il markup vale l'importo indicato. Pattuito e servizi
              restano fermi.
            </p>
            <div className="space-y-1">
              <Label
                htmlFor="markup-desiderato"
                className="text-xs text-text-3"
              >
                Markup desiderato €
              </Label>
              <Input
                id="markup-desiderato"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={markupTesto}
                onChange={e => setMarkupTesto(e.target.value)}
              />
            </div>
            <p className="text-xs text-text-3">
              Markup attuale: {formatCent(f.markupCent)}.
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-row">
            <Button
              variant="outline"
              className="h-11 sm:h-10"
              onClick={() => setDialogoRiequilibrio(false)}
            >
              Annulla
            </Button>
            <Button
              className="h-11 sm:h-10"
              disabled={inCorso || centDaTesto(markupTesto) == null}
              onClick={() => {
                setDialogoRiequilibrio(false);
                invia({
                  riequilibraBeniAMarkupCent: centDaTesto(markupTesto) ?? 0,
                });
              }}
            >
              Riequilibra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confermaEmissione}
        onOpenChange={setConfermaEmissione}
        title="Emetti la fattura su Fatture in Cloud"
        description={`${
          dryRun
            ? "Invio allo SdI in prova: il documento sarà numerato da FiC ma non spedito."
            : "Invio reale allo SdI: il documento parte davvero."
        } Totale ${formatCent(f.totaleCent)}${
          f.clienteSnapshot ? ` · ${f.clienteSnapshot.nome}` : ""
        }.`}
        destructive={!dryRun}
        confirmLabel="Emetti"
        busy={emetti.isPending}
        onConfirm={() => {
          setConfermaEmissione(false);
          emetti.mutate({ id: fatturaId, revisione: f.revisione });
        }}
      />

      <ConfirmDialog
        open={confermaRigenera}
        onOpenChange={setConfermaRigenera}
        title="Rigenera la bozza dal contratto"
        description="Righe e scadenze tornano alla proposta di contratto e computo: le correzioni fatte a mano su questa bozza si perdono."
        destructive={false}
        confirmLabel="Rigenera"
        busy={rigenera.isPending}
        onConfirm={() => {
          setConfermaRigenera(false);
          rigenera.mutate({ id: fatturaId, revisione: f.revisione });
        }}
      />

      <ConfirmDialog
        open={confermaAnnulla}
        onOpenChange={setConfermaAnnulla}
        title="Annulla la bozza"
        description="La bozza resta registrata come annullata e non si potrà più modificare. Nessun documento è stato mandato a Fatture in Cloud."
        confirmLabel="Annulla la bozza"
        busy={annulla.isPending}
        onConfirm={() => {
          setConfermaAnnulla(false);
          annulla.mutate({ id: fatturaId, motivo: null });
        }}
      />
    </div>
  );
}
