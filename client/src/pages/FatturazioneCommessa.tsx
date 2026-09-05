// `/fatturazione/:id` — il percorso a passi di una commessa (piano 4).
//
// Quattro tappe in sequenza — Documenti, Contratto, Limiti, Fattura — sopra
// gli stessi componenti che vivono nelle tab della scheda commessa. Qui
// cambia solo la cornice: intestazione, riepilogo di ciò che si è già
// chiuso, stepper e navigazione. Il lavoro resta dove sta il dominio.
//
// Chi decide cosa è «fatto» è il server (`fatturazioneGuidata.passi`,
// funzione pura `calcolaPassi`): questa pagina lo legge e basta. Dopo ogni
// cambiamento nei passi (`onCambiato`) rilegge i passi di questa commessa e
// invalida l'elenco, così «Avanti» si apre da solo e la commessa esce
// dall'elenco quando la fattura è emessa.
//
// Due cornici, non una: il passo Documenti porta con sé intestazione e
// «Avanti» (`PassoDocumenti`, Task 4, ha il proprio motivo scritto sotto il
// pulsante); gli altri tre la ricevono da qui. Un solo controllo di
// avanzamento per schermata, mai due.
//
// Il passo vive nella query (`?passo=documenti|contratto|limiti|fattura`)
// come la vista del Centro azioni: un link è condivisibile, un refresh non
// riporta all'inizio, e un passo che si chiude mentre lo si guarda non fa
// saltare la pagina in avanti da sola.
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §3 (flusso), §6 (client), §7 (permessi, sede, flag).
import { useEffect } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import {
  ETICHETTA_PASSO,
  ORDINE_PASSI,
  type CommessaDaFatturare,
  type PassoFatturazione,
} from "@shared/fatturazione/passi";

import ContrattoTab from "@/components/contratto/ContrattoTab";
import LimitiTab from "@/components/computo/LimitiTab";
import FatturaTab from "@/components/fattura/FatturaTab";
import PassiFatturazione from "@/components/fatturazione/PassiFatturazione";
import PassoDocumenti from "@/components/fatturazione/PassoDocumenti";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import StatePanel, {
  type StatePanelProps,
} from "@/components/patterns/StatePanel";
import StatoChip from "@/components/StatoChip";
import { Button } from "@/components/ui/button";
import { importiCard } from "@/lib/fatturazioneView";
import { formatCent } from "@/lib/limitiView";
import { trpc } from "@/lib/trpc";
import { permessoNegato } from "@/lib/trpcErrors";

/**
 * Una riga di guida per passo: cosa si fa qui, in una frase. Documenti non
 * c'è perché la sua intestazione è dentro `PassoDocumenti`: una copia muta
 * qui divergerebbe senza che nessuno se ne accorga.
 */
const GUIDA_PASSO: Record<Exclude<PassoFatturazione, "documenti">, string> = {
  contratto:
    "Controlla righe, pattuito, rate e opzioni: da qui nasce il computo dei limiti.",
  limiti:
    "Calcola i limiti sul contratto corrente: la bozza di fattura nasce da qui.",
  fattura:
    "Genera la bozza dai limiti, correggi importi e scadenze, poi emetti.",
};

/**
 * Perché «Avanti» è ancora chiuso: mai un pulsante spento e muto. Solo per i
 * due passi con il piede di pagina — Documenti ha il proprio, e Fattura è
 * l'ultimo (nessun «Avanti» da spiegare).
 */
function motivoAvanti(passo: PassoFatturazione): string | null {
  if (passo === "contratto") {
    return "Il contratto deve avere almeno una riga salvata.";
  }
  if (passo === "limiti") {
    return "Serve un computo aggiornato sul contratto corrente, con esito «ok».";
  }
  return null;
}

/** Il passo chiesto dall'URL, se è uno dei quattro; altrimenti niente. */
function passoDallaQuery(search: string): PassoFatturazione | null {
  const richiesto = new URLSearchParams(search).get("passo");
  return ORDINE_PASSI.find(passo => passo === richiesto) ?? null;
}

function hrefPasso(commessaId: number, passo: PassoFatturazione): string {
  return `/fatturazione/${commessaId}?passo=${passo}`;
}

/** «3 documenti (1 contratto)», con singolari e plurali giusti. */
function riepilogoDocumenti(
  documenti: CommessaDaFatturare["documenti"]
): string {
  const totale = `${documenti.totale} ${
    documenti.totale === 1 ? "documento" : "documenti"
  }`;
  const contratti = `${documenti.contratti} ${
    documenti.contratti === 1 ? "contratto" : "contratti"
  }`;
  return `${totale} (${contratti})`;
}

