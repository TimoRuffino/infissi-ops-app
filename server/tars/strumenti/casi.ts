// Strumenti L2 di Tars (T5): transizioni del Centro Azioni — condivise
// ma reversibili e interne — sul servizio ESISTENTE
// (`transitionActionCase`: authz mine/direzione, `expectedFingerprint`
// anti-stale, eventi del caso come audit, publishAssignmentEvent sui
// cambi assegnatario). Richiesta esplicita = zero conferme; l'undo è
// dichiarato nel risultato, non un click (spec §23, decisione 25).

import { z } from "zod";
import { getActionCaseRepository } from "../../actionCenter/repository";
import { transitionActionCase } from "../../actionCenter/service";
import { tarsAttivo } from "../../platform/interruttori";
import {
  ErroreTempo,
  formattaIstanteLocale,
  risolviEspressioneTempo,
} from "../tempo";
import { parseFutureReminderInstant, parseRomeLocalDateTime } from "../../reminders/time";
import type { EsitoAzione, StrumentoTars } from "./tipi";

function assicuraAzioniL2(): void {
  if (!tarsAttivo("tarsL2Actions")) {
    throw new Error(
      "FORBIDDEN: le azioni operative L2 di Tars sono disattivate (kill switch)."
    );
  }
}

function baseAzione(strumento: string) {
  return {
    tipo: "azione" as const,
    strumento,
    azioneId: null as string | null,
    auditId: null as string | null,
    entitaToccate: [] as string[],
    prima: null as Record<string, unknown> | null,
    dopo: null as Record<string, unknown> | null,
    undoDisponibile: false,
    undoEntro: null as string | null,
    undoVia: null,
    conferma: null,
    avvertenze: [] as string[],
    assunzioni: [] as string[],
    evidenze: [] as Array<{
      tipo: "entita" | "caso";
      riferimento: string;
      descrizione: string;
    }>,
    freschezza: new Date().toISOString(),
  };
}

function nonEseguito(strumento: string, motivo: string): EsitoAzione<null> {
  return { ...baseAzione(strumento), stato: "non_eseguito", motivo, dati: null };
}

async function ultimoEventoId(
  sedeId: number,
  casoId: number
): Promise<string | null> {
  try {
    const eventi = await getActionCaseRepository().listEvents(sedeId, casoId);
    const ultimo = eventi[eventi.length - 1];
    return ultimo ? `caso_eventi:${ultimo.id}` : null;
  } catch {
    return null;
  }
}

// ── prendi_in_carico_caso ────────────────────────────────────────────────

const prendiInCarico: StrumentoTars = {
  nome: "prendi_in_carico_caso",
  versione: "1.0.0",
  categoria: "operativita",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.read"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Prende in carico un caso del Centro Azioni per l'utente corrente, subito e senza conferme. Reversibile: si può rinviare o riassegnare.",
  schemaInput: z.object({ casoId: z.number().int().positive() }).strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraAzioniL2();
    const nome = "prendi_in_carico_caso";
    const repo = getActionCaseRepository();
    const caso = await repo.findById(contesto.sedeId, input.casoId);
    if (!caso) return nonEseguito(nome, "Caso non trovato.");
    if (caso.status === "risolta") {
      return nonEseguito(nome, "Il caso è già risolto.");
    }
    if (
      caso.status === "in_carico" &&
      caso.assigneeUserId === contesto.utenteId
    ) {
      return {
        ...baseAzione(nome),
        stato: "gia_in_carico",
        motivo: null,
        entitaToccate: [`caso:${caso.id}`],
        dopo: { stato: caso.status },
        dati: { casoId: caso.id, stato: caso.status },
        evidenze: [
          {
            tipo: "caso",
            riferimento: `caso:${caso.id}`,
            descrizione: caso.title,
          },
        ],
      };
    }
    const prima = { stato: caso.status, assegnatario: caso.assigneeUserId };
    let aggiornato;
    try {
      aggiornato = await transitionActionCase({
        repository: repo,
        sedeId: contesto.sedeId,
        caseId: caso.id,
        expectedFingerprint: caso.signalFingerprint,
        userId: contesto.utenteId,
        roles: contesto.ruoli,
        action: "take",
        now: new Date(),
      });
    } catch (errore: any) {
      const messaggio = String(errore?.message ?? "");
      if (messaggio === "NOT_FOUND") {
        return nonEseguito(nome, "Caso non trovato.");
      }
      if (messaggio === "STALE_ACTION_CASE") {
        return nonEseguito(
          nome,
          "Il caso è cambiato nel frattempo: ricaricalo e riprova."
        );
      }
      if (messaggio === "FORBIDDEN") {
        return nonEseguito(nome, "Operazione non permessa su questo caso.");
      }
      throw errore;
    }
    return {
      ...baseAzione(nome),
      stato: "preso_in_carico",
      motivo: null,
      azioneId: `${nome}:caso:${aggiornato.id}`,
      auditId: await ultimoEventoId(contesto.sedeId, aggiornato.id),
      entitaToccate: [`caso:${aggiornato.id}`],
      prima,
      dopo: { stato: aggiornato.status, assegnatario: aggiornato.assigneeUserId },
      avvertenze: [
        "Per tornare indietro: rinvia il caso o riassegnalo dal Centro Azioni.",
      ],
      dati: { casoId: aggiornato.id, stato: aggiornato.status },
      evidenze: [
        {
          tipo: "caso",
          riferimento: `caso:${aggiornato.id}`,
          descrizione: aggiornato.title,
        },
      ],
    };
  },
};

