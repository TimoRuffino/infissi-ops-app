// Vista «Proposte» della pagina Tars: la coda delle decisioni.
//
// Terza stesura (08/09/2026, PRD §62). Le tre sorgenti — comunicazioni da
// collegare, dati letti dai documenti, consigli dell'analisi — arrivavano
// qui con le parole della propria sorgente: il titolo di una comunicazione
// era l'oggetto grezzo dell'email, cosa Tars volesse fare stava sotto in
// piccolo e il perché era chiuso in un pannello da aprire riga per riga.
// Ora ogni riga dice, nell'ordine: cosa succede se dici sì, perché, cosa
// cambia, da dove viene. Il testo lo prepara `lib/tarsDecisioniView.ts`
// (puro, provato da solo); qui si disegna e si decide.
//
// Il server resta il confine: qui si decide, mai si applica da soli.
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  ArrowRight,
  Brain,
  Check,
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
import {
  decisioneDaComunicazione,
  decisioneDaConsiglio,
  decisioneDaDocumento,
  ETICHETTA_FIDUCIA,
  titoloCoda,
  type Decisione,
} from "@/lib/tarsDecisioniView";
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
  const proposteAnalisi = demo?.analisi ?? analisi.proposte;
  return {
    smistamento: demo?.smistamento ?? smistamento.data ?? [],
    gateway: demo?.gateway ?? gateway.data ?? [],
    analisi: proposteAnalisi,
    analisiId: demo ? 999 : analisi.analisiId,
    // Il numero sulla linguetta è quello che aspetta una decisione: un
    // consiglio già eseguito o scartato non è lavoro, e contarlo faceva
    // dire «6» alla linguetta sopra una coda di cinque righe.
    totale:
      (demo?.smistamento.length ?? smistamento.data?.length ?? 0) +
      (demo?.gateway.length ?? gateway.data?.length ?? 0) +
      proposteAnalisi.filter(p => !p.esecuzione).length,
    loading: !demo && (smistamento.isLoading || gateway.isLoading),
    // L'analisi di oggi si rigenera da qui: è dove si leggono i suoi
    // consigli. Prima il pulsante stava nella colonna destra della chat,
    // che non c'è più (PRD §62).
    rigeneraAnalisi: analisi.rigenera,
    analisiNascosta: analisi.nascosta,
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
        entita: [{ riferimento: "commessa:182", etichetta: "COM-2026-182 — Rossi Anna", link: "/commesse/182" }],
        link: "/commesse/182",
        azione: null,
      },
      {
        testo: "Aprire il ticket post-vendita per il reclamo WnD fermo da 183 giorni.",
        richiestaPerTars: "Crea un ticket urgente per la commessa 190: reclamo WnD, appuntamento da fissare",
        entita: [{ riferimento: "comunicazione:16295", etichetta: "Email: reclamo WnD", link: "/messaggi/email?messaggio=16295" }],
        link: "/messaggi/email?messaggio=16295",
        azione: { strumento: "crea_ticket", input: "{\"commessaId\":190,\"oggetto\":\"Reclamo WnD\",\"categoria\":\"altro\",\"priorita\":\"urgente\"}" },
      },
      {
        testo: "Ricordare lunedì il sollecito del preventivo Soare (già eseguita).",
        richiestaPerTars: "Ricordami lunedì alle 9 di sollecitare il preventivo Soare",
        entita: [{ riferimento: "commessa:24", etichetta: "COM-2026-024 — Soare", link: "/commesse/24" }],
        link: "/commesse/24",
        azione: { strumento: "crea_promemoria", input: "{\"testo\":\"Sollecitare Soare\",\"quando\":\"lunedì alle 9\"}" },
        esecuzione: { stato: "creato", motivo: null, azioneId: "crea_promemoria:9", entitaToccate: ["promemoria:9"], quando: adesso, daUtente: 1 },
      },
    ] as unknown as VoceAnalisi[],
  };
}

function classeFiducia(fiducia: NonNullable<Decisione["fiducia"]>): string {
  if (fiducia === "alta") return "bg-success-soft text-success";
  if (fiducia === "media") return "bg-warning-soft text-warning";
  return "bg-surface-2 text-text-2";
}

