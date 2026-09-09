// `/piattaforma/:slug` — la scheda di un'azienda di Wyndoor (spec WS6 §8).
// Otto sezioni piatte, nell'ordine in cui si guardano quando qualcosa non
// torna: Abbonamento, Spazio, Tars, Sedi, Proprietari e inviti, Backup e
// ripristino, Eventi, Comandi. Niente card annidate: ogni sezione è un
// titolino e una superficie sola.
//
// Qui non si entra nei dati dell'azienda (clienti, commesse, messaggi): si
// amministra. Ogni scrittura è un comando di `tenant_comandi` con il nome di
// chi l'ha chiesto, e ogni azione sensibile passa dalla password (spec §3.2).
//
// La scheda si rinfresca da sola ogni 15 secondi. I due comandi lunghi —
// ricalcolo dello spazio e ripristino degli archivi — restano `in_attesa` e
// li esegue il giro dei comandi del server: la pagina li segue interrogando
// `piattaforma.comando` ogni 2 secondi finché non si chiudono, e solo allora
// racconta com'è andata.
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Link, useParams } from "wouter";

import type { AppRouter } from "../../../../server/routers";

import {
  byteScritti,
  dataItaliana,
  etichettaStato,
  etichettaTipo,
  meseScritto,
  percentualeScritta,
  tonoStato,
} from "@/components/abbonamento/testi";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import StatePanel from "@/components/patterns/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";

import AzioniAbbonamento from "./AzioniAbbonamento";
import ConfermaPassword from "./ConfermaPassword";
import SezioneProprietari from "./SezioneProprietari";
import SezioneRipristino from "./SezioneRipristino";
import {
  TESTO_SOLA_LETTURA_FLAG_SPENTO,
  attoreLeggibile,
  dataOraItaliana,
  dettagliCompatti,
  erroreDelComando,
  etichettaBlocco,
  etichettaComando,
  etichettaEvento,
  etichettaStatoAzienda,
  etichettaStatoComando,
  tonoStatoAzienda,
  tonoStatoComando,
} from "./testi";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Scheda = RouterOutputs["piattaforma"]["azienda"];
type Comando = NonNullable<RouterOutputs["piattaforma"]["comando"]>;

/** L'azienda che possiede la piattaforma (stesso `TENANT_PREDEFINITO_ID` del server). */
const TENANT_PIATTAFORMA_ID = 1;

const VARIANTE_ABBONAMENTO = {
  quieto: "secondary",
  attenzione: "warning",
  errore: "danger",
} as const;

const PERIODICITA: Record<string, string> = { monthly: "Mensile", yearly: "Annuale" };

function Sezione({
  titolo,
  descrizione,
  azioni,
  children,
}: {
  titolo: string;
  descrizione?: string;
  azioni?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="min-w-0">
        <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-text-3">
          {titolo}
        </h2>
        {descrizione ? (
          <p className="mt-1 max-w-3xl text-sm leading-6 text-text-2">{descrizione}</p>
        ) : null}
      </div>
      <DataSurface density="compact" tone="default" clip={false}>
        <div className="min-w-0 space-y-3">
          {children}
          {azioni ? (
            <div className="min-w-0 border-t border-border-soft pt-3">{azioni}</div>
          ) : null}
        </div>
      </DataSurface>
    </section>
  );
}

function Dati({ children }: { children: ReactNode }) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </dl>
  );
}

function Dato({ etichetta, children }: { etichetta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-3">{etichetta}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-sm text-text-1">{children}</dd>
    </div>
  );
}