// ── rinvia_caso ──────────────────────────────────────────────────────────

const rinviaCaso: StrumentoTars = {
  nome: "rinvia_caso",
  versione: "1.0.0",
  categoria: "operativita",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.read"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Rinvia un caso del Centro Azioni a un momento futuro (campo «quando» come per i promemoria), con motivo facoltativo. Solo casi propri o da direzione.",
  schemaInput: z
    .object({
      casoId: z.number().int().positive(),
      quando: z.string().min(1).max(120),
      motivo: z.string().max(200).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraAzioniL2();
    const nome = "rinvia_caso";
    const repo = getActionCaseRepository();
    const caso = await repo.findById(contesto.sedeId, input.casoId);
    if (!caso) return nonEseguito(nome, "Caso non trovato.");
    if (caso.status === "risolta") {
      return nonEseguito(nome, "Il caso è già risolto: niente da rinviare.");
    }

    const adesso = new Date();
    let fino: Date;
    let assunzioni: string[] = [];
    try {
      const risoluzione = risolviEspressioneTempo(input.quando, adesso);
      assunzioni = risoluzione.assunzioni;
      fino =
        risoluzione.tipo === "locale"
          ? parseRomeLocalDateTime(
              `${risoluzione.dataLocale}T${risoluzione.oraLocale}`,
              adesso
            )
          : parseFutureReminderInstant(risoluzione.iso, adesso);
    } catch (errore) {
      if (errore instanceof ErroreTempo) {
        return nonEseguito(nome, errore.message);
      }
      const messaggio = errore instanceof Error ? errore.message : "";
      if (messaggio.startsWith("REMINDER_")) {
        return nonEseguito(
          nome,
          "Il momento indicato non è valido o non è futuro: riprova con un'altra espressione."
        );
      }
      throw errore;
    }

    const prima = { stato: caso.status, rinviatoFinoA: caso.snoozedUntil };
    let aggiornato;
    try {
      aggiornato = await transitionActionCase({
        repository: repo,
        sedeId: contesto.sedeId,
        caseId: caso.id,
        expectedFingerprint: caso.signalFingerprint,
        userId: contesto.utenteId,
        roles: contesto.ruoli,
        action: "snooze",
        until: fino,
        reason: input.motivo,
        now: adesso,
      });
    } catch (errore: any) {
      const messaggio = String(errore?.message ?? "");
      if (messaggio === "NOT_FOUND") {
        return nonEseguito(nome, "Caso non trovato.");
      }
      if (messaggio === "FORBIDDEN") {
        return nonEseguito(
          nome,
          "Puoi rinviare solo i casi tuoi (o essere direzione)."
        );
      }
      if (messaggio === "STALE_ACTION_CASE") {
        return nonEseguito(
          nome,
          "Il caso è cambiato nel frattempo: ricaricalo e riprova."
        );
      }
      if (messaggio === "FUTURE_DATE_REQUIRED") {
        return nonEseguito(nome, "Il rinvio richiede un momento futuro.");
      }
      throw errore;
    }
    return {
      ...baseAzione(nome),
      stato: "rinviato",
      motivo: null,
      azioneId: `${nome}:caso:${aggiornato.id}`,
      auditId: await ultimoEventoId(contesto.sedeId, aggiornato.id),
      entitaToccate: [`caso:${aggiornato.id}`],
      prima,
      dopo: {
        stato: aggiornato.status,
        rinviatoFinoA: aggiornato.snoozedUntil?.toISOString() ?? null,
        rinviatoFinoALocale: aggiornato.snoozedUntil
          ? formattaIstanteLocale(aggiornato.snoozedUntil)
          : null,
      },
      avvertenze: ["Per riprenderlo subito: prendilo di nuovo in carico."],
      assunzioni,
      dati: { casoId: aggiornato.id, stato: aggiornato.status },
      evidenze: [
        {
          tipo: "caso",
          riferimento: `caso:${aggiornato.id}`,
          descrizione: aggiornato.title,
        },
      ],
    };
  },
};

export const STRUMENTI_CASI: readonly StrumentoTars[] = [
  prendiInCarico,
  rinviaCaso,
];
