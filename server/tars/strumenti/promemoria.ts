// Strumenti L1 di Tars (T2): promemoria PERSONALI su richiesta esplicita
// — docs/tars/architettura-tars-v2.md §6 (riga L1) e §20.
//
// Regole dure, nel codice e non nel prompt:
// - il destinatario è SEMPRE il principal del run (nessun parametro per
//   crearne ad altri: L1 è personale per costruzione);
// - zero conferme: l'esecuzione è diretta, l'esito dichiara assunzioni e
//   undo («conferma informativa + Annulla», mai «sei sicuro?»);
// - il tempo lo risolve il server (tempo.ts + reminders/time.ts: DST e
//   futuro restano decisi lì); gli errori diventano esiti `non_eseguito`
//   leggibili, DATI per il modello, mai eccezioni generiche;
// - idempotenza via canonicalKey deterministica (vincolo UNIQUE del
//   repository); ricreazione dopo annullo con catena `:dopo<id>`.

import { createHash } from "node:crypto";
import { z } from "zod";
import { getClienteById } from "../../routers/clienti";
import { getCommessaById } from "../../routers/commesse";
import {
  getReminderService,
  ReminderNotFoundError,
} from "../../reminders/service";
import {
  parseFutureReminderInstant,
  parseRomeLocalDateTime,
} from "../../reminders/time";
import type { Reminder } from "../../reminders/types";
import { tarsAttivo } from "../../platform/interruttori";
import {
  ErroreTempo,
  formattaIstanteLocale,
  istanteComeLocale,
  risolviEspressioneTempo,
  type RisoluzioneTempo,
} from "../tempo";
import type {
  ContestoRun,
  EsitoAzione,
  EvidenzaTars,
  StrumentoTars,
} from "./tipi";

function assicuraFunzionePromemoria(): void {
  if (!tarsAttivo("tarsReminders")) {
    throw new Error(
      "FORBIDDEN: la funzione promemoria di Tars è disattivata (kill switch)."
    );
  }
}

function scope(contesto: ContestoRun) {
  return { sedeId: contesto.sedeId, recipientUserId: contesto.utenteId };
}

function base(strumento: string): Omit<
  EsitoAzione,
  "stato" | "motivo" | "dati"
> {
  return {
    tipo: "azione",
    strumento,
    azioneId: null,
    auditId: null,
    entitaToccate: [],
    prima: null,
    dopo: null,
    undoDisponibile: false,
    undoEntro: null,
    undoVia: null,
    conferma: null,
    avvertenze: [],
    assunzioni: [],
    evidenze: [],
    freschezza: new Date().toISOString(),
  };
}

function nonEseguito(
  strumento: string,
  motivo: string,
  assunzioni: string[] = []
): EsitoAzione<null> {
  return {
    ...base(strumento),
    stato: "non_eseguito",
    motivo,
    assunzioni,
    dati: null,
  };
}

/** Traduce gli errori del modulo tempo/reminders in motivi leggibili. */
function motivoTemporale(errore: unknown): string | null {
  if (errore instanceof ErroreTempo) return errore.message;
  const messaggio = errore instanceof Error ? errore.message : "";
  switch (messaggio) {
    case "REMINDER_LOCAL_TIME_INVALID":
      return "Quell'orario non esiste in quel giorno (passaggio all'ora legale): scegli un altro orario.";
    case "REMINDER_LOCAL_TIME_AMBIGUOUS":
      return "Quell'orario si ripete due volte quella notte (ritorno all'ora solare): scegli un orario non ambiguo.";
    case "REMINDER_TIME_NOT_FUTURE":
      return "Il momento risolto è già passato: indica un momento futuro.";
    default:
      return null;
  }
}

function risolviIstante(
  risoluzione: RisoluzioneTempo,
  adesso: Date
): Date {
  return risoluzione.tipo === "locale"
    ? parseRomeLocalDateTime(
        `${risoluzione.dataLocale}T${risoluzione.oraLocale}`,
        adesso
      )
    : parseFutureReminderInstant(risoluzione.iso, adesso);
}

function vistaPromemoria(record: Reminder) {
  return {
    id: record.id,
    testo: record.text,
    remindAt: record.remindAt.toISOString(),
    remindAtLocale: formattaIstanteLocale(record.remindAt),
    stato: record.status,
    commessaId: record.commessaId,
    clienteId: record.clienteId,
  };
}

function evidenzaPromemoria(record: Reminder): EvidenzaTars {
  return {
    tipo: "entita",
    riferimento: `promemoria:${record.id}`,
    descrizione: `${record.text} — ${formattaIstanteLocale(record.remindAt)}`,
  };
}

