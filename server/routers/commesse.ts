import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  addCommessaToCliente,
  getClienteById,
  removeCommessaFromCliente,
} from "./clienti";
import { getUtentiStore } from "./utenti";
import {
  assertSedeScope,
  requireDirezione,
  requireDirezioneOAmministrazione,
  isAmministrazione,
  isDirezione,
} from "../_core/permissions";
import { calcolaMargine } from "../_core/margine";
import {
  chiaveRicerca,
  numeroCorrisponde,
  testoCorrisponde,
} from "../_core/ricerca";
import { DEFAULT_SEDE_ID } from "./sedi";
import { getOrdiniPerMargine } from "./fornitori";
import {
  hasPreventivoOrContratto,
  statoHasRequiredDoc,
  REQUIRED_DOC_TIPI_PER_STATO,
  DOC_TIPO_LABEL,
} from "./preventiviContratti";
import {
  STATI_COMMESSA,
  annullaTransizioneCommessa,
  eseguiTransizioneCommessa,
  storeTransizioniCommessa,
  type DipendenzeTransizioneCommessa,
  type StatoCommessa,
} from "../commesse/transizioni";
import { conTransazioneStoreAtomica, persistedStore } from "../_core/persistence";
import { publishAssignmentEvent } from "../events/publish";
import { requireAssignableUser } from "../authz/assignments";
import {
  authorizeCoreOperation,
  effectiveCapabilitySet,
} from "../authz/enforcement";
import type { Capability } from "../authz/capabilities";
import type { TrpcContext } from "../_core/context";
import {
  fingerprintPagamento,
  normalizzaPagamentoLegacy,
  ricalcolaImportoIncassato,
} from "../_core/commessaPayments";
import { annoCommessa } from "../_core/annoCommessa";
import {
  MOTIVO_PATTUITO_BLOCCATO,
  backfillPattuito,
  derivaPattuitoDaFic,
  pattuitoModificabileAMano,
  type DocumentoFicPerPiano,
  type RataCommessa,
} from "../_core/commessaPattuito";

// Tipologie di lavorazione che una commessa può comprendere. Elenco chiuso
// per poter raggruppare e filtrare; "Altro" resta come valvola di sfogo.
export const TIPOLOGIE_PRODOTTO = [
  "Infissi",
  "Porte interne",
  "Portoncino / Blindato",
  "Zanzariere",
  "Persiane",
  "Avvolgibili / Tapparelle",
  "Cassonetti",
  "Controtelai",
  "Tende da sole",
  "Veneziane",
  "Grate",
  "Vetri",
  "Scale",
  "Altro",
] as const;

// Compatibilità: timeline, client e test continuano a importare dal router;
// la fonte autorevole vive nel servizio di dominio condiviso con Tars.
export { STATI_COMMESSA };
export type { StatoCommessa };

let nextId = 1;

// ── Sagomatura economica (slice 2, R4) ──────────────────────────────────────
// La matrice confermata dalla direzione il 28/08/2026
// (docs/reports/slice-2-authz-economia-proposta.md): il registro pagamenti
// richiede `pagamento.read`, costi e costo posa `economia.read`; la sintesi
// della scheda (pattuito, incassato, piano rate) resta operativa per tutti.
// I campi non autorizzati NON partono nel payload — il confine è il server,
// la UI è solo la seconda protezione.

const CAPACITA_ECONOMICHE: readonly Capability[] = [
  "pagamento.read",
  "economia.read",
];

function capacitaEconomiche(
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">
): Promise<Set<Capability>> {
  return effectiveCapabilitySet(ctx, CAPACITA_ECONOMICHE);
}

/** C'è ancora qualcosa da incassare? Un bit, mai una cifra. */
function residuoPositivo(c: any): boolean {
  const totale = Number(c?.importoTotale ?? 0);
  if (!(totale > 0)) return false;
  return totale - Number(c?.importoIncassato ?? 0) > 0;
}

/**
 * La commessa come la può vedere questo utente. Con entrambe le capability
 * l'oggetto passa intero (identico a prima della slice 2); senza, i dettagli
 * vengono OMESSI — mai errori: la parte operativa resta usabile.
 */
function sagomaDettaglio(c: any, caps: ReadonlySet<Capability>): any {
  const vedeRegistro = caps.has("pagamento.read");
  const vedeCosti = caps.has("economia.read");
  if (vedeRegistro && vedeCosti) return c;
  const { pagamenti, costi, costoPosaStimato, ...resto } = c;
  return {
    ...resto,
    nPagamenti: Array.isArray(pagamenti) ? pagamenti.length : 0,
    ...(vedeRegistro ? { pagamenti } : {}),
    ...(vedeCosti ? { costi, costoPosaStimato } : {}),
  };
}

// Per-commessa monotonic prodotto id counter (lives in memory; ids are unique
// within a single commessa.prodotti array, which is all we need).
function nextProdottoId(commessa: any): number {
  const current: any[] = Array.isArray(commessa.prodotti) ? commessa.prodotti : [];
  return current.length ? Math.max(...current.map((p) => p.id ?? 0)) + 1 : 1;
}

const _store = persistedStore<any>("commesse", (items) => {
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
  for (const c of items) {
    // Backfill prodotti[] so the field is always an array.
    if (!Array.isArray((c as any).prodotti)) (c as any).prodotti = [];
    // Backfill assegnatoA on legacy records — falls back to createdBy if set.
    if ((c as any).assegnatoA === undefined) {
      (c as any).assegnatoA = (c as any).createdBy ?? null;
    }
    // Soft-archive flag. ISO date string (YYYY-MM-DDTHH:mm:ss.sssZ) when set.
    // Orthogonal to `stato`: archiving does NOT change stato so board position
    // and progress are preserved on restore.
    if ((c as any).archivedAt === undefined) {
      (c as any).archivedAt = null;
    }
    // Backfill sede scope → default sede (id 1) for pre-multi-sede records.
    if ((c as any).sedeId === undefined) (c as any).sedeId = 1;
    if ((c as any).ficSourceRef === undefined) (c as any).ficSourceRef = null;
    // Payment tracker fields (saldi).
    if ((c as any).importoTotale === undefined) (c as any).importoTotale = null;
    // Margine (P0.2): manual estimate of the posa cost, € — direzione-only.
    if ((c as any).costoPosaStimato === undefined) (c as any).costoPosaStimato = null;
    // Registro costi fornitore — inserito direttamente in scheda commessa.
    if (!Array.isArray((c as any).costi)) (c as any).costi = [];
    // Il costo nato da una conferma d'ordine ricorda il documento in un
    // campo, non in una stringa nelle note (03/09/2026). I costi scritti da
    // Tars prima del campo portavano «documento:<id>» nella nota.
    for (const costo of (c as any).costi) {
      if (costo.documentoId === undefined) {
        const riferimento = /documento:(\d+)/.exec(String(costo.note ?? ""));
        costo.documentoId = riferimento ? Number(riferimento[1]) : null;
      }
    }
    if ((c as any).importoIncassato === undefined) (c as any).importoIncassato = 0;
    // Acconti register — importoIncassato is derived from it. Legacy records
    // with a bare incassato figure get a single imported entry.
    if (!Array.isArray((c as any).pagamenti)) (c as any).pagamenti = [];
    if (((c as any).importoIncassato ?? 0) > 0 && (c as any).pagamenti.length === 0) {
      (c as any).pagamenti = [
        {
          id: 1,
          importo: (c as any).importoIncassato,
          data: null,
          metodo: null,
          note: "Importo importato",
          createdAt: (c as any).updatedAt ?? new Date(),
        },
      ];
    }
    (c as any).pagamenti = (c as any).pagamenti.map(normalizzaPagamentoLegacy);
    // Pulizia una tantum: la prima versione dello scollegamento stornava i
    // movimenti della fattura tolta invece di rimuoverli, e la commessa
    // restava con righe "Stornato" che raccontavano incassi mai stati suoi.
    // Il marcatore `ficStato = "scollegata"` lo scriveva solo quella
    // versione, quindi non tocca nessuno storno vero.
    (c as any).pagamenti = (c as any).pagamenti.filter(
      (p: any) =>
        !(
          p.origine === "fic" &&
          p.stato === "stornato" &&
          p.ficStato === "scollegata"
        )
    );
    ricalcolaImportoIncassato(c as any);
    // Pattuito: fonte esplicita (FiC o manuale) e piano rate. Sui record
    // storici il pattuito già presente resta, dichiarato `manuale`.
    backfillPattuito(c as any);
  }
});
const commesse = _store.items;

// Auto-generate codice: COM-YYYY-NNN (zero-padded, sequential per year)
function generaCodiceCommessa(): string {
  const year = new Date().getFullYear();
  const yearCodes = commesse
    .filter((c) => typeof c.codice === "string" && c.codice.startsWith(`COM-${year}-`))
    .map((c) => parseInt(c.codice.split("-")[2] ?? "0", 10))
    .filter((n) => !isNaN(n));
  const next = (yearCodes.length ? Math.max(...yearCodes) : 0) + 1;
  return `COM-${year}-${String(next).padStart(3, "0")}`;
}