/** Una tabella che non spinge mai la pagina: scorre dentro il suo riquadro. */
function Tabella({
  etichetta,
  colonne,
  children,
}: {
  etichetta: string;
  colonne: Array<{ nome: string; larghezza?: string }>;
  children: ReactNode;
}) {
  return (
    // `relative` per lo stesso motivo di SezioneRipristino: qualsiasi
    // discendente in posizione assoluta (una `sr-only`, un tooltip) deve
    // restare dentro il riquadro che scorre, non allargare la pagina.
    <div
      className="relative min-w-0 overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label={etichetta}
    >
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-xs text-text-3">
          <tr>
            {colonne.map(colonna => (
              <th
                key={colonna.nome}
                scope="col"
                className={`px-2 py-2 text-left font-semibold ${colonna.larghezza ?? ""}`}
              >
                {colonna.nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function AziendaDetail() {
  const { slug } = useParams<{ slug: string }>();
  const utils = trpc.useUtils();

  const azienda = trpc.piattaforma.azienda.useQuery({ slug }, { refetchInterval: 15_000 });
  const mio = trpc.tenants.mio.useQuery();
  const solaLettura = mio.data?.multiAzienda === false;

  // Il comando lungo che stiamo seguendo (ricalcolo o ripristino): parte
  // `in_attesa` e si chiude al giro del server. `gestito` ricorda l'id già
  // raccontato, così un rerender non ripete il toast.
  const [seguito, setSeguito] = useState<Comando | null>(null);
  const gestito = useRef<number | null>(null);
  const inAttesa = seguito?.stato === "in_attesa";
  const seguitoQuery = trpc.piattaforma.comando.useQuery(
    { id: seguito?.id ?? 0 },
    { enabled: inAttesa, refetchInterval: 2_000 }
  );

  const [statoAperto, setStatoAperto] = useState<"sospendi" | "riattiva" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [ancheTenant1, setAncheTenant1] = useState(false);
  const [erroreStato, setErroreStato] = useState<string | null>(null);

  const aggiorna = useCallback(() => {
    utils.piattaforma.azienda.invalidate({ slug });
    utils.piattaforma.aziende.invalidate();
  }, [slug, utils]);

  /**
   * L'esito di un comando appena accodato: rinfresca sempre, poi racconta.
   * `false` quando il dominio ha rifiutato — chi ha aperto il dialogo lo
   * tiene aperto e mostra lì il messaggio, così com'è arrivato (spec §10).
   */
  const esitoComando = useCallback(
    (comando: Comando, successo: string): boolean => {
      aggiorna();
      if (comando.stato === "errore") {
        toast.error(erroreDelComando(comando.esito) ?? "Il comando non è andato a buon fine.");
        return false;
      }
      if (comando.stato === "in_attesa") {
        gestito.current = null;
        setSeguito(comando);
        toast.info(`${etichettaComando(comando.tipo)}: in corso, lo esegue il server.`);
        return true;
      }
      toast.success(successo);
      return true;
    },
    [aggiorna]
  );

  useEffect(() => {
    const chiuso = seguitoQuery.data;
    if (!chiuso || chiuso.stato === "in_attesa") return;
    if (gestito.current === chiuso.id) return;
    gestito.current = chiuso.id;
    setSeguito(chiuso);
    aggiorna();
    if (chiuso.stato === "errore") {
      toast.error(erroreDelComando(chiuso.esito) ?? "Il comando non è andato a buon fine.");
    } else {
      toast.success(`${etichettaComando(chiuso.tipo)}: fatto.`);
    }
  }, [seguitoQuery.data, aggiorna]);

  const cambiaStato = trpc.piattaforma.sospendi.useMutation({
    onSuccess: ({ comando }) => {
      if (esitoComando(comando, "Azienda sospesa")) chiudiStato(false);
      else setErroreStato(erroreDelComando(comando.esito) ?? "Comando non riuscito.");
    },
    onError: e => setErroreStato(e.message),
  });
  const riattiva = trpc.piattaforma.riattiva.useMutation({
    onSuccess: ({ comando }) => {
      if (esitoComando(comando, "Azienda riattivata")) chiudiStato(false);
      else setErroreStato(erroreDelComando(comando.esito) ?? "Comando non riuscito.");
    },
    onError: e => setErroreStato(e.message),
  });
  const ricalcola = trpc.piattaforma.ricalcolaStorage.useMutation({
    onSuccess: ({ comando }) => esitoComando(comando, "Spazio ricalcolato"),
    onError: e => toast.error(e.message),
  });

  function chiudiStato(aperto: boolean) {
    if (!aperto) {
      setStatoAperto(null);
      setMotivo("");
      setAncheTenant1(false);
      setErroreStato(null);
      cambiaStato.reset();
      riattiva.reset();
    }
  }

  // Un istante solo per tutta la scheda: due sezioni non devono raccontare
  // due «adesso» diversi.
  const adesso = useMemo(() => new Date(), [azienda.dataUpdatedAt]);

  if (azienda.isLoading || azienda.error || !azienda.data) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1200px] space-y-5">
        <PageHeader
          variant="record"
          eyebrow="Piattaforma"
          title={slug}
          secondaryActions={
            <Button asChild variant="quiet" className="min-h-11">
              <Link href="/piattaforma">
                <ArrowLeft className="size-4" aria-hidden="true" />
                Tutte le aziende
              </Link>
            </Button>
          }
        />
        {azienda.isLoading ? (
          <StatePanel
            kind="loading"
            title="Caricamento della scheda"
            description="Sto leggendo il control plane di Wyndoor."
            rows={6}
          />
        ) : (
          <StatePanel
            kind="error"
            title="Scheda non disponibile"
            description={azienda.error?.message ?? "Risorsa non trovata."}
            action={
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void azienda.refetch()}
              >
                Riprova
              </Button>
            }
          />
        )}
      </div>
    );
  }

  const scheda: Scheda = azienda.data;
  const tenant1 = scheda.id === TENANT_PIATTAFORMA_ID;
  const sospesa = scheda.stato === "sospeso";
  const abbonamento = scheda.abbonamento;
  const storage = scheda.storage;
  const bloccoSpazio = etichettaBlocco(storage?.bloccoDal ?? null, adesso);
  const bloccoTars = etichettaBlocco(scheda.tars.bloccoDal, adesso);
  const ricalcoloInCorso =
    seguito?.tipo === "ricalcola_storage" && seguito.stato === "in_attesa";
  const titoloSolaLettura = solaLettura ? TESTO_SOLA_LETTURA_FLAG_SPENTO : undefined;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1200px] space-y-5">
      <PageHeader
        variant="record"
        eyebrow="Piattaforma"
        title={scheda.nome}
        metadata={
          <>
            <span className="font-mono">{scheda.slug}</span>
            <Badge variant={tonoStatoAzienda(scheda.stato)} title={scheda.motivoStato ?? undefined}>
              {etichettaStatoAzienda(scheda.stato)}
            </Badge>
            {tenant1 ? <Badge variant="brand">piattaforma</Badge> : null}
            <span>Aperta il {dataItaliana(scheda.createdAt)}</span>
            {scheda.motivoStato ? (
              <span className="min-w-0">Motivo: {scheda.motivoStato}</span>
            ) : null}
          </>
        }
        warning={
          solaLettura ? (
            TESTO_SOLA_LETTURA_FLAG_SPENTO
          ) : scheda.workerSospesi.length > 0 ? (
            <span className="min-w-0">
              {scheda.workerSospesi.length}{" "}
              {scheda.workerSospesi.length === 1 ? "worker fermo" : "worker fermi"}:{" "}
              {scheda.workerSospesi
                .map(w => `${w.etichetta} (fino al ${dataItaliana(w.finoA)})`)
                .join(", ")}
            </span>
          ) : undefined
        }
        secondaryActions={
          <>
            <Button asChild variant="quiet" className="min-h-11">
              <Link href="/piattaforma">
                <ArrowLeft className="size-4" aria-hidden="true" />
                Tutte le aziende
              </Link>
            </Button>
            <Button
              type="button"
              variant={sospesa ? "default" : "outline"}
              className="min-h-11"
              disabled={solaLettura}
              title={titoloSolaLettura}
              onClick={() => {
                setErroreStato(null);
                setMotivo("");
                setAncheTenant1(false);
                setStatoAperto(sospesa ? "riattiva" : "sospendi");
              }}
            >
              {sospesa ? (
                <PlayCircle className="size-4" aria-hidden="true" />
              ) : (
                <PauseCircle className="size-4" aria-hidden="true" />
              )}
              {sospesa ? "Riattiva" : "Sospendi"}
            </Button>
          </>
        }
      />

      <Sezione
        titolo="Abbonamento"
        azioni={
          <AzioniAbbonamento
            slug={slug}
            gruppo="abbonamento"
            abbonamento={abbonamento}
            solaLettura={solaLettura}
            onEsito={esitoComando}
          />
        }
      >
        {abbonamento ? (
          <Dati>
            <Dato etichetta="Tipo">{etichettaTipo(abbonamento.tipo)}</Dato>
            <Dato etichetta="Stato">
              <Badge variant={VARIANTE_ABBONAMENTO[tonoStato(abbonamento.stato)]}>
                {etichettaStato(abbonamento.stato)}
              </Badge>
            </Dato>
            <Dato etichetta="Periodicità">
              {abbonamento.periodicita ? PERIODICITA[abbonamento.periodicita] : "—"}
            </Dato>
            <Dato etichetta="Inizio del periodo">
              {dataItaliana(abbonamento.inizioPeriodo)}
            </Dato>
            <Dato etichetta="Fine del periodo">
              {abbonamento.finePeriodo ? dataItaliana(abbonamento.finePeriodo) : "—"}
              {abbonamento.giorniAllaScadenza != null ? (
                <span className="block text-xs text-text-3">
                  {abbonamento.giorniAllaScadenza >= 0
                    ? `fra ${abbonamento.giorniAllaScadenza} giorni`
                    : `scaduto da ${-abbonamento.giorniAllaScadenza} giorni`}
                </span>
              ) : null}
            </Dato>
            <Dato etichetta="Prossimo rinnovo">
              {abbonamento.prossimoRinnovo ? dataItaliana(abbonamento.prossimoRinnovo) : "—"}
            </Dato>
            <Dato etichetta="Disdetta">
              {abbonamento.disdettaAFinePeriodo ? (
                <span className="text-warning">A fine periodo</span>
              ) : (
                "No"
              )}
            </Dato>
            <Dato etichetta="Insoluto dal">
              {abbonamento.insolutoDal ? (
                <span className="text-danger">{dataItaliana(abbonamento.insolutoDal)}</span>
              ) : (
                "—"
              )}
            </Dato>
            <Dato etichetta="Provider">{abbonamento.provider}</Dato>
            <Dato etichetta="Omaggio">
              {abbonamento.omaggio ? (
                <>
                  <span className="block break-words">{abbonamento.omaggio.motivo}</span>
                  <span className="block text-xs text-text-3">
                    {abbonamento.omaggio.scadenzaIso
                      ? `fino al ${dataItaliana(new Date(abbonamento.omaggio.scadenzaIso))}`
                      : "senza scadenza"}
                    {" · "}
                    {attoreLeggibile(abbonamento.omaggio.attore)}
                  </span>
                </>
              ) : (
                "—"
              )}
            </Dato>
          </Dati>
        ) : (
          <p className="text-sm leading-5 text-text-2">
            Nessun abbonamento: l'azienda non ha né prova né contratto.
          </p>
        )}
      </Sezione>

      <Sezione
        titolo="Spazio"
        azioni={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AzioniAbbonamento
              slug={slug}
              gruppo="spazio"
              abbonamento={abbonamento}
              quotaBytes={storage?.quotaBytes ?? null}
              solaLettura={solaLettura}
              onEsito={esitoComando}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9"
              disabled={solaLettura || ricalcola.isPending || ricalcoloInCorso}
              title={titoloSolaLettura}
              onClick={() => ricalcola.mutate({ slug })}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {ricalcoloInCorso ? "In corso…" : "Ricalcola"}
            </Button>
          </div>
        }
      >
        {storage ? (
          <Dati>
            <Dato etichetta="Usato">
              {byteScritti(storage.bytes)} di {byteScritti(storage.quotaBytes)}
            </Dato>
            <Dato etichetta="Percentuale">{percentualeScritta(storage.percentuale)}</Dato>
            <Dato etichetta="File">{storage.file.toLocaleString("it-IT")}</Dato>
            <Dato etichetta="Tolleranza">
              {abbonamento ? `${abbonamento.tolleranzaStorageGiorni} giorni` : "—"}
            </Dato>
            <Dato etichetta="Al 100 % dal">
              {storage.soglia100Dal ? dataItaliana(storage.soglia100Dal) : "—"}
            </Dato>
            <Dato etichetta="Ricalcolato il">
              {storage.ricalcolatoIl ? dataOraItaliana(storage.ricalcolatoIl) : "mai"}
            </Dato>
            {bloccoSpazio ? (
              <Dato etichetta="Caricamenti">
                <span className="text-warning">{bloccoSpazio}</span>
              </Dato>
            ) : null}
          </Dati>
        ) : (
          <p className="text-sm leading-5 text-text-2">
            Lo spazio non è mai stato contato per questa azienda.
          </p>
        )}
        {ricalcoloInCorso ? (
          <p role="status" className="text-sm leading-5 text-text-2">
            Ricalcolo in corso… Lo esegue il server al prossimo giro dei comandi.
          </p>
        ) : null}
      </Sezione>

      <Sezione
        titolo="Tars"
        descrizione={`Consumo di ${meseScritto(scheda.tars.mese)}.`}
        azioni={
          <AzioniAbbonamento
            slug={slug}
            gruppo="tars"
            abbonamento={abbonamento}
            meseTars={scheda.tars.mese}
            solaLettura={solaLettura}
            onEsito={esitoComando}
          />
        }
      >
        <Dati>
          <Dato etichetta="Consumo del mese">
            {scheda.tars.consumoEur == null ? "—" : formatEuroSimbolo(scheda.tars.consumoEur)}
          </Dato>
          <Dato etichetta="Budget">
            {scheda.tars.budgetEur == null ? "senza tetto" : formatEuroSimbolo(scheda.tars.budgetEur)}
          </Dato>
          <Dato etichetta="Extra del mese">
            {scheda.tars.extraEur > 0 ? formatEuroSimbolo(scheda.tars.extraEur) : "—"}
          </Dato>
          <Dato etichetta="Percentuale">
            {scheda.tars.percentuale == null ? "—" : percentualeScritta(scheda.tars.percentuale)}
          </Dato>
          <Dato etichetta="Tolleranza">
            {abbonamento ? `${abbonamento.tolleranzaTarsGiorni} giorni` : "—"}
          </Dato>
          {bloccoTars ? (
            <Dato etichetta="Funzioni a pagamento">
              <span className="text-warning">{bloccoTars}</span>
            </Dato>
          ) : null}
        </Dati>
      </Sezione>

      <Sezione titolo="Sedi">
        {scheda.sedi.length === 0 ? (
          <p className="text-sm leading-5 text-text-2">Nessuna sede.</p>
        ) : (
          <ul className="min-w-0 divide-y divide-border-soft">
            {scheda.sedi.map(sede => (
              <li
                key={sede.id}
                className="flex min-w-0 items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-sm text-text-1">{sede.nome}</span>
                {sede.attiva ? null : <Badge variant="secondary">Chiusa</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Sezione>

      <Sezione titolo="Proprietari e inviti">
        <SezioneProprietari
          slug={slug}
          proprietari={scheda.proprietari}
          inviti={scheda.inviti}
          adesso={adesso}
          solaLettura={solaLettura}
          onEsito={esitoComando}
          aggiorna={aggiorna}
        />
      </Sezione>

      <Sezione titolo="Backup e ripristino">
        <SezioneRipristino
          slug={slug}
          backup={scheda.backup}
          tenant1={tenant1}
          solaLettura={solaLettura}
          comandoSeguito={seguito}
          onEsito={esitoComando}
        />
      </Sezione>

      <Sezione titolo="Eventi" descrizione="Gli ultimi 50 fatti registrati per questa azienda.">
        {scheda.eventi.length === 0 ? (
          <p className="text-sm leading-5 text-text-2">Nessun evento.</p>
        ) : (
          <Tabella
            etichetta="Eventi dell'azienda"
            colonne={[
              { nome: "Quando" },
              { nome: "Cosa" },
              { nome: "Chi" },
              { nome: "Motivo e dettagli" },
            ]}
          >
            {scheda.eventi.map(evento => (
              <tr key={evento.id} className="border-t border-border-soft align-top">
                <td className="whitespace-nowrap px-2 py-2 tabular-nums text-text-2">
                  {dataOraItaliana(evento.createdAt)}
                </td>
                <td className="min-w-0 px-2 py-2 font-medium text-text-1">
                  {etichettaEvento(evento.tipo)}
                </td>
                <td className="min-w-0 px-2 py-2 text-text-2">
                  {attoreLeggibile(evento.attore)}
                </td>
                <td className="min-w-0 px-2 py-2 text-text-2">
                  {evento.motivo ? (
                    <span className="block break-words">{evento.motivo}</span>
                  ) : null}
                  {dettagliCompatti(evento.dettagli) ? (
                    <span className="block break-words text-xs text-text-3">
                      {dettagliCompatti(evento.dettagli)}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </Tabella>
        )}
      </Sezione>

      <Sezione titolo="Comandi" descrizione="Gli ultimi 20 comandi accodati per questa azienda.">
        {scheda.comandi.length === 0 ? (
          <p className="text-sm leading-5 text-text-2">Nessun comando.</p>
        ) : (
          <Tabella
            etichetta="Comandi dell'azienda"
            colonne={[
              { nome: "Quando" },
              { nome: "Comando" },
              { nome: "Stato" },
              { nome: "Chi" },
              { nome: "Esito" },
            ]}
          >
            {scheda.comandi.map(comando => (
              <tr key={comando.id} className="border-t border-border-soft align-top">
                <td className="whitespace-nowrap px-2 py-2 tabular-nums text-text-2">
                  {dataOraItaliana(comando.createdAt)}
                  {comando.eseguitoAt ? (
                    <span className="block text-xs text-text-3">
                      chiuso {dataOraItaliana(comando.eseguitoAt)}
                    </span>
                  ) : null}
                </td>
                <td className="min-w-0 px-2 py-2 font-medium text-text-1">
                  {etichettaComando(comando.tipo)}
                </td>
                <td className="px-2 py-2">
                  <Badge variant={tonoStatoComando(comando.stato)}>
                    {etichettaStatoComando(comando.stato)}
                  </Badge>
                </td>
                <td className="min-w-0 px-2 py-2 text-text-2">
                  {attoreLeggibile(comando.richiestoDa)}
                </td>
                <td className="min-w-0 px-2 py-2">
                  {comando.stato === "errore" ? (
                    <span className="block break-words text-danger">
                      {erroreDelComando(comando.esito) ?? "Errore senza messaggio."}
                    </span>
                  ) : (
                    <span className="block break-words text-xs text-text-3">
                      {dettagliCompatti(comando.esito) || "—"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Tabella>
        )}
      </Sezione>

      <ConfermaPassword
        open={statoAperto != null}
        onOpenChange={chiudiStato}
        titolo={statoAperto === "riattiva" ? "Riattiva l'azienda" : "Sospendi l'azienda"}
        descrizione={
          statoAperto === "riattiva"
            ? "L'azienda torna a scrivere: i suoi utenti rientrano come prima."
            : "L'azienda resta leggibile ma nessuno può più scrivere. Il motivo lo vedono anche i suoi utenti."
        }
        etichettaConferma={statoAperto === "riattiva" ? "Riattiva" : "Sospendi"}
        distruttiva={statoAperto === "sospendi"}
        pending={cambiaStato.isPending || riattiva.isPending}
        errore={erroreStato}
        disabilitato={motivo.trim().length < 3 || (statoAperto === "sospendi" && tenant1 && !ancheTenant1)}
        onConferma={password => {
          if (!statoAperto) return;
          setErroreStato(null);
          if (statoAperto === "riattiva") {
            riattiva.mutate({ slug, motivo: motivo.trim(), passwordConferma: password });
          } else {
            cambiaStato.mutate({
              slug,
              motivo: motivo.trim(),
              ...(tenant1 ? { ancheTenant1 } : {}),
              passwordConferma: password,
            });
          }
        }}
      >
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="stato-motivo">Motivo</Label>
          <Input
            id="stato-motivo"
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            className="h-11"
            autoFocus
          />
          <p className="text-xs leading-4 text-text-3">
            Almeno tre caratteri. Resta nel registro dell'azienda.
          </p>
        </div>

        {statoAperto === "sospendi" && tenant1 ? (
          <div className="flex min-w-0 items-start gap-2">
            <Checkbox
              id="stato-anche-tenant1"
              checked={ancheTenant1}
              onCheckedChange={valore => setAncheTenant1(valore === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="stato-anche-tenant1"
              className="min-w-0 text-sm font-normal leading-5"
            >
              Anche Ruffino Group (mette la piattaforma in sola lettura)
            </Label>
          </div>
        ) : null}
      </ConfermaPassword>
    </div>
  );
}
