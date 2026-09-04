// /integrazioni — hub Impostazioni.
//
// Regola della pagina: si mostra soltanto ciò che un router espone davvero.
// Nessuna card vive di stato locale, nessuno stato «attivo» è scritto a mano:
// badge, ultimo esito ed errori vengono dal payload della query. Le operazioni
// che scrivono dichiarano la conseguenza prima del pulsante.
//
// I gate restano quelli già presenti: `isDirezione` per le superfici di
// direzione (specchio di `adminProcedure`, che promuove ad admin chi ha il
// ruolo direzione) e l'errore FORBIDDEN della query per i pannelli che il
// server nasconde. Un errore che non è di permesso non viene più mascherato:
// diventa uno stato di errore con ritentativo.

import { Badge } from "@/components/ui/badge";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import StatePanel from "@/components/patterns/StatePanel";
import {
  AlertCircle,
  Calendar,
  RefreshCw,
  Truck,
  Users,
  Shield,
  Calculator,
  ArrowRight,
  Lock,
  Copy,
  Check,
  Plus,
  Trash2,
  Power,
  Play,
  Link2,
  Unlink2,
  KeyRound,
  Square,
  Store,
  BookOpen,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { presentFicSyncStats } from "@/lib/paymentView";
import { trpc } from "@/lib/trpc";
import { permessoNegato } from "@/lib/trpcErrors";
import { toast } from "sonner";
import CaselleEmailCard from "@/components/CaselleEmailCard";
import WhatsAppCard from "@/components/WhatsAppCard";
import TarsAgentCard from "@/components/tars/TarsAgentCard";
import TariffeLimitiPanel from "@/components/computo/TariffeLimitiPanel";
import FatturazioneConfigPanel from "@/components/fattura/FatturazioneConfigPanel";

// Scorciatoie di direzione verso route già registrate in App.tsx. L'elenco non
// autorizza nulla: ogni destinazione ha la sua guardia (RequireDirezione) e il
// suo router. Non si aggiunge una voce se la route non esiste.
const GESTIONE_LINKS: Array<{
  icon: ComponentType<{ className?: string }>;
  label: string;
  path: string;
  description: string;
}> = [
  {
    icon: Truck,
    label: "Fornitori",
    path: "/fornitori",
    description: "Anagrafica fornitori, ordini, listini",
  },
  {
    icon: Users,
    label: "Squadre",
    path: "/squadre",
    description: "Squadre di posa e assegnazioni",
  },
  {
    icon: Shield,
    label: "Garanzie",
    path: "/garanzie",
    description: "Registro garanzie e scadenze",
  },
  {
    icon: Calculator,
    label: "Preventivatori",
    path: "/preventivatori",
    description: "Calcolatori prezzo per azienda e prodotto",
  },
  {
    icon: Users,
    label: "Utenti",
    path: "/utenti",
    description: "Persone, ruoli e deleghe di capability",
  },
  {
    icon: Store,
    label: "Sedi",
    path: "/sedi",
    description: "Anagrafica sedi e ambito dei dati",
  },
  {
    icon: BookOpen,
    label: "Conoscenza",
    path: "/conoscenza",
    description: "Regole e convenzioni aziendali scritte",
  },
];

function SezioneHub({
  titolo,
  descrizione,
  children,
}: {
  titolo: string;
  descrizione: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="min-w-0">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-text-3">
          {titolo}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-text-2">
          {descrizione}
        </p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

export default function Integrazioni() {
  const { user } = useAuth();
  // Specchio UX del `requireDirezione` che i router mail, Fatture in Cloud e
  // backup applicano già lato server (`adminProcedure`: `server/routers.ts`
  // promuove ad `admin` chi ha il ruolo direzione, quindi l'esito coincide).
  // Serve solo a non stampare intestazioni di sezione sopra pannelli che
  // sparirebbero comunque: il confine resta il server, e i rami
  // `permessoNegato` dentro ogni pannello restano come difesa in profondità.
  // Non è una capability e non va usato per decidere cosa può essere scritto.
  const canManage = isDirezione(user);
  // Kill switch «limiti»: la UI nasconde la sezione, il server decide.
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const limitiAttivi = Boolean(interruttori.data?.limiti);
  // La fatturazione dal contratto dipende da due interruttori: senza i limiti
  // non c'è il computo su cui la bozza si fonda, quindi la sua configurazione
  // non avrebbe niente da governare.
  const fatturazioneAttiva = Boolean(
    interruttori.data?.fatturazione && interruttori.data?.limiti
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Amministrazione"
        title="Impostazioni"
        description="Canali, contabilità, calendari e backup. Ogni pannello riporta lo stato che il server conosce: se un collegamento manca, lo dice invece di mostrarsi attivo."
        metadata={
          <>
            <span>
              Email, WhatsApp, Fatture in Cloud e calendari valgono{" "}
              <strong className="font-semibold text-text-2">per la sede</strong>{" "}
              selezionata nella barra laterale.
            </span>
            <span>
              Il backup su Google Drive è{" "}
              <strong className="font-semibold text-text-2">
                unico per l&apos;installazione
              </strong>{" "}
              e copre i dati di tutte le sedi.
            </span>
          </>
        }
      />

      {canManage && (
        <SezioneHub
          titolo="Canali"
          descrizione="Posta e WhatsApp entrano nel CRM in sola lettura e diventano cronologia del cliente. Le credenziali si scrivono una volta e non si rileggono."
        >
          <CaselleEmailCard />
          <WhatsAppCard />
        </SezioneHub>
      )}

      {canManage && (
        <SezioneHub
          titolo="Contabilità"
          descrizione="Fatture in Cloud allinea documenti, pagamenti e anagrafica della sede. Le operazioni che scrivono si simulano prima e dichiarano cosa cambia."
        >
          <FattureInCloudCard />
          {fatturazioneAttiva && <FatturazioneConfigPanel />}
          <ImportaClientiCard />
          <ResetPattuitiCard />
        </SezioneHub>
      )}

      {canManage && limitiAttivi && (
        <SezioneHub
          titolo="Limiti di spesa"
          descrizione="Massimali, prodotti DEI, accessori, opere, coefficienti e detrazioni del computo limiti in vigore, con la data di validità. Sola lettura in questa fase."
        >
          <TariffeLimitiPanel />
        </SezioneHub>
      )}

      <SezioneHub
        titolo="Calendari"
        descrizione="Due direzioni distinte e indipendenti: i calendari Google si leggono dentro il CRM, e gli appuntamenti del CRM si pubblicano come feed iCal."
      >
        <GoogleCalendarImport />
        <GoogleCalendarSync />
      </SezioneHub>

      {canManage && (
        <SezioneHub
          titolo="Backup e storage"
          descrizione="Il salvataggio notturno dell'installazione. Finché Drive non è collegato il backup viene comunque eseguito, ma resta sul disco del server."
        >
          <BackupDrive />
        </SezioneHub>
      )}

      <SezioneHub
        titolo="Agente"
        descrizione="Diagnostica tecnica di Tars: interruttori, provider e budget. Le proposte restano inerti finché una persona non le approva."
      >
        {/* La card è gated al suo interno su interruttori e ruolo: qui non si
            aggiunge un secondo controllo. */}
        <TarsAgentCard direzione={canManage} />
      </SezioneHub>

      {canManage && (
        <SezioneHub
          titolo="Gestione direzione"
          descrizione="Scorciatoie verso le superfici raggiungibili dalla direzione. Ogni destinazione applica la propria guardia e il proprio router."
        >
          <DataSurface
            density="compact"
            tone="sunken"
            title={
              <span className="flex flex-wrap items-center gap-2">
                Superfici collegate
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  Direzione
                </Badge>
              </span>
            }
          >
            <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
              {GESTIONE_LINKS.map(link => (
                <li key={link.path} className="min-w-0">
                  <CollegamentoGestione {...link} />
                </li>
              ))}
            </ul>
          </DataSurface>
        </SezioneHub>
      )}
    </div>
  );
}

function CollegamentoGestione({
  icon: Icona,
  label,
  path,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  path: string;
  description: string;
}) {
  const [, setLocation] = useLocation();

  return (
    <button
      type="button"
      onClick={() => setLocation(path)}
      className="group flex min-h-11 w-full min-w-0 items-start gap-3 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-2 text-text-2"
      >
        <Icona className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-text-1">
            {label}
          </span>
          <ArrowRight
            aria-hidden="true"
            className="size-4 shrink-0 text-text-3"
          />
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-text-2">
          {description}
        </span>
      </span>
    </button>
  );
}

// ── Import anagrafica da un export Fatture in Cloud — direzione soltanto ─────
//
// Il file lo legge il browser e ne manda il testo: l'alternativa era un
// upload con storage temporaneo per un'operazione che si fa due volte l'anno.
// Simula sempre per primo — la simulazione dice quanti ne creerebbe, ed è il
// numero su cui si decide.
function ImportaClientiCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [csv, setCsv] = useState<string | null>(null);
  const [nomeFile, setNomeFile] = useState<string | null>(null);
  const [arricchisci, setArricchisci] = useState(true);
  const [report, setReport] = useState<any>(null);

  const importa = trpc.clienti.importaDaCsv.useMutation({
    onSuccess: r => {
      setReport(r);
      if (!r.dryRun) {
        toast.success(
          `${r.creati} clienti creati · ${r.campiArricchiti} campi riempiti`
        );
        utils.clienti.invalidate();
      }
    },
    onError: e => toast.error(e.message),
  });

  if (!isDirezione(user)) return null;

  const scegli = async (file: File | undefined) => {
    if (!file) return;
    setReport(null);
    setNomeFile(file.name);
    setCsv(await file.text());
  };

  return (
    <DataSurface
      density="comfortable"
      tone="default"
      title="Importa clienti da Fatture in Cloud"
      description="Carica l'export dei clienti in CSV. Chi c'è già viene riconosciuto da partita IVA, codice fiscale o nome e non viene duplicato: nessun cliente viene mai eliminato o sovrascritto."
    >
      <div className="min-w-0 space-y-3 text-sm">
        <p className="text-xs text-text-2">
          Da Excel: <em>File → Salva come → CSV UTF-8</em>. Da Fatture in Cloud
          si può esportare direttamente in CSV.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            id="import-clienti-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={e => scegli(e.target.files?.[0])}
          />
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <label htmlFor="import-clienti-file" className="cursor-pointer">
              Scegli il file CSV
            </label>
          </Button>
          {nomeFile && (
            <span className="min-w-0 truncate text-xs text-text-2">
              {nomeFile}
            </span>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-text-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={arricchisci}
            onChange={e => setArricchisci(e.target.checked)}
          />
          <span>
            Riempi i campi vuoti dei clienti già presenti (email, telefono,
            indirizzo). Non sovrascrive mai un dato esistente.
          </span>
        </label>

        {report && (
          <div className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3 text-xs">
            <p className="font-semibold text-text-1">
              {report.dryRun ? "Simulazione — nessuna scrittura" : "Importato"}
            </p>
            <ul className="mt-1 space-y-0.5 tabular-nums text-text-2">
              <li>Righe lette: {report.righeLette}</li>
              <li className="font-semibold text-text-1">
                {report.dryRun ? "Da creare" : "Creati"}: {report.creati}
              </li>
              <li>Già in anagrafica: {report.giaPresenti}</li>
              <li>Ripetuti nel file: {report.duplicatiNelFile}</li>
              {report.scartati > 0 && <li>Scartati: {report.scartati}</li>}
              {arricchisci && (
                <li>Campi vuoti riempiti: {report.campiArricchiti}</li>
              )}
            </ul>
            {report.esempiDaCreare?.length > 0 && (
              <p className="mt-2 min-w-0 break-words text-text-2">
                Esempi fra i nuovi:{" "}
                {report.esempiDaCreare.slice(0, 8).join(" · ")}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={!csv || importa.isPending}
            onClick={() =>
              importa.mutate({ csv: csv!, apply: false, arricchisci })
            }
          >
            {importa.isPending && (
              <RefreshCw className="size-4 motion-safe:animate-spin" />
            )}
            Simula
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            disabled={!csv || !report || !report.dryRun || importa.isPending}
            onClick={() =>
              importa.mutate({ csv: csv!, apply: true, arricchisci })
            }
          >
            Importa {report?.dryRun ? `${report.creati} clienti` : ""}
          </Button>
        </div>
        {!report && (
          <p className="text-xs text-text-3">
            Simula prima: il numero della simulazione è quello che verrà creato.
          </p>
        )}
      </div>
    </DataSurface>
  );
}

// ── Reset di pattuito, rate e pagamenti manuali — direzione soltanto ─────────
//
// Sta qui e non solo nello script perche' uno script esterno non regge: il
// server tiene le commesse in memoria e le riscrive intere al primo salvataggio,
// quindi una scrittura fatta da fuori viene sovrascritta dal primo sync utile.
// Da questo bottone la mutazione avviene dentro il processo vivo.
function ResetPattuitiCard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [includiArchiviate, setIncludiArchiviate] = useState(false);
  const [tutteLeSedi, setTutteLeSedi] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [confermaAperta, setConfermaAperta] = useState(false);

  const reset = trpc.commesse.resetPattuiti.useMutation({
    onSuccess: r => {
      setReport(r);
      if (r.refusedReason) {
        toast.error("Reset rifiutato");
        return;
      }
      if (!r.dryRun) {
        setConfermaAperta(false);
        toast.success(
          `Reset eseguito · ${r.pattuitiAzzerati} pattuiti, ${r.pagamentiManualiRimossi} pagamenti manuali`
        );
        utils.commesse.invalidate();
        utils.economia.invalidate();
      }
    },
    onError: e => toast.error(e.message),
  });

  if (!isDirezione(user)) return null;

  const lancia = (apply: boolean) =>
    reset.mutate({
      apply,
      includiArchiviate,
      soloSedeAttiva: !tutteLeSedi,
    });

  return (
    <DataSurface
      density="comfortable"
      tone="default"
      title={
        <span className="flex flex-wrap items-center gap-2">
          Reset pattuito e pagamenti manuali
          <Badge variant="destructive">Distruttivo</Badge>
        </span>
      }
      description="Azzera importo pattuito e piano rate ed elimina i pagamenti inseriti a mano. I movimenti che arrivano da Fatture in Cloud restano intatti; «Sincronizza ora» ricostruisce poi il pattuito dalle fatture."
    >
      <div className="min-w-0 space-y-3 text-sm">
        <div
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-control)] border border-danger/40 bg-danger-soft p-3 text-xs text-text-1"
        >
          <AlertCircle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-danger"
          />
          <span>
            I pagamenti manuali vengono{" "}
            <strong>eliminati, non stornati</strong>. Quelli che Fatture in
            Cloud conosce tornano al prossimo sync; gli acconti mai fatturati
            no. Serve un backup Drive riuscito nelle ultime 24 ore, altrimenti
            l&apos;esecuzione viene rifiutata.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
            <input
              type="checkbox"
              checked={includiArchiviate}
              onChange={e => setIncludiArchiviate(e.target.checked)}
            />
            <span>Includi anche le commesse archiviate</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-2">
            <input
              type="checkbox"
              checked={tutteLeSedi}
              onChange={e => setTutteLeSedi(e.target.checked)}
            />
            <span>Tutte le sedi, non solo quella attiva</span>
          </label>
        </div>

        {report && (
          <div className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3 text-xs">
            <p className="font-semibold text-text-1">
              {report.refusedReason
                ? "Rifiutato"
                : report.dryRun
                  ? "Simulazione — nessuna scrittura"
                  : "Eseguito"}
            </p>
            {report.refusedReason ? (
              <p className="mt-1 text-danger">{report.refusedReason}</p>
            ) : (
              <ul className="mt-1 space-y-0.5 tabular-nums text-text-2">
                <li>Commesse esaminate: {report.commesseEsaminate}</li>
                <li>Pattuiti azzerati: {report.pattuitiAzzerati}</li>
                <li>Piani rate rimossi: {report.pianiRimossi}</li>
                <li className="font-semibold text-danger">
                  Pagamenti manuali eliminati: {report.pagamentiManualiRimossi}
                </li>
                <li>
                  Pagamenti FiC conservati: {report.pagamentiFicConservati}
                </li>
                {report.commesseSaltate?.length > 0 && (
                  <li>Saltate (archiviate): {report.commesseSaltate.length}</li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            disabled={reset.isPending}
            onClick={() => lancia(false)}
          >
            Simula
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="min-h-11"
            disabled={reset.isPending || !report || report.dryRun === false}
            onClick={() => setConfermaAperta(true)}
          >
            Esegui il reset
          </Button>
        </div>
        {!report && (
          <p className="text-xs text-text-3">
            Simula prima: i numeri della simulazione sono quelli che verranno
            applicati.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confermaAperta}
        onOpenChange={setConfermaAperta}
        title="Eliminare i pagamenti inseriti a mano?"
        description={
          report
            ? `Verranno azzerati ${report.pattuitiAzzerati} pattuiti ed eliminati ${report.pagamentiManualiRimossi} pagamenti manuali su ${report.commesseEsaminate} commesse. I ${report.pagamentiFicConservati} movimenti di Fatture in Cloud restano. L'operazione non ha un annullamento: si torna indietro solo dal backup Drive.`
            : ""
        }
        confirmLabel="Elimina"
        onConfirm={() => lancia(true)}
      />
    </DataSurface>
  );
}

// ── Fatture in Cloud → contabilità e clienti della sede ──────────────────────
// Ogni 6h (o su richiesta) il CRM rilegge i documenti dell'anno e allinea
// anagrafica, pattuito e pagamenti. Lo stato mostrato è quello del payload.
function FattureInCloudCard() {
  const status = trpc.fattureInCloud.status.useQuery(undefined, {
    retry: false,
    refetchInterval: query => (query.state.data?.syncInCorso ? 1_500 : 15_000),
  });
  const utils = trpc.useUtils();
  const [token, setToken] = useState("");
  const [companies, setCompanies] = useState<Array<{
    id: number;
    name: string;
  }> | null>(null);

  const save = trpc.fattureInCloud.saveConfig.useMutation({
    onSuccess: () => {
      utils.fattureInCloud.invalidate();
      setToken("");
      toast.success("Configurazione salvata");
    },
    onError: e => toast.error(e.message),
  });
  const loadCompanies = trpc.fattureInCloud.companies.useMutation({
    onSuccess: list => {
      setCompanies(list);
      if (list.length === 1) save.mutate({ companyId: list[0].id });
    },
    onError: e => toast.error(e.message),
  });
  // Riallineamento locale: nessuna chiamata all'API, lavora sulle fatture
  // gia' scaricate. Serve dopo un reset del pattuito o dopo un cambio della
  // regola di match, quando il sync completo sarebbe minuti spesi per niente.
  const riallinea = trpc.ficFatture.riconciliaOra.useMutation({
    onSuccess: r => {
      toast.success(
        `Riallineato · ${r.collegate} fatture collegate · ${r.pattuitiAggiornati} pattuiti aggiornati`
      );
      utils.ficFatture.invalidate();
      utils.commesse.invalidate();
      utils.economia.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const sync = trpc.fattureInCloud.syncNow.useMutation({
    onMutate: () => {
      window.setTimeout(() => void status.refetch(), 150);
    },
    onSuccess: ({ result }) => {
      utils.fattureInCloud.invalidate();
      utils.clienti.invalidate();
      utils.ficFatture.invalidate();
      utils.ficCosti.invalidate();
      utils.economia.invalidate();
      toast.success(result);
    },
    onError: e => {
      utils.fattureInCloud.invalidate();
      if (!/annullata dall'operatore/i.test(e.message)) toast.error(e.message);
    },
  });
  const annullaSync = trpc.fattureInCloud.annullaSync.useMutation({
    onSuccess: ({ annullata }) => {
      utils.fattureInCloud.invalidate();
      if (annullata) toast.success("Sincronizzazione fermata");
      else toast.info("Nessuna sincronizzazione attiva");
    },
    onError: e => toast.error(e.message),
  });
  const oauthStart = trpc.fattureInCloud.oauthStartUrl.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: e => toast.error(e.message),
  });
  const disconnect = trpc.fattureInCloud.disconnectOAuth.useMutation({
    onSuccess: () => {
      setCompanies(null);
      utils.fattureInCloud.invalidate();
      toast.success("Fatture in Cloud scollegato");
    },
    onError: e => toast.error(e.message),
  });

  // Il pannello è direzione-only lato server: un FORBIDDEN significa che non
  // riguarda questo utente, e resta nascosto come prima.
  if (permessoNegato(status.error)) return null;

  if (status.isLoading || status.error || !status.data) {
    return (
      <DataSurface
        density="comfortable"
        tone="default"
        title="Fatture in Cloud"
        description="Contabilità della sede: documenti, pagamenti e anagrafica."
        state={
          status.error
            ? {
                kind: "error",
                title: "Stato Fatture in Cloud non disponibile",
                description:
                  "Il server non ha risposto sullo stato del collegamento. Nessuna operazione è stata eseguita.",
                action: (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void status.refetch()}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Riprova
                  </Button>
                ),
              }
            : {
                kind: "loading",
                title: "Lettura stato Fatture in Cloud",
                description: "Sto chiedendo al server com'è il collegamento.",
                rows: 2,
              }
        }
      />
    );
  }

  const st = status.data;
  const lastStats = st.lastStats ? presentFicSyncStats(st.lastStats) : [];

  return (
    <DataSurface
      density="comfortable"
      tone="default"
      title="Fatture in Cloud"
      description="Sincronizza vendite, note di credito, acquisti, pagamenti e clienti della sede selezionata."
      toolbar={
        <>
          {st.configured && (
            <Switch
              aria-label="Abilita la sincronizzazione Fatture in Cloud"
              checked={st.enabled}
              onCheckedChange={v => save.mutate({ enabled: v })}
              disabled={st.syncInCorso}
            />
          )}
          {st.syncInCorso ? (
            <Button
              size="sm"
              variant="destructive"
              className="min-h-11"
              onClick={() => annullaSync.mutate()}
              disabled={annullaSync.isPending}
            >
              <Square className="size-3.5 fill-current" aria-hidden="true" />
              {annullaSync.isPending ? "Arresto…" : "Ferma sincronizzazione"}
            </Button>
          ) : (
            <Button
              size="sm"
              className="min-h-11"
              onClick={() => sync.mutate()}
              disabled={!st.configured || sync.isPending}
            >
              <RefreshCw
                aria-hidden="true"
                className={
                  sync.isPending
                    ? "size-3.5 motion-safe:animate-spin"
                    : "size-3.5"
                }
              />
              {sync.isPending ? "Avvio…" : "Sincronizza ora"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            title="Ricollega le fatture già scaricate e ricostruisce pattuito e rate, senza contattare Fatture in Cloud"
            onClick={() => riallinea.mutate()}
            disabled={!st.configured || riallinea.isPending || sync.isPending}
          >
            <Link2
              aria-hidden="true"
              className={
                riallinea.isPending
                  ? "size-3.5 motion-safe:animate-pulse"
                  : "size-3.5"
              }
            />
            {riallinea.isPending ? "Riallineo…" : "Riallinea dalle fatture"}
          </Button>
        </>
      }
    >
      <div className="min-w-0 space-y-4 border-t border-border-soft pt-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {st.connected ? (
            <>
              <Badge variant="success">
                {st.authMode === "oauth" ? "OAuth collegato" : "Token manuale"}
              </Badge>
              <span className="codice-mono text-[11px] text-text-3">
                {st.companyId
                  ? `azienda #${st.companyId}`
                  : "azienda da selezionare"}
              </span>
            </>
          ) : (
            <Badge variant="warning">Non configurato</Badge>
          )}
          {st.syncInCorso && (
            <Badge variant="warning">
              Sincronizzazione in corso
              {st.syncAvviataAt
                ? ` dalle ${new Date(st.syncAvviataAt).toLocaleTimeString(
                    "it-IT",
                    { hour: "2-digit", minute: "2-digit" }
                  )}`
                : ""}
            </Badge>
          )}
          {st.lastResult && (
            <span
              className={`text-xs ${st.lastResult.startsWith("ERRORE") ? "text-danger" : "text-text-2"}`}
            >
              Ultimo esito: {st.lastResult}
            </span>
          )}
        </div>

        {lastStats.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5"
            aria-label="Esito ultimo sync FiC"
          >
            {lastStats.map(item => (
              <Badge key={item} variant="outline" className="text-[10px]">
                {item}
              </Badge>
            ))}
          </div>
        )}

        {st.permessiEconomiciDaAggiornare && (
          <div className="rounded-[var(--radius-control)] border border-warning/40 bg-warning-soft px-3 py-3">
            <p className="text-sm font-semibold text-text-1">
              Aggiorna i permessi economici
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-2">
              Il collegamento attuale non ha ancora confermato la lettura di
              note di credito e documenti ricevuti. Ricollega FiC una volta, poi
              avvia una sincronizzazione completa.
            </p>
            {st.oauthClientReady && (
              <Button
                size="sm"
                className="mt-3 min-h-11"
                onClick={() => oauthStart.mutate()}
                disabled={oauthStart.isPending}
              >
                <Link2 className="size-4" aria-hidden="true" />
                Ricollega e aggiorna permessi
              </Button>
            )}
          </div>
        )}

        {/* Permessi di scrittura: servono solo alla fatturazione dal
            contratto (emissione su FiC). Il collegamento di sola lettura
            resta valido, quindi qui si dichiara lo stato e si offre il
            ri-collegamento, senza allarmare chi non emette da qui. */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-2">Permessi di scrittura fatture:</span>
          {st.scopeScrittura ? (
            <Badge variant="success">autorizzati</Badge>
          ) : (
            <Badge variant="warning">non autorizzati</Badge>
          )}
          {st.oauthClientReady && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              title="Rifà il consenso OAuth chiedendo anche la creazione dei documenti su Fatture in Cloud"
              onClick={() => oauthStart.mutate({ scrittura: true })}
              disabled={oauthStart.isPending}
            >
              <Link2 className="size-3.5" aria-hidden="true" />
              Ri-autorizza con permessi di scrittura
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {st.oauthClientReady ? (
            <Button
              size="sm"
              className="min-h-11"
              variant={st.authMode === "oauth" ? "outline" : "default"}
              onClick={() => oauthStart.mutate()}
              disabled={oauthStart.isPending}
            >
              <Link2 className="size-3.5" aria-hidden="true" />
              {st.authMode === "oauth"
                ? "Ricollega account"
                : "Collega con OAuth"}
            </Button>
          ) : (
            <Badge variant="outline" className="font-normal">
              OAuth server da configurare
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={!st.connected || loadCompanies.isPending}
            onClick={() => loadCompanies.mutate()}
          >
            {loadCompanies.isPending ? "Cerco…" : "Seleziona azienda"}
          </Button>
          {st.authMode === "oauth" && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 text-danger"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              <Unlink2 className="size-3.5" aria-hidden="true" />
              Scollega
            </Button>
          )}
        </div>

        {companies && companies.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {companies.map(c => (
              <Button
                key={c.id}
                variant={st.companyId === c.id ? "default" : "outline"}
                size="sm"
                className="min-h-11"
                onClick={() => save.mutate({ companyId: c.id })}
              >
                {c.name}
              </Button>
            ))}
          </div>
        )}

        {!st.oauthClientReady && (
          <p className="text-xs text-text-2">
            Imposta <code>FIC_OAUTH_CLIENT_ID</code>,{" "}
            <code>FIC_OAUTH_CLIENT_SECRET</code> e la callback{" "}
            <code>/api/oauth/fic/callback</code> per attivare il rinnovo
            automatico.
          </p>
        )}

        {/* Il token non viene mai riletto: il campo è in scrittura, e il
            server restituisce al massimo un mascheramento come segnaposto. */}
        <details className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-text-1">
            <KeyRound className="size-3.5 text-text-3" aria-hidden="true" />
            Token manuale di emergenza
          </summary>
          <div className="flex flex-wrap items-end gap-2 pt-3">
            <div className="min-w-[240px] flex-1 space-y-1">
              <Label htmlFor="fic-token" className="text-xs">
                Access token
              </Label>
              <Input
                id="fic-token"
                type="password"
                autoComplete="new-password"
                placeholder={
                  st.authMode === "manual" ? (st.tokenMasked ?? "a/…") : "a/…"
                }
                value={token}
                onChange={e => setToken(e.target.value)}
                className="h-11 font-mono text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={token.trim().length < 10 || save.isPending}
              onClick={() => save.mutate({ accessToken: token.trim() })}
            >
              Salva token
            </Button>
          </div>
        </details>
      </div>
    </DataSurface>
  );
}

// ── Backup notturno su Google Drive ─────────────────────────────────────────
// Pannello di installazione (non per sede): stato del backup delle 00:00,
// esecuzione manuale, cartella di destinazione e istruzioni di collegamento.
function BackupDrive() {
  const status = trpc.backup.status.useQuery(undefined, {
    refetchInterval: 30000,
    retry: false,
  });
  const utils = trpc.useUtils();
  const [folderId, setFolderId] = useState<string | null>(null);

  const runNow = trpc.backup.runNow.useMutation({
    onSuccess: (log: any) => {
      utils.backup.invalidate();
      if (log.ok) {
        toast.success(
          log.target === "drive"
            ? `Backup su Google Drive completato — ${log.files} file`
            : `Drive non collegato: backup locale completato — ${log.files} file`
        );
      } else {
        toast.error(`Backup fallito: ${log.error}`);
      }
    },
    onError: e => toast.error(e.message ?? "Backup fallito"),
  });
  const updateCfg = trpc.backup.updateConfig.useMutation({
    onSuccess: () => {
      utils.backup.invalidate();
      setFolderId(null);
      toast.success("Impostazioni backup salvate");
    },
  });
  const oauthStart = trpc.backup.oauthStartUrl.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: e => toast.error(e.message ?? "Avvio collegamento fallito"),
  });
  const oauthDisconnect = trpc.backup.disconnectOAuth.useMutation({
    onSuccess: () => {
      utils.backup.invalidate();
      toast.success("Account Google scollegato");
    },
  });

  // Procedure admin: un FORBIDDEN nasconde il pannello, come prima.
  if (permessoNegato(status.error)) return null;

  if (status.isLoading || status.error || !status.data) {
    return (
      <DataSurface
        density="comfortable"
        tone="default"
        title="Backup notturno su Google Drive"
        description="Vale per l'intera installazione, non per la singola sede."
        state={
          status.error
            ? {
                kind: "error",
                title: "Stato del backup non disponibile",
                description:
                  "Il server non ha risposto sullo stato del backup. Non è possibile dire se l'ultimo salvataggio sia riuscito.",
                action: (
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => void status.refetch()}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Riprova
                  </Button>
                ),
              }
            : {
                kind: "loading",
                title: "Lettura stato del backup",
                description: "Sto chiedendo al server l'ultimo salvataggio.",
                rows: 2,
              }
        }
      />
    );
  }

  const s = status.data;
  const last = s.ultimoBackup;
  const nextMin =
    s.prossimoTraMs != null ? Math.round(s.prossimoTraMs / 60000) : null;
  const folderValue = folderId ?? s.folderId;

  return (
    <DataSurface
      density="comfortable"
      tone="default"
      title="Backup notturno su Google Drive"
      description="Ogni notte alle 00:00 salva clienti, commesse, preventivi, misure e tutti i file in cartelle ordinate per sede e cliente. È unico per l'installazione."
      toolbar={
        <Button
          size="sm"
          className="min-h-11"
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending || s.inCorso}
        >
          <Play className="size-3.5" aria-hidden="true" />
          {runNow.isPending || s.inCorso ? "In corso…" : "Esegui ora"}
        </Button>
      }
    >
      <div className="min-w-0 space-y-3 border-t border-border-soft pt-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {s.mode === "oauth" ? (
            <>
              <Badge variant="success">Drive collegato</Badge>
              <span className="codice-mono min-w-0 truncate text-[11px] text-text-3">
                {s.oauthEmail ?? "account Google"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 text-xs text-danger"
                onClick={() => oauthDisconnect.mutate()}
                disabled={oauthDisconnect.isPending}
              >
                Scollega
              </Button>
            </>
          ) : s.mode === "service_account" ? (
            <>
              <Badge variant="success">Drive collegato (service account)</Badge>
              <span className="codice-mono min-w-0 truncate text-[11px] text-text-3">
                {s.serviceAccountEmail}
              </span>
            </>
          ) : (
            <>
              <Badge variant="warning">
                Drive non collegato — backup salvato in locale
              </Badge>
              {s.oauthClientReady && (
                <Button
                  size="sm"
                  className="min-h-11 text-xs"
                  onClick={() => oauthStart.mutate()}
                  disabled={oauthStart.isPending}
                >
                  Collega Google Drive
                </Button>
              )}
            </>
          )}
          {nextMin != null && (
            <span className="text-xs text-text-2">
              Prossimo backup automatico tra ~
              {nextMin >= 60
                ? `${Math.floor(nextMin / 60)}h ${nextMin % 60}m`
                : `${nextMin}m`}
            </span>
          )}
        </div>

        {s.mode === "oauth" && (
          <p className="text-xs text-text-2">
            I backup finiscono nella cartella{" "}
            <a
              className="font-medium text-primary hover:underline"
              href={
                s.rootFolderId
                  ? `https://drive.google.com/drive/folders/${s.rootFolderId}`
                  : "https://drive.google.com"
              }
              target="_blank"
              rel="noreferrer"
            >
              «Backup CRM Ruffino»
            </a>{" "}
            del tuo Drive: puoi spostarla o condividerla liberamente (anche
            dentro un&apos;altra cartella condivisa) — il CRM continua a
            trovarla.
          </p>
        )}

        {last && (
          <div className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2 text-xs">
            <p className="min-w-0">
              <span className="font-semibold text-text-1">Ultimo backup:</span>{" "}
              {new Date(last.startedAt).toLocaleString("it-IT")} ·{" "}
              {last.ok == null ? (
                <Badge variant="secondary" className="text-[10px]">
                  in corso
                </Badge>
              ) : last.ok ? (
                <Badge variant="success" className="text-[10px]">
                  riuscito ({last.target === "drive" ? "Drive" : "locale"})
                </Badge>
              ) : (
                <Badge variant="danger" className="text-[10px]">
                  fallito
                </Badge>
              )}
            </p>
            <p className="mt-0.5 text-text-2">
              {last.rootName} — {last.files} file,{" "}
              {(last.bytes / 1024 / 1024).toFixed(1)} MB
            </p>
            {last.error && <p className="mt-0.5 text-danger">{last.error}</p>}
          </div>
        )}

        {s.mode === "service_account" && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1 space-y-1">
              <Label htmlFor="backup-folder" className="text-xs">
                ID cartella Google Drive di destinazione
              </Label>
              <Input
                id="backup-folder"
                value={folderValue}
                onChange={e => setFolderId(e.target.value)}
                className="h-11 font-mono text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              disabled={
                folderId == null ||
                folderId.trim() === s.folderId ||
                updateCfg.isPending
              }
              onClick={() =>
                folderId && updateCfg.mutate({ folderId: folderId.trim() })
              }
            >
              Salva
            </Button>
          </div>
        )}

        {!s.driveConfigurato && !s.oauthClientReady && (
          <div className="rounded-[var(--radius-control)] border border-warning/40 bg-warning-soft px-3 py-2.5">
            <p className="mb-1 text-xs font-semibold text-text-1">
              Per collegare Google Drive (account Google normale, una sola
              volta):
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-text-2">
              <li>
                Su{" "}
                <span className="font-medium text-text-1">
                  console.cloud.google.com
                </span>{" "}
                → «API e servizi» → «Schermata consenso OAuth»: configurala
                (tipo <span className="font-medium text-text-1">Esterno</span>),
                aggiungi la tua email e poi{" "}
                <span className="font-medium text-text-1">pubblica l&apos;app</span>{" "}
                (stato «In produzione»).
              </li>
              <li>
                «Credenziali» → «Crea credenziali» →{" "}
                <span className="font-medium text-text-1">ID client OAuth</span>{" "}
                → tipo «Applicazione web» → aggiungi URI di reindirizzamento:{" "}
                <span className="codice-mono break-all">
                  {window.location.origin}/api/oauth/gdrive/callback
                </span>
              </li>
              <li>
                Sul server imposta{" "}
                <span className="codice-mono">GOOGLE_OAUTH_CLIENT_ID</span> e{" "}
                <span className="codice-mono">GOOGLE_OAUTH_CLIENT_SECRET</span>{" "}
                con i valori del client e riavvia: comparirà qui il bottone
                «Collega Google Drive».
              </li>
            </ol>
            <p className="mt-1.5 text-[11px] text-text-3">
              Finché Drive non è collegato il backup notturno viene comunque
              eseguito e salvato sul disco del server (cartella{" "}
              <span className="codice-mono">backups/</span>).
            </p>
          </div>
        )}

        {!s.driveConfigurato && s.oauthClientReady && (
          <p className="text-xs text-text-2">
            Client OAuth configurato: premi{" "}
            <span className="font-medium text-text-1">
              «Collega Google Drive»
            </span>{" "}
            qui sopra, scegli l&apos;account e autorizza. Da quel momento il
            backup notturno finisce su Drive.
          </p>
        )}
      </div>
    </DataSurface>
  );
}

// ── Import dei calendari Google DENTRO il CRM (overlay in sola lettura) ──────
// L'operatore incolla l'«indirizzo segreto in formato iCal» di ogni calendario
// Google. Il server li scarica e li interpreta; il Calendario li sovrappone.
function GoogleCalendarImport() {
  const list = trpc.externalCalendars.list.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [nome, setNome] = useState("");
  const [url, setUrl] = useState("");

  const add = trpc.externalCalendars.add.useMutation({
    onSuccess: () => {
      utils.externalCalendars.invalidate();
      setNome("");
      setUrl("");
      toast.success("Calendario aggiunto — comparirà nel calendario CRM");
    },
    onError: e => toast.error(e.message ?? "Aggiunta non riuscita"),
  });
  const remove = trpc.externalCalendars.remove.useMutation({
    onSuccess: () => utils.externalCalendars.invalidate(),
    onError: e => toast.error(e.message ?? "Rimozione non riuscita"),
  });
  const update = trpc.externalCalendars.update.useMutation({
    onSuccess: () => utils.externalCalendars.invalidate(),
    onError: e => toast.error(e.message ?? "Aggiornamento non riuscito"),
  });
  const refresh = trpc.externalCalendars.refresh.useMutation({
    onSuccess: () => {
      utils.externalCalendars.invalidate();
      toast.success("Aggiornamento richiesto");
    },
    onError: e => toast.error(e.message ?? "Aggiornamento non riuscito"),
  });

  if (permessoNegato(list.error)) return null;

  const fonti = list.data ?? [];

  return (
    <DataSurface
      density="comfortable"
      tone="default"
      title="Mostra Google nel calendario CRM"
      description="Importa uno o più calendari Google: i loro eventi compaiono nel Calendario del CRM in sola lettura e si aggiornano ogni ~10 minuti."
      toolbar={
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || list.isLoading || Boolean(list.error)}
        >
          <RefreshCw
            aria-hidden="true"
            className={
              refresh.isPending ? "size-3.5 motion-safe:animate-spin" : "size-3.5"
            }
          />
          Aggiorna
        </Button>
      }
    >
      <div className="min-w-0 space-y-4 border-t border-border-soft pt-4">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-text-2">
          <li>
            In Google Calendar apri{" "}
            <span className="font-medium text-text-1">
              Impostazioni del calendario → Integra calendario
            </span>
            .
          </li>
          <li>
            Copia l&apos;
            <span className="font-medium text-text-1">
              «Indirizzo segreto in formato iCal»
            </span>{" "}
            (finisce in <span className="codice-mono">.ics</span>).
          </li>
          <li>Incollalo qui sotto con un nome. Ripeti per ogni calendario.</li>
        </ol>

        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="min-w-[140px] flex-1 space-y-1">
            <Label htmlFor="cal-nome" className="text-xs">
              Nome
            </Label>
            <Input
              id="cal-nome"
              placeholder="Es. Squadra posa"
              value={nome}
              onChange={e => setNome(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="min-w-[220px] flex-[2] space-y-1">
            <Label htmlFor="cal-url" className="text-xs">
              Indirizzo iCal (segreto)
            </Label>
            <Input
              id="cal-url"
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              value={url}
              onChange={e => setUrl(e.target.value)}
              className="h-11"
            />
          </div>
          <Button
            className="min-h-11"
            onClick={() => add.mutate({ nome: nome.trim(), icsUrl: url.trim() })}
            disabled={!nome.trim() || !url.trim() || add.isPending}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Aggiungi
          </Button>
        </div>

        {/* Lo stato riguarda l'elenco, non la superficie: il modulo di
            aggiunta qui sopra resta usabile, quindi StatePanel sta fra i figli
            invece di passare dalla prop `state` di DataSurface. */}
        {list.isLoading ? (
          <StatePanel
            kind="loading"
            compact
            title="Lettura calendari importati"
            description="Sto chiedendo al server le sorgenti configurate per la sede."
            rows={2}
          />
        ) : list.error ? (
          <StatePanel
            kind="error"
            compact
            title="Calendari importati non disponibili"
            description="Il server non ha risposto: l'elenco qui sotto non è affidabile."
            action={
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => void list.refetch()}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Riprova
              </Button>
            }
          />
        ) : fonti.length === 0 ? (
          <StatePanel
            kind="empty"
            compact
            title="Nessun calendario Google importato"
            description="Aggiungi un indirizzo iCal qui sopra: gli eventi compariranno nel Calendario del CRM."
          />
        ) : (
          <ul className="min-w-0 space-y-1.5">
            {fonti.map((s: any) => (
              <li
                key={s.id}
                className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2"
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-text-1">
                      {s.nome}
                    </p>
                    {s.status === "error" ? (
                      <Badge variant="danger" className="text-[10px]">
                        Errore
                      </Badge>
                    ) : s.status === "ok" ? (
                      <Badge variant="success" className="text-[10px]">
                        Sincronizzato
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        In attesa
                      </Badge>
                    )}
                    {!s.attivo && (
                      <Badge variant="outline" className="text-[10px]">
                        Nascosto
                      </Badge>
                    )}
                  </div>
                  {s.error && (
                    <p className="min-w-0 truncate text-[11px] text-danger">
                      {s.error}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={
                    s.attivo
                      ? `Nascondi «${s.nome}» dal calendario`
                      : `Mostra «${s.nome}» nel calendario`
                  }
                  title={
                    s.attivo ? "Nascondi dal calendario" : "Mostra nel calendario"
                  }
                  onClick={() => update.mutate({ id: s.id, attivo: !s.attivo })}
                >
                  <Power
                    aria-hidden="true"
                    className={`size-4 ${s.attivo ? "text-success" : "text-text-3"}`}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-danger"
                  aria-label={`Rimuovi «${s.nome}»`}
                  title="Rimuovi"
                  onClick={() => remove.mutate(s.id)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-text-3">
          Sola lettura: gli eventi Google appaiono nel calendario CRM ma non si
          modificano da qui.
        </p>
      </div>
    </DataSurface>
  );
}

// ── Feed iCal sottoscrivibili (export CRM → Google) ──────────────────────────
function GoogleCalendarSync() {
  const feeds = trpc.calendarSync.feeds.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const rotate = trpc.calendarSync.rotateToken.useMutation({
    onSuccess: () => {
      utils.calendarSync.feeds.invalidate();
      toast.success("Token ruotato — i vecchi link non funzionano più");
    },
    onError: e => toast.error(e.message ?? "Rotazione non riuscita"),
  });

  const [copied, setCopied] = useState<string | null>(null);
  const [confermaRotazione, setConfermaRotazione] = useState(false);

  function copyUrl(key: string, path: string) {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(key);
        toast.success("Link copiato — incollalo in Google Calendar");
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => toast.error("Copia non riuscita"));
  }

  if (permessoNegato(feeds.error)) return null;

  const elenco = feeds.data?.feeds ?? [];

  return (
    <DataSurface
      density="comfortable"
      tone="default"
      title="Pubblica il calendario CRM su Google"
      description="Un feed iCal per ogni tipo di appuntamento della sede, più uno con tutti. Google li rilegge periodicamente, in genere entro poche ore."
    >
      <div className="min-w-0 space-y-4 border-t border-border-soft pt-4">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-text-2">
          <li>Copia il link del calendario che vuoi sincronizzare.</li>
          <li>
            Apri Google Calendar →{" "}
            <span className="font-medium text-text-1">
              Altri calendari → + → Da URL
            </span>
            .
          </li>
          <li>
            Incolla il link e conferma: gli appuntamenti compaiono e si
            aggiornano da soli.
          </li>
          <li>Ripeti per ogni calendario che ti serve (rilievi, pose, …).</li>
        </ol>

        {/* Come sopra: le istruzioni e la rotazione del token restano leggibili
            anche quando l'elenco dei feed non lo è. */}
        {feeds.isLoading ? (
          <StatePanel
            kind="loading"
            compact
            title="Lettura dei feed della sede"
            description="Sto chiedendo al server i link pubblicabili."
            rows={2}
          />
        ) : feeds.error ? (
          <StatePanel
            kind="error"
            compact
            title="Feed non disponibili"
            description="Il server non ha risposto: i link non sono leggibili in questo momento."
            action={
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => void feeds.refetch()}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Riprova
              </Button>
            }
          />
        ) : elenco.length === 0 ? (
          <StatePanel
            kind="empty"
            compact
            title="Nessun feed disponibile per questa sede"
            description="Il server non espone link iCal per la sede selezionata."
          />
        ) : (
          <ul className="min-w-0 space-y-1.5">
            {elenco.map(f => (
              <li
                key={f.key}
                className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2"
              >
                <Calendar
                  aria-hidden="true"
                  className="size-4 shrink-0 text-text-3"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-1">{f.label}</p>
                  <p className="codice-mono min-w-0 truncate text-[11px] text-text-3">
                    {window.location.origin}
                    {f.path}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 shrink-0"
                  onClick={() => copyUrl(f.key, f.path)}
                >
                  {copied === f.key ? (
                    <>
                      <Check
                        className="size-3.5 text-success"
                        aria-hidden="true"
                      />{" "}
                      Copiato
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" aria-hidden="true" /> Copia
                      link
                    </>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-3">
          <p className="max-w-md text-[11px] text-text-2">
            I link contengono un token segreto della sede. Rigenerandolo{" "}
            <strong>tutte le iscrizioni esistenti smettono di funzionare</strong>{" "}
            e vanno rifatte a mano su ogni calendario Google.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => setConfermaRotazione(true)}
            disabled={rotate.isPending}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Rigenera token
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confermaRotazione}
        onOpenChange={setConfermaRotazione}
        title="Rigenerare il token dei feed?"
        description="Tutti i link già incollati in Google Calendar smettono di aggiornarsi: chi li usa dovrà iscriversi di nuovo con i link nuovi. Gli appuntamenti nel CRM non cambiano."
        confirmLabel="Rigenera"
        onConfirm={() => {
          setConfermaRotazione(false);
          rotate.mutate();
        }}
      />
    </DataSurface>
  );
}