/**
 * Una riga della coda, letta dall'alto: cosa succede se dici sì (il
 * titolo), perché, cosa cambia, da dove viene. Niente si apre: quello che
 * serve per decidere è già tutto qui, e quello che non serve non c'è.
 */
function RigaDecisione({
  decisione: d,
  icona,
  azioni,
  onApri,
  onApriLink,
}: {
  decisione: Decisione;
  icona: ReactNode;
  azioni: ReactNode;
  onApri?: () => void;
  onApriLink: (link: string) => void;
}) {
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
        <span
          className="hidden size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-2 lg:flex"
          aria-hidden="true"
        >
          {icona}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-semibold leading-6 text-text-1 break-words [overflow-wrap:anywhere]">
              {d.azione}
            </span>
            {d.urgente && (
              <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
                urgente
              </span>
            )}
            {d.fiducia && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  classeFiducia(d.fiducia)
                )}
              >
                {ETICHETTA_FIDUCIA[d.fiducia]}
              </span>
            )}
          </p>

          {d.perche && (
            <p className="mt-1 text-sm leading-5 text-text-2 break-words [overflow-wrap:anywhere]">
              {d.perche}
            </p>
          )}

          {d.cambio && (
            <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-text-3 line-through">{d.cambio.da}</span>
              <ArrowRight className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
              <strong className="font-semibold text-text-1">{d.cambio.a}</strong>
            </p>
          )}

          {d.effetti.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {d.effetti.map(effetto => (
                <li
                  key={effetto}
                  className="flex min-w-0 gap-1.5 text-xs leading-5 text-text-3"
                >
                  <span aria-hidden="true">·</span>
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {effetto}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {d.riguarda.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1">
              {/* Nomi, non id: le etichette e i link li risolve il server. */}
              {d.riguarda.map(e =>
                e.link ? (
                  <button
                    key={e.etichetta}
                    type="button"
                    className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-1 hover:underline"
                    onClick={() => onApriLink(e.link!)}
                  >
                    {e.etichetta}
                  </button>
                ) : (
                  <span
                    key={e.etichetta}
                    className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-2"
                  >
                    {e.etichetta}
                  </span>
                )
              )}
            </p>
          )}

          {(d.provenienza || onApri) && (
            <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-5 text-text-3">
              {d.provenienza && (
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {d.provenienza}
                </span>
              )}
              {onApri && (
                <button
                  type="button"
                  className="inline-flex min-h-8 shrink-0 items-center gap-1 font-semibold text-text-2 hover:text-text-1"
                  onClick={onApri}
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Apri l'originale
                </button>
              )}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:pl-2">
          {azioni}
        </div>
      </div>
    </li>
  );
}

/** Sì e no, con lo stesso peso visivo ovunque: il verbo dice il gesto. */
function BottoniDecisione({
  inCorso,
  verbo,
  etichettaNo = "Rifiuta",
  onSi,
  onNo,
}: {
  inCorso: boolean;
  verbo: string;
  etichettaNo?: string;
  onSi: () => void;
  onNo: () => void;
}) {
  return (
    <>
      <Button
        type="button"
        className="min-h-10"
        disabled={inCorso}
        onClick={onSi}
      >
        {inCorso ? (
          <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        {verbo}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-10"
        disabled={inCorso}
        onClick={onNo}
      >
        <X aria-hidden="true" />
        {etichettaNo}
      </Button>
    </>
  );
}

/**
 * Un gruppo della coda. Titolo e conteggio, niente istruzioni: cosa fa il
 * pulsante lo dice il pulsante.
 */
function Sezione({
  titolo,
  conteggio,
  children,
}: {
  titolo: string;
  conteggio: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={titolo}>
      <div className="flex items-baseline gap-2 px-4 pb-1.5 pt-5 sm:px-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-2">
          {titolo}
        </h3>
        <span className="text-xs font-semibold text-text-3">{conteggio}</span>
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
  // Le proposte già gestite (eseguite o scartate) non sono lavoro: restano
  // dietro un toggle, così la lista mostra solo ciò che aspetta una
  // decisione (direzione 04/09/2026: «se le rifiuto rimangono lì»).
  const [mostraGestite, setMostraGestite] = useState(false);
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
  // T3: «Esegui» su una proposta dell'analisi — il server riverifica
  // catalogo e input e passa dal ledger R1; qui solo il click e l'esito.
  const [analisiInCorso, setAnalisiInCorso] = useState<number | null>(null);
  const eseguiAnalisi = trpc.tars.eseguiPropostaAnalisi.useMutation({
    onSuccess: ({ esecuzione }) => {
      setAnalisiInCorso(null);
      void utils.tars.analisiAzienda.invalidate();
      if (esecuzione.stato === "non_eseguito") {
        toast.warning(esecuzione.motivo ?? "Non eseguita.");
      } else {
        toast.success("Fatto: lo trovi nel Registro di Tars.");
      }
    },
    onError: errore => {
      setAnalisiInCorso(null);
      void utils.tars.analisiAzienda.invalidate();
      toast.error(errore.message || "Esecuzione non riuscita.");
    },
  });
  const scartaAnalisi = trpc.tars.scartaPropostaAnalisi.useMutation({
    onSuccess: () => {
      setAnalisiInCorso(null);
      void utils.tars.analisiAzienda.invalidate();
      toast.success("Proposta scartata.");
    },
    onError: errore => {
      setAnalisiInCorso(null);
      void utils.tars.analisiAzienda.invalidate();
      toast.error(errore.message || "Scarto non riuscito.");
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

  // L'indice originale resta la chiave delle mutation (Esegui/Scarta):
  // nasconderne una non lo sposta.
  const analisiTutte = dati.analisi.map((p, i) => ({ p, i }));
  const analisiAperte = analisiTutte.filter(x => !x.p.esecuzione);
  const analisiGestite = analisiTutte.length - analisiAperte.length;
  const analisiVoci = mostraGestite ? analisiTutte : analisiAperte;

  // Un numero solo, contato dalle righe che si vedono. Prima l'intestazione
  // partiva dal totale del server e i filtri toglievano le gestite: la
  // pagina diceva «6 proposte» sopra una lista di cinque.
  const daDecidere =
    dati.smistamento.length + analisiAperte.length + gatewayVisibili.length;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-border-soft bg-card px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-text-1">
              {titoloCoda(daDecidere)}
            </h2>
            <p className="text-xs leading-5 text-text-3">
              Quando è sicuro Tars fa da solo e lo scrive nel Registro. Qui
              resta ciò che vuole il tuo sì.
            </p>
          </div>
          {!dati.analisiNascosta && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-10 shrink-0"
              // Sotto sm resta la sola icona: il nome accessibile non può
              // dipendere dal testo che sparisce.
              aria-label="Rigenera l'analisi di oggi"
              title="Rifà l'analisi di oggi e i suoi consigli"
              disabled={dati.rigeneraAnalisi.isPending}
              onClick={() => dati.rigeneraAnalisi.mutate()}
            >
              {dati.rigeneraAnalisi.isPending ? (
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Brain aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Rigenera l'analisi</span>
            </Button>
          )}
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {dati.loading ? (
          <p className="flex items-center gap-2 px-5 py-4 text-xs text-text-3">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Carico le proposte…
          </p>
        ) : daDecidere === 0 ? (
          <div className="mx-auto max-w-md px-4 py-12 text-center">
            <Inbox className="mx-auto size-8 text-text-3" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-text-1">
              Niente da decidere
            </p>
            <p className="mt-1 text-xs leading-5 text-text-3">
              Qui arrivano i messaggi da collegare, i dati letti dai documenti
              e i consigli dell'analisi. Tutto il resto Tars lo fa da solo.
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
            {dati.smistamento.length > 0 && (
              <Sezione
                titolo="Messaggi da collegare"
                conteggio={dati.smistamento.length}
              >
                {dati.smistamento.map(voce => {
                  const inCorso = smistamentoInCorso === voce.comunicazioneId;
                  return (
                    <RigaDecisione
                      key={voce.comunicazioneId}
                      decisione={decisioneDaComunicazione(voce)}
                      icona={<Link2 className="size-4" aria-hidden="true" />}
                      onApri={() => onApriLink(voce.link)}
                      onApriLink={onApriLink}
                      azioni={
                        <BottoniDecisione
                          inCorso={inCorso}
                          verbo="Collega"
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
                    />
                  );
                })}
              </Sezione>
            )}

            {gatewayVisibili.length > 0 && (
              <Sezione
                titolo="Dati letti dai documenti"
                conteggio={gatewayVisibili.length}
              >
                {gatewayVisibili.map(p => (
                  <RigaDecisione
                    key={p.id}
                    decisione={decisioneDaDocumento(p)}
                    icona={<ClipboardCheck className="size-4" aria-hidden="true" />}
                    onApri={() => onApriLink(p.link)}
                    onApriLink={onApriLink}
                    azioni={
                      <BottoniDecisione
                        inCorso={gatewayInCorso === p.id}
                        verbo="Applica"
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
                  />
                ))}
              </Sezione>
            )}

            {analisiVoci.length > 0 && (
              <Sezione
                titolo="Consigli dell'analisi di oggi"
                conteggio={analisiAperte.length}
              >
                {analisiVoci.map(({ p, i }) => {
                  const decisione = decisioneDaConsiglio(p, i);
                  const link =
                    p.link ?? p.entita.find(e => e.link)?.link ?? null;
                  return (
                    <RigaDecisione
                      key={i}
                      decisione={decisione}
                      icona={<Brain className="size-4" aria-hidden="true" />}
                      onApri={link ? () => onApriLink(link) : undefined}
                      onApriLink={onApriLink}
                      azioni={
                        p.esecuzione ? (
                          <>
                            <span
                              className={cn(
                                "rounded-full px-2 py-1 text-[11px] font-semibold",
                                p.esecuzione.stato === "scartata"
                                  ? "bg-surface-2 text-text-3"
                                  : p.esecuzione.stato === "non_eseguito"
                                    ? "bg-warning-soft text-warning"
                                    : "bg-success-soft text-success"
                              )}
                            >
                              {p.esecuzione.stato === "scartata"
                                ? "Scartata"
                                : p.esecuzione.stato === "non_eseguito"
                                  ? (p.esecuzione.motivo ?? "Non eseguita")
                                  : "Fatto da Tars"}
                            </span>
                            {p.esecuzione.stato !== "scartata" && (
                              <Button
                                type="button"
                                variant="ghost"
                                className="min-h-10"
                                onClick={onVaiAlRegistro}
                              >
                                Registro
                              </Button>
                            )}
                          </>
                        ) : p.azione ? (
                          <>
                            <Button
                              type="button"
                              className="min-h-10"
                              disabled={analisiInCorso === i || dati.analisiId == null}
                              onClick={() => {
                                setAnalisiInCorso(i);
                                eseguiAnalisi.mutate({ analisiId: dati.analisiId!, indice: i });
                              }}
                            >
                              {analisiInCorso === i ? (
                                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                              ) : (
                                <Check aria-hidden="true" />
                              )}
                              Esegui
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="min-h-10"
                              aria-label="Chiedi a Tars in chat"
                              title="Chiedi a Tars invece di eseguire"
                              onClick={() => onSuggerimento(p.richiestaPerTars)}
                            >
                              <MessageSquarePlus aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-10"
                              disabled={analisiInCorso === i || dati.analisiId == null}
                              onClick={() => {
                                setAnalisiInCorso(i);
                                scartaAnalisi.mutate({ analisiId: dati.analisiId!, indice: i });
                              }}
                            >
                              <X aria-hidden="true" />
                              Scarta
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              className="min-h-10"
                              onClick={() => onSuggerimento(p.richiestaPerTars)}
                            >
                              <MessageSquarePlus aria-hidden="true" />
                              Apri in chat
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-10"
                              disabled={analisiInCorso === i || dati.analisiId == null}
                              onClick={() => {
                                setAnalisiInCorso(i);
                                scartaAnalisi.mutate({ analisiId: dati.analisiId!, indice: i });
                              }}
                            >
                              <X aria-hidden="true" />
                              Scarta
                            </Button>
                          </>
                        )
                      }
                    />
                  );
                })}
              </Sezione>
            )}

            {analisiGestite > 0 && (
              <p className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-text-3 sm:px-5">
                <span>
                  {analisiAperte.length === 0
                    ? "I consigli di oggi sono stati gestiti tutti."
                    : `${analisiGestite} ${analisiGestite === 1 ? "consiglio gestito" : "consigli gestiti"}.`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setMostraGestite(v => !v)}
                >
                  {mostraGestite ? "Nascondi i gestiti" : "Mostra i gestiti"}
                </Button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
