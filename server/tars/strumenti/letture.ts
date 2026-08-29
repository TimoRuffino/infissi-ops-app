// Strumenti L0 di Tars (T1): letture mirate, sede-scoped, sagomate sulle
// capability del principal. Ogni strumento riusa i servizi ESISTENTI del
// CRM (mai query nuove parallele) e restituisce EsitoLettura: dati,
// evidenze, freschezza, fonte autorevole, omissioni dichiarate.
//
// Regola economica (slice 2 + revisione v5.10): senza `economia.read` /
// `pagamento.read` gli importi NON partono — nemmeno come uguaglianze o
// segnali derivati — e l'omissione viene dichiarata. `daSaldare` è il
// booleano operativo sanzionato, visibile a tutti come nel Board.

import { z } from "zod";
import { getCommessaById, getCommesseStore, STATI_COMMESSA } from "../../routers/commesse";
import {
  REQUIRED_DOC_TIPI_PER_STATO,
  statoHasRequiredDoc,
} from "../../routers/preventiviContratti";
import { getOrdiniFornitoreDiSede, getOrdineFornitoreInSede } from "../../routers/fornitori";
import { analisiPerOrdine } from "../../documenti/analisi";
import { getActionCaseRepository } from "../../actionCenter/repository";
import { listActionCases } from "../../actionCenter/service";
import { getReminderService } from "../../reminders/service";
import { versioneRegistroPagamenti } from "../../_core/commessaPayments";
import type {
  ContestoRun,
  EsitoLettura,
  EvidenzaTars,
  StrumentoTars,
} from "./tipi";

const FONTE_CRM = "CRM Ruffino Flow (memoria viva; senza DATABASE_URL i dati locali sono volatili)";

function lettura<T>(input: {
  dati: T;
  evidenze?: EvidenzaTars[];
  omissioni?: string[];
  versioniEntita?: Record<string, string>;
  fonte?: string;
}): EsitoLettura<T> {
  return {
    dati: input.dati,
    evidenze: input.evidenze ?? [],
    freschezza: new Date().toISOString(),
    fonteAutorevole: input.fonte ?? FONTE_CRM,
    omissioni: input.omissioni ?? [],
    versioniEntita: input.versioniEntita ?? {},
  };
}

function conEconomia(contesto: ContestoRun): boolean {
  return (
    contesto.capability.has("economia.read") ||
    contesto.capability.has("pagamento.read")
  );
}

function versione(valore: unknown): string {
  const data = valore instanceof Date ? valore : new Date(String(valore ?? 0));
  return Number.isNaN(data.getTime()) ? "-" : String(data.getTime());
}

// ── cerca_commesse ───────────────────────────────────────────────────────

