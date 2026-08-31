import TarsAvatar, { type StatoTarsAvatar } from "@/components/tars/TarsAvatar";
import TarsContextPanel, {
  type BriefingOperativoTars,
  type ContestoOperativoTars,
} from "@/components/tars/TarsContextPanel";
import TarsConversationList, {
  type TarsConversationListProps,
} from "@/components/tars/TarsConversationList";
import TarsThread, {
  chiaveUndoTars,
  type ChiaveUndoTars,
  type RichiestaApprovazioneTars,
  type RichiestaUndoTars,
} from "@/components/tars/TarsThread";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  associaTurnoOttimisticoAConversazione,
  creaTurnoOttimistico,
  deveInviareDaTastiera,
  selezioneDopoCambioArchivio,
  selezioneDopoRispostaInvio,
  unisciConversazioniSenzaDuplicati,
  unisciTurniConOttimistico,
  type ConversazioneTarsView,
  type TurnoTarsOttimistico,
  type TurnoTarsView,
} from "@/lib/tarsView";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArchiveRestore,
  BellPlus,
  BriefcaseBusiness,
  CalendarClock,
  FileCheck2,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ErroreInvio = { chiaveBozza: string; messaggio: string };

type InvioInVolo = {
  chiaveBozza: string;
  chiaveLocale: string;
  conversazioneId: number | null;
  testo: string;
  versioneSelezione: number;
};

function chiaveBozza(
  conversazioneId: number | null,
  chiaveNuova: string
): string {
  return conversazioneId == null
    ? chiaveNuova
    : `conversazione:${conversazioneId}`;
}

function codiceErrore(errore: unknown): string | null {
  if (errore == null || typeof errore !== "object" || !("data" in errore)) {
    return null;
  }
  const data = (errore as { data?: { code?: unknown } }).data;
  return typeof data?.code === "string" ? data.code : null;
}

function turnoIndicaOperativitaRidotta(turno: TurnoTarsView): boolean {
  if (turno.ruolo !== "tars") return false;
  if (turno.payload?.degradato === true) return true;
  const statoOperativo = turno.payload?.statoOperativo;
  return (
    statoOperativo != null &&
    typeof statoOperativo === "object" &&
    "stato" in statoOperativo &&
    statoOperativo.stato === "Bloccato"
  );
}

function StatoPagina({
  stato,
  titolo,
  descrizione,
  azione,
}: {
  stato: StatoTarsAvatar;
  titolo: string;
  descrizione: string;
  azione?: ReactNode;
}) {
  return (
    <div className="grid min-h-[45dvh] place-items-center px-4 text-center">
      <div className="max-w-md">
        <TarsAvatar stato={stato} size={52} className="mx-auto" />
        <h1 className="mt-4 text-lg font-bold text-text-1">{titolo}</h1>
        <p className="mt-2 text-sm leading-6 text-text-3">{descrizione}</p>
        {azione && <div className="mt-5">{azione}</div>}
      </div>
    </div>
  );
}

function CaricamentoPagina() {
  return (
    <div
      className="flex h-[calc(100dvh-8rem)] min-h-[34rem] min-w-0 overflow-hidden rounded-md border border-border-soft bg-card"
      role="status"
      aria-label="Caricamento Tars"
    >
      <div className="hidden w-72 shrink-0 space-y-3 border-r border-border-soft p-3 md:block xl:w-80">
        <Skeleton className="h-11 w-full motion-reduce:animate-none" />
        <Skeleton className="h-11 w-full motion-reduce:animate-none" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton
            key={index}
            className="h-16 w-full motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-4 p-4">
        <Skeleton className="h-12 w-48 motion-reduce:animate-none" />
        <Skeleton className="ml-auto h-20 w-3/4 motion-reduce:animate-none" />
        <Skeleton className="h-28 w-4/5 motion-reduce:animate-none" />
      </div>
      <div className="hidden w-80 shrink-0 space-y-3 border-l border-border-soft p-4 xl:block">
        <Skeleton className="h-5 w-40 motion-reduce:animate-none" />
        <Skeleton className="h-24 w-full motion-reduce:animate-none" />
        <Skeleton className="h-40 w-full motion-reduce:animate-none" />
      </div>
    </div>
  );
}

