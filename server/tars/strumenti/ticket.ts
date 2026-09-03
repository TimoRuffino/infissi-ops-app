// Strumento R1 «crea_ticket» (02/09/2026): apre un ticket di post-vendita
// sulla commessa in contesto o indicata. Servizio di dominio canonico
// (`creaTicketRecord`), capability `ticket.create`, ledger R1 dal
// registro. Nessuna assegnazione dal modello: un ticket nasce «aperto»
// e la squadra lo prende dalla pagina Post-vendita.
//
// Mancava: «crea un ticket per Bertoli» finiva in «non ho uno strumento
// per creare ticket» dopo aver risolto la commessa.

import { z } from "zod";
import { getClienteById } from "../../routers/clienti";
import { getCommessaById } from "../../routers/commesse";
import {
  creaTicketRecord,
  TICKET_CATEGORIE,
  TICKET_PRIORITA,
} from "../../routers/ticket";
import { tarsAttivo } from "../../platform/interruttori";
import type { ContestoRun, EsitoAzione, EvidenzaTars, StrumentoTars } from "./tipi";

const schemaCreaTicket = z
  .object({
    oggetto: z.string().min(3).max(160),
    descrizione: z.string().max(2000).optional(),
    categoria: z.enum(TICKET_CATEGORIE).default("altro"),
    priorita: z.enum(TICKET_PRIORITA).default("media"),
    /** Omesso = la commessa attiva della conversazione (verificata dal server). */
    commessaId: z.number().int().positive().optional(),
  })
  .strict();

type InputCreaTicket = z.infer<typeof schemaCreaTicket>;

function base(strumento: string): Omit<EsitoAzione, "stato" | "motivo" | "dati"> {
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

function nonEseguito(strumento: string, motivo: string): EsitoAzione<null> {
  return { ...base(strumento), stato: "non_eseguito", motivo, dati: null };
}

const creaTicket: StrumentoTars<InputCreaTicket, EsitoAzione> = {
  nome: "crea_ticket",
  versione: "1.0.0",
  categoria: "post-vendita",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["ticket.create"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Apre un ticket di post-vendita/assistenza (difetto, regolazione, sostituzione, garanzia, altro) sulla commessa indicata o su quella attiva nella conversazione. Usa l'oggetto e la descrizione con le parole dell'utente. Il ticket nasce «aperto», senza assegnazione. Se l'utente ha chiesto esplicitamente di creare/aprire un ticket, chiamalo subito senza chiedere conferma.",
  schemaInput: schemaCreaTicket,
  async esegui(contesto: ContestoRun, input): Promise<EsitoAzione> {
    const nome = "crea_ticket";
    if (!tarsAttivo("tarsL2Actions")) {
      throw new Error("FORBIDDEN: le azioni L2 di Tars sono disattivate (kill switch).");
    }
    const commessaId =
      input.commessaId ??
      (contesto.contestoConversazione?.verifiche.commessa === "verificato"
        ? contesto.contestoConversazione.commessaId
        : null);
    let clienteId: number | null = null;
    const evidenze: EvidenzaTars[] = [];
    if (commessaId != null) {
      const commessa: any = getCommessaById(commessaId);
      if (!commessa || commessa.sedeId !== contesto.sedeId) {
        return nonEseguito(nome, "Commessa non trovata: nessun ticket creato.");
      }
      if (commessa.stato === "archiviata" || commessa.archivedAt) {
        return nonEseguito(
          nome,
          `La commessa ${commessa.codice} è archiviata: un ticket va aperto su una commessa attiva, oppure ripristinala prima.`
        );
      }
      clienteId = Number.isInteger(commessa.clienteId) ? commessa.clienteId : null;
      evidenze.push({
        tipo: "entita",
        riferimento: `commessa:${commessa.id}`,
        descrizione: `${commessa.codice} — ${commessa.cliente}`,
      });
    } else if (contesto.contestoConversazione?.clienteId != null) {
      const cliente: any = getClienteById(contesto.contestoConversazione.clienteId);
      if (cliente && cliente.sedeId === contesto.sedeId) {
        clienteId = cliente.id;
        evidenze.push({
          tipo: "entita",
          riferimento: `cliente:${cliente.id}`,
          descrizione: `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim(),
        });
      }
    }
    if (commessaId == null && clienteId == null) {
      return nonEseguito(
        nome,
        "Non so a quale commessa o cliente intestare il ticket: indica la commessa (codice o cliente) e riprova."
      );
    }
    const ticket = await creaTicketRecord({
      sedeId: contesto.sedeId,
      apertoBy: contesto.utenteId,
      commessaId,
      clienteId,
      oggetto: input.oggetto.trim(),
      descrizione: input.descrizione?.trim() || undefined,
      categoria: input.categoria,
      priorita: input.priorita,
    });
    const vista = {
      id: ticket.id,
      oggetto: ticket.oggetto,
      categoria: ticket.categoria,
      priorita: ticket.priorita,
      stato: ticket.stato,
      commessaId: ticket.commessaId,
      clienteId: ticket.clienteId,
      link: `/ticket?ticket=${ticket.id}`,
    };
    return {
      ...base(nome),
      stato: "creato",
      motivo: null,
      azioneId: `${nome}:ticket:${ticket.id}`,
      auditId: null,
      entitaToccate: [
        `ticket:${ticket.id}`,
        ...(commessaId != null ? [`commessa:${commessaId}`] : []),
      ],
      prima: null,
      dopo: vista,
      undoDisponibile: false,
      undoEntro: null,
      undoVia: null,
      avvertenze: [
        "Il ticket è aperto e non assegnato: la squadra lo prende dalla pagina Post-vendita, dove si può anche chiudere o eliminare.",
      ],
      assunzioni: [],
      dati: vista,
      evidenze: [
        {
          tipo: "entita",
          riferimento: `ticket:${ticket.id}`,
          descrizione: `Ticket #${ticket.id} — ${ticket.oggetto}`,
        },
        ...evidenze,
      ],
      freschezza: new Date().toISOString(),
    };
  },
};

export const STRUMENTI_TICKET: readonly StrumentoTars[] = [creaTicket];
