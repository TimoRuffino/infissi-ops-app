// Tab «Fattura» della commessa: la bozza nasce dai limiti, si corregge qui e
// da qui si emette; dopo l'emissione la stessa tab mostra il documento in
// sola lettura. Questo componente sceglie quale fattura guardare e mostra il
// percorso interno della fattura (bozza → controlli → emissione → SdI): la
// modifica sta in `BozzaFatturaEditor`, la lettura in `FatturaEmessaView`.
//
// Contratto e limiti sono i due passi che precedono la fattura nel percorso
// guidato (`/fatturazione/:id`, piano 4): quando mancano, la tab lo dice a
// parole e porta al passo giusto invece di lasciare un pulsante spento.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { FileText, FlaskConical, Plus, ReceiptText, Trash2 } from "lucide-react";

import { trpc } from "@/lib/trpc";
import {
  badgeStatoFattura,
  passiFattura,
  riepilogoControlli,
  VARIANTE_BADGE,
  type PassoFattura,
} from "@/lib/fatturaView";
import { hrefPasso } from "@/lib/fatturazioneView";
import { formatCent } from "@/lib/limitiView";
import BozzaFatturaEditor from "@/components/fattura/BozzaFatturaEditor";
import FatturaEmessaView from "@/components/fattura/FatturaEmessaView";
import FatturaPercorso from "@/components/fattura/FatturaPercorso";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function FatturaTab({
  commessaId,
  modalita,
  onCambiato,
}: {
  commessaId: number;
  /**
   * Cornice in cui la tab è montata (piano 4). Assente = la tab della scheda
   * commessa, com'è sempre stata. `"guidata"` è il passo 4 (l'ultimo) del
   * percorso `/fatturazione/:id`: nessun «Avanti», la pagina porta solo
   * «Indietro». `"lettura"` (Task 6) è il riassunto in sola lettura: stato,
   * numero/data, totale se presente, solo «Apri fatturazione».
   */
  modalita?: "guidata" | "lettura";
  /** Bozza creata, emessa, annullata o stato SdI cambiato: chi monta rilegga i passi. */
  onCambiato?: () => void;
}) {
  const guidata = modalita === "guidata";
  const lettura = modalita === "lettura";
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const q = trpc.fatture.perCommessa.useQuery({ commessaId }, { retry: false });
  // Contratto e computo sono i due passi prima della fattura: senza di loro
  // la bozza non nasce, e il pulsante deve dire perché è spento. Il riassunto
  // in sola lettura non li guarda: non li chiede (ogni giro verso il database
  // costa). Le stesse query le apre il percorso guidato: React Query le dedupe.
  const contratto = trpc.contratti.get.useQuery(
    { commessaId },
    { retry: false, enabled: !lettura }
  );
  const computo = trpc.computo.ultimo.useQuery(
    { commessaId },
    { retry: false, enabled: !lettura }
  );
  const [selezionata, setSelezionata] = useState<number | null>(null);

  const elenco = q.data?.fatture ?? [];

  // Quale fattura si apre per prima: la bozza (il lavoro in corso), poi la
  // più recente ancora viva, infine l'ultima creata comunque sia finita.
  const predefinita = useMemo(() => {
    if (elenco.length === 0) return null;
    const bozza = elenco.find(f => f.stato === "bozza");
    if (bozza) return bozza.id;
    const viva = [...elenco].reverse().find(f => f.stato !== "annullata");
    return (viva ?? elenco[elenco.length - 1]).id;
  }, [elenco]);

  useEffect(() => {
    if (predefinita == null) {
      if (selezionata != null) setSelezionata(null);
      return;
    }
    if (selezionata == null || !elenco.some(f => f.id === selezionata)) {
      setSelezionata(predefinita);
    }
  }, [predefinita, selezionata, elenco]);

  const fattura = elenco.find(f => f.id === selezionata) ?? null;

  // I controlli della bozza alimentano il passo «Controlli»: stessa query
  // dell'editor, quindi nessuna seconda richiesta.
  const validazioni = trpc.fatture.validazioni.useQuery(
    { id: fattura?.id ?? 0 },
    { enabled: !lettura && fattura?.stato === "bozza", retry: false }
  );

  const crea = trpc.fatture.creaBozza.useMutation({
    onSuccess: esito => {
      void utils.fatture.perCommessa.invalidate({ commessaId });
      setSelezionata(esito.fattura.id);
      toast.success("Bozza generata dai limiti");
      esito.avvertenze.forEach(a => toast.warning(a));
      onCambiato?.();
    },
    onError: e => toast.error(e.message),
  });
  // Cancellazione definitiva: solo bozze, annullate o emissioni ferme senza
  // documento FiC (lo decide il server); conferma umana prima del click.
  const [daEliminare, setDaEliminare] = useState<number | null>(null);
  const elimina = trpc.fatture.elimina.useMutation({
    onSuccess: esito => {
      void utils.fatture.perCommessa.invalidate({ commessaId });
      void utils.fatturazioneGuidata.passi.invalidate({ commessaId: esito.commessaId });
      void utils.fatturazioneGuidata.daFare.invalidate();
      setDaEliminare(null);
      if (selezionata === esito.id) setSelezionata(null);
      toast.success("Bozza eliminata");
      onCambiato?.();
    },
    onError: e => toast.error(e.message),
  });

  if (q.isLoading) {
    return (
      <p className="text-sm text-muted-foreground py-6">Caricamento fatture…</p>
    );
  }
  if (q.error)
    return <p className="text-sm text-danger py-6">{q.error.message}</p>;
  if (!q.data) return null;

  if (lettura) {
    // M1 (Task 6): mai `selezionata` — resta `null` fino al primo giro di
    // effetti, e quel primo render mostrerebbe «Nessuna fattura» anche
    // quando ce n'è una. `predefinita` è già pronta al primo render (stessa
    // logica: bozza, poi la più recente viva, poi l'ultima).
    const fatturaLettura = elenco.find(f => f.id === predefinita) ?? null;
    const badge = fatturaLettura
      ? badgeStatoFattura(fatturaLettura.stato, fatturaLettura.inviataDryRun)
      : null;
    return (
      <div className="space-y-3 min-w-0">
        {fatturaLettura && badge ? (
          <div className="flex flex-wrap items-center gap-2 text-sm min-w-0">
            <Badge variant={VARIANTE_BADGE[badge.tono]}>{badge.testo}</Badge>
            <span className="min-w-0 truncate">
              {fatturaLettura.tipo === "nota_credito" ? "Nota di credito " : "Fattura "}
              {fatturaLettura.numero ?? "in bozza"}
              {fatturaLettura.data ? ` · ${fatturaLettura.data}` : ""}
            </span>
            <span className="tabular-nums font-medium">{formatCent(fatturaLettura.totaleCent)}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nessuna fattura</p>
        )}
        <Button asChild className="min-h-11">
          <Link href={hrefPasso(commessaId, "fattura")}>
            <ReceiptText className="h-4 w-4" aria-hidden="true" />
            Apri fatturazione
          </Link>
        </Button>
      </div>
    );
  }

  const prerequisitiInLettura = contratto.isPending || computo.isPending;
  const contrattoPresente = contratto.data?.contratto != null;
  const computoValido = computo.data?.valido === true;
  const passi = passiFattura({
    contratto: contratto.data
      ? { presente: contrattoPresente, righe: contratto.data.righe.length }
      : null,
    computo: computo.data
      ? { eseguito: computo.data.computo != null, valido: computoValido }
      : null,
    fattura,
    controlli:
      fattura?.stato === "bozza"
        ? validazioni.data
          ? (() => {
              const r = riepilogoControlli(validazioni.data.controlli);
              return { errori: r.errori.length, avvisi: r.avvisi.length };
            })()
          : null
        : null,
  });
  // Nel percorso guidato Contratto e Limiti sono già i passi 2 e 3 dello
  // stepper della pagina: qui resta solo il tratto della fattura.
  const passiVisibili = guidata
    ? passi.filter(p => p.chiave !== "contratto" && p.chiave !== "limiti")
    : passi;

  // Il server rifiuta una seconda fattura sulla commessa: finché ce n'è una
  // viva si passa dalla nota di credito, non da una bozza nuova.
  const puoGenerare = elenco.every(
    f => f.tipo !== "fattura" || f.stato === "annullata"
  );
  // Perché il pulsante è spento, detto a parole: prima si scopriva solo
  // dopo il click, con un errore. Finché contratto e computo non sono letti
  // il pulsante aspetta senza accusare nessuno.
  const motivoNonGenerabile = !q.data.puoDraft
    ? "Serve il permesso di preparare le fatture (amministrazione o direzione)."
    : prerequisitiInLettura
      ? null
      : !contrattoPresente
        ? "Prima serve il contratto: inseriscilo o leggilo dal PDF nel passo Contratto."
        : !computoValido
          ? "Prima servono i limiti aggiornati: calcolali nel passo Limiti."
          : null;
  const passoMancante: "contratto" | "limiti" | null =
    motivoNonGenerabile == null || !q.data.puoDraft
      ? null
      : !contrattoPresente
        ? "contratto"
        : "limiti";

  function vai(chiave: PassoFattura["chiave"]): boolean {
    if (chiave === "contratto" || chiave === "limiti") {
      setLocation(hrefPasso(commessaId, chiave));
      return true;
    }
    const id =
      chiave === "controlli"
        ? "fattura-controlli"
        : chiave === "emissione"
          ? "fattura-azioni"
          : chiave === "bozza"
            ? "fattura-righe"
            : "fattura-cronologia";
    const el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  // Radice comune a `BozzaFatturaEditor` e `FatturaEmessaView`: la stessa,
  // sia essa in modifica o in emesso, va nello stesso posto del contenitore
  // qui sotto.
  const editor =
    fattura?.stato === "bozza" ? (
      <BozzaFatturaEditor
        key={fattura.id}
        commessaId={commessaId}
        fatturaId={fattura.id}
        puoModificare={q.data.puoDraft}
        puoEmettere={q.data.puoEmettere}
        dryRun={q.data.dryRun}
        onAnnullata={() => {
          setSelezionata(null);
          onCambiato?.();
        }}
        onCambiato={onCambiato}
      />
    ) : fattura ? (
      <FatturaEmessaView
        key={fattura.id}
        commessaId={commessaId}
        fatturaId={fattura.id}
        puoNotaCredito={q.data.puoNotaCredito}
        puoEmettere={q.data.puoEmettere}
        puoModificare={q.data.puoDraft}
        onApriFattura={setSelezionata}
        onCambiato={onCambiato}
      />
    ) : null;

  return (
    // `mt-4` è lo stacco dalla linguetta della tab: nel percorso guidato la
    // spaziatura la porta la pagina.
    <div className={guidata ? "space-y-4 min-w-0" : "space-y-4 mt-4 min-w-0"}>
      <FatturaPercorso passi={passiVisibili} onVai={vai} />

      {q.data.dryRun && (
        <p className="flex min-w-0 items-start gap-2 rounded-[var(--radius-control)] border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-text-1">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0">
            <span className="font-semibold">Invio allo SdI in prova.</span> Le
            fatture emesse da qui vengono numerate da Fatture in Cloud ma non
            spedite davvero. Si spegne dalle impostazioni del server
            (<code className="codice-mono text-[11px]">FATTURAZIONE_SDI_DRY_RUN=off</code>).
          </span>
        </p>
      )}

      {puoGenerare && (
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Button
            size="sm"
            // Nel percorso guidato è il gesto principale del passo: target
            // touch pieno, non il pulsantino di una barra di tab.
            className={guidata ? "min-h-11" : "h-9"}
            disabled={
              motivoNonGenerabile != null || prerequisitiInLettura || crea.isPending
            }
            onClick={() => crea.mutate({ commessaId })}
          >
            <Plus className="h-4 w-4 mr-1" />
            {crea.isPending ? "Generazione…" : "Genera bozza dai limiti"}
          </Button>
          <span className="text-xs text-text-3 min-w-0">
            {motivoNonGenerabile ??
              "La bozza propone beni dal contratto e servizi dai limiti del computo: resta modificabile."}
          </span>
          {passoMancante && (
            <Button asChild variant="link" size="sm" className="h-9 px-1">
              <Link href={hrefPasso(commessaId, passoMancante)}>
                {passoMancante === "contratto" ? "Apri il contratto" : "Apri i limiti"}
              </Link>
            </Button>
          )}
        </div>
      )}

      {elenco.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nessuna fattura su questa commessa.
        </p>
      )}

      {elenco.length > 1 && (
        <ul
          aria-label="Fatture della commessa"
          className="grid gap-2 min-w-0 sm:grid-cols-2"
        >
          {elenco.map(f => {
            const badge = badgeStatoFattura(f.stato, f.inviataDryRun);
            const scelta = f.id === selezionata;
            return (
              <li key={f.id} className="flex min-w-0 items-stretch gap-1">
                <button
                  type="button"
                  aria-current={scelta ? "true" : undefined}
                  onClick={() => setSelezionata(f.id)}
                  className={`flex w-full min-h-11 min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                    scelta
                      ? "border-border-strong bg-surface-2"
                      : "border-border hover:bg-surface-2"
                  }`}
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {f.tipo === "nota_credito"
                      ? "Nota di credito "
                      : "Fattura "}
                    {f.numero ?? "in bozza"}
                    {f.data ? ` · ${f.data}` : ""}
                  </span>
                  <Badge
                    variant={VARIANTE_BADGE[badge.tono]}
                    className="shrink-0"
                  >
                    {badge.testo}
                  </Badge>
                  <span className="ml-auto shrink-0 tabular-nums">
                    {formatCent(f.totaleCent)}
                  </span>
                </button>
                {q.data.puoDraft && f.ficDocumentId == null && (f.stato === "bozza" || f.stato === "annullata" || f.stato === "in_emissione") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0 text-danger hover:text-danger hover:bg-danger-soft"
                    aria-label={`Elimina ${f.tipo === "nota_credito" ? "la nota di credito" : "la bozza"} #${f.id}`}
                    title="Elimina definitivamente"
                    disabled={elimina.isPending}
                    onClick={() => setDaEliminare(f.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* `BozzaFatturaEditor`/`FatturaEmessaView` portano il proprio `mt-4`
          in radice (per quando vivono da soli sotto la linguetta della tab):
          nel percorso guidato quel margine si somma a quello che questo
          contenitore già dà via `space-y-4`, un doppio stacco sopra
          l'editor. `[&>*]:mt-0` annulla solo il loro margine, senza toccare
          lo spazio fra gli elementi sopra. */}
      {guidata ? (
        <div className="[&>*]:mt-0">{editor}</div>
      ) : (
        editor
      )}
      <ConfirmDialog
        open={daEliminare != null}
        onOpenChange={aperto => { if (!aperto) setDaEliminare(null); }}
        title="Eliminare definitivamente?"
        description="La bozza sparisce dal CRM con righe, scadenze e cronologia. Non tocca Fatture in Cloud: si può eliminare solo ciò che non è mai uscito dal CRM."
        confirmLabel="Elimina"
        cancelLabel="Resta"
        busy={elimina.isPending}
        onConfirm={() => { if (daEliminare != null) elimina.mutate({ id: daEliminare }); }}
      />
    </div>
  );
}