export function getCommesseStore() {
  return commesse;
}

export function getCommessaById(id: number) {
  return commesse.find((c) => c.id === id) ?? null;
}

export function saveCommesseStore(): void {
  _store.save();
}

/**
 * Dipendenze del comando canonico. Esportate per i tool Tars: entrambi i
 * percorsi chiamano lo stesso servizio, senza passare dal contratto tRPC.
 */
export function dipendenzeTransizioniCommesse(): DipendenzeTransizioneCommessa {
  return {
    trovaCommessa: getCommessaById,
    eseguiStatoEAuditAtomico: operazione =>
      conTransazioneStoreAtomica(
        [_store, storeTransizioniCommessa],
        operazione
      ),
    haDocumentoRichiesto: statoHasRequiredDoc,
    documentiRichiesti: stato =>
      REQUIRED_DOC_TIPI_PER_STATO[stato] ?? [],
    etichettaDocumento: tipo =>
      (DOC_TIPO_LABEL as Record<string, string>)[tipo] ?? tipo,
    allineaTimeline: async (commessaId, stato, attoreNome) => {
      const { allineaTimelineAlBoard } = await import("./timeline");
      allineaTimelineAlBoard(commessaId, stato, attoreNome);
    },
  };
}

/** Crea una sola commessa per fattura FiC; ogni retry restituisce la stessa. */
export async function createCommessaFromFic(data: {
  sedeId: number;
  fatturaId: number;
  clienteId: number;
  indirizzo?: string | null;
  citta?: string | null;
  telefono?: string | null;
  email?: string | null;
  note?: string | null;
}) {
  const ficSourceRef = `fic:${data.sedeId}:${data.fatturaId}`;
  const trovaEsistente = () => commesse.find(
    c => (c.sedeId ?? DEFAULT_SEDE_ID) === data.sedeId && c.ficSourceRef === ficSourceRef
  );
  const esistente = trovaEsistente();
  if (esistente) return { commessa: esistente, creata: false };
  const cliente = getClienteById(data.clienteId);
  if (!cliente || (cliente.sedeId ?? DEFAULT_SEDE_ID) !== data.sedeId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente FiC non trovato." });
  }
  const now = new Date();
  const commessa = {
    id: nextId++, sedeId: data.sedeId, codice: generaCodiceCommessa(),
    clienteId: cliente.id,
    cliente: `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim(),
    indirizzo: data.indirizzo ?? cliente.indirizzoLavoro ?? cliente.indirizzo ?? null,
    citta: data.citta ?? cliente.cittaLavoro ?? cliente.citta ?? null,
    telefono: data.telefono ?? cliente.telefono ?? null,
    email: data.email ?? cliente.email ?? null,
    stato: "preventivo" as const, importoTotale: null, pattuitoFonte: null,
    pattuitoFicDocumentoIds: [] as number[], pattuitoAggiornatoAt: null,
    pianoRate: [] as RataCommessa[], importoIncassato: 0,
    costoPosaStimato: null, costi: [], pagamenti: [], priorita: "media" as const,
    squadraId: null, dataApertura: now.toISOString().split("T")[0],
    consegnaIndicativa: null, dataConsegnaIndicativa: null,
    dataConsegnaConfermata: null, dataChiusura: null,
    note: data.note ?? null, prodotti: [], assegnatoA: cliente.assegnatoA ?? null,
    createdBy: null, createdAt: now, updatedAt: now, ficSourceRef,
  };
  const concorrente = trovaEsistente();
  if (concorrente) return { commessa: concorrente, creata: false };
  commesse.push(commessa);
  addCommessaToCliente(cliente.id, commessa.id);
  _store.save();
  await publishAssignmentEvent({
    sedeId: commessa.sedeId, entityType: "commessa", entityId: commessa.id,
    previousAssigneeId: null, assigneeId: commessa.assegnatoA,
    actorUserId: null, updatedAt: now, link: `/commesse/${commessa.id}`,
  });
  return { commessa, creata: true };
}

// ── Pattuito e piano rate ───────────────────────────────────────────────────

/**
 * Riallinea pattuito e rate di una commessa alle fatture FiC che le sono
 * collegate. Chiamata dal sync e da ogni collegamento/scollegamento: è
 * l'unico punto in cui il pattuito diventa `fic`.
 *
 * Con zero documenti la commessa torna manuale e il piano derivato viene
 * rimosso, ma il pattuito NON viene azzerato: scollegare una fattura non è
 * un motivo per cancellare la cifra che l'operatore vede sulla scheda. Da
 * quel momento è di nuovo modificabile a mano.
 */
/**
 * L'imponibile del pattuito, anche per le commesse salvate PRIMA che il
 * campo esistesse (03/09/2026): se `pattuitoImponibile` non c'è ma le
 * fatture FiC sono collegate, si somma qui il loro importoNetto invece di
 * aspettare il prossimo sync. Senza questo, ogni commessa già a sistema
 * mostrava «manca il totale pattuito» nella card economia.
 *
 * Import dinamico: `ficFatture` importa `commesse`, un import statico
 * chiuderebbe il ciclo.
 */
export async function pattuitoImponibileDi(commessa: any): Promise<number | null> {
  if (commessa?.pattuitoImponibile != null) return commessa.pattuitoImponibile;
  const ids: number[] = commessa?.pattuitoFicDocumentoIds ?? [];
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const { ficFatture } = await import("./ficFatture");
  let totale = 0;
  let trovate = 0;
  for (const documento of ficFatture as any[]) {
    if (!ids.includes(documento.id)) continue;
    const netto = Number(documento.importoNetto);
    if (!Number.isFinite(netto)) continue;
    totale += (documento.tipo === "credit_note" ? -1 : 1) * netto;
    trovate += 1;
  }
  if (trovate === 0) return null;
  return Math.round((totale + Number.EPSILON) * 100) / 100;
}

export function applicaPattuitoDaFic(
  commessaId: number,
  documenti: readonly DocumentoFicPerPiano[]
): { cambiato: boolean; importoTotale: number | null } {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa) return { cambiato: false, importoTotale: null };

  const primaFonte = commessa.pattuitoFonte ?? null;
  const primaImporto = commessa.importoTotale ?? null;
  const primaImponibile = commessa.pattuitoImponibile ?? null;
  const primaFirma = JSON.stringify(commessa.pianoRate ?? []);
  const primaDocs = JSON.stringify(commessa.pattuitoFicDocumentoIds ?? []);

  if (documenti.length === 0) {
    commessa.pattuitoFicDocumentoIds = [];
    // Senza fattura non esiste un imponibile certo: il margine lo dichiara
    // incompleto invece di scorporare un'aliquota inventata.
    commessa.pattuitoImponibile = null;
    commessa.pattuitoFonte = commessa.importoTotale == null ? null : "manuale";
    commessa.pianoRate = (commessa.pianoRate ?? []).filter(
      (rata: RataCommessa) => rata.origine === "manuale"
    );
  } else {
    const derivato = derivaPattuitoDaFic(documenti);
    commessa.importoTotale = derivato.importoTotale;
    commessa.pattuitoImponibile = derivato.importoImponibile;
    commessa.pianoRate = derivato.rate;
    commessa.pattuitoFicDocumentoIds = derivato.documentoIds;
    commessa.pattuitoFonte = "fic";
  }

  const cambiato =
    primaFonte !== (commessa.pattuitoFonte ?? null) ||
    primaImporto !== (commessa.importoTotale ?? null) ||
    primaImponibile !== (commessa.pattuitoImponibile ?? null) ||
    primaFirma !== JSON.stringify(commessa.pianoRate ?? []) ||
    primaDocs !== JSON.stringify(commessa.pattuitoFicDocumentoIds ?? []);

  if (cambiato) {
    commessa.pattuitoAggiornatoAt = new Date();
    commessa.updatedAt = new Date();
    _store.save();
  }
  return { cambiato, importoTotale: commessa.importoTotale ?? null };
}

/**
 * Toglie il pattuito rimasto orfano quando l'ULTIMA fattura FiC viene
 * scollegata a mano.
 *
 * `applicaPattuitoDaFic` con zero documenti lascia apposta l'importo dov'e' e
 * si limita a restituire la commessa alla penna dell'operatore: e' giusto
 * quando la fattura sparisce per motivi suoi. Non lo e' quando un umano la
 * stacca perche' non c'entrava niente — li' quel numero e' la somma di un
 * lavoro altrui, e lasciarlo significa esattamente "il pattuito non si e'
 * aggiornato". Un campo vuoto che chiede l'importo e' meglio di un numero
 * che nessuno sa giustificare.
 *
 * Le rate manuali restano: non sono mai state di FiC.
 */
export function azzeraPattuitoDerivato(commessaId: number): boolean {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa) return false;
  if ((commessa.pattuitoFicDocumentoIds ?? []).length > 0) return false;
  const rate: RataCommessa[] = Array.isArray(commessa.pianoRate)
    ? commessa.pianoRate
    : [];
  const manuali = rate.filter(rata => rata.origine === "manuale");
  if (commessa.importoTotale == null && manuali.length === rate.length) {
    return false;
  }
  commessa.importoTotale = null;
  commessa.pattuitoFonte = null;
  commessa.pianoRate = manuali;
  commessa.pattuitoAggiornatoAt = new Date();
  commessa.updatedAt = new Date();
  _store.save();
  return true;
}

/** Guardia condivisa: rifiuta una scrittura manuale su un pattuito FiC. */
function assertPattuitoScrivibile(commessa: any): void {
  if (pattuitoModificabileAMano(commessa)) return;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: MOTIVO_PATTUITO_BLOCCATO,
  });
}

function prossimoIdRata(commessa: any): number {
  const rate: RataCommessa[] = Array.isArray(commessa.pianoRate)
    ? commessa.pianoRate
    : [];
  return rate.length ? Math.max(...rate.map(rata => rata.id ?? 0)) + 1 : 1;
}

function rinumeraPiano(commessa: any): void {
  const rate: RataCommessa[] = Array.isArray(commessa.pianoRate)
    ? commessa.pianoRate
    : [];
  rate.sort(
    (a, b) =>
      (a.scadenza ?? "9999-12-31").localeCompare(b.scadenza ?? "9999-12-31") ||
      a.id - b.id
  );
  rate.forEach((rata, index) => {
    rata.numero = index + 1;
  });
}

/**
 * Reconciles historical timeline progress with the board in one persisted
 * write. This is forward-only: the timeline can raise the minimum workflow
 * state, but can never pull a commessa backwards.
 */
export function advanceCommesseFromTimeline(
  targets: ReadonlyMap<number, StatoCommessa>
): number {
  const now = new Date();
  let updated = 0;

  for (const commessa of commesse) {
    const target = targets.get(commessa.id);
    if (!target) continue;
    const currentIdx = STATI_COMMESSA.indexOf(commessa.stato as StatoCommessa);
    const targetIdx = STATI_COMMESSA.indexOf(target);
    if (currentIdx < 0 || targetIdx <= currentIdx) continue;

    commessa.stato = target;
    commessa.updatedAt = now;
    if (target === "archiviata" && !commessa.dataChiusura) {
      commessa.dataChiusura = now.toISOString().split("T")[0];
    }
    updated++;
  }

  if (updated > 0) _store.save();
  return updated;
}

// Cascade archive/restore: when a cliente is (un)archived, its commesse follow.
// Returns the count of commesse touched. Used by clienti.archive/restore.
export function setCommesseArchivedByCliente(
  clienteId: number,
  archived: boolean
): number {
  const now = new Date();
  let touched = 0;
  for (const c of commesse) {
    if (c.clienteId !== clienteId) continue;
    const target = archived ? now.toISOString() : null;
    if ((c.archivedAt ?? null) === target) continue;
    // When restoring, only un-archive commesse that were archived together
    // with the cliente (heuristic: any archived one) — simplest is to clear.
    c.archivedAt = target;
    c.updatedAt = now;
    touched++;
  }
  if (touched > 0) _store.save();
  return touched;
}

// Called by clienti.update so the denormalized `cliente` display string on
// every commessa pointing at this clienteId stays in sync with the canonical
// nome/cognome on the cliente record. Also refreshes per-commessa copies of
// telefono/email/indirizzo/citta WHEN they still match the previous cliente
// value — that way commesse that explicitly overrode those fields (e.g. a
// cantiere address different from the home address) keep their override.
export function syncClienteOnCommesse(
  clienteId: number,
  updatedCliente: {
    nome?: string;
    cognome?: string;
    telefono?: string | null;
    email?: string | null;
    indirizzo?: string | null;
    citta?: string | null;
  },
  previousCliente: {
    nome?: string;
    cognome?: string;
    telefono?: string | null;
    email?: string | null;
    indirizzo?: string | null;
    citta?: string | null;
  }
): number {
  let touched = 0;
  // Display name convention is "Cognome Nome" (global, §naming).
  const prevDisplay = `${previousCliente.cognome ?? ""} ${previousCliente.nome ?? ""}`.trim();
  const newDisplay = `${
    updatedCliente.cognome ?? previousCliente.cognome ?? ""
  } ${updatedCliente.nome ?? previousCliente.nome ?? ""}`.trim();

  for (const c of commesse) {
    if (c.clienteId !== clienteId) continue;
    let changed = false;

    // Always refresh the display name — it's derived from cliente and should
    // never drift.
    if (c.cliente !== newDisplay) {
      c.cliente = newDisplay;
      changed = true;
    }

    // For per-commessa contact fields, only overwrite if the commessa still
    // carries the exact previous cliente value (i.e. user never overrode).
    // This preserves legitimate cantiere-vs-home differences.
    const maybeSync = (
      field: "telefono" | "email" | "indirizzo" | "citta"
    ) => {
      if (updatedCliente[field] === undefined) return;
      const prev = previousCliente[field] ?? null;
      const next = updatedCliente[field] ?? null;
      if ((c as any)[field] === prev && prev !== next) {
        (c as any)[field] = next;
        changed = true;
      }
    };
    maybeSync("telefono");
    maybeSync("email");
    maybeSync("indirizzo");
    maybeSync("citta");

    if (changed) {
      c.updatedAt = new Date();
      touched++;
    }

    // Suppress unused warning when nothing changed but display also unchanged.
    void prevDisplay;
  }
  if (touched > 0) _store.save();
  return touched;
}

// ── Creazione commessa ──────────────────────────────────────────────────────

export const creaCommessaInput = z.object({
  clienteId: z.number().optional(),
  cliente: z.string().optional(),
  indirizzo: z.string().optional(),
  citta: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
  importoTotale: z.number().nonnegative().nullable().optional(),
  note: z.string().optional(),
  // Indicative delivery — either a preset offset (30/60/90 days) OR a
  // free-form date picked from the calendar. The two are mutually
  // exclusive at display time but the schema accepts both for
  // backwards compatibility with already-persisted records.
  consegnaIndicativa: z.enum(["30", "60", "90"]).optional(),
  dataConsegnaIndicativa: z.string().optional(),
  assegnatoA: z.number().nullable().optional(),
  // Di cosa si tratta: tipologia + quantità, indicate già in creazione.
  prodotti: z
    .array(
      z.object({
        nome: z.string().min(1),
        quantita: z.number().int().min(1).default(1),
      })
    )
    .optional(),
});
export type CreaCommessaInput = z.infer<typeof creaCommessaInput>;

/**
 * L'unico percorso che fa nascere una commessa da una richiesta utente:
 * `commesse.create` e `clienti.createConCommessa` passano entrambi di qui,
 * così policy, scope sede, proprietario ereditato e collegamento al cliente
 * restano una regola sola.
 */
export async function creaCommessa(
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">,
  input: CreaCommessaInput
) {
  await authorizeCoreOperation({
    ctx,
    endpoint: "commesse.create",
    capability: "commessa.create",
    resourceType: "commessa",
  });
  if (input.importoTotale !== undefined) {
    await authorizeCoreOperation({
      ctx,
      endpoint: "commesse.create.economia",
      capability: "economia.read",
      resourceType: "commessa",
      resource: { sedeId: ctx.sedeId, sensitivity: "economic" },
    });
  }
  if (input.assegnatoA !== undefined && input.assegnatoA !== ctx.user?.id) {
    requireAssignableUser({
      assigneeUserId: input.assegnatoA,
      sedeId: ctx.sedeId ?? 1,
      requiredCapability: "commessa.update_operational",
    });
  }
  const now = new Date();
  const id = nextId++;
  const {
    clienteId: inputClienteId,
    cliente: clienteName,
    prodotti: inputProdotti,
    ...rest
  } = input;

  // Derive cliente display name + inherit owner from cliente if linked.
  let clienteDisplay = clienteName ?? "";
  let inheritedAssegnatoA: number | null = null;
  if (inputClienteId) {
    const c = getClienteById(inputClienteId);
    if (c) {
      assertSedeScope(c, ctx.sedeId);
      clienteDisplay = `${c.cognome} ${c.nome}`.trim();
      inheritedAssegnatoA = c.assegnatoA ?? null;
    }
  }
  // Owner resolution priority: explicit input > cliente's owner > current user.
  const assegnatoA =
    input.assegnatoA !== undefined
      ? input.assegnatoA
      : inheritedAssegnatoA ?? ctx.user?.id ?? null;

  const commessa = {
    id,
    // Stamp the active sede so the commessa belongs to the current showroom.
    sedeId: ctx.sedeId ?? 1,
    codice: generaCodiceCommessa(),
    clienteId: inputClienteId ?? null,
    cliente: clienteDisplay,
    indirizzo: rest.indirizzo ?? null,
    citta: rest.citta ?? null,
    telefono: rest.telefono ?? null,
    email: rest.email ?? null,
    stato: "preventivo" as const,
    importoTotale: input.importoTotale ?? null,
    // Una commessa nasce sempre senza fattura: il pattuito è manuale
    // finché il primo collegamento FiC non lo promuove.
    pattuitoFonte: input.importoTotale == null ? null : ("manuale" as const),
    pattuitoFicDocumentoIds: [] as number[],
    pattuitoAggiornatoAt: input.importoTotale == null ? null : now,
    pianoRate: [] as RataCommessa[],
    importoIncassato: 0,
    costoPosaStimato: null,
    costi: [],
    pagamenti: [],
    priorita: input.priorita ?? "media",
    squadraId: null,
    dataApertura: now.toISOString().split("T")[0],
    consegnaIndicativa: input.consegnaIndicativa ?? null, // "30" | "60" | "90"
    dataConsegnaIndicativa: input.dataConsegnaIndicativa ?? null, // ISO date when operator picks a calendar date instead of an offset
    dataConsegnaConfermata: null, // set when stato=produzione
    dataChiusura: null,
    note: rest.note ?? null,
    prodotti: (inputProdotti ?? []).map((p, i) => ({
      id: i + 1,
      nome: p.nome,
      tipologia: null,
      quantita: p.quantita ?? 1,
      dimensioni: null,
      note: null,
      createdAt: now,
    })) as any[],
    assegnatoA,
    createdBy: ctx.user?.id ?? null,
    createdAt: now,
    updatedAt: now,
    ficSourceRef: null,
  };
  commesse.push(commessa);
  // Link commessa back to cliente
  if (inputClienteId) {
    addCommessaToCliente(inputClienteId, id);
  }
  _store.save();
  await publishAssignmentEvent({
    sedeId: commessa.sedeId,
    entityType: "commessa",
    entityId: commessa.id,
    previousAssigneeId: null,
    assigneeId: commessa.assegnatoA,
    actorUserId: ctx.user?.id ?? null,
    updatedAt: now,
    link: `/commesse/${commessa.id}`,
  });
  return sagomaDettaglio(commessa, await capacitaEconomiche(ctx));
}

export const commesseRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        stato: z.string().optional(),
        search: z.string().optional(),
        clienteId: z.number().optional(),
        assegnatoA: z.number().optional(),
        // Archive scope:
        //   "exclude" (default) — only active commesse (archivedAt IS NULL)
        //   "only"              — only archived commesse (archivedAt IS NOT NULL)
        //   "all"               — both (used rarely, e.g. admin exports)
        archived: z.enum(["exclude", "only", "all"]).optional(),
      }).optional()
    )
    .query(async ({ input, ctx }) => {
      let result = commesse.filter((c) => c.sedeId === ctx.sedeId);
      const scope = input?.archived ?? "exclude";
      if (scope === "exclude") {
        result = result.filter((c) => !c.archivedAt);
      } else if (scope === "only") {
        result = result.filter((c) => !!c.archivedAt);
      }
      if (input?.stato) {
        result = result.filter((c) => c.stato === input.stato);
      }
      if (input?.clienteId) {
        result = result.filter((c) => c.clienteId === input.clienteId);
      }
      if (input?.assegnatoA !== undefined) {
        result = result.filter((c) => c.assegnatoA === input.assegnatoA);
      }
      // Indirizzo, telefono e mail del cantiere viaggiano già sulla commessa
      // (li copia la create dal cliente): cercarli costa niente e sono
      // proprio i dati che uno ha sottomano quando cerca la commessa —
      // il numero da cui l'hanno chiamato, la via del cantiere.
      const chiave = input?.search ? chiaveRicerca(input.search) : null;
      if (chiave) {
        result = result.filter(
          (c) =>
            testoCorrisponde(
              [c.codice, c.cliente, c.email, c.indirizzo, c.citta],
              chiave
            ) || numeroCorrisponde([c.telefono], chiave)
        );
      }
      // Strip the heavy `prodotti` array from list responses — list pages
      // never read it; only commesse.byId needs the full object.
      const caps = await capacitaEconomiche(ctx);
      const vedeCifre = caps.has("pagamento.read");
      return result
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        // prodotti/pagamenti/costi restano fuori per non appesantire la
        // lista (nessuna pagina di lista li legge), ma il CONTEGGIO degli
        // acconti serve alla pagina Pagamenti per proporre la rata
        // successiva: senza, suggeriva sempre "1° acconto".
        .map(({ prodotti, pagamenti, costi, costoPosaStimato, ...rest }) => {
          void costi;
          void costoPosaStimato;
          const base = {
            ...rest,
            nPagamenti: Array.isArray(pagamenti) ? pagamenti.length : 0,
            // Il chip «Da saldare» del Board usa SOLO questo bit: sul Board
            // non viaggiano cifre (decisione direzione 28/08/2026).
            daSaldare: residuoPositivo(rest),
            // L'anno di appartenenza lo decide il server: il filtro per anno
            // della pagina Pagamenti se lo calcolava da solo con la stessa
            // euristica scritta due volte, e due copie divergono.
            anno: annoCommessa(rest as any),
            // Sintesi delle lavorazioni per la colonna in lista: solo nome e
            // quantità, non l'intero prodotto con dimensioni e note.
            prodottiSintesi: (Array.isArray(prodotti) ? prodotti : []).map(
              (p: any) => ({ nome: p.nome, quantita: p.quantita ?? 1 })
            ),
          };
          if (vedeCifre) return base;
          const { importoTotale, importoIncassato, ...senzaCifre } = base;
          void importoTotale;
          void importoIncassato;
          return senzaCifre;
        });
    }),

  byId: protectedProcedure.input(z.number()).query(async ({ input, ctx }) => {
    const commessa = commesse.find((c) => c.id === input);
    // Cross-sede isolation: only return the commessa if it belongs to the
    // active sede. Mismatch → null (treated as "not found" by the client).
    if (!commessa || commessa.sedeId !== ctx.sedeId) return null;
    return sagomaDettaglio(commessa, await capacitaEconomiche(ctx));
  }),

  create: protectedProcedure
    .input(creaCommessaInput)
    .mutation(({ input, ctx }) => creaCommessa(ctx, input)),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        cliente: z.string().optional(),
        clienteId: z.number().nullable().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        stato: z.enum(STATI_COMMESSA).optional(),
        priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
        importoTotale: z.number().nonnegative().nullable().optional(),
        // importoIncassato NON è accettato qui: è la somma del registro
        // pagamenti[], ricalcolata da add/update/removePagamento. Accettarlo
        // permetteva di scrivere un incassato slegato dal registro (es. 99999
        // con zero acconti), rompendo residui, KPI e notifiche.
        costoPosaStimato: z.number().nonnegative().nullable().optional(),
        squadraId: z.number().nullable().optional(),
        note: z.string().optional(),
        consegnaIndicativa: z.enum(["30", "60", "90"]).nullable().optional(),
        dataConsegnaIndicativa: z.string().nullable().optional(),
        dataConsegnaConfermata: z.string().nullable().optional(),
        assegnatoA: z.number().nullable().optional(),
        // When true, skip the "required doc uploaded" gate on forward
        // transitions. Used by the client after the operator has confirmed
        // an explicit "procedi comunque" dialog. The state-machine
        // transizione check is NEVER bypassed (shape of the workflow is
        // still enforced).
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.update",
        capability: "commessa.update_operational",
        resourceType: "commessa",
        resource: commesse[idx],
      });
      if (
        input.importoTotale !== undefined ||
        input.costoPosaStimato !== undefined
      ) {
        // Il pattuito di una commessa fatturata è FiC. Il blocco vale prima
        // dell'autorizzazione di ruolo: nemmeno la direzione può scrivere una
        // cifra diversa da quella emessa.
        if (input.importoTotale !== undefined) {
          assertPattuitoScrivibile(commesse[idx]);
        }
        await authorizeCoreOperation({
          ctx,
          endpoint: "commesse.update.economia",
          capability: "economia.read",
          resourceType: "commessa",
          resource: { ...commesse[idx], sensitivity: "economic" },
          legacyAllowed:
            input.costoPosaStimato === undefined ||
            isDirezione(ctx.user) ||
            isAmministrazione(ctx.user),
        });
      }
      if (input.stato && input.stato !== commesse[idx].stato) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "commesse.changeState",
          capability: "commessa.change_state",
          resourceType: "commessa",
          resource: commesse[idx],
        });
      }
      if (input.assegnatoA !== undefined) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "commesse.assign",
          capability: "commessa.assign",
          resourceType: "commessa",
          resource: commesse[idx],
        });
        if (input.assegnatoA !== ctx.user?.id) {
          requireAssignableUser({
            assigneeUserId: input.assegnatoA,
            sedeId: ctx.sedeId ?? 1,
            requiredCapability: "commessa.update_operational",
          });
        }
      }
      const previousAssigneeId = commesse[idx].assegnatoA ?? null;
      const { id, force: _force, ...updates } = input;
      void _force;
      // If clienteId changes to a real id, resolve display name + link back to
      // that cliente's commesseIds so the relationship is kept consistent.
      let resolvedCliente = updates.cliente;
      const prevClienteId: number | null = commesse[idx].clienteId ?? null;
      let collegaClienteId: number | null = null;
      if (
        updates.clienteId !== undefined &&
        updates.clienteId !== null &&
        updates.clienteId !== prevClienteId
      ) {
        const linked = getClienteById(updates.clienteId);
        if (!linked || linked.sedeId !== ctx.sedeId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cliente non trovato." });
        }
        resolvedCliente = `${linked.cognome} ${linked.nome}`.trim();
        collegaClienteId = updates.clienteId;
      }
      // Normalize the mutually-exclusive consegna fields: writing one
      // clears the other so the persisted record can never carry both.
      if (updates.dataConsegnaIndicativa !== undefined) {
        if (updates.dataConsegnaIndicativa) {
          updates.consegnaIndicativa = null;
        }
      } else if (updates.consegnaIndicativa !== undefined && updates.consegnaIndicativa) {
        updates.dataConsegnaIndicativa = null;
      }
      const prevStato: string = commesse[idx].stato;
      if (input.stato && input.stato !== prevStato) {
        const { stato: _stato, ...patchAutorizzata } = updates;
        void _stato;
        await eseguiTransizioneCommessa(
          {
            ctx,
            commessaId: id,
            nuovoStato: input.stato,
            origine: "router",
            bypassGateDocumentale: Boolean(input.force),
            attoreNome: ctx.user?.name ?? null,
            patchAutorizzata: {
              ...patchAutorizzata,
              cliente: resolvedCliente ?? commesse[idx].cliente,
            },
          },
          dipendenzeTransizioniCommesse()
        );
      } else {
        await conTransazioneStoreAtomica(
          [_store, storeTransizioniCommessa],
          async commit => {
            const indiceCorrente = commesse.findIndex(commessa => commessa.id === id);
            if (indiceCorrente === -1) throw new Error("Commessa non trovata");
            const precedente = commesse[indiceCorrente];
            assertSedeScope(precedente, ctx.sedeId);
            const { stato: statoRichiesto, ...patchNonState } = updates;
            if (
              statoRichiesto !== undefined &&
              statoRichiesto !== precedente.stato
            ) {
              throw new Error(
                "STATO_COMMESSA_CAMBIATO: ripetere l'aggiornamento sullo stato corrente."
              );
            }
            try {
              commesse[indiceCorrente] = {
                ...precedente,
                ...patchNonState,
                cliente: resolvedCliente ?? precedente.cliente,
                updatedAt: new Date(),
              };
              await commit();
            } catch (errore) {
              commesse[indiceCorrente] = precedente;
              throw errore;
            }
          }
        );
      }
      // Gli indici cliente vengono aggiornati soltanto dopo che il comando
      // principale ha avuto successo: un gate/optimistic-lock fallito non
      // lascia relazioni laterali mutate.
      if (collegaClienteId != null) {
        addCommessaToCliente(collegaClienteId, commesse[idx].id);
        if (prevClienteId != null) {
          removeCommessaFromCliente(prevClienteId, commesse[idx].id);
        }
      }
      if (input.assegnatoA !== undefined) {
        await publishAssignmentEvent({
          sedeId: commesse[idx].sedeId,
          entityType: "commessa",
          entityId: commesse[idx].id,
          previousAssigneeId,
          assigneeId: commesse[idx].assegnatoA ?? null,
          actorUserId: ctx.user?.id ?? null,
          updatedAt: commesse[idx].updatedAt,
          link: `/commesse/${commesse[idx].id}`,
        });
      }
      return sagomaDettaglio(commesse[idx], await capacitaEconomiche(ctx));
    }),

  /**
   * Compensazione additiva per azioni Tars R1. Il client storico non la usa:
   * stato/versione e snapshot sono recuperati dall'audit server-side, mai
   * accettati dal chiamante.
   */
  undoTransizione: protectedProcedure
    .input(z.object({ transizioneId: z.number().int().positive() }).strict())
    .mutation(async ({ input, ctx }) => {
      const esito = await annullaTransizioneCommessa(
        {
          ctx,
          transizioneId: input.transizioneId,
          attoreNome: ctx.user?.name ?? null,
        },
        dipendenzeTransizioniCommesse()
      );
      const dettaglio = sagomaDettaglio(
        esito.commessa,
        await capacitaEconomiche(ctx)
      );
      return {
        ...dettaglio,
        transizioneAnnullataId: input.transizioneId,
      };
    }),

  // Dedicated endpoint for confirming delivery date when stato hits produzione
  confermaDataConsegna: protectedProcedure
    .input(z.object({ id: z.number(), dataConsegna: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      commesse[idx] = {
        ...commesse[idx],
        dataConsegnaConfermata: input.dataConsegna,
        updatedAt: new Date(),
      };
      _store.save();
      return sagomaDettaglio(commesse[idx], await capacitaEconomiche(ctx));
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.delete",
        capability: "commessa.delete",
        resourceType: "commessa",
        resource: commesse[idx],
        legacyAllowed:
          isDirezione(ctx.user) ||
          (ctx.user?.id != null &&
            (commesse[idx].createdBy === ctx.user.id ||
              commesse[idx].assegnatoA === ctx.user.id)),
      });
      // Detach the commessa id from the cliente's index so it doesn't
      // linger as a stale reference.
      const clienteId: number | null = commesse[idx].clienteId ?? null;
      const commessaId: number = commesse[idx].id;
      commesse.splice(idx, 1);
      if (clienteId != null) {
        removeCommessaFromCliente(clienteId, commessaId);
      }
      // Cascade: warehouse products belong to the commessa. Dynamic import
      // avoids a static circular dependency (magazzino imports commesse).
      const { deleteMagazzinoByCommessa } = await import("./magazzino");
      deleteMagazzinoByCommessa(commessaId);
      // Cascade: documents (JSONB metadata + storage bytes) die with the
      // commessa — otherwise they linger orphaned in the collection.
      const { deleteDocumentiByCommessa } = await import("./preventiviContratti");
      deleteDocumentiByCommessa(commessaId);
      _store.save();
      return { success: true };
    }),

  // Latest acconti across the sede — feeds the Pagamenti page "ultimi
  // incassi" strip without shipping every register in commesse.list.
  // Vista cassa: richiede `pagamento.read` in ogni policyMode (slice 2).
  pagamentiRecenti: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(15) }).optional())
    .query(async ({ input, ctx }) => {
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.pagamentiRecenti",
        capability: "pagamento.read",
        resourceType: "commessa",
        legacyAllowed: "capability",
      });
      const out: any[] = [];
      for (const c of commesse) {
        if (c.sedeId !== ctx.sedeId) continue;
        if (!Array.isArray(c.pagamenti)) continue;
        for (const p of c.pagamenti) {
          out.push({
            ...p,
            commessaId: c.id,
            codice: c.codice,
            cliente: c.cliente,
            stato: c.stato,
          });
        }
      }
      out.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
      return out.slice(0, input?.limit ?? 15);
    }),

  // ── Margine (P0.2) ─────────────────────────────────────────────────────────
  // Economia della singola commessa: direzione o amministrazione.
  margine: protectedProcedure.input(z.number()).query(async ({ input, ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    const c = commesse.find((x) => x.id === input);
    assertSedeScope(c, ctx.sedeId);
    // Ordini fornitore già registrati nel modulo Fornitori: proposti come
    // import una tantum finché il registro costi della commessa è vuoto.
    const ordiniImportabili =
      (c!.costi ?? []).length === 0
        ? getOrdiniPerMargine(input, ctx.sedeId).filter(
            (o) => o.importoTotale > 0 && o.stato !== "bozza" && o.stato !== "contestato"
          )
        : [];
    // Conferme d'ordine nel fascicolo senza un costo a registro: la scheda
    // dice perché (imponibile non dichiarato, scansione…) invece di mostrare
    // uno zero muto.
    const { confermeSenzaCostoDi } = await import("../commesse/costoDaConferma");
    return {
      ...calcolaMargine({
        ...c!,
        pattuitoImponibile: await pattuitoImponibileDi(c!),
      }),
      ordiniImportabili,
      confermeSenzaCosto: confermeSenzaCostoDi(input),
    };
  }),

  // ── Registro costi fornitore (embedded sulla commessa) ─────────────────────
  // Stesso schema del registro acconti: si scrive dalla scheda commessa, e il
  // margine è sempre ricalcolato dalla somma — nessun totale denormalizzato.
  addCosto: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      importo: z.number().positive(),
      fornitore: z.string().nullable().optional(),
      descrizione: z.string().nullable().optional(),
      data: z.string().nullable().optional(), // "YYYY-MM-DD"
      numeroOrdine: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      // Il documento del fascicolo da cui il costo è letto (Tars): la scheda
      // non lo manda mai.
      documentoId: z.number().int().positive().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const c = commesse.find((x) => x.id === input.commessaId);
      assertSedeScope(c, ctx.sedeId);
      if (!Array.isArray(c!.costi)) c!.costi = [];
      const nextCid = c!.costi.length
        ? Math.max(...c!.costi.map((x: any) => x.id ?? 0)) + 1
        : 1;
      c!.costi.push({
        id: nextCid,
        importo: input.importo,
        fornitore: input.fornitore?.trim() || null,
        descrizione: input.descrizione?.trim() || null,
        data: input.data || null,
        numeroOrdine: input.numeroOrdine?.trim() || null,
        note: input.note?.trim() || null,
        documentoId: input.documentoId ?? null,
        createdAt: new Date(),
      });
      c!.updatedAt = new Date();
      _store.save();
      return c;
    }),

  updateCosto: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      costoId: z.number(),
      importo: z.number().positive().optional(),
      fornitore: z.string().nullable().optional(),
      descrizione: z.string().nullable().optional(),
      data: z.string().nullable().optional(),
      numeroOrdine: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const c = commesse.find((x) => x.id === input.commessaId);
      assertSedeScope(c, ctx.sedeId);
      const co = (c!.costi ?? []).find((x: any) => x.id === input.costoId);
      if (!co) throw new Error("Costo non trovato");
      if (input.importo !== undefined) co.importo = input.importo;
      if (input.fornitore !== undefined) co.fornitore = input.fornitore?.trim() || null;
      if (input.descrizione !== undefined) co.descrizione = input.descrizione?.trim() || null;
      if (input.data !== undefined) co.data = input.data || null;
      if (input.numeroOrdine !== undefined) co.numeroOrdine = input.numeroOrdine?.trim() || null;
      if (input.note !== undefined) co.note = input.note?.trim() || null;
      c!.updatedAt = new Date();
      _store.save();
      return c;
    }),

  removeCosto: protectedProcedure
    .input(z.object({ commessaId: z.number(), costoId: z.number() }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const c = commesse.find((x) => x.id === input.commessaId);
      assertSedeScope(c, ctx.sedeId);
      if (!Array.isArray(c!.costi)) c!.costi = [];
      const ci = c!.costi.findIndex((x: any) => x.id === input.costoId);
      if (ci === -1) throw new Error("Costo non trovato");
      c!.costi.splice(ci, 1);
      c!.updatedAt = new Date();
      _store.save();
      return c;
    }),

  // Import una tantum degli ordini fornitore già registrati nel modulo
  // Fornitori, per non riscrivere a mano quanto è già a sistema.
  importaCostiDaOrdini: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const c = commesse.find((x) => x.id === input);
      assertSedeScope(c, ctx.sedeId);
      if (!Array.isArray(c!.costi)) c!.costi = [];
      const ordini = getOrdiniPerMargine(input, ctx.sedeId).filter(
        (o) => o.importoTotale > 0 && o.stato !== "bozza" && o.stato !== "contestato"
      );
      let nextCid = c!.costi.length
        ? Math.max(...c!.costi.map((x: any) => x.id ?? 0)) + 1
        : 1;
      let importati = 0;
      for (const o of ordini) {
        // Idempotente: salta gli ordini già importati (stesso numero).
        if (c!.costi.some((x: any) => x.numeroOrdine === o.codiceOrdine)) continue;
        c!.costi.push({
          id: nextCid++,
          importo: o.importoTotale,
          fornitore: o.fornitoreNome,
          descrizione: "Ordine fornitore",
          data: null,
          numeroOrdine: o.codiceOrdine,
          note: null,
          documentoId: null,
          createdAt: new Date(),
        });
        importati++;
      }
      c!.updatedAt = new Date();
      _store.save();
      return { importati };
    }),

  // Vista aggregata per la pagina /marginalita: solo direzione. Esclude le
  // commesse archiviate (stato o soft-archive) — sono storia, non gestione.
  marginalita: protectedProcedure.query(async ({ ctx }) => {
    requireDirezione(ctx.user);
    const utenti = getUtentiStore() as any[];
    const mie = commesse.filter(
      (c) =>
        c.sedeId === ctx.sedeId && c.stato !== "archiviata" && !c.archivedAt
    );
    // Una sola lettura dello store FiC per tutte le righe.
    const imponibili = new Map<number, number | null>();
    for (const c of mie) {
      imponibili.set(c.id, await pattuitoImponibileDi(c));
    }
    return mie
      .map((c) => {
        const assegnatario = utenti.find((u) => u.id === c.assegnatoA);
        return {
          id: c.id,
          codice: c.codice,
          cliente: c.cliente,
          stato: c.stato,
          dataApertura: c.dataApertura ?? null,
          assegnatoA: c.assegnatoA ?? null,
          assegnatoNome: assegnatario
            ? `${assegnatario.cognome ?? ""} ${assegnatario.nome ?? ""}`.trim()
            : null,
          ...calcolaMargine({
            ...c,
            pattuitoImponibile: imponibili.get(c.id) ?? null,
          }),
        };
      });
  }),

  // ── Acconti / pagamenti (embedded register on commessa) ────────────────────
  // importoIncassato is always recomputed as the sum of the register so the
  // board chips, dashboard items and notifications stay consistent.
  /**
   * Reset di pattuito, piano rate e pagamenti manuali — direzione soltanto.
   *
   * Esiste come endpoint e non solo come script perche' `persistedStore` e' un
   * array in memoria: uno script esterno scrive sul DB, ma il processo vivo
   * conserva la copia vecchia e la riscrive al primo `save()` — il sync FiC
   * gira da solo ogni 6 ore, quindi la sovrascrittura e' certa, non probabile.
   * Qui la mutazione avviene sullo stesso array che il server tiene, quindi
   * regge.
   *
   * DISTRUTTIVO: i pagamenti `origine="manuale"` vengono eliminati, non
   * stornati. Il ripristino passa dal backup Drive, e senza un backup riuscito
   * nelle ultime 24 ore l'apply viene rifiutato.
   */
  resetPattuiti: protectedProcedure
    .input(
      z.object({
        apply: z.boolean().default(false),
        includiArchiviate: z.boolean().default(false),
        skipBackupCheck: z.boolean().default(false),
        soloSedeAttiva: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireDirezione(ctx.user);
      const { resetPattuiti } = await import("../_core/resetPattuiti");
      return resetPattuiti(
        {
          apply: input.apply,
          includiArchiviate: input.includiArchiviate,
          skipBackupCheck: input.skipBackupCheck,
          sedeId: input.soloSedeAttiva ? (ctx.sedeId ?? 1) : null,
        },
        {
          commesse,
          save: () => _store.save(),
          ricalcolaImportoIncassato,
        }
      );
    }),

  // ── Piano rate ────────────────────────────────────────────────────────────
  // Le rate di una commessa fatturata arrivano da FiC e sono di sola lettura.
  // Queste tre mutation esistono per il caso opposto: nessuna fattura ancora
  // emessa, e l'operatore che concorda il pagamento a rate col cliente.

  pattuito: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const c = commesse.find(x => x.id === input);
    if (!c) throw new Error("Commessa non trovata");
    assertSedeScope(c, ctx.sedeId);
    const rate: RataCommessa[] = Array.isArray((c as any).pianoRate)
      ? (c as any).pianoRate
      : [];
    return {
      importoTotale: (c as any).importoTotale ?? null,
      fonte: ((c as any).pattuitoFonte ?? null) as "fic" | "manuale" | null,
      modificabile: pattuitoModificabileAMano(c as any),
      motivoBlocco: pattuitoModificabileAMano(c as any)
        ? null
        : MOTIVO_PATTUITO_BLOCCATO,
      ficDocumentoIds: ((c as any).pattuitoFicDocumentoIds ?? []) as number[],
      aggiornatoAt: (c as any).pattuitoAggiornatoAt ?? null,
      rate,
    };
  }),

  addRata: protectedProcedure
    .input(
      z.object({
        commessaId: z.number(),
        importo: z.number().positive(),
        scadenza: z.string().nullable().optional(),
        descrizione: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const c = commesse.find(x => x.id === input.commessaId);
      if (!c) throw new Error("Commessa non trovata");
      assertSedeScope(c, ctx.sedeId);
      assertPattuitoScrivibile(c);
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.addRata",
        capability: "economia.read",
        resourceType: "commessa",
        resource: { ...(c as any), sensitivity: "economic" },
      });
      if (!Array.isArray((c as any).pianoRate)) (c as any).pianoRate = [];
      const now = new Date();
      (c as any).pianoRate.push({
        id: prossimoIdRata(c),
        numero: (c as any).pianoRate.length + 1,
        importo: input.importo,
        scadenza: input.scadenza ?? null,
        descrizione: input.descrizione?.trim() || null,
        origine: "manuale" as const,
        ficDocumentoId: null,
        ficRataId: null,
        ficSourceKey: null,
        stato: "attesa" as const,
        dataPagamento: null,
        createdAt: now,
        updatedAt: null,
      });
      rinumeraPiano(c);
      (c as any).pattuitoAggiornatoAt = now;
      (c as any).updatedAt = now;
      _store.save();
      return (c as any).pianoRate as RataCommessa[];
    }),

  updateRata: protectedProcedure
    .input(
      z.object({
        commessaId: z.number(),
        rataId: z.number(),
        importo: z.number().positive().optional(),
        scadenza: z.string().nullable().optional(),
        descrizione: z.string().max(200).nullable().optional(),
        stato: z.enum(["attesa", "pagata", "stornata"]).optional(),
        dataPagamento: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const c = commesse.find(x => x.id === input.commessaId);
      if (!c) throw new Error("Commessa non trovata");
      assertSedeScope(c, ctx.sedeId);
      assertPattuitoScrivibile(c);
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.updateRata",
        capability: "economia.read",
        resourceType: "commessa",
        resource: { ...(c as any), sensitivity: "economic" },
      });
      const rata = ((c as any).pianoRate ?? []).find(
        (r: RataCommessa) => r.id === input.rataId
      );
      if (!rata) throw new Error("Rata non trovata");
      if (input.importo !== undefined) rata.importo = input.importo;
      if (input.scadenza !== undefined) rata.scadenza = input.scadenza;
      if (input.descrizione !== undefined) {
        rata.descrizione = input.descrizione?.trim() || null;
      }
      if (input.stato !== undefined) rata.stato = input.stato;
      if (input.dataPagamento !== undefined) {
        rata.dataPagamento = input.dataPagamento;
      }
      rata.updatedAt = new Date();
      rinumeraPiano(c);
      (c as any).pattuitoAggiornatoAt = new Date();
      (c as any).updatedAt = new Date();
      _store.save();
      return (c as any).pianoRate as RataCommessa[];
    }),

  removeRata: protectedProcedure
    .input(z.object({ commessaId: z.number(), rataId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const c = commesse.find(x => x.id === input.commessaId);
      if (!c) throw new Error("Commessa non trovata");
      assertSedeScope(c, ctx.sedeId);
      assertPattuitoScrivibile(c);
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.removeRata",
        capability: "economia.read",
        resourceType: "commessa",
        resource: { ...(c as any), sensitivity: "economic" },
      });
      const rate: RataCommessa[] = (c as any).pianoRate ?? [];
      const idx = rate.findIndex(r => r.id === input.rataId);
      if (idx === -1) throw new Error("Rata non trovata");
      rate.splice(idx, 1);
      rinumeraPiano(c);
      (c as any).pattuitoAggiornatoAt = new Date();
      (c as any).updatedAt = new Date();
      _store.save();
      return rate;
    }),

  addPagamento: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      importo: z.number().positive(),
      data: z.string().nullable().optional(), // "YYYY-MM-DD"
      metodo: z.enum(["bonifico", "contanti", "assegno", "pos", "finanziamento", "altro"]).nullable().optional(),
      // Che rata è: 1°–5° acconto oppure saldo finale.
      tipo: z.enum(["acconto_1", "acconto_2", "acconto_3", "acconto_4", "acconto_5", "saldo"]).nullable().optional(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      // Scrivere denaro richiede `pagamento.record` in ogni policyMode:
      // amministrazione/direzione dal ruolo, gli altri solo con un override
      // individuale con audit (slice 2, decisione 3).
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.addPagamento",
        capability: "pagamento.record",
        resourceType: "commessa",
        resource: { sedeId: commesse[idx].sedeId, sensitivity: "economic" },
        legacyAllowed: "capability",
      });
      const c = commesse[idx];
      if (!Array.isArray(c.pagamenti)) c.pagamenti = [];
      const nextPid = c.pagamenti.length
        ? Math.max(...c.pagamenti.map((p: any) => p.id ?? 0)) + 1
        : 1;
      c.pagamenti.push({
        id: nextPid,
        importo: input.importo,
        data: input.data ?? null,
        metodo: input.metodo ?? null,
        tipo: input.tipo ?? null,
        note: input.note?.trim() || null,
        origine: "manuale",
        stato: "attivo",
        ficDocumentoId: null,
        ficRataId: null,
        ficSourceKey: null,
        ficStato: null,
        ficUltimoSyncAt: null,
        stornatoAt: null,
        createdAt: new Date(),
        updatedAt: null,
      });
      ricalcolaImportoIncassato(c);
      c.updatedAt = new Date();
      _store.save();
      // Chi ha solo l'override `record` non possiede `read`: la risposta
      // torna sagomata come qualsiasi lettura.
      return sagomaDettaglio(c, await capacitaEconomiche(ctx));
    }),

  updatePagamento: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      pagamentoId: z.number(),
      importo: z.number().positive().optional(),
      data: z.string().nullable().optional(),
      metodo: z.enum(["bonifico", "contanti", "assegno", "pos", "finanziamento", "altro"]).nullable().optional(),
      tipo: z.enum(["acconto_1", "acconto_2", "acconto_3", "acconto_4", "acconto_5", "saldo"]).nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.updatePagamento",
        capability: "pagamento.record",
        resourceType: "commessa",
        resource: { sedeId: commesse[idx].sedeId, sensitivity: "economic" },
        legacyAllowed: "capability",
      });
      const c = commesse[idx];
      const p = (c.pagamenti ?? []).find((x: any) => x.id === input.pagamentoId);
      if (!p) throw new Error("Acconto non trovato");
      if (p.origine === "fic") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Il pagamento proviene da Fatture in Cloud e viene aggiornato dalla sincronizzazione.",
        });
      }
      if (input.importo !== undefined) p.importo = input.importo;
      if (input.data !== undefined) p.data = input.data || null;
      if (input.metodo !== undefined) p.metodo = input.metodo ?? null;
      if (input.tipo !== undefined) p.tipo = input.tipo ?? null;
      if (input.note !== undefined) p.note = input.note?.trim() || null;
      p.updatedAt = new Date();
      ricalcolaImportoIncassato(c);
      c.updatedAt = new Date();
      _store.save();
      // Chi ha solo l'override `record` non possiede `read`: la risposta
      // torna sagomata come qualsiasi lettura.
      return sagomaDettaglio(c, await capacitaEconomiche(ctx));
    }),

  correggiPagamento: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      pagamentoId: z.number(),
      ficDocumentoId: z.number(),
      ficSourceKey: z.string().min(1),
      expectedFingerprint: z.string().min(1),
      soloNeutralizzazione: z.boolean().optional(),
      patch: z.object({
        importo: z.number().positive().optional(),
        data: z.string().nullable().optional(),
        metodo: z.enum(["bonifico", "contanti", "assegno", "pos", "finanziamento", "altro"]).nullable().optional(),
        tipo: z.enum(["acconto_1", "acconto_2", "acconto_3", "acconto_4", "acconto_5", "saldo"]).nullable().optional(),
        note: z.string().nullable().optional(),
        stato: z.literal("stornato").optional(),
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata" });
      }
      assertSedeScope(commesse[idx], ctx.sedeId);
      // Stessa capability delle altre scritture sul registro: il perimetro
      // di ruolo resta amministrazione/direzione, l'override individuale
      // può estenderlo con audit (slice 2).
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.correggiPagamento",
        capability: "pagamento.record",
        resourceType: "commessa",
        resource: { sedeId: commesse[idx].sedeId, sensitivity: "economic" },
        legacyAllowed: "capability",
      });
      const commessa = commesse[idx];
      const pagamento = (commessa.pagamenti ?? []).find(
        (item: any) => item.id === input.pagamentoId
      );
      if (!pagamento) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Pagamento non trovato" });
      }
      const normalized = normalizzaPagamentoLegacy(pagamento);
      if (normalized.origine !== "manuale") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "La correzione approvabile riguarda soltanto pagamenti manuali.",
        });
      }
      if (fingerprintPagamento(normalized) !== input.expectedFingerprint) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Il pagamento e cambiato dopo la proposta. Riesegui la sincronizzazione FiC.",
        });
      }

      const {
        confermaRiconciliazioneManuale,
        correzionePagamentoFicValida,
        esisteLinkManualeSuperato,
        trovaConflittoRiconciliazioneManuale,
      } = await import("./ficPagamenti");
      const reconciliationConflict = trovaConflittoRiconciliazioneManuale({
        sedeId: ctx.sedeId ?? 1,
        ficDocumentoId: input.ficDocumentoId,
        ficSourceKey: input.ficSourceKey,
        commessaId: input.commessaId,
        pagamentoId: input.pagamentoId,
      });
      if (input.soloNeutralizzazione) {
        const storicoDuplicato = esisteLinkManualeSuperato({
          sedeId: ctx.sedeId ?? 1,
          ficDocumentoId: input.ficDocumentoId,
          ficSourceKey: input.ficSourceKey,
          commessaId: input.commessaId,
          pagamentoId: input.pagamentoId,
        });
        const canonicalSourceStillElsewhere =
          reconciliationConflict?.ficDocumentoId === input.ficDocumentoId &&
          reconciliationConflict.ficSourceKey === input.ficSourceKey &&
          (reconciliationConflict.commessaId !== input.commessaId ||
            reconciliationConflict.pagamentoId !== input.pagamentoId ||
            reconciliationConflict.target !== "manuale");
        if (
          !canonicalSourceStillElsewhere ||
          !storicoDuplicato ||
          input.patch.stato !== "stornato" ||
          Object.keys(input.patch).length !== 1
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Il doppione non e piu neutralizzabile. Riesegui la sincronizzazione FiC.",
          });
        }
      } else if (reconciliationConflict) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "La rata FiC e gia riconciliata con un altro pagamento. Riesegui la sincronizzazione FiC.",
        });
      }
      if (
        !input.soloNeutralizzazione &&
        !correzionePagamentoFicValida({
          sedeId: ctx.sedeId ?? 1,
          ficDocumentoId: input.ficDocumentoId,
          ficSourceKey: input.ficSourceKey,
          commessaId: input.commessaId,
          pagamento: normalized,
          patch: input.patch,
        })
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "La rata FiC e cambiata dopo la proposta. Riesegui la sincronizzazione FiC.",
        });
      }

      if (input.patch.importo !== undefined) pagamento.importo = input.patch.importo;
      if (input.patch.data !== undefined) pagamento.data = input.patch.data;
      if (input.patch.metodo !== undefined) pagamento.metodo = input.patch.metodo;
      if (input.patch.tipo !== undefined) pagamento.tipo = input.patch.tipo;
      if (input.patch.note !== undefined) {
        pagamento.note = input.patch.note?.trim() || null;
      }
      if (input.patch.stato === "stornato") {
        pagamento.stato = "stornato";
        pagamento.stornatoAt = new Date();
      }
      pagamento.updatedAt = new Date();
      ricalcolaImportoIncassato(commessa);
      commessa.updatedAt = new Date();
      _store.save();

      if (!input.soloNeutralizzazione) {
        confermaRiconciliazioneManuale({
          sedeId: ctx.sedeId ?? 1,
          ficDocumentoId: input.ficDocumentoId,
          ficSourceKey: input.ficSourceKey,
          commessaId: input.commessaId,
          pagamentoId: input.pagamentoId,
        });
      }
      return sagomaDettaglio(commessa, await capacitaEconomiche(ctx));
    }),

  removePagamento: protectedProcedure
    .input(z.object({ commessaId: z.number(), pagamentoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "commesse.removePagamento",
        capability: "pagamento.record",
        resourceType: "commessa",
        resource: { sedeId: commesse[idx].sedeId, sensitivity: "economic" },
        legacyAllowed: "capability",
      });
      const c = commesse[idx];
      if (!Array.isArray(c.pagamenti)) c.pagamenti = [];
      const pi = c.pagamenti.findIndex((p: any) => p.id === input.pagamentoId);
      if (pi === -1) throw new Error("Acconto non trovato");
      if (c.pagamenti[pi].origine === "fic") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Il pagamento proviene da Fatture in Cloud e viene aggiornato dalla sincronizzazione.",
        });
      }
      c.pagamenti.splice(pi, 1);
      ricalcolaImportoIncassato(c);
      c.updatedAt = new Date();
      _store.save();
      // Chi ha solo l'override `record` non possiede `read`: la risposta
      // torna sagomata come qualsiasi lettura.
      return sagomaDettaglio(c, await capacitaEconomiche(ctx));
    }),

  // ── Prodotti desiderati (embedded list on commessa) ────────────────────────
  addProdotto: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      nome: z.string().min(1),
      tipologia: z.string().optional(),
      quantita: z.number().int().min(1).default(1),
      dimensioni: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      if (!Array.isArray(commesse[idx].prodotti)) commesse[idx].prodotti = [];
      const prodotto = {
        id: nextProdottoId(commesse[idx]),
        nome: input.nome,
        tipologia: input.tipologia ?? null,
        quantita: input.quantita ?? 1,
        dimensioni: input.dimensioni ?? null,
        note: input.note ?? null,
        createdAt: new Date(),
      };
      commesse[idx].prodotti.push(prodotto);
      commesse[idx].updatedAt = new Date();
      _store.save();
      return prodotto;
    }),

  updateProdotto: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      prodottoId: z.number(),
      nome: z.string().optional(),
      tipologia: z.string().nullable().optional(),
      quantita: z.number().int().min(1).optional(),
      dimensioni: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const prodotti: any[] = commesse[idx].prodotti ?? [];
      const pIdx = prodotti.findIndex((p) => p.id === input.prodottoId);
      if (pIdx === -1) throw new Error("Prodotto non trovato");
      const { commessaId, prodottoId, ...updates } = input;
      prodotti[pIdx] = { ...prodotti[pIdx], ...updates };
      commesse[idx].updatedAt = new Date();
      _store.save();
      return prodotti[pIdx];
    }),

  removeProdotto: protectedProcedure
    .input(z.object({ commessaId: z.number(), prodottoId: z.number() }))
    .mutation(({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const prodotti: any[] = commesse[idx].prodotti ?? [];
      const pIdx = prodotti.findIndex((p) => p.id === input.prodottoId);
      if (pIdx === -1) throw new Error("Prodotto non trovato");
      prodotti.splice(pIdx, 1);
      commesse[idx].updatedAt = new Date();
      _store.save();
      return { success: true };
    }),

  stats: protectedProcedure.query(({ ctx }) => {
    // Archived commesse (soft-archive) are excluded from every aggregation so
    // dashboard counters don't pollute with jobs the client declined.
    // Also scoped to the active sede.
    const active = commesse.filter(
      (c) => !c.archivedAt && c.sedeId === ctx.sedeId
    );
    const total = active.length;
    const preventivi = active.filter((c) => c.stato === "preventivo").length;
    const inCorso = active.filter((c) =>
      !["preventivo", "finiture_saldo", "interventi_regolazioni", "archiviata"].includes(c.stato)
    ).length;
    const chiuse = active.filter((c) => ["finiture_saldo", "interventi_regolazioni", "archiviata"].includes(c.stato)).length;
    const urgenti = active.filter(
      (c) => c.priorita === "urgente" && c.stato !== "archiviata"
    ).length;
    return { total, preventivi, inCorso, chiuse, urgenti };
  }),

  // Aggregated by priority for dashboard card
  byPriorita: protectedProcedure.query(async ({ ctx }) => {
    const caps = await capacitaEconomiche(ctx);
    const vedeCifre = caps.has("pagamento.read");
    const grezzi: Record<string, any[]> = { urgente: [], alta: [], media: [], bassa: [] };
    for (const c of commesse) {
      if (c.sedeId !== ctx.sedeId) continue;
      if (c.archivedAt) continue;
      if (c.stato === "archiviata") continue;
      if (!grezzi[c.priorita]) continue;
      grezzi[c.priorita].push(c);
    }
    // Elenco esplicito, non "tutto meno qualcosa". Il pannello della
    // Dashboard disegna quattro campi per riga: spedire la commessa intera
    // costava un megabyte a ogni giro di aggiornamento (uno ogni trenta
    // secondi), da leggere e ricostruire sul client per mostrarne quattro.
    // Un elenco esplicito tiene anche fuori i campi che verranno aggiunti
    // domani alla commessa, che qui non servirebbero comunque.
    //
    // Le cifre viaggiano solo con `pagamento.read`; per gli altri resta il
    // bit `daSaldare`, che non è un importo (slice 2). Registro, costi e
    // prodotti non escono da qui per nessuno.
    const buckets: Record<string, any[]> = {};
    for (const [priorita, righe] of Object.entries(grezzi)) {
      buckets[priorita] = righe
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(c => ({
          id: c.id,
          codice: c.codice,
          cliente: c.cliente,
          stato: c.stato,
          priorita: c.priorita,
          daSaldare: residuoPositivo(c),
          ...(vedeCifre
            ? {
                importoTotale: c.importoTotale,
                importoIncassato: c.importoIncassato,
              }
            : {}),
        }));
    }
    return buckets;
  }),

  // ── Classifica venditori ──────────────────────────────────────────────────
  // Leaderboard of "commerciale" users ranked by number of ACTIVE commesse
  // they own (assegnatoA). "Active" here = stato from "misure_esecutive"
  // onwards (preventivo excluded — not yet a real job) up to and including
  // "interventi_regolazioni"; "archiviata" stato and soft-archived commesse
  // are excluded.

  // ── Soft archive ──────────────────────────────────────────────────────────
  // Sets `archivedAt` to now. The commessa keeps its stato, prodotti,
  // documenti, aperture, interventi — nothing is destroyed. Restore just
  // clears the flag. Safe to re-archive after restore.
  archive: protectedProcedure
    .input(z.number())
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const caps = await capacitaEconomiche(ctx);
      // Archive is the safe, reversible path — open to anyone in the sede.
      if (commesse[idx].archivedAt) return sagomaDettaglio(commesse[idx], caps);
      commesse[idx] = {
        ...commesse[idx],
        archivedAt: new Date().toISOString(),
        updatedAt: new Date(),
      };
      _store.save();
      return sagomaDettaglio(commesse[idx], caps);
    }),

  restore: protectedProcedure
    .input(z.number())
    .mutation(async ({ input, ctx }) => {
      const idx = commesse.findIndex((c) => c.id === input);
      if (idx === -1) throw new Error("Commessa non trovata");
      assertSedeScope(commesse[idx], ctx.sedeId);
      const caps = await capacitaEconomiche(ctx);
      if (!commesse[idx].archivedAt) return sagomaDettaglio(commesse[idx], caps);
      commesse[idx] = {
        ...commesse[idx],
        archivedAt: null,
        updatedAt: new Date(),
      };
      _store.save();
      return sagomaDettaglio(commesse[idx], caps);
    }),
});