export default function FatturazioneCommessa() {
  const params = useParams<{ id: string }>();
  const commessaId = Number(params.id);
  const idValido = Number.isInteger(commessaId) && commessaId > 0;
  const [, setLocation] = useLocation();
  const search = useSearch();
  const utils = trpc.useUtils();

  // Kill switch: la pagina vive dietro l'interruttore «limiti» come
  // l'elenco — le procedure del piano 4 sono tutte dietro
  // `procedureConInterruttore("limiti")`. La UI nasconde, il server decide.
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const limitiAttivi = Boolean(interruttori.data?.limiti);
  const fatturazioneAttiva = Boolean(interruttori.data?.fatturazione);
  const abilitata = limitiAttivi && idValido;

  const passiQ = trpc.fatturazioneGuidata.passi.useQuery(
    { commessaId },
    { enabled: abilitata, retry: false }
  );
  // La commessa è il record di questa pagina: cliente, codice e stato
  // vengono da lì, non dallo specchio dei passi. Una commessa di un'altra
  // sede torna `null`, esattamente come una che non esiste.
  const commessaQ = trpc.commesse.byId.useQuery(commessaId, {
    enabled: abilitata,
  });

  const record = passiQ.data ?? null;
  const passoUrl = passoDallaQuery(search);
  const corrente: PassoFatturazione =
    passoUrl ?? record?.prossimoPasso ?? ORDINE_PASSI[0];
  const indice = ORDINE_PASSI.indexOf(corrente);

  // Alla prima lettura il passo di ripresa finisce nell'URL: da lì in poi è
  // l'URL a comandare, e un passo che si chiude mentre lo si guarda non
  // sposta più l'operatore da solo.
  useEffect(() => {
    if (passoUrl != null || !record) return;
    setLocation(
      hrefPasso(commessaId, record.prossimoPasso ?? ORDINE_PASSI[0]),
      { replace: true }
    );
  }, [passoUrl, record, commessaId, setLocation]);

  const vai = (passo: PassoFatturazione) =>
    setLocation(hrefPasso(commessaId, passo), { replace: true });

  /** Un passo è cambiato sul server: rileggi questo percorso e l'elenco. */
  const segnalaCambio = () => {
    void utils.fatturazioneGuidata.passi.invalidate({ commessaId });
    void utils.fatturazioneGuidata.daFare.invalidate();
  };

  // Il riepilogo guarda solo indietro: righe e limite si leggono soltanto
  // quando il passo è già alle spalle, non a ogni apertura della pagina.
  const contrattoQ = trpc.contratti.get.useQuery(
    { commessaId },
    {
      enabled: abilitata && indice > ORDINE_PASSI.indexOf("contratto"),
      retry: false,
    }
  );
  const computoQ = trpc.computo.ultimo.useQuery(
    { commessaId },
    {
      enabled: abilitata && indice > ORDINE_PASSI.indexOf("limiti"),
      retry: false,
    }
  );

  // Un id fuori forma, una commessa che non esiste e una commessa di
  // un'altra sede danno lo stesso identico esito: da qui non si enumera
  // niente. Un rifiuto di permesso e un guasto restano invece distinti —
  // nasconderli dietro «non trovata» manderebbe a cercare la commessa
  // sbagliata.
  const nonTrovata =
    !idValido ||
    (abilitata && commessaQ.isSuccess && commessaQ.data == null) ||
    (abilitata && passiQ.error?.data?.code === "NOT_FOUND");
  const negata = abilitata && permessoNegato(passiQ.error);
  const guasto = abilitata && (passiQ.isError || commessaQ.isError);

  const stato: StatePanelProps | undefined = interruttori.isPending
    ? {
        kind: "loading",
        title: "Verifico la disponibilità",
        description:
          "Controllo se la fatturazione guidata è attiva su questo ambiente.",
      }
    : !limitiAttivi
      ? {
          kind: "unavailable",
          title: "Fatturazione guidata non disponibile",
          description: "Fatturazione guidata non attiva su questo ambiente.",
        }
      : nonTrovata
        ? {
            kind: "unavailable",
            title: "Commessa non trovata",
            description: "La commessa richiesta non è disponibile.",
            action: (
              <Button asChild variant="outline" className="min-h-11">
                <Link href="/fatturazione">Torna a Fatturazione</Link>
              </Button>
            ),
          }
        : negata
          ? {
              kind: "permission",
              title: "Percorso non disponibile",
              description:
                "Serve il permesso di leggere i contratti della sede.",
            }
          : guasto
            ? {
                kind: "error",
                title: "Percorso non disponibile",
                description:
                  passiQ.error?.message ??
                  commessaQ.error?.message ??
                  "Riprova tra poco.",
                action: (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => {
                      void passiQ.refetch();
                      void commessaQ.refetch();
                    }}
                  >
                    Riprova
                  </Button>
                ),
              }
            : !record || commessaQ.isPending
              ? {
                  kind: "loading",
                  title: "Carico il percorso",
                  description: "Recupero i passi della commessa.",
                  rows: 3,
                }
              : undefined;

  const commessa = commessaQ.data as
    | { codice?: string; cliente?: string; stato?: string }
    | null
    | undefined;

  // Solo i passi già alle spalle, in una riga: gli importi compaiono
  // soltanto quando il server li manda (senza `economia.read` sono `null`).
  const riepilogo: string[] = [];
  if (record && indice > 0) {
    riepilogo.push(`Documenti: ${riepilogoDocumenti(record.documenti)}`);
  }
  if (record && indice > ORDINE_PASSI.indexOf("contratto") && contrattoQ.data) {
    const righe = contrattoQ.data.righe.length;
    const pattuito = importiCard(record).pattuito;
    riepilogo.push(
      `Contratto: ${righe} ${righe === 1 ? "riga" : "righe"}${
        pattuito != null ? `, pattuito ${pattuito}` : ""
      }`
    );
  }
  if (indice > ORDINE_PASSI.indexOf("limiti") && computoQ.data?.computo) {
    riepilogo.push(
      `Limiti: limite ${formatCent(computoQ.data.computo.limiteCent)}`
    );
  }

  const ultimo = indice === ORDINE_PASSI.length - 1;
  const fatto = record?.passi[corrente] === "fatto";
  const motivo = motivoAvanti(corrente);

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="record"
        breadcrumbs={
          <Link
            href="/fatturazione"
            className="rounded-[var(--radius-control)] underline-offset-4 hover:underline"
          >
            Fatturazione
          </Link>
        }
        eyebrow="Fatturazione guidata"
        title={commessa?.cliente ?? "Commessa"}
        description={
          commessa?.codice ? (
            <span className="codice-mono text-xs text-text-3">
              {commessa.codice}
            </span>
          ) : undefined
        }
        metadata={
          commessa?.stato ? <StatoChip stato={commessa.stato} /> : undefined
        }
        busy={passiQ.isFetching}
        secondaryActions={
          <Button asChild variant="outline" className="min-h-11">
            <Link href={`/commesse/${commessaId}`}>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Apri commessa
            </Link>
          </Button>
        }
      />

      <DataSurface density="compact" tone="default" state={stato}>
        {record ? (
          <div className="min-w-0 space-y-4">
            <PassiFatturazione
              passi={record.passi}
              corrente={corrente}
              onVai={vai}
            />

            {riepilogo.length > 0 && (
              <p className="min-w-0 text-xs text-text-2">
                {riepilogo.join(" · ")}
              </p>
            )}

            {/* Il passo Documenti porta con sé intestazione e «Avanti»
                (`PassoDocumenti`, Task 4): la pagina non gliene mette un
                secondo accanto. Gli altri tre la cornice la ricevono qui. */}
            {corrente !== "documenti" && (
              <header className="min-w-0 space-y-1">
                <h2 className="text-[15px] font-bold leading-5 text-text-1">
                  {indice + 1} · {ETICHETTA_PASSO[corrente]}
                </h2>
                <p className="text-sm text-text-2">{GUIDA_PASSO[corrente]}</p>
              </header>
            )}

            {corrente === "documenti" && (
              <PassoDocumenti
                commessaId={commessaId}
                passo={record.passi.documenti}
                onAvanti={() => vai("contratto")}
                onCambiato={segnalaCambio}
              />
            )}

            {corrente === "contratto" && (
              <ContrattoTab
                commessaId={commessaId}
                modalita="guidata"
                onAvanti={() => vai("limiti")}
                onCambiato={segnalaCambio}
              />
            )}

            {corrente === "limiti" && (
              <LimitiTab
                commessaId={commessaId}
                modalita="guidata"
                onCambiato={segnalaCambio}
              />
            )}

            {corrente === "fattura" &&
              (fatturazioneAttiva ? (
                <FatturaTab
                  commessaId={commessaId}
                  modalita="guidata"
                  onCambiato={segnalaCambio}
                />
              ) : (
                <StatePanel
                  kind="unavailable"
                  compact
                  title="Fattura non disponibile"
                  description="Fatturazione non attiva su questo ambiente."
                />
              ))}

            {corrente !== "documenti" && (
              <footer className="flex min-w-0 flex-col gap-2 border-t border-border-soft pt-3 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => vai(ORDINE_PASSI[indice - 1])}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Indietro
                </Button>

                {/* Nessun «Avanti» sull'ultimo passo: dopo la fattura il
                    percorso è finito e la commessa esce dall'elenco. */}
                {!ultimo && (
                  <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                    {!fatto && motivo && (
                      <p id="motivo-avanti" className="text-xs text-text-3">
                        {motivo}
                      </p>
                    )}
                    <Button
                      type="button"
                      className="min-h-11"
                      disabled={!fatto}
                      aria-describedby={
                        fatto || !motivo ? undefined : "motivo-avanti"
                      }
                      onClick={() => vai(ORDINE_PASSI[indice + 1])}
                    >
                      Avanti
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </footer>
            )}
          </div>
        ) : null}
      </DataSurface>
    </div>
  );
}