function RiepilogoBriefing({
  briefing,
  loading,
}: {
  briefing: BriefingOperativoTars | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-label="Caricamento briefing">
        <Skeleton className="h-4 w-36 motion-reduce:animate-none" />
        <Skeleton className="h-14 w-full motion-reduce:animate-none" />
      </div>
    );
  }
  if (briefing === null) {
    return (
      <p className="text-xs leading-5 text-text-3">
        Il briefing operativo non è disponibile in questo momento.
      </p>
    );
  }

  const vuotoBase =
    briefing.promemoriaOggi.length === 0 && briefing.casiMiei.length === 0;
  const vuotoCompleto =
    vuotoBase &&
    briefing.segnalazioni !== null &&
    briefing.segnalazioni.length === 0;
  if (vuotoCompleto) {
    return (
      <p className="text-xs leading-5 text-text-3">
        Nessun promemoria, caso assegnato o segnale operativo da evidenziare.
      </p>
    );
  }
  if (vuotoBase && briefing.segnalazioni === null) {
    return (
      <div className="space-y-1 text-xs leading-5 text-text-3">
        <p>Nessun promemoria o caso assegnato da evidenziare.</p>
        <p>Le segnalazioni non sono incluse nel briefing.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2 text-left text-xs text-text-2">
      {briefing.promemoriaOggi.slice(0, 2).map(promemoria => (
        <li key={`promemoria-${promemoria.id}`} className="flex gap-2">
          <CalendarClock
            className="mt-0.5 size-4 shrink-0 text-text-3"
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">
            {promemoria.remindAtLocale.slice(-5)} · {promemoria.testo}
          </span>
        </li>
      ))}
      {briefing.casiMiei.slice(0, 2).map(caso => (
        <li key={`caso-${caso.id}`} className="flex gap-2">
          <BriefcaseBusiness
            className="mt-0.5 size-4 shrink-0 text-text-3"
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">
            {caso.titolo} · {caso.priorita}
          </span>
        </li>
      ))}
      {briefing.segnalazioni?.slice(0, 2).map((segnalazione, index) => (
        <li key={`segnalazione-${index}`} className="flex gap-2">
          <BellPlus
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">{segnalazione.titolo}</span>
        </li>
      ))}
      {briefing.segnalazioni === null && (
        <li className="text-text-3">Segnalazioni non incluse.</li>
      )}
    </ul>
  );
}