async function auditId(
  contesto: ContestoRun,
  id: number,
  tipoEvento: string
): Promise<string | null> {
  try {
    const eventi = await getReminderService().listEvents({
      ...scope(contesto),
      id,
    });
    const ultimo = [...eventi]
      .reverse()
      .find(evento => evento.eventType === tipoEvento);
    return ultimo ? `promemoria_eventi:${ultimo.id}` : null;
  } catch {
    return null;
  }
}

// ── crea_promemoria ──────────────────────────────────────────────────────

const creaPromemoria: StrumentoTars = {
  nome: "crea_promemoria",
  versione: "1.1.0",
  categoria: "promemoria",
  livello: "L1",
  effetto: "interno",
  reversibile: true,
  capability: [],
  interruttore: "tarsReminders",
  descrizione:
    "Crea un promemoria PERSONALE per l'utente corrente, subito e senza conferme. Passa nel campo «quando» l'espressione temporale dell'utente così com'è (es. «domani alle 9», «venerdì», «tra due ore»): la data la risolve il server. Per espressioni relative a una data di riferimento (es. «tre giorni prima» della posa) leggi prima la data e passala in ancoraData.",
  schemaInput: z
    .object({
      testo: z.string().min(1).max(300),
      quando: z.string().min(1).max(120),
      ancoraData: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      commessaId: z.number().int().positive().optional(),
      clienteId: z.number().int().positive().optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraFunzionePromemoria();
    const nome = "crea_promemoria";
    const adesso = new Date();

    let risoluzione: RisoluzioneTempo;
    let istante: Date;
    try {
      risoluzione = risolviEspressioneTempo(
        input.quando,
        adesso,
        input.ancoraData
      );
      istante = risolviIstante(risoluzione, adesso);
    } catch (errore) {
      const motivo = motivoTemporale(errore);
      if (motivo) return nonEseguito(nome, motivo);
      throw errore;
    }

    const contestoPersistito = contesto.contestoConversazione;
    const ereditaCommessa =
      input.commessaId == null &&
      contestoPersistito?.verificato === true &&
      contestoPersistito.commessaId != null;
    const commessaId = input.commessaId ??
      (ereditaCommessa ? contestoPersistito!.commessaId! : null);
    let clienteId = input.clienteId ??
      (ereditaCommessa ? contestoPersistito!.clienteId : null);

    const evidenzeCollegamenti: EvidenzaTars[] = [];
    if (commessaId != null) {
      // Rilettura obbligatoria: il contesto non autorizza e non garantisce
      // freschezza. Per l'eredità implicita anche la versione deve coincidere.
      const commessa: any = getCommessaById(commessaId);
      if (!commessa || commessa.sedeId !== contesto.sedeId) {
        return nonEseguito(nome, "Commessa non trovata: nessun promemoria creato.");
      }
      if (ereditaCommessa) {
        const attesa = contestoPersistito!.versioniEntita[`commessa:${commessa.id}`];
        const corrente = commessa.updatedAt instanceof Date
          ? String(commessa.updatedAt.getTime())
          : String(new Date(commessa.updatedAt).getTime());
        if (!attesa || corrente === "NaN" || attesa !== corrente) {
          return nonEseguito(
            nome,
            "La commessa è cambiata dall'ultima lettura: rileggila prima di collegare il promemoria."
          );
        }
      }
      if (clienteId == null && Number.isInteger(commessa.clienteId)) {
        clienteId = commessa.clienteId;
      }
      evidenzeCollegamenti.push({
        tipo: "entita",
        riferimento: `commessa:${commessa.id}`,
        descrizione: `${commessa.codice} — ${commessa.cliente}`,
      });
    }
    if (clienteId != null) {
      const cliente: any = getClienteById(clienteId);
      if (!cliente || cliente.sedeId !== contesto.sedeId) {
        return nonEseguito(nome, "Cliente non trovato: nessun promemoria creato.");
      }
    }

    const testo = input.testo.trim();
    const chiaveBase = `tars:u${contesto.utenteId}:${createHash("sha256")
      .update(
        `${testo.toLowerCase().replace(/\s+/g, " ")}|${istante.toISOString()}|c:${commessaId ?? "-"}|cl:${clienteId ?? "-"}`
      )
      .digest("hex")
      .slice(0, 20)}`;

    // Catena deterministica: dopo un annullo/completamento la stessa
    // richiesta può ricreare; il doppio invio resta deduplicato.
    let chiave = chiaveBase;
    let record: Reminder | null = null;
    let creato = false;
    for (let giro = 0; giro < 5; giro++) {
      const esito = await getReminderService().createApproved({
        sedeId: contesto.sedeId,
        requestedByUserId: contesto.utenteId,
        sourceProposalId: null,
        actionKey: chiave,
        text: testo,
        remindAtIso: istante.toISOString(),
        clienteId: clienteId ?? null,
        commessaId: commessaId ?? null,
      });
      record = esito.record;
      creato = esito.created;
      const attivo =
        record.status === "scheduled" || record.status === "due";
      if (creato || attivo) break;
      chiave = `${chiaveBase}:dopo${record.id}`;
      record = null;
    }
    if (!record) {
      return nonEseguito(
        nome,
        "Non sono riuscito a creare il promemoria (troppi omonimi annullati): cambia leggermente il testo."
      );
    }

    const vista = vistaPromemoria(record);
    return {
      ...base(nome),
      stato: creato ? "creato" : "gia_esistente",
      motivo: null,
      azioneId: `${nome}:promemoria:${record.id}`,
      auditId: await auditId(contesto, record.id, "created"),
      entitaToccate: [`promemoria:${record.id}`],
      prima: null,
      dopo: vista,
      undoDisponibile: true,
      undoEntro: "finché il promemoria è attivo",
      undoVia: { procedura: "promemoria.cancel", id: record.id },
      avvertenze: creato
        ? []
        : [
            "Esisteva già un promemoria identico (stesso testo e orario): non ne ho creato un secondo.",
          ],
      assunzioni: [
        ...risoluzione.assunzioni,
        ...(ereditaCommessa
          ? ["Collegamento alla commessa ereditato dal contesto conversazionale verificato e riletto."]
          : []),
      ],
      dati: vista,
      evidenze: [evidenzaPromemoria(record), ...evidenzeCollegamenti],
      freschezza: new Date().toISOString(),
    };
  },
};

// ── sposta_promemoria ────────────────────────────────────────────────────

const spostaPromemoria: StrumentoTars = {
  nome: "sposta_promemoria",
  versione: "1.0.0",
  categoria: "promemoria",
  livello: "L1",
  effetto: "interno",
  reversibile: true,
  capability: [],
  interruttore: "tarsReminders",
  descrizione:
    "Sposta un promemoria personale a un nuovo momento (campo «quando» come per la creazione). Solo i propri promemoria attivi.",
  schemaInput: z
    .object({
      promemoriaId: z.number().int().positive(),
      quando: z.string().min(1).max(120),
      ancoraData: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraFunzionePromemoria();
    const nome = "sposta_promemoria";
    const adesso = new Date();

    const corrente = await getReminderService().get({
      ...scope(contesto),
      id: input.promemoriaId,
    });
    if (!corrente) {
      return nonEseguito(nome, "Promemoria non trovato.");
    }
    if (corrente.status === "completed" || corrente.status === "cancelled") {
      return nonEseguito(
        nome,
        `Il promemoria è già ${corrente.status === "completed" ? "completato" : "annullato"}: crea un nuovo promemoria invece di spostarlo.`
      );
    }

    let risoluzione: RisoluzioneTempo;
    try {
      risoluzione = risolviEspressioneTempo(
        input.quando,
        adesso,
        input.ancoraData
      );
    } catch (errore) {
      const motivo = motivoTemporale(errore);
      if (motivo) return nonEseguito(nome, motivo);
      throw errore;
    }
    const localDateTime =
      risoluzione.tipo === "locale"
        ? `${risoluzione.dataLocale}T${risoluzione.oraLocale}`
        : istanteComeLocale(new Date(risoluzione.iso));

    const prima = vistaPromemoria(corrente);
    let aggiornato: Reminder;
    try {
      aggiornato = await getReminderService().snooze({
        ...scope(contesto),
        id: input.promemoriaId,
        kind: "custom",
        localDateTime,
      });
    } catch (errore) {
      if (errore instanceof ReminderNotFoundError) {
        return nonEseguito(nome, "Promemoria non trovato.");
      }
      const motivo = motivoTemporale(errore);
      if (motivo) return nonEseguito(nome, motivo);
      throw errore;
    }

    const vista = vistaPromemoria(aggiornato);
    return {
      ...base(nome),
      stato: "spostato",
      motivo: null,
      azioneId: `${nome}:promemoria:${aggiornato.id}`,
      auditId: await auditId(contesto, aggiornato.id, "snoozed"),
      entitaToccate: [`promemoria:${aggiornato.id}`],
      prima: { remindAt: prima.remindAt, remindAtLocale: prima.remindAtLocale },
      dopo: vista,
      undoDisponibile: false,
      undoEntro: null,
      undoVia: null,
      avvertenze: [
        `Per tornare indietro: sposta di nuovo a ${prima.remindAtLocale}.`,
      ],
      assunzioni: risoluzione.assunzioni,
      dati: vista,
      evidenze: [evidenzaPromemoria(aggiornato)],
      freschezza: new Date().toISOString(),
    };
  },
};

// ── annulla_promemoria ───────────────────────────────────────────────────

const annullaPromemoria: StrumentoTars = {
  nome: "annulla_promemoria",
  versione: "1.0.0",
  categoria: "promemoria",
  livello: "L1",
  effetto: "interno",
  reversibile: false,
  capability: [],
  interruttore: "tarsReminders",
  descrizione:
    "Annulla un promemoria personale. Per «annulla l'ultimo» leggi prima i promemoria (leggi_promemoria, periodo ultimi_creati) e usa l'id più recente. Solo i propri.",
  schemaInput: z
    .object({ promemoriaId: z.number().int().positive() })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraFunzionePromemoria();
    const nome = "annulla_promemoria";
    const corrente = await getReminderService().get({
      ...scope(contesto),
      id: input.promemoriaId,
    });
    if (!corrente) return nonEseguito(nome, "Promemoria non trovato.");
    if (corrente.status === "completed") {
      return nonEseguito(
        nome,
        "Il promemoria è già completato: non c'è nulla da annullare."
      );
    }
    const prima = vistaPromemoria(corrente);
    const giaAnnullato = corrente.status === "cancelled";

    let record = corrente;
    if (!giaAnnullato) {
      try {
        record = await getReminderService().cancel({
          ...scope(contesto),
          id: input.promemoriaId,
        });
      } catch (errore) {
        if (errore instanceof ReminderNotFoundError) {
          return nonEseguito(nome, "Promemoria non trovato.");
        }
        throw errore;
      }
    }

    const vista = vistaPromemoria(record);
    return {
      ...base(nome),
      stato: giaAnnullato ? "gia_annullato" : "annullato",
      motivo: null,
      azioneId: `${nome}:promemoria:${record.id}`,
      auditId: await auditId(contesto, record.id, "cancelled"),
      entitaToccate: [`promemoria:${record.id}`],
      prima: { remindAt: prima.remindAt, remindAtLocale: prima.remindAtLocale, stato: prima.stato },
      dopo: vista,
      undoDisponibile: false,
      undoEntro: null,
      undoVia: null,
      avvertenze: [
        `L'annullamento non si ripristina: per riaverlo, ricrea «${record.text}» per ${prima.remindAtLocale}.`,
      ],
      assunzioni: [],
      dati: vista,
      evidenze: [evidenzaPromemoria(record)],
      freschezza: new Date().toISOString(),
    };
  },
};

// ── completa_promemoria ──────────────────────────────────────────────────

const completaPromemoria: StrumentoTars = {
  nome: "completa_promemoria",
  versione: "1.0.0",
  categoria: "promemoria",
  livello: "L1",
  effetto: "interno",
  reversibile: false,
  capability: [],
  interruttore: "tarsReminders",
  descrizione:
    "Segna come fatto un promemoria personale («fatto», «l'ho chiamato»). Solo i propri.",
  schemaInput: z
    .object({ promemoriaId: z.number().int().positive() })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraFunzionePromemoria();
    const nome = "completa_promemoria";
    const corrente = await getReminderService().get({
      ...scope(contesto),
      id: input.promemoriaId,
    });
    if (!corrente) return nonEseguito(nome, "Promemoria non trovato.");
    if (corrente.status === "cancelled") {
      return nonEseguito(
        nome,
        "Il promemoria è annullato: non si può completare."
      );
    }
    const giaCompletato = corrente.status === "completed";
    let record = corrente;
    if (!giaCompletato) {
      try {
        record = await getReminderService().complete({
          ...scope(contesto),
          id: input.promemoriaId,
        });
      } catch (errore) {
        if (errore instanceof ReminderNotFoundError) {
          return nonEseguito(nome, "Promemoria non trovato.");
        }
        throw errore;
      }
    }
    const vista = vistaPromemoria(record);
    return {
      ...base(nome),
      stato: giaCompletato ? "gia_completato" : "completato",
      motivo: null,
      azioneId: `${nome}:promemoria:${record.id}`,
      auditId: await auditId(contesto, record.id, "completed"),
      entitaToccate: [`promemoria:${record.id}`],
      prima: { stato: corrente.status },
      dopo: vista,
      undoDisponibile: false,
      undoEntro: null,
      undoVia: null,
      avvertenze: [],
      assunzioni: [],
      dati: vista,
      evidenze: [evidenzaPromemoria(record)],
      freschezza: new Date().toISOString(),
    };
  },
};

export const STRUMENTI_PROMEMORIA: readonly StrumentoTars[] = [
  creaPromemoria,
  spostaPromemoria,
  annullaPromemoria,
  completaPromemoria,
];
