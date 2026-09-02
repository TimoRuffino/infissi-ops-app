// Vista «Proposte» della pagina Tars (02/09/2026, sera, seconda stesura
// su richiesta della direzione): una coda di decisioni, a tutta larghezza.
// Una riga per proposta: cosa è, dove Tars vuole portarla, quanto è
// sicuro, e un bottone grande. Il perché e gli effetti si aprono a
// richiesta. Il server è il confine: qui si decide, mai si applica da soli.
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  Brain,
  Check,
  ChevronDown,
  ClipboardCheck,
  ExternalLink,
  Inbox,
  Link2,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { useAnalisiAzienda } from "./TarsAnalisiAzienda";
import { useDecisioneSmistamento } from "./TarsSmistamento";

// Tipi dalle procedure tRPC (non dal hook: la fixture demo li usa prima).
type RouterOutputs = inferRouterOutputs<AppRouter>;
type VoceSmistamento = RouterOutputs["tars"]["smistamentoProposte"][number];
type VoceGateway = RouterOutputs["tars"]["proposte"][number];
type VoceAnalisi = ReturnType<typeof useAnalisiAzienda>["proposte"][number];

export function useProposteTars(abilitato: boolean) {
  const smistamento = trpc.tars.smistamentoProposte.useQuery(undefined, {
    enabled: abilitato,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const gateway = trpc.tars.proposte.useQuery(undefined, {
    enabled: abilitato,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const analisi = useAnalisiAzienda(abilitato);
  const demo = fixtureDemo();
  return {
    smistamento: demo?.smistamento ?? smistamento.data ?? [],
    gateway: demo?.gateway ?? gateway.data ?? [],
    analisi: demo?.analisi ?? analisi.proposte,
    totale: demo
      ? demo.smistamento.length + demo.gateway.length + demo.analisi.length
      : (smistamento.data?.length ?? 0) +
        (gateway.data?.length ?? 0) +
        analisi.proposte.length,
    loading: !demo && (smistamento.isLoading || gateway.isLoading),
    // Lo smistamento può essere spento (flag) senza che il resto sparisca.
    erroreSmistamento: smistamento.error?.message ?? null,
    errore: gateway.error?.message ?? null,
    ricarica: () => {
      void smistamento.refetch();
      void gateway.refetch();
    },
  };
}

export type ProposteTars = ReturnType<typeof useProposteTars>;

/**
 * Solo in sviluppo e solo con `?demoProposte`: dati finti per guardare la
 * coda con qualcosa dentro (in locale non c'è PostgreSQL né modello).
 * In produzione il ramo è eliminato dal bundle.
 */
function fixtureDemo(): {
  smistamento: VoceSmistamento[];
  gateway: VoceGateway[];
  analisi: VoceAnalisi[];
} | null {
  if (!import.meta.env.DEV) return null;
  if (typeof window === "undefined") return null;
  if (!new URLSearchParams(window.location.search).has("demoProposte")) return null;
  const adesso = new Date().toISOString();
  return {
    smistamento: [
      {
        comunicazioneId: 1,
        canale: "email",
        mittente: "riparazioni@primed.it",
        oggetto: "PRIMED ticket # 2678C25B58 # RITIRO RIPARAZIONI",
        ricevutaIl: adesso,
        riepilogo: "Primed conferma il ritiro delle riparazioni per l'articolo Giada.",
        urgenza: "normale",
        categoria: "fornitore",
        collegamento: { esito: "proposto", commessaId: 333, clienteId: 51, confidenza: "media", motivo: "Il riferimento all'articolo Giada è coerente con l'unica commessa candidata intestata a Galastri Giada, ma il mittente è un fornitore." },
        candidati: [{ tipo: "commessa", id: 333, etichetta: "COM-2026-333 — Galastri Giada", punteggio: 40, motivi: [] }],
        allegatiDaArchiviare: ["DDT_ritiro_2678.pdf"],
        link: "/messaggi/email?messaggio=1",
      },
      {
        comunicazioneId: 2,
        canale: "email",
        mittente: "angela.cataldi@example.it",
        oggetto: "Re: Precontratti FIRMATI",
        ricevutaIl: adesso,
        riepilogo: "La cliente rimanda i precontratti firmati.",
        urgenza: "alta",
        categoria: "operativa",
        collegamento: { esito: "proposto", commessaId: 398, clienteId: 77, confidenza: "alta", motivo: "Mittente e nominativo sui preventivi corrispondono, ma la cliente ha due commesse attive." },
        candidati: [{ tipo: "commessa", id: 398, etichetta: "COM-2026-398 — Cataldi Angela", punteggio: 60, motivi: [] }],
        allegatiDaArchiviare: ["precontratto_1.pdf", "precontratto_2.pdf"],
        link: "/messaggi/email?messaggio=2",
      },
    ] as unknown as VoceSmistamento[],
    gateway: [
      {
        id: 9,
        tipo: "ordine_data_consegna",
        etichetta: "Aggiorna la data di consegna dell'ordine",
        effetto: "Consegna prevista dell'ordine 41 da 12/09 a 19/09.",
        motivazione: "La conferma d'ordine Oknoplast riporta il 19/09.",
        valoreCorrente: "12/09/2026",
        valoreProposto: "19/09/2026",
        documentoNome: "Conferma_ordine_41.pdf",
        ordineId: 41,
        commessaId: 182,
        stato: "proposta",
        hashAnteprima: "x".repeat(64),
        creataIl: adesso,
        scadeIl: adesso,
        link: "/commesse/182",
      },
    ] as unknown as VoceGateway[],
    analisi: [
      {
        testo: "Sbloccare le tre commesse ferme definendo una priorità operativa.",
        richiestaPerTars: "Aggiorna come prioritarie le verifiche del prossimo passo per le commesse 182, 183 e 193",
        entita: ["commessa:182"],
        link: "/commesse/182",
      },
      {
        testo: "Aprire il ticket post-vendita per il reclamo WnD fermo da 183 giorni.",
        richiestaPerTars: "Crea un ticket urgente per la commessa 190: reclamo WnD, appuntamento da fissare",
        entita: ["comunicazione:16295"],
        link: "/messaggi/email?messaggio=16295",
      },
    ] as VoceAnalisi[],
  };
}

function dataBreve(valore: string | Date): string {
  const d = new Date(valore);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ETICHETTA_CONFIDENZA: Record<string, string> = {
  alta: "sicuro",
  media: "probabile",
  bassa: "incerto",
};

function classeConfidenza(confidenza: string): string {
  if (confidenza === "alta") return "bg-success-soft text-success";
  if (confidenza === "media") return "bg-warning-soft text-warning";
  return "bg-surface-2 text-text-2";
}

type Filtro = "tutte" | "comunicazioni" | "analisi" | "documenti";

/**
 * Una riga della coda. Sopra: titolo e meta. Sotto: la destinazione in
 * evidenza. A destra: i bottoni. Il resto (perché, effetti) si apre.
 */
function RigaProposta({
  icona,
  tipo,
  titolo,
  meta,
  destinazione,
  chip,
  dettagli,
  azioni,
  onApri,
}: {
  icona: ReactNode;
  tipo: string;
  titolo: string;
  meta?: string | null;
  destinazione: ReactNode;
  chip?: ReactNode;
  dettagli: ReactNode;
  azioni: ReactNode;
  onApri?: () => void;
}) {
  const [aperta, setAperta] = useState(false);
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-2"
          aria-hidden="true"
        >
          {icona}
        </span>
        <div className="min-w-0">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] text-text-3">
            <span className="font-semibold uppercase tracking-wide">{tipo}</span>
            {meta && <span className="min-w-0 truncate">{meta}</span>}
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-5 text-text-1 break-words [overflow-wrap:anywhere]">
            {titolo}
          </p>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-5 text-text-1 break-words [overflow-wrap:anywhere]">
            {destinazione}
            {chip}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
              aria-expanded={aperta}
              onClick={() => setAperta(a => !a)}
            >
              <ChevronDown
                className={cn("size-4 transition-transform motion-reduce:transition-none", aperta && "rotate-180")}
                aria-hidden="true"
              />
              {aperta ? "Nascondi dettagli" : "Perché e cosa succede"}
            </button>
            {onApri && (
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-1 text-text-2 hover:text-text-1"
                onClick={onApri}
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Apri
              </button>
            )}
          </div>
          {aperta && (
            <div className="mt-2 space-y-1.5 rounded-md border border-border-soft bg-surface-2 px-3 py-2.5 text-xs leading-5 text-text-2">
              {dettagli}
            </div>
          )}
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:flex-nowrap md:self-start md:pl-2">
          {azioni}
        </div>
      </div>
    </li>
  );
}

function Dettaglio({ etichetta, children }: { etichetta: string; children: ReactNode }) {
  return (
    <p className="break-words [overflow-wrap:anywhere]">
      <span className="font-semibold text-text-1">{etichetta}: </span>
      {children}
    </p>
  );
}

function BottoniDecisione({
  inCorso,
  etichettaSi,
  onSi,
  onNo,
}: {
  inCorso: boolean;
  etichettaSi: string;
  onSi: () => void;
  onNo: () => void;
}) {
  return (
    <>
      <Button
        type="button"
        className="min-h-10 flex-1 md:flex-none"
        disabled={inCorso}
        onClick={onSi}
      >
        {inCorso ? (
          <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        {etichettaSi}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-10"
        disabled={inCorso}
        aria-label="Rifiuta la proposta"
        title="Rifiuta"
        onClick={onNo}
      >
        <X aria-hidden="true" />
        <span className="md:sr-only">Rifiuta</span>
      </Button>
    </>
  );
}

function Sezione({
  titolo,
  suggerimento,
  conteggio,
  children,
}: {
  titolo: string;
  suggerimento: string;
  conteggio: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={titolo}>
      <div className="flex items-baseline gap-2 px-4 pb-1.5 pt-4 sm:px-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-2">
          {titolo}
        </h3>
        <span className="text-xs font-semibold text-text-3">{conteggio}</span>
        <span className="hidden min-w-0 truncate text-xs text-text-3 sm:inline">
          · {suggerimento}
        </span>
      </div>
      <ul className="divide-y divide-border-soft border-y border-border-soft bg-card">
        {children}
      </ul>
    </section>
  );
}

export function TarsProposteBoard({
  dati,
  onApriLink,
  onSuggerimento,
  onVaiAlRegistro,
}: {
  dati: ProposteTars;
  onApriLink: (link: string) => void;
  /** Precompila la chat con la richiesta di una proposta dell'analisi. */
  onSuggerimento: (testo: string) => void;
  onVaiAlRegistro: () => void;
}) {
  const utils = trpc.useUtils();
  const [filtro, setFiltro] = useState<Filtro>("tutte");
  const [smistamentoInCorso, setSmistamentoInCorso] = useState<number | null>(null);
  const [gatewayInCorso, setGatewayInCorso] = useState<number | null>(null);
  // Le proposte già decise, tolte dalla coda senza aspettare il server.
  //
  // Prima la riga restava lì con la rotella finché non tornava la mutation E
  // non finiva il ricaricamento della coda: due giri di rete più il carico
  // della lista, cioè i secondi che si vedevano prima che sparisse. La
  // decisione però è già presa nel momento del clic — il server la conferma,
  // non la stabilisce — quindi la riga esce subito. Se l'applicazione
  // fallisce la riga torna: `onError` svuota l'elenco locale e ricarica,
  // così niente sparisce senza essere stato applicato davvero.
  const [decise, setDecise] = useState<number[]>([]);
  const nascondi = (id: number) =>
    setDecise(correnti => (correnti.includes(id) ? correnti : [...correnti, id]));
  const riesponi = () => setDecise([]);
  const decidiSmistamento = useDecisioneSmistamento(() => {
    setSmistamentoInCorso(null);
    dati.ricarica();
  });
  const approva = trpc.proposte.approvaEApplica.useMutation({
    onSuccess: esito => {
      setGatewayInCorso(null);
      dati.ricarica();
      void utils.fornitori.ordini.invalidate();
      void utils.proposte.invalidate();
      toast.success(
        esito.riusata
          ? "La proposta era già applicata: nessun doppio effetto."
          : "Proposta approvata e applicata."
      );
      if (esito.avvisoPosa) toast.warning(esito.avvisoPosa);
    },
    onError: errore => {
      setGatewayInCorso(null);
      riesponi();
      dati.ricarica();
      toast.error(errore.message || "Applicazione non riuscita.");
    },
  });
  const rifiuta = trpc.proposte.rifiuta.useMutation({
    onSuccess: () => {
      setGatewayInCorso(null);
      dati.ricarica();
      void utils.proposte.invalidate();
      toast.success("Proposta rifiutata");
    },
    onError: errore => {
      setGatewayInCorso(null);
      riesponi();
      dati.ricarica();
      toast.error(errore.message || "Rifiuto non riuscito.");
    },
  });

  const gatewayVisibili = dati.gateway.filter(p => !decise.includes(p.id));
  // I contatori dei filtri contano quello che si vede, non quello che il
  // server non sa ancora di aver perso.
  const nascoste = dati.gateway.length - gatewayVisibili.length;
  const totaleVisibile = dati.totale - nascoste;

  const tuttiIFiltri: Array<{ id: Filtro; etichetta: string; n: number }> = [
    { id: "tutte", etichetta: "Tutte", n: dati.totale - nascoste },
    { id: "comunicazioni", etichetta: "Comunicazioni", n: dati.smistamento.length },
    { id: "analisi", etichetta: "Analisi di oggi", n: dati.analisi.length },
    { id: "documenti", etichetta: "Documenti", n: gatewayVisibili.length },
  ];
  const filtri = tuttiIFiltri.filter(f => f.id === "tutte" || f.n > 0);
  const mostra = (id: Exclude<Filtro, "tutte">) => filtro === "tutte" || filtro === id;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-border-soft bg-card px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-text-1">
              {totaleVisibile === 0
                ? "Nessuna proposta da decidere"
                : totaleVisibile === 1
                  ? "1 proposta da decidere"
                  : `${totaleVisibile} proposte da decidere`}
            </h2>
            <p className="text-xs leading-5 text-text-3">
              Tars fa da solo quando è sicuro e lo scrive nel Registro. Qui
              solo ciò che aspetta te.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-10 shrink-0"
            aria-label="Aggiorna le proposte"
            title="Aggiorna"
            onClick={dati.ricarica}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
        {dati.totale > 0 && filtri.length > 2 && (
          <div role="tablist" aria-label="Filtra le proposte" className="mt-3 flex flex-wrap gap-1.5">
            {filtri.map(f => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filtro === f.id}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filtro === f.id
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border-soft bg-surface text-text-2 hover:text-text-1"
                )}
                onClick={() => setFiltro(f.id)}
              >
                {f.etichetta} <span className="opacity-80">{f.n}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {dati.loading ? (
          <p className="flex items-center gap-2 px-5 py-4 text-xs text-text-3">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Carico le proposte…
          </p>
        ) : totaleVisibile === 0 ? (
          <div className="mx-auto max-w-md px-4 py-12 text-center">
            <Inbox className="mx-auto size-8 text-text-3" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-text-1">Coda vuota</p>
            <p className="mt-1 text-xs leading-5 text-text-3">
              Comunicazioni ambigue, importi, cancellazioni ed effetti esterni
              arrivano qui. Tutto il resto Tars lo fa da solo.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4 min-h-10"
              onClick={onVaiAlRegistro}
            >
              Vedi cosa ha fatto Tars
            </Button>
            {dati.erroreSmistamento && (
              <p className="mt-4 text-[11px] text-text-3">
                Smistamento non disponibile: {dati.erroreSmistamento}
              </p>
            )}
            {dati.errore && <p className="mt-2 text-xs text-danger">{dati.errore}</p>}
          </div>
        ) : (
          <>
            {mostra("comunicazioni") && dati.smistamento.length > 0 && (
              <Sezione
                titolo="Comunicazioni da collegare"
                suggerimento="Approva: collega la comunicazione e archivia gli allegati riconosciuti"
                conteggio={dati.smistamento.length}
              >
                {dati.smistamento.map(voce => {
                  const candidato = voce.candidati.find(c =>
                    voce.collegamento.commessaId
                      ? c.tipo === "commessa" && c.id === voce.collegamento.commessaId
                      : c.tipo === "cliente" && c.id === voce.collegamento.clienteId
                  );
                  const destinazione =
                    candidato?.etichetta ??
                    (voce.collegamento.commessaId
                      ? `commessa ${voce.collegamento.commessaId}`
                      : `cliente ${voce.collegamento.clienteId}`);
                  const inCorso = smistamentoInCorso === voce.comunicazioneId;
                  const allegati = voce.allegatiDaArchiviare;
                  return (
                    <RigaProposta
                      key={voce.comunicazioneId}
                      icona={<Link2 className="size-4" aria-hidden="true" />}
                      tipo={voce.canale === "whatsapp" ? "WhatsApp" : "Email"}
                      meta={`${voce.mittente} · ${dataBreve(voce.ricevutaIl)}`}
                      titolo={voce.oggetto || voce.mittente}
                      destinazione={
                        <>
                          <span className="text-text-3">Collega a</span>
                          <strong className="font-semibold">{destinazione}</strong>
                        </>
                      }
                      chip={
                        <>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              classeConfidenza(voce.collegamento.confidenza)
                            )}
                          >
                            {ETICHETTA_CONFIDENZA[voce.collegamento.confidenza] ??
                              voce.collegamento.confidenza}
                          </span>
                          {(voce.urgenza === "critica" || voce.urgenza === "alta") && (
                            <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
                              urgente
                            </span>
                          )}
                          {allegati.length > 0 && (
                            <span className="text-xs text-text-3">
                              + {allegati.length}{" "}
                              {allegati.length === 1 ? "allegato" : "allegati"} nel fascicolo
                            </span>
                          )}
                        </>
                      }
                      dettagli={
                        <>
                          <Dettaglio etichetta="Perché">{voce.collegamento.motivo}</Dettaglio>
                          {voce.riepilogo && (
                            <Dettaglio etichetta="Il messaggio">{voce.riepilogo}</Dettaglio>
                          )}
                          <Dettaglio etichetta="Se approvi">
                            {voce.collegamento.commessaId
                              ? "la comunicazione viene collegata alla commessa e segnata gestita"
                              : "la comunicazione viene agganciata al cliente"}
                            {allegati.length > 0
                              ? `; ${allegati.length === 1 ? "l'allegato" : "gli allegati"} ${allegati.join(", ")} ${allegati.length === 1 ? "finisce" : "finiscono"} nel fascicolo.`
                              : "."}
                          </Dettaglio>
                        </>
                      }
                      azioni={
                        <BottoniDecisione
                          inCorso={inCorso}
                          etichettaSi="Approva"
                          onSi={() => {
                            setSmistamentoInCorso(voce.comunicazioneId);
                            decidiSmistamento.mutate({
                              comunicazioneId: voce.comunicazioneId,
                              decisione: "approva",
                            });
                          }}
                          onNo={() => {
                            setSmistamentoInCorso(voce.comunicazioneId);
                            decidiSmistamento.mutate({
                              comunicazioneId: voce.comunicazioneId,
                              decisione: "rifiuta",
                            });
                          }}
                        />
                      }
                      onApri={() => onApriLink(voce.link)}
                    />
                  );
                })}
              </Sezione>
            )}

            {mostra("analisi") && dati.analisi.length > 0 && (
              <Sezione
                titolo="Dall'analisi di oggi"
                suggerimento="«Chiedi a Tars» apre la chat con la richiesta già scritta"
                conteggio={dati.analisi.length}
              >
                {dati.analisi.map((p, i) => (
                  <RigaProposta
                    key={i}
                    icona={<Brain className="size-4" aria-hidden="true" />}
                    tipo="Consiglio"
                    titolo={p.testo}
                    destinazione={
                      <span className="text-text-2">
                        Tars farebbe: <em className="not-italic font-medium text-text-1">{p.richiestaPerTars}</em>
                      </span>
                    }
                    dettagli={
                      <>
                        <Dettaglio etichetta="Cosa succede">
                          niente finché non lo chiedi: la richiesta va in chat, Tars la esegue con i
                          suoi strumenti e la scrive nel Registro.
                        </Dettaglio>
                        {p.entita.length > 0 && (
                          <Dettaglio etichetta="Riguarda">{p.entita.join(", ")}</Dettaglio>
                        )}
                      </>
                    }
                    azioni={
                      <Button
                        type="button"
                        className="min-h-10 flex-1 md:flex-none"
                        onClick={() => onSuggerimento(p.richiestaPerTars)}
                      >
                        <MessageSquarePlus aria-hidden="true" />
                        Chiedi a Tars
                      </Button>
                    }
                    onApri={p.link ? () => onApriLink(p.link!) : undefined}
                  />
                ))}
              </Sezione>
            )}

            {mostra("documenti") && gatewayVisibili.length > 0 && (
              <Sezione
                titolo="Dai documenti letti"
                suggerimento="Cambiano dati dell'ordine: si applicano solo con la tua approvazione"
                conteggio={gatewayVisibili.length}
              >
                {gatewayVisibili.map(p => {
                  const inCorso = gatewayInCorso === p.id;
                  return (
                    <RigaProposta
                      key={p.id}
                      icona={<ClipboardCheck className="size-4" aria-hidden="true" />}
                      tipo="Documento"
                      meta={`${p.documentoNome} · ${dataBreve(p.creataIl)}`}
                      titolo={p.etichetta}
                      destinazione={
                        p.valoreCorrente !== p.valoreProposto ? (
                          <>
                            <span className="text-text-3 line-through">
                              {p.valoreCorrente ?? "—"}
                            </span>
                            <span aria-hidden="true" className="text-text-3">
                              →
                            </span>
                            <strong className="font-semibold">{p.valoreProposto}</strong>
                          </>
                        ) : (
                          <span>{p.effetto ?? p.motivazione}</span>
                        )
                      }
                      dettagli={
                        <>
                          {p.effetto && <Dettaglio etichetta="Effetto">{p.effetto}</Dettaglio>}
                          <Dettaglio etichetta="Perché">{p.motivazione}</Dettaglio>
                        </>
                      }
                      azioni={
                        <BottoniDecisione
                          inCorso={inCorso}
                          etichettaSi="Approva e applica"
                          onSi={() => {
                            setGatewayInCorso(p.id);
                            nascondi(p.id);
                            approva.mutate({ id: p.id, hashAnteprima: p.hashAnteprima });
                          }}
                          onNo={() => {
                            setGatewayInCorso(p.id);
                            nascondi(p.id);
                            rifiuta.mutate({ id: p.id });
                          }}
                        />
                      }
                      onApri={() => onApriLink(p.link)}
                    />
                  );
                })}
              </Sezione>
            )}
          </>
        )}
      </div>
    </div>
  );
}