function EmptyStateWorkbench({
  briefing,
  briefingLoading,
  contesto,
  onSuggerimento,
}: {
  briefing: BriefingOperativoTars | null;
  briefingLoading: boolean;
  contesto: ContestoOperativoTars | null;
  onSuggerimento: (testo: string) => void;
}) {
  const suggerimenti = [
    {
      icona: CalendarClock,
      etichetta: "Fammi il punto operativo di oggi",
    },
    {
      icona: Search,
      etichetta:
        contesto?.entita.tipo === "commessa"
          ? `Verifica la commessa #${contesto.entita.id}`
          : "Cerca una commessa per cliente o riferimento",
    },
    {
      icona: FileCheck2,
      etichetta: "Controlla gate e documenti della commessa",
    },
    {
      icona: BellPlus,
      etichetta: "Ricordami domani alle 9 di rivedere le priorità",
    },
  ];

  return (
    <div className="w-full space-y-5">
      <div>
        <TarsAvatar stato="disponibile" size={48} className="mx-auto" />
        <h2 className="mt-3 text-sm font-bold text-text-1">
          Postazione operativa pronta
        </h2>
        <p className="mt-1 text-sm leading-6 text-text-3">
          Parti dal briefing o prepara una richiesta concreta.
        </p>
      </div>
      <section
        aria-labelledby="tars-empty-briefing"
        className="rounded-md bg-surface-2 p-3 text-left"
      >
        <h3 id="tars-empty-briefing" className="mb-2 text-xs font-bold">
          Situazione di oggi
        </h3>
        <RiepilogoBriefing briefing={briefing} loading={briefingLoading} />
      </section>
      <div className="grid gap-2 sm:grid-cols-2">
        {suggerimenti.map(({ icona: Icona, etichetta }) => (
          <button
            key={etichetta}
            type="button"
            className="flex min-h-11 min-w-0 items-center gap-2 rounded-md border border-border-soft bg-surface px-3 py-2 text-left text-xs font-semibold text-text-1 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onSuggerimento(etichetta)}
          >
            <Icona className="size-4 shrink-0 text-text-3" aria-hidden="true" />
            <span className="min-w-0 break-words">{etichetta}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ListaWorkbench({
  erroreAzione,
  ...props
}: TarsConversationListProps & { erroreAzione: string | null }) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
      {erroreAzione && (
        <div
          role="alert"
          className="shrink-0 border-b border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger"
        >
          {erroreAzione}
        </div>
      )}
      <div className="min-h-0 flex-1 [&>nav]:h-full">
        <TarsConversationList {...props} />
      </div>
    </div>
  );
}

export default function Tars() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [conversazioneId, setConversazioneId] = useState<number | null>(null);
  const conversazioneIdRef = useRef<number | null>(null);
  const [metadatiSelezionati, setMetadatiSelezionati] =
    useState<ConversazioneTarsView | null>(null);
  const versioneSelezioneRef = useRef(0);
  const sequenzaNuovaRef = useRef(0);
  const [chiaveNuova, setChiaveNuova] = useState("nuova:0");
  const [ricerca, setRicerca] = useState("");
  const [ricercaServer, setRicercaServer] = useState("");
  const [listaMobileAperta, setListaMobileAperta] = useState(false);
  const [contestoMobileAperto, setContestoMobileAperto] = useState(false);
  const [bozze, setBozze] = useState<Record<string, string>>({});
  const [erroreInvio, setErroreInvio] = useState<ErroreInvio | null>(null);
  const [erroreGestione, setErroreGestione] = useState<string | null>(null);
  const [ottimistico, setOttimistico] = useState<TurnoTarsOttimistico | null>(
    null
  );
  const [undoCompletati, setUndoCompletati] = useState<ChiaveUndoTars[]>([]);
  const [applicate, setApplicate] = useState<number[]>([]);
  const [ultimoRunRidottoId, setUltimoRunRidottoId] = useState<number | null>(
    null
  );
  const [conversazioneDaRinominare, setConversazioneDaRinominare] =
    useState<ConversazioneTarsView | null>(null);
  const [titoloRinomina, setTitoloRinomina] = useState("");
  const [erroreRinomina, setErroreRinomina] = useState<string | null>(null);
  const inVoloRef = useRef<InvioInVolo | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setRicercaServer(ricerca.trim()),
      250
    );
    return () => window.clearTimeout(timer);
  }, [ricerca]);

  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    retry: false,
    staleTime: 300_000,
  });
  const tarsAcceso = interruttori.data?.tars === true;
  const inputStato = conversazioneId == null ? undefined : { conversazioneId };
  const stato = trpc.tars.stato.useQuery(inputStato, {
    enabled: tarsAcceso,
    retry: false,
    placeholderData: precedente => precedente,
  });
  const precondizioneFallita =
    codiceErrore(stato.error) === "PRECONDITION_FAILED";
  const queryOperativeAbilitate = tarsAcceso && !precondizioneFallita;
  const conversazioniAttive = trpc.tars.conversazioni.useQuery(
    {
      archiviate: false,
      ricerca: ricercaServer || undefined,
      limite: 100,
    },
    {
      enabled: queryOperativeAbilitate,
      retry: false,
      placeholderData: precedente => precedente,
    }
  );
  const conversazioniArchiviate = trpc.tars.conversazioni.useQuery(
    {
      archiviate: true,
      ricerca: ricercaServer || undefined,
      limite: 100,
    },
    {
      enabled: queryOperativeAbilitate,
      retry: false,
      placeholderData: precedente => precedente,
    }
  );
  const turni = trpc.tars.turni.useQuery(
    { conversazioneId: conversazioneId ?? 0 },
    {
      enabled: queryOperativeAbilitate && conversazioneId != null,
      retry: false,
    }
  );
  const briefing = trpc.tars.briefing.useQuery(undefined, {
    enabled: queryOperativeAbilitate,
    retry: false,
    staleTime: 60_000,
  });

  const rinomina = trpc.tars.rinominaConversazione.useMutation({
    onSuccess: risposta => {
      setConversazioneDaRinominare(null);
      setMetadatiSelezionati(correnti =>
        correnti?.id === risposta.id ? risposta : correnti
      );
      setErroreRinomina(null);
      setErroreGestione(null);
      void utils.tars.conversazioni.invalidate();
      toast.success("Conversazione rinominata.");
    },
    onError: errore => {
      setErroreRinomina(errore.message || "Rinomina non riuscita.");
    },
  });

  const fissa = trpc.tars.fissaConversazione.useMutation({
    onSuccess: risposta => {
      setMetadatiSelezionati(correnti =>
        correnti?.id === risposta.id ? risposta : correnti
      );
      setErroreGestione(null);
      void utils.tars.conversazioni.invalidate();
    },
    onError: errore => {
      setErroreGestione(errore.message || "Aggiornamento non riuscito.");
    },
  });

  const archivia = trpc.tars.archiviaConversazione.useMutation({
    onSuccess: (_risposta, variabili) => {
      setErroreGestione(null);
      const corrente = conversazioneIdRef.current;
      const prossima = selezioneDopoCambioArchivio({
        selezioneCorrente: corrente,
        conversazioneId: variabili.conversazioneId,
        archiviata: variabili.archiviata,
      });
      if (prossima !== corrente) {
        versioneSelezioneRef.current += 1;
        conversazioneIdRef.current = prossima;
        setConversazioneId(prossima);
        setMetadatiSelezionati(null);
        preparaNuovaSessione();
        setErroreInvio(null);
        setListaMobileAperta(false);
      } else if (corrente === variabili.conversazioneId) {
        setMetadatiSelezionati(selezionati =>
          selezionati
            ? {
                ...selezionati,
                fissata: variabili.archiviata ? false : selezionati.fissata,
                archiviataAt: variabili.archiviata ? new Date() : null,
              }
            : selezionati
        );
      }
      void utils.tars.conversazioni.invalidate();
      toast.success(
        variabili.archiviata
          ? "Conversazione archiviata."
          : "Conversazione ripristinata."
      );
    },
    onError: errore => {
      setErroreGestione(errore.message || "Aggiornamento non riuscito.");
    },
  });

  const annullaPromemoria = trpc.promemoria.cancel.useMutation({
    onSuccess: (_risposta, variabili) => {
      const chiave = chiaveUndoTars({
        procedura: "promemoria.cancel",
        id: variabili.id,
      });
      setUndoCompletati(correnti =>
        correnti.includes(chiave) ? correnti : [...correnti, chiave]
      );
      void utils.promemoria.due.invalidate();
      void utils.tars.briefing.invalidate();
      toast.success("Promemoria annullato.");
    },
    onError: errore =>
      toast.error(errore.message || "Annullamento non riuscito."),
  });

  const annullaTransizione = trpc.commesse.undoTransizione.useMutation({
    onSuccess: (_risposta, variabili) => {
      const chiave = chiaveUndoTars({
        procedura: "commesse.undoTransizione",
        id: variabili.transizioneId,
      });
      setUndoCompletati(correnti =>
        correnti.includes(chiave) ? correnti : [...correnti, chiave]
      );
      void utils.commesse.invalidate();
      void utils.tars.fascicolo.invalidate();
      toast.success("Transizione annullata.");
    },
    onError: errore =>
      toast.error(errore.message || "Annullamento non riuscito."),
  });

  const approva = trpc.proposte.approvaEApplica.useMutation({
    onSuccess: (esito, variabili) => {
      setApplicate(correnti =>
        correnti.includes(variabili.id) ? correnti : [...correnti, variabili.id]
      );
      void utils.fornitori.ordini.invalidate();
      void utils.proposte.invalidate();
      void utils.tars.fascicolo.invalidate();
      if (esito.riusata) {
        toast.info("La proposta era già applicata: nessun doppio effetto.");
      } else {
        toast.success("Proposta approvata e applicata.");
      }
      if (esito.avvisoPosa) toast.warning(esito.avvisoPosa);
    },
    onError: errore =>
      toast.error(errore.message || "Applicazione non riuscita."),
  });

  const invia = trpc.tars.invia.useMutation({
    onSuccess: risposta => {
      const inVolo = inVoloRef.current;
      if (!inVolo) return;
      const selezioneInvariata =
        inVolo.versioneSelezione === versioneSelezioneRef.current;
      setOttimistico(corrente =>
        corrente?.chiaveLocale === inVolo.chiaveLocale
          ? associaTurnoOttimisticoAConversazione(
              corrente,
              risposta.conversazioneId
            )
          : corrente
      );
      const corrente = conversazioneIdRef.current;
      const prossima = selezioneInvariata
        ? selezioneDopoRispostaInvio({
            selezioneCorrente: corrente,
            conversazioneInvioId: inVolo.conversazioneId,
            conversazioneRispostaId: risposta.conversazioneId,
          })
        : corrente;
      if (prossima !== corrente) {
        const nuovaChiave = chiaveBozza(prossima, chiaveNuova);
        setBozze(correnti => {
          const bozzaDuranteInvio = correnti[inVolo.chiaveBozza] ?? "";
          if (!bozzaDuranteInvio) return correnti;
          return {
            ...correnti,
            [inVolo.chiaveBozza]: "",
            [nuovaChiave]: bozzaDuranteInvio,
          };
        });
        conversazioneIdRef.current = prossima;
        setConversazioneId(prossima);
        setMetadatiSelezionati(null);
      }
      setUltimoRunRidottoId(
        risposta.stato === "degradato" ? risposta.conversazioneId : null
      );
      setErroreInvio(correnteErrore =>
        correnteErrore?.chiaveBozza === inVolo.chiaveBozza
          ? null
          : correnteErrore
      );
      void utils.tars.turni.invalidate({
        conversazioneId: risposta.conversazioneId,
      });
      void utils.tars.conversazioni.invalidate();
      void utils.tars.briefing.invalidate();
      void utils.tars.stato.invalidate({
        conversazioneId: risposta.conversazioneId,
      });
      if (risposta.stato === "degradato") toast.warning(risposta.testo);
      inVoloRef.current = null;
    },
    onError: errore => {
      const inVolo = inVoloRef.current;
      if (!inVolo) return;
      setOttimistico(corrente =>
        corrente?.chiaveLocale === inVolo.chiaveLocale ? null : corrente
      );
      setBozze(correnti =>
        (correnti[inVolo.chiaveBozza] ?? "").length === 0
          ? { ...correnti, [inVolo.chiaveBozza]: inVolo.testo }
          : correnti
      );
      const messaggio = errore.message || "Invio non riuscito. Riprova.";
      setErroreInvio({ chiaveBozza: inVolo.chiaveBozza, messaggio });
      toast.error(messaggio);
      inVoloRef.current = null;
    },
  });

  const conversazioni = useMemo(
    () =>
      unisciConversazioniSenzaDuplicati(
        conversazioniAttive.data ?? [],
        conversazioniArchiviate.data ?? []
      ),
    [conversazioniAttive.data, conversazioniArchiviate.data]
  );
  const conversazioneDallaLista =
    conversazioni.find(conversazione => conversazione.id === conversazioneId) ??
    null;
  const conversazioneAttiva =
    metadatiSelezionati?.id === conversazioneId
      ? { ...conversazioneDallaLista, ...metadatiSelezionati }
      : conversazioneDallaLista;
  const conversazioneArchiviata = conversazioneAttiva?.archiviataAt != null;
  const turniServer = (turni.data ?? []) as TurnoTarsView[];
  const bozzaAttivaId = chiaveBozza(conversazioneId, chiaveNuova);
  const invioVisibile =
    invia.isPending && inVoloRef.current?.chiaveBozza === bozzaAttivaId;
  const ottimisticoVisibile =
    ottimistico != null &&
    (ottimistico.conversazioneId != null
      ? ottimistico.conversazioneId === conversazioneId
      : inVoloRef.current?.chiaveBozza === bozzaAttivaId)
      ? ottimistico
      : null;
  const turniVisualizzati = unisciTurniConOttimistico(
    turniServer,
    ottimisticoVisibile
  );
  const ultimoTurnoTars = [...turniServer]
    .reverse()
    .find(turno => turno.ruolo === "tars");
  const statoAvatar: StatoTarsAvatar = invioVisibile
    ? "in_lavoro"
    : ultimoRunRidottoId === conversazioneId ||
        (ultimoTurnoTars != null &&
          turnoIndicaOperativitaRidotta(ultimoTurnoTars))
      ? "degradato"
      : "disponibile";
  const contestoDato = stato.data?.contestoAttivo;
  const contesto: ContestoOperativoTars | null = contestoDato
    ? {
        superficie: contestoDato.superficie,
        entita: {
          tipo: contestoDato.entita.tipo,
          id: contestoDato.entita.id,
        },
      }
    : null;
  const messaggio = bozze[bozzaAttivaId] ?? "";
  const erroreInvioVisibile =
    erroreInvio?.chiaveBozza === bozzaAttivaId ? erroreInvio.messaggio : null;
  const erroreLista =
    conversazioniAttive.error?.message ??
    conversazioniArchiviate.error?.message ??
    null;
  const conversazioneInCorsoId =
    (invia.isPending ? inVoloRef.current?.conversazioneId : null) ??
    (fissa.isPending ? fissa.variables?.conversazioneId : null) ??
    (archivia.isPending ? archivia.variables?.conversazioneId : null) ??
    (rinomina.isPending ? rinomina.variables?.conversazioneId : null) ??
    null;

  function preparaNuovaSessione(): string {
    sequenzaNuovaRef.current += 1;
    const nuovaChiave = `nuova:${sequenzaNuovaRef.current}`;
    setChiaveNuova(nuovaChiave);
    return nuovaChiave;
  }

  function cambiaSelezione(
    id: number | null,
    metadati: ConversazioneTarsView | null = null
  ) {
    versioneSelezioneRef.current += 1;
    conversazioneIdRef.current = id;
    setConversazioneId(id);
    setMetadatiSelezionati(metadati);
    setErroreInvio(null);
    setListaMobileAperta(false);
  }

  function nuovaConversazione() {
    const nuovaChiave = preparaNuovaSessione();
    cambiaSelezione(null);
    setBozze(correnti => ({ ...correnti, [nuovaChiave]: "" }));
    setErroreGestione(null);
  }

  function aggiornaBozza(value: string) {
    setBozze(correnti => ({ ...correnti, [bozzaAttivaId]: value }));
    setErroreInvio(corrente =>
      corrente?.chiaveBozza === bozzaAttivaId ? null : corrente
    );
  }

  function inviaOra() {
    const testo = messaggio.trim();
    if (!testo || invia.isPending || conversazioneArchiviata) return;
    const chiaveLocale = globalThis.crypto.randomUUID();
    const dopoTurnoId = turniServer.reduce(
      (massimo, turno) => Math.max(massimo, turno.id),
      0
    );
    const inVolo: InvioInVolo = {
      chiaveBozza: bozzaAttivaId,
      chiaveLocale,
      conversazioneId,
      testo,
      versioneSelezione: versioneSelezioneRef.current,
    };
    inVoloRef.current = inVolo;
    setErroreInvio(null);
    setBozze(correnti => ({ ...correnti, [bozzaAttivaId]: "" }));
    setOttimistico(
      creaTurnoOttimistico({
        chiaveLocale,
        conversazioneId,
        contenuto: testo,
        dopoTurnoId,
      })
    );
    invia.mutate({
      messaggio: testo,
      conversazioneId: conversazioneId ?? undefined,
    });
  }

  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    inviaOra();
  }

  function apriRinomina(conversazione: ConversazioneTarsView) {
    setConversazioneDaRinominare(conversazione);
    setTitoloRinomina(conversazione.titolo);
    setErroreRinomina(null);
  }

  function submitRinomina(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversazioneDaRinominare || rinomina.isPending) return;
    const titolo = titoloRinomina.trim();
    if (titolo.length < 1 || titolo.length > 80) {
      setErroreRinomina("Inserisci un titolo da 1 a 80 caratteri.");
      return;
    }
    rinomina.mutate({
      conversazioneId: conversazioneDaRinominare.id,
      titolo,
    });
  }

  function eseguiUndo(richiesta: RichiestaUndoTars) {
    if (richiesta.procedura === "promemoria.cancel") {
      annullaPromemoria.mutate({ id: richiesta.id });
      return;
    }
    annullaTransizione.mutate({ transizioneId: richiesta.id });
  }

  function eseguiApprovazione(richiesta: RichiestaApprovazioneTars) {
    approva.mutate({ id: richiesta.propostaId });
  }

  const listaProps: TarsConversationListProps = {
    conversazioni,
    conversazioneAttivaId: conversazioneId,
    ricerca,
    loading: conversazioniAttive.isLoading || conversazioniArchiviate.isLoading,
    error: erroreLista,
    conversazioneInCorsoId,
    onRicercaChange: setRicerca,
    onNuovaConversazione: nuovaConversazione,
    onApriConversazione: conversazione =>
      cambiaSelezione(conversazione.id, conversazione),
    onRinomina: apriRinomina,
    onFissa: (conversazione, fissata) => {
      setErroreGestione(null);
      fissa.mutate({ conversazioneId: conversazione.id, fissata });
    },
    onArchivia: conversazione => {
      setErroreGestione(null);
      archivia.mutate({
        conversazioneId: conversazione.id,
        archiviata: true,
      });
    },
    onRipristina: conversazione => {
      setErroreGestione(null);
      archivia.mutate({
        conversazioneId: conversazione.id,
        archiviata: false,
      });
    },
    onRetry: () => {
      void conversazioniAttive.refetch();
      void conversazioniArchiviate.refetch();
    },
  };

  if (interruttori.isLoading) return <CaricamentoPagina />;
  if (interruttori.error) {
    return (
      <StatoPagina
        stato="degradato"
        titolo="Tars non è raggiungibile"
        descrizione="Il CRM continua a funzionare normalmente. Riprova tra poco."
        azione={
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => void interruttori.refetch()}
          >
            <RefreshCw aria-hidden="true" />
            Riprova
          </Button>
        }
      />
    );
  }
  if (!tarsAcceso || precondizioneFallita) {
    return (
      <StatoPagina
        stato="spento"
        titolo="Tars è disattivato"
        descrizione="Il CRM continua a funzionare normalmente senza la superficie Tars."
      />
    );
  }
  if (stato.isLoading && !stato.data) return <CaricamentoPagina />;
  if (stato.error) {
    return (
      <StatoPagina
        stato="degradato"
        titolo="Tars non risponde"
        descrizione="Il CRM continua a funzionare normalmente. Riprova tra poco."
        azione={
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => void stato.refetch()}
          >
            <RefreshCw aria-hidden="true" />
            Riprova
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="flex h-[calc(100dvh-8rem)] min-h-[34rem] min-w-0 overflow-hidden rounded-md border border-border-soft bg-card">
        <aside className="hidden h-full w-72 shrink-0 border-r border-border-soft md:block xl:w-80">
          <ListaWorkbench erroreAzione={erroreGestione} {...listaProps} />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 [&>section>header>button:first-child]:md:hidden">
            <TarsThread
              titolo={conversazioneAttiva?.titolo ?? "Nuova conversazione"}
              turni={turniVisualizzati}
              statoAvatar={statoAvatar}
              archiviata={conversazioneArchiviata}
              loading={conversazioneId != null && turni.isLoading}
              error={
                conversazioneId != null ? (turni.error?.message ?? null) : null
              }
              inLavoro={invioVisibile}
              mobile
              emptyState={
                <EmptyStateWorkbench
                  briefing={briefing.data ?? null}
                  briefingLoading={briefing.isLoading}
                  contesto={stato.isFetching ? null : contesto}
                  onSuggerimento={testo => {
                    aggiornaBozza(testo);
                    window.requestAnimationFrame(() =>
                      composerRef.current?.focus()
                    );
                  }}
                />
              }
              undoCompletati={undoCompletati}
              applicate={applicate}
              undoInCorso={
                annullaPromemoria.isPending || annullaTransizione.isPending
              }
              approvazioneInCorso={approva.isPending}
              onBack={() => setListaMobileAperta(true)}
              onOpenContext={() => setContestoMobileAperto(true)}
              onRetry={() => void turni.refetch()}
              onUndo={eseguiUndo}
              onApprova={eseguiApprovazione}
            />
          </div>

          {conversazioneArchiviata ? (
            <div className="sticky bottom-0 z-10 flex shrink-0 flex-col gap-3 border-t border-border-soft bg-surface-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-text-2">
                Questa conversazione è archiviata e resta in sola lettura.
              </p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0"
                disabled={archivia.isPending || conversazioneAttiva == null}
                onClick={() => {
                  if (conversazioneAttiva) {
                    archivia.mutate({
                      conversazioneId: conversazioneAttiva.id,
                      archiviata: false,
                    });
                  }
                }}
              >
                <ArchiveRestore aria-hidden="true" />
                Ripristina per continuare
              </Button>
            </div>
          ) : (
            <form
              onSubmit={submitComposer}
              className="sticky bottom-0 z-10 shrink-0 border-t border-border-soft bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4"
            >
              {erroreInvioVisibile && (
                <p
                  id="tars-invio-errore"
                  role="alert"
                  className="mb-2 flex items-start gap-2 text-xs text-danger"
                >
                  <AlertCircle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  {erroreInvioVisibile}
                </p>
              )}
              <div className="flex min-w-0 items-end gap-2">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Messaggio per Tars</span>
                  <Textarea
                    ref={composerRef}
                    value={messaggio}
                    maxLength={4000}
                    aria-describedby={
                      erroreInvioVisibile ? "tars-invio-errore" : undefined
                    }
                    aria-invalid={erroreInvioVisibile ? true : undefined}
                    onChange={event => aggiornaBozza(event.target.value)}
                    onKeyDown={event => {
                      if (
                        deveInviareDaTastiera({
                          key: event.key,
                          shiftKey: event.shiftKey,
                          isComposing: event.nativeEvent.isComposing,
                        })
                      ) {
                        event.preventDefault();
                        inviaOra();
                      }
                    }}
                    placeholder="Scrivi a Tars…"
                    className="max-h-40 min-h-11 resize-none text-sm"
                  />
                </label>
                <Button
                  type="submit"
                  size="icon"
                  className="size-11 shrink-0"
                  disabled={!messaggio.trim() || invia.isPending}
                  aria-label="Invia messaggio"
                  title="Invia"
                >
                  <Send aria-hidden="true" />
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-text-3">
                Invio per inviare · Maiusc+Invio per andare a capo
              </p>
            </form>
          )}
        </div>

        <aside className="hidden h-full w-80 shrink-0 border-l border-border-soft xl:block 2xl:w-[21rem]">
          <TarsContextPanel
            contesto={contesto}
            briefing={briefing.data ?? null}
            loading={stato.isFetching || briefing.isLoading}
            error={briefing.error?.message ?? null}
            onApriLink={navigate}
            onRetry={() => {
              void stato.refetch();
              void briefing.refetch();
            }}
          />
        </aside>
      </div>

      <Sheet open={listaMobileAperta} onOpenChange={setListaMobileAperta}>
        <SheetContent
          side="left"
          className="w-full max-w-none gap-0 p-0 motion-reduce:duration-0 sm:max-w-sm md:hidden [&>[data-slot=sheet-close]:last-child]:hidden"
        >
          <SheetHeader className="shrink-0 flex-row items-center justify-between border-b border-border-soft pr-3">
            <SheetTitle className="text-sm">Conversazioni</SheetTitle>
            <SheetDescription className="sr-only">
              Cerca, apri e gestisci le conversazioni.
            </SheetDescription>
            <SheetClose asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-11 shrink-0"
                aria-label="Chiudi conversazioni"
                title="Chiudi"
              >
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <ListaWorkbench erroreAzione={erroreGestione} {...listaProps} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={contestoMobileAperto} onOpenChange={setContestoMobileAperto}>
        <SheetContent
          side="right"
          className="w-full max-w-none gap-0 p-0 motion-reduce:duration-0 sm:max-w-md xl:hidden [&>[data-slot=sheet-close]:last-child]:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Contesto operativo</SheetTitle>
            <SheetDescription>
              Entità attiva e briefing della conversazione.
            </SheetDescription>
          </SheetHeader>
          <div className="absolute right-2 top-2 z-20">
            <SheetClose asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-11 bg-card"
                aria-label="Chiudi contesto operativo"
                title="Chiudi"
              >
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
          </div>
          <TarsContextPanel
            contesto={contesto}
            briefing={briefing.data ?? null}
            loading={stato.isFetching || briefing.isLoading}
            error={briefing.error?.message ?? null}
            onApriLink={link => {
              setContestoMobileAperto(false);
              navigate(link);
            }}
            onRetry={() => {
              void stato.refetch();
              void briefing.refetch();
            }}
          />
        </SheetContent>
      </Sheet>

      <Dialog
        open={conversazioneDaRinominare != null}
        onOpenChange={aperta => {
          if (!aperta && !rinomina.isPending) {
            setConversazioneDaRinominare(null);
            setErroreRinomina(null);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <form onSubmit={submitRinomina}>
            <DialogHeader className="pr-8">
              <DialogTitle>Rinomina conversazione</DialogTitle>
              <DialogDescription>
                Usa un titolo breve e riconoscibile nell’elenco operativo.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-2">
              <label
                htmlFor="titolo-conversazione"
                className="text-sm font-semibold"
              >
                Titolo
              </label>
              <Input
                id="titolo-conversazione"
                autoFocus
                value={titoloRinomina}
                maxLength={80}
                disabled={rinomina.isPending}
                aria-invalid={erroreRinomina ? true : undefined}
                aria-describedby="titolo-conversazione-aiuto titolo-conversazione-errore"
                onChange={event => {
                  setTitoloRinomina(event.target.value);
                  setErroreRinomina(null);
                }}
              />
              <p
                id="titolo-conversazione-aiuto"
                className="text-xs text-text-3"
              >
                Da 1 a 80 caratteri.
              </p>
              <p
                id="titolo-conversazione-errore"
                role="alert"
                className="min-h-5 text-xs text-danger"
              >
                {erroreRinomina}
              </p>
            </div>
            <DialogFooter className="mt-5">
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={rinomina.isPending}
                >
                  Annulla
                </Button>
              </DialogClose>
              <Button
                type="submit"
                className="min-h-11"
                disabled={rinomina.isPending || !titoloRinomina.trim()}
              >
                {rinomina.isPending ? "Salvataggio…" : "Salva titolo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