const cercaCommesse: StrumentoTars = {
  nome: "cerca_commesse",
  versione: "1.0.0",
  categoria: "commesse",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  descrizione:
    "Cerca le commesse della sede per testo (codice o cliente) e/o stato. Restituisce righe operative senza importi.",
  schemaInput: z
    .object({
      testo: z.string().max(80).optional(),
      stato: z.enum(STATI_COMMESSA).optional(),
      limite: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  async esegui(contesto, input) {
    const filtro = (input.testo ?? "").trim().toLowerCase();
    const righe = (getCommesseStore() as any[])
      .filter(c => c.sedeId === contesto.sedeId)
      .filter(c => !input.stato || c.stato === input.stato)
      .filter(
        c =>
          !filtro ||
          String(c.codice ?? "").toLowerCase().includes(filtro) ||
          String(c.cliente ?? "").toLowerCase().includes(filtro)
      )
      .slice(0, input.limite)
      .map(c => ({
        id: c.id,
        codice: c.codice,
        cliente: c.cliente,
        stato: c.stato,
        priorita: c.priorita ?? "media",
        assegnatoA: c.assegnatoA ?? null,
        dataConsegnaConfermata: c.dataConsegnaConfermata ?? null,
        daSaldare:
          (c.importoTotale ?? 0) > 0 &&
          (c.importoTotale ?? 0) - (c.importoIncassato ?? 0) > 0,
      }));
    return lettura({
      dati: { commesse: righe, totaleTrovate: righe.length },
      evidenze: righe.map(r => ({
        tipo: "entita" as const,
        riferimento: `commessa:${r.id}`,
        descrizione: `${r.codice} — ${r.cliente}`,
      })),
      omissioni: conEconomia(contesto)
        ? []
        : ["importi (richiedono capability economiche)"],
    });
  },
};

// ── leggi_commessa ───────────────────────────────────────────────────────

const leggiCommessa: StrumentoTars = {
  nome: "leggi_commessa",
  versione: "1.0.0",
  categoria: "commesse",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  descrizione:
    "Il fascicolo operativo di una commessa: stato, gate documentale, transizioni adiacenti, ordini fornitori collegati. Importi solo con capability economiche.",
  schemaInput: z.object({ commessaId: z.number().int().positive() }).strict(),
  async esegui(contesto, input) {
    const c: any = getCommessaById(input.commessaId);
    if (!c || c.sedeId !== contesto.sedeId) {
      throw new Error("NOT_FOUND: commessa non trovata.");
    }
    const indice = STATI_COMMESSA.indexOf(c.stato);
    const successivo = STATI_COMMESSA[indice + 1] ?? null;
    const precedente = indice > 0 ? STATI_COMMESSA[indice - 1] : null;
    const docRichiesti = REQUIRED_DOC_TIPI_PER_STATO[c.stato] ?? [];
    const gateSoddisfatto = statoHasRequiredDoc(c.id, c.stato);
    const ordini = getOrdiniFornitoreDiSede(contesto.sedeId)
      .filter(o => o.ordine.commessaId === c.id)
      .map(o => ({
        id: o.ordine.id,
        codiceOrdine: o.ordine.codiceOrdine,
        fornitoreNome: o.fornitoreNome,
        stato: o.ordine.stato,
        dataConsegnaPrevista: o.ordine.dataConsegnaPrevista ?? null,
      }));

    const economia = conEconomia(contesto)
      ? {
          importoTotale: c.importoTotale ?? null,
          importoIncassato: c.importoIncassato ?? 0,
          residuo:
            c.importoTotale != null
              ? Math.round((c.importoTotale - (c.importoIncassato ?? 0)) * 100) /
                100
              : null,
        }
      : null;

    return lettura({
      dati: {
        id: c.id,
        codice: c.codice,
        cliente: c.cliente,
        stato: c.stato,
        priorita: c.priorita ?? "media",
        assegnatoA: c.assegnatoA ?? null,
        dataConsegnaConfermata: c.dataConsegnaConfermata ?? null,
        daSaldare:
          (c.importoTotale ?? 0) > 0 &&
          (c.importoTotale ?? 0) - (c.importoIncassato ?? 0) > 0,
        gate: {
          documentiRichiestiPerStato: docRichiesti,
          soddisfatto: gateSoddisfatto,
        },
        transizioniAdiacenti: {
          precedente,
          successivo,
          nota: "Le transizioni sono decise SOLO dal servizio deterministico delle commesse: qui si legge, non si cambia stato.",
        },
        ordiniFornitore: ordini,
        economia,
      },
      evidenze: [
        {
          tipo: "entita",
          riferimento: `commessa:${c.id}`,
          descrizione: `${c.codice} — ${c.cliente} (${c.stato})`,
        },
        ...ordini.map(o => ({
          tipo: "entita" as const,
          riferimento: `ordine:${o.id}`,
          descrizione: `${o.codiceOrdine} — ${o.fornitoreNome ?? "?"}`,
        })),
      ],
      omissioni: economia
        ? []
        : ["economia (importi, incassato, residuo): richiede pagamento.read/economia.read"],
      versioniEntita: {
        [`commessa:${c.id}`]: versione(c.updatedAt),
        registroPagamenti: versioneRegistroPagamenti(c.pagamenti),
      },
    });
  },
};

// ── verifica_gate_commessa ───────────────────────────────────────────────

const verificaGate: StrumentoTars = {
  nome: "verifica_gate_commessa",
  versione: "1.0.0",
  categoria: "commesse",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  descrizione:
    "Cosa manca alla commessa per la transizione di stato: gate documentale dello stato corrente o di quello indicato. Non esegue nulla.",
  schemaInput: z
    .object({
      commessaId: z.number().int().positive(),
      stato: z.enum(STATI_COMMESSA).optional(),
    })
    .strict(),
  async esegui(contesto, input) {
    const c: any = getCommessaById(input.commessaId);
    if (!c || c.sedeId !== contesto.sedeId) {
      throw new Error("NOT_FOUND: commessa non trovata.");
    }
    const stato = input.stato ?? c.stato;
    const richiesti = REQUIRED_DOC_TIPI_PER_STATO[stato] ?? [];
    const soddisfatto = statoHasRequiredDoc(c.id, stato);
    return lettura({
      dati: {
        commessaId: c.id,
        stato,
        documentiRichiesti: richiesti,
        gateSoddisfatto: soddisfatto,
        mancanze:
          soddisfatto || richiesti.length === 0
            ? []
            : [
                `Serve almeno un documento di tipo ${richiesti.join(" o ")} caricato nello stato «${stato}».`,
              ],
      },
      evidenze: [
        {
          tipo: "entita",
          riferimento: `commessa:${c.id}`,
          descrizione: `${c.codice} — gate «${stato}»`,
        },
      ],
      versioniEntita: { [`commessa:${c.id}`]: versione(c.updatedAt) },
    });
  },
};

// ── leggi_ordini_fornitore ───────────────────────────────────────────────

const leggiOrdini: StrumentoTars = {
  nome: "leggi_ordini_fornitore",
  versione: "1.0.0",
  categoria: "fornitori",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  descrizione:
    "Gli ordini fornitori della sede (filtrabili per commessa o stato), con date di consegna. Importi solo con capability economiche.",
  schemaInput: z
    .object({
      commessaId: z.number().int().positive().optional(),
      stato: z.string().max(30).optional(),
      limite: z.number().int().min(1).max(50).default(25),
    })
    .strict(),
  async esegui(contesto, input) {
    const economia = conEconomia(contesto);
    const righe = getOrdiniFornitoreDiSede(contesto.sedeId)
      .filter(o => !input.commessaId || o.ordine.commessaId === input.commessaId)
      .filter(o => !input.stato || o.ordine.stato === input.stato)
      .slice(0, input.limite)
      .map(o => ({
        id: o.ordine.id,
        codiceOrdine: o.ordine.codiceOrdine,
        fornitoreNome: o.fornitoreNome,
        commessaId: o.ordine.commessaId,
        stato: o.ordine.stato,
        dataOrdine: o.ordine.dataOrdine,
        dataConsegnaPrevista: o.ordine.dataConsegnaPrevista ?? null,
        dataConsegnaEffettiva: o.ordine.dataConsegnaEffettiva ?? null,
        numeroRighe: o.ordine.righe.length,
        importoTotale: economia ? (o.ordine.importoTotale ?? null) : undefined,
      }));
    return lettura({
      dati: { ordini: righe },
      evidenze: righe.map(o => ({
        tipo: "entita" as const,
        riferimento: `ordine:${o.id}`,
        descrizione: `${o.codiceOrdine} — ${o.fornitoreNome ?? "?"} (${o.stato})`,
      })),
      omissioni: economia
        ? []
        : ["importoTotale degli ordini: richiede economia.read"],
    });
  },
};

// ── leggi_analisi_ordine (Document Intelligence) ─────────────────────────

const leggiAnalisi: StrumentoTars = {
  nome: "leggi_analisi_ordine",
  versione: "1.0.0",
  categoria: "documenti",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  soloDirezione: true, // stessa regola dell'endpoint analisiDocumenti.perOrdine
  interruttore: "documentIntelligence",
  descrizione:
    "I run di analisi Document Intelligence di un ordine: stato, campi estratti con evidenza (pagina e frammento), differenze con l'ordine, marcatura «da verificare» per l'OCR a bassa confidenza.",
  schemaInput: z.object({ ordineId: z.number().int().positive() }).strict(),
  async esegui(contesto, input) {
    const trovato = getOrdineFornitoreInSede(input.ordineId, contesto.sedeId);
    if (!trovato) throw new Error("NOT_FOUND: ordine non trovato.");
    const runs = analisiPerOrdine(contesto.sedeId, input.ordineId).map(run => ({
      id: run.id,
      documentoNome: run.documentoNome,
      stato: run.stato,
      motivoStato: run.motivoStato,
      parser: run.parser,
      daVerificare: run.daVerificare,
      confidenzaOcr: run.ocr?.confidenzaMedia ?? null,
      differenze: run.differenze.map(d => ({
        tipo: d.tipo,
        gravita: d.gravita,
        dettaglio: d.dettaglio,
        evidenza: d.evidenza
          ? { pagina: d.evidenza.pagina, frammento: d.evidenza.frammento }
          : null,
      })),
      createdAt: run.createdAt,
    }));
    return lettura({
      dati: { ordineId: input.ordineId, analisi: runs },
      fonte:
        "Run Document Intelligence (derivati): l'ordine CRM e la conferma originale del fornitore restano le fonti; le differenze citano pagina e frammento.",
      evidenze: runs.map(r => ({
        tipo: "run_analisi" as const,
        riferimento: `analisi:${r.id}`,
        descrizione: `${r.documentoNome} — ${r.stato}${r.daVerificare ? " (DA VERIFICARE)" : ""}`,
      })),
      versioniEntita: Object.fromEntries(
        runs.map(r => [`analisi:${r.id}`, versione(r.createdAt)])
      ),
    });
  },
};

// ── leggi_centro_azioni ──────────────────────────────────────────────────

const leggiCentroAzioni: StrumentoTars = {
  nome: "leggi_centro_azioni",
  versione: "1.0.0",
  categoria: "operativita",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  descrizione:
    "I casi aperti del Centro Azioni visibili al principal (scope mine; site solo per direzione): priorità, segnali e next best action.",
  schemaInput: z
    .object({
      scope: z.enum(["mine", "site"]).default("mine"),
      limite: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  async esegui(contesto, input) {
    if (input.scope === "site" && !contesto.direzione) {
      throw new Error("FORBIDDEN: lo scope di sede richiede la direzione.");
    }
    const pagina = await listActionCases({
      repository: getActionCaseRepository(),
      sedeId: contesto.sedeId,
      userId: contesto.utenteId,
      roles: contesto.ruoli,
      scope: input.scope,
      now: new Date(),
      limit: input.limite,
    });
    const casi = pagina.items.map(caso => ({
      id: caso.id,
      titolo: caso.title,
      priorita: caso.priority,
      stato: caso.status,
      prossimaAzione: caso.nextAction.label,
      segnali: caso.signals.map(s => s.summary),
      link: caso.link,
    }));
    return lettura({
      dati: { casi },
      evidenze: casi.map(c => ({
        tipo: "caso" as const,
        riferimento: `caso:${c.id}`,
        descrizione: `${c.titolo} (${c.priorita})`,
      })),
    });
  },
};

// ── leggi_promemoria_in_scadenza ─────────────────────────────────────────

const leggiPromemoria: StrumentoTars = {
  nome: "leggi_promemoria_in_scadenza",
  versione: "1.0.0",
  categoria: "promemoria",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: [],
  descrizione:
    "I promemoria personali del principal attualmente in scadenza (stesso servizio del popup CRM). Solo i propri: mai quelli di altri.",
  schemaInput: z.object({}).strict(),
  async esegui(contesto) {
    const items = await getReminderService().listPopupDue({
      sedeId: contesto.sedeId,
      recipientUserId: contesto.utenteId,
    });
    return lettura({
      dati: { promemoria: items },
      omissioni: [],
    });
  },
};

export const STRUMENTI_L0: readonly StrumentoTars[] = [
  cercaCommesse,
  leggiCommessa,
  verificaGate,
  leggiOrdini,
  leggiAnalisi,
  leggiCentroAzioni,
  leggiPromemoria,
];
