// Strumenti di scrittura «Tars libero» (02/09/2026): clienti, commesse,
// ticket, interventi, comunicazioni, casi. Ogni strumento esegue la
// procedura canonica del router con il contesto server dell'utente (stesse
// autorizzazioni, stessa sede) e restituisce un esito strutturato che il
// ledger R1 registra: «fatto da Tars per <utente>».
//
// Fuori da qui, per scelta: pagamenti/importi, cancellazioni definitive,
// stato delle commesse (strumento dedicato con state machine e gate).

import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import { getActionCaseRepository } from "../../actionCenter/repository";
import { transitionActionCase } from "../../actionCenter/service";
import { CATEGORIE_COMUNICAZIONE } from "../../comunicazioni/filtroComunicazioni";
import { getLiveComunicazione } from "../../comunicazioni/comunicazioni";
import { getClienteById } from "../../routers/clienti";
import { getCommessaById } from "../../routers/commesse";
import { ficFatture } from "../../routers/ficFatture";
import {
  getDocumentoCommessaById,
  spostaDocumentoDiCommessa,
} from "../../routers/preventiviContratti";
import { getTicketById, TICKET_CATEGORIE, TICKET_PRIORITA } from "../../routers/ticket";
import { tarsAttivo } from "../../platform/interruttori";
import { risolviEspressioneTempo } from "../tempo";
import {
  callerPer,
  commessaDalContesto,
  evidenzaCliente,
  evidenzaCommessa,
  fatto,
  motivoSicuro,
  nonEseguito,
} from "./comune";
import type { ContestoRun, EsitoAzione, StrumentoTars } from "./tipi";

function assicuraL2(): void {
  if (!tarsAttivo("tarsL2Actions")) {
    throw new Error("FORBIDDEN: le azioni operative di Tars sono disattivate (kill switch).");
  }
}

const PRIORITA = ["bassa", "media", "alta", "urgente"] as const;
const TIPI_CLIENTE = ["privato", "azienda", "condominio", "ente_pubblico"] as const;

function commessaInSede(contesto: ContestoRun, id: number): any | null {
  const c: any = getCommessaById(id);
  return c && c.sedeId === contesto.sedeId ? c : null;
}

// ── Clienti ─────────────────────────────────────────────────────────────

const creaCliente: StrumentoTars = {
  nome: "crea_cliente",
  versione: "1.0.0",
  categoria: "clienti",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["cliente.create"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Crea un nuovo cliente nella sede. Per una persona: nome e cognome; per azienda/condominio/ente: la ragione sociale nel campo cognome e il tipo. Contatti e indirizzo se li conosci. Prima di crearlo, cerca se esiste già (cerca_clienti).",
  schemaInput: z
    .object({
      nome: z.string().min(1).max(80),
      cognome: z.string().min(1).max(120),
      tipo: z.enum(TIPI_CLIENTE).default("privato"),
      telefono: z.string().max(40).optional(),
      email: z.string().max(120).optional(),
      indirizzo: z.string().max(160).optional(),
      citta: z.string().max(80).optional(),
      cap: z.string().max(10).optional(),
      note: z.string().max(1000).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "crea_cliente";
    try {
      const caller = await callerPer(contesto);
      const cliente: any = await caller.clienti.create({
        ...input,
        note: input.note ? `${input.note} (creato da Tars)` : "Creato da Tars.",
      });
      return fatto({
        strumento: nome,
        stato: "creato",
        azioneId: `${nome}:cliente:${cliente.id}`,
        entitaToccate: [`cliente:${cliente.id}`],
        dopo: { id: cliente.id, denominazione: `${cliente.cognome} ${cliente.nome}`.trim(), tipo: cliente.tipo, link: `/clienti/${cliente.id}` },
        evidenze: [evidenzaCliente(cliente)],
        avvertenze: ["Cliente creato senza commessa: se serve, crea la commessa con crea_commessa."],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

const aggiornaCliente: StrumentoTars = {
  nome: "aggiorna_cliente",
  versione: "1.0.0",
  categoria: "clienti",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["cliente.update_operational"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Aggiorna i dati di un cliente della sede (anagrafica, contatti, indirizzi, note, pratiche). Passa SOLO i campi da cambiare. Nome/cognome e contatti si propagano alle commesse collegate.",
  schemaInput: z
    .object({
      clienteId: z.number().int().positive(),
      nome: z.string().min(1).max(80).optional(),
      cognome: z.string().min(1).max(120).optional(),
      tipo: z.enum(TIPI_CLIENTE).optional(),
      telefono: z.string().max(40).optional(),
      email: z.string().max(120).optional(),
      indirizzo: z.string().max(160).optional(),
      citta: z.string().max(80).optional(),
      cap: z.string().max(10).optional(),
      indirizzoLavoro: z.string().max(160).optional(),
      cittaLavoro: z.string().max(80).optional(),
      note: z.string().max(1000).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "aggiorna_cliente";
    const prima: any = getClienteById(input.clienteId);
    if (!prima || prima.sedeId !== contesto.sedeId) {
      return nonEseguito(nome, "Cliente non trovato in questa sede.");
    }
    const { clienteId, ...campi } = input;
    if (Object.keys(campi).length === 0) {
      return nonEseguito(nome, "Nessun campo da aggiornare.");
    }
    try {
      const caller = await callerPer(contesto);
      const cliente: any = await caller.clienti.update({ id: clienteId, ...campi });
      const primaSnapshot = Object.fromEntries(Object.keys(campi).map(k => [k, prima[k] ?? null]));
      return fatto({
        strumento: nome,
        stato: "aggiornato",
        azioneId: `${nome}:cliente:${cliente.id}:${Date.now()}`,
        entitaToccate: [`cliente:${cliente.id}`],
        prima: primaSnapshot,
        dopo: { id: cliente.id, ...campi, link: `/clienti/${cliente.id}` },
        evidenze: [evidenzaCliente(cliente)],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

// ── Commesse ────────────────────────────────────────────────────────────

const creaCommessa: StrumentoTars = {
  nome: "crea_commessa",
  versione: "1.0.0",
  categoria: "commesse",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["commessa.create"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Crea una nuova commessa (nasce in «preventivo») per un cliente esistente (clienteId) o con il solo nome del cliente. Indirizzo del cantiere, contatti, priorità e note se noti. Niente importi: si mettono dalla scheda.",
  schemaInput: z
    .object({
      clienteId: z.number().int().positive().optional(),
      cliente: z.string().max(160).optional(),
      indirizzo: z.string().max(160).optional(),
      citta: z.string().max(80).optional(),
      telefono: z.string().max(40).optional(),
      email: z.string().max(120).optional(),
      priorita: z.enum(PRIORITA).optional(),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "crea_commessa";
    const clienteId = input.clienteId ?? contesto.contestoConversazione?.clienteId ?? undefined;
    if (clienteId == null && !input.cliente) {
      return nonEseguito(nome, "Serve il cliente: indica clienteId (cerca_clienti) o il nome.");
    }
    if (clienteId != null) {
      const cliente: any = getClienteById(clienteId);
      if (!cliente || cliente.sedeId !== contesto.sedeId) {
        return nonEseguito(nome, "Cliente non trovato in questa sede.");
      }
    }
    try {
      const caller = await callerPer(contesto);
      const commessa: any = await caller.commesse.create({
        ...input,
        clienteId,
        note: input.note ? `${input.note} (creata da Tars)` : "Creata da Tars.",
      });
      return fatto({
        strumento: nome,
        stato: "creato",
        azioneId: `${nome}:commessa:${commessa.id}`,
        entitaToccate: [`commessa:${commessa.id}`, ...(clienteId != null ? [`cliente:${clienteId}`] : [])],
        dopo: { id: commessa.id, codice: commessa.codice, cliente: commessa.cliente, stato: commessa.stato, link: `/commesse/${commessa.id}` },
        evidenze: [evidenzaCommessa(commessa)],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

const aggiornaCommessa: StrumentoTars = {
  nome: "aggiorna_commessa",
  versione: "1.0.0",
  categoria: "commesse",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["commessa.update_operational"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Aggiorna i campi operativi di una commessa (indicata o attiva in conversazione): indirizzo/città del cantiere, contatti, priorità, note, consegna indicativa (30/60/90 giorni o data YYYY-MM-DD), data consegna confermata, cliente collegato. Passa SOLO i campi da cambiare. Lo stato si cambia con transizione_adiacente_commessa; gli importi dalla scheda.",
  schemaInput: z
    .object({
      commessaId: z.number().int().positive().optional(),
      clienteId: z.number().int().positive().optional(),
      indirizzo: z.string().max(160).optional(),
      citta: z.string().max(80).optional(),
      telefono: z.string().max(40).optional(),
      email: z.string().max(120).optional(),
      priorita: z.enum(PRIORITA).optional(),
      note: z.string().max(4000).optional(),
      consegnaIndicativa: z.enum(["30", "60", "90"]).nullable().optional(),
      dataConsegnaIndicativa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      dataConsegnaConfermata: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "aggiorna_commessa";
    const id = input.commessaId ?? commessaDalContesto(contesto);
    if (id == null) return nonEseguito(nome, "Non so quale commessa aggiornare: indica codice o cliente.");
    const prima = commessaInSede(contesto, id);
    if (!prima) return nonEseguito(nome, "Commessa non trovata in questa sede.");
    if (prima.stato === "archiviata" || prima.archivedAt) {
      return nonEseguito(nome, `La commessa ${prima.codice} è archiviata: ripristinala prima di modificarla.`);
    }
    const { commessaId: _id, ...campi } = input;
    void _id;
    if (Object.keys(campi).length === 0) return nonEseguito(nome, "Nessun campo da aggiornare.");
    try {
      const caller = await callerPer(contesto);
      const commessa: any = await caller.commesse.update({ id, ...campi });
      const primaSnapshot = Object.fromEntries(Object.keys(campi).map(k => [k, prima[k] ?? null]));
      return fatto({
        strumento: nome,
        stato: "aggiornato",
        azioneId: `${nome}:commessa:${id}:${Date.now()}`,
        entitaToccate: [`commessa:${id}`],
        prima: primaSnapshot,
        dopo: { id, codice: commessa.codice, ...campi, link: `/commesse/${id}` },
        evidenze: [evidenzaCommessa(commessa)],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

function strumentoArchivioCommessa(azione: "archivia" | "ripristina"): StrumentoTars {
  const nome = azione === "archivia" ? "archivia_commessa" : "ripristina_commessa";
  return {
    nome,
    versione: "1.0.0",
    categoria: "commesse",
    livello: "L2",
    effetto: "interno",
    reversibile: true,
    capability: ["commessa.update_operational"],
    interruttore: "tarsL2Actions",
    descrizione:
      azione === "archivia"
        ? "Archivia una commessa (lavoro concluso): esce dai quadri operativi, resta consultabile. Reversibile con ripristina_commessa."
        : "Ripristina una commessa archiviata: torna nei quadri operativi nello stato in cui era.",
    schemaInput: z.object({ commessaId: z.number().int().positive().optional() }).strict(),
    async esegui(contesto, input): Promise<EsitoAzione> {
      assicuraL2();
      const id = input.commessaId ?? commessaDalContesto(contesto);
      if (id == null) return nonEseguito(nome, "Non so quale commessa: indica codice o cliente.");
      const prima = commessaInSede(contesto, id);
      if (!prima) return nonEseguito(nome, "Commessa non trovata in questa sede.");
      const giaArchiviata = Boolean(prima.archivedAt);
      if (azione === "archivia" && giaArchiviata) {
        return nonEseguito(nome, `La commessa ${prima.codice} è già archiviata.`);
      }
      if (azione === "ripristina" && !giaArchiviata) {
        return nonEseguito(nome, `La commessa ${prima.codice} non è archiviata.`);
      }
      try {
        const caller = await callerPer(contesto);
        const commessa: any =
          azione === "archivia" ? await caller.commesse.archive(id) : await caller.commesse.restore(id);
        return fatto({
          strumento: nome,
          stato: azione === "archivia" ? "archiviata" : "ripristinata",
          azioneId: `${nome}:commessa:${id}:${Date.now()}`,
          entitaToccate: [`commessa:${id}`],
          prima: { archivedAt: prima.archivedAt ?? null },
          dopo: { id, codice: commessa.codice, archivedAt: commessa.archivedAt ?? null, link: `/commesse/${id}` },
          evidenze: [evidenzaCommessa(commessa)],
          avvertenze:
            azione === "archivia"
              ? ["Reversibile: «ripristina la commessa» la riporta operativa."]
              : [],
        });
      } catch (errore) {
        return nonEseguito(nome, motivoSicuro(errore));
      }
    },
  };
}

// ── Ticket ──────────────────────────────────────────────────────────────

const aggiornaTicket: StrumentoTars = {
  nome: "aggiorna_ticket",
  versione: "1.0.0",
  categoria: "post-vendita",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["ticket.manage"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Aggiorna un ticket di post-vendita: oggetto, descrizione, categoria, priorità, assegnatario (utenteId), commessa/cliente collegati. Passa SOLO i campi da cambiare. Per chiuderlo usa chiudi_ticket.",
  schemaInput: z
    .object({
      ticketId: z.number().int().positive(),
      oggetto: z.string().min(3).max(160).optional(),
      descrizione: z.string().max(2000).optional(),
      categoria: z.enum(TICKET_CATEGORIE).optional(),
      priorita: z.enum(TICKET_PRIORITA).optional(),
      assegnatoA: z.number().int().positive().nullable().optional(),
      commessaId: z.number().int().positive().nullable().optional(),
      clienteId: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "aggiorna_ticket";
    const prima: any = getTicketById(input.ticketId);
    if (!prima || prima.sedeId !== contesto.sedeId) return nonEseguito(nome, "Ticket non trovato in questa sede.");
    const { ticketId, ...campi } = input;
    if (Object.keys(campi).length === 0) return nonEseguito(nome, "Nessun campo da aggiornare.");
    try {
      const caller = await callerPer(contesto);
      const ticket: any = await caller.ticket.update({ id: ticketId, ...campi });
      return fatto({
        strumento: nome,
        stato: "aggiornato",
        azioneId: `${nome}:ticket:${ticketId}:${Date.now()}`,
        entitaToccate: [`ticket:${ticketId}`],
        prima: Object.fromEntries(Object.keys(campi).map(k => [k, prima[k] ?? null])),
        dopo: { id: ticketId, stato: ticket.stato, ...campi, link: `/post-vendita?ticket=${ticketId}` },
        evidenze: [{ tipo: "entita", riferimento: `ticket:${ticketId}`, descrizione: `Ticket #${ticketId} — ${ticket.oggetto}` }],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

const chiudiTicket: StrumentoTars = {
  nome: "chiudi_ticket",
  versione: "1.0.0",
  categoria: "post-vendita",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["ticket.manage"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Chiude un ticket di post-vendita (stato «chiuso») con l'esito dell'intervento se noto. Il ticket si può riaprire dalla pagina Post-vendita.",
  schemaInput: z
    .object({
      ticketId: z.number().int().positive(),
      esitoIntervento: z.string().max(1000).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "chiudi_ticket";
    const prima: any = getTicketById(input.ticketId);
    if (!prima || prima.sedeId !== contesto.sedeId) return nonEseguito(nome, "Ticket non trovato in questa sede.");
    if (prima.stato === "chiuso") return nonEseguito(nome, "Il ticket è già chiuso.");
    try {
      const caller = await callerPer(contesto);
      const ticket: any = await caller.ticket.updateStato({
        id: input.ticketId,
        stato: "chiuso",
        esitoIntervento: input.esitoIntervento,
      });
      return fatto({
        strumento: nome,
        stato: "chiuso",
        azioneId: `${nome}:ticket:${input.ticketId}:${Date.now()}`,
        entitaToccate: [`ticket:${input.ticketId}`],
        prima: { stato: prima.stato },
        dopo: { id: input.ticketId, stato: ticket.stato, esitoIntervento: ticket.esitoIntervento ?? null, link: `/post-vendita?ticket=${input.ticketId}` },
        evidenze: [{ tipo: "entita", riferimento: `ticket:${input.ticketId}`, descrizione: `Ticket #${input.ticketId} — ${ticket.oggetto}` }],
        avvertenze: ["Riapribile dalla pagina Post-vendita (rollback di stato)."],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

// ── Interventi ──────────────────────────────────────────────────────────

function dataLocaleDa(quando: string, adesso: Date): { data: string; assunzioni: string[] } {
  const risoluzione = risolviEspressioneTempo(quando, adesso);
  if (risoluzione.tipo === "locale") {
    return { data: risoluzione.dataLocale, assunzioni: risoluzione.assunzioni };
  }
  const locale = new TZDate(new Date(risoluzione.iso), "Europe/Rome");
  const mm = String(locale.getMonth() + 1).padStart(2, "0");
  const dd = String(locale.getDate()).padStart(2, "0");
  return { data: `${locale.getFullYear()}-${mm}-${dd}`, assunzioni: risoluzione.assunzioni };
}

const pianificaIntervento: StrumentoTars = {
  nome: "pianifica_intervento",
  versione: "1.0.0",
  categoria: "interventi",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["intervento.plan"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Pianifica un intervento (rilievo, posa, assistenza, altro) su una commessa (indicata o attiva), in una data: passa «quando» con le parole dell'utente («martedì prossimo», «domani mattina») oppure una data YYYY-MM-DD; orari facoltativi HH:MM. Va nel calendario della sede. Squadra e stato si gestiscono dal calendario.",
  schemaInput: z
    .object({
      commessaId: z.number().int().positive().optional(),
      tipo: z.enum(["rilievo", "posa", "assistenza", "altro"]),
      quando: z.string().min(1).max(120).optional(),
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      oraInizio: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      oraFine: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      indirizzo: z.string().max(160).optional(),
      note: z.string().max(1000).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "pianifica_intervento";
    const commessaId = input.commessaId ?? commessaDalContesto(contesto);
    if (commessaId == null) return nonEseguito(nome, "Non so su quale commessa: indica codice o cliente.");
    const commessa = commessaInSede(contesto, commessaId);
    if (!commessa) return nonEseguito(nome, "Commessa non trovata in questa sede.");
    if (!input.data && !input.quando) return nonEseguito(nome, "Serve la data: «quando» o data YYYY-MM-DD.");
    let data = input.data;
    let assunzioni: string[] = [];
    if (!data) {
      try {
        const risolta = dataLocaleDa(input.quando!, new Date());
        data = risolta.data;
        assunzioni = risolta.assunzioni;
      } catch (errore) {
        return nonEseguito(nome, `Non riesco a interpretare «${input.quando}»: indica una data precisa.`);
      }
    }
    try {
      const caller = await callerPer(contesto);
      const intervento: any = await caller.interventi.create({
        commessaId,
        tipo: input.tipo,
        dataPianificata: data,
        oraInizio: input.oraInizio ?? null,
        oraFine: input.oraFine ?? null,
        indirizzo: input.indirizzo ?? commessa.indirizzo ?? undefined,
        note: input.note ? `${input.note} (pianificato da Tars)` : "Pianificato da Tars.",
      });
      return {
        ...fatto({
          strumento: nome,
          stato: "pianificato",
          azioneId: `${nome}:intervento:${intervento.id}`,
          entitaToccate: [`intervento:${intervento.id}`, `commessa:${commessaId}`],
          dopo: { id: intervento.id, tipo: intervento.tipo, data, oraInizio: intervento.oraInizio, oraFine: intervento.oraFine, link: "/calendario" },
          evidenze: [evidenzaCommessa(commessa), { tipo: "entita", riferimento: `intervento:${intervento.id}`, descrizione: `${intervento.tipo} il ${data}` }],
          avvertenze: ["Senza squadra assegnata: si assegna dal calendario."],
        }),
        assunzioni,
      };
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

// ── Comunicazioni ───────────────────────────────────────────────────────

const collegaComunicazione: StrumentoTars = {
  nome: "collega_comunicazione",
  versione: "1.0.0",
  categoria: "comunicazioni",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.read"],
  interruttore: ["tarsL2Actions", "tarsCommunications"],
  descrizione:
    "Collega una comunicazione (email/WhatsApp) a una commessa oppure a un cliente; con nessuno dei due la scollega. Il collegamento la segna come gestita e (se commessa) classificata operativa.",
  schemaInput: z
    .object({
      comunicazioneId: z.number().int().positive(),
      commessaId: z.number().int().positive().nullable().optional(),
      clienteId: z.number().int().positive().nullable().optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "collega_comunicazione";
    const c = await getLiveComunicazione(input.comunicazioneId, contesto.sedeId);
    if (!c) return nonEseguito(nome, "Comunicazione non trovata in questa sede.");
    const commessaId = input.commessaId === undefined && input.clienteId === undefined ? commessaDalContesto(contesto) : input.commessaId ?? null;
    const clienteId = input.commessaId != null ? undefined : input.clienteId ?? null;
    if (commessaId == null && clienteId == null && input.commessaId === undefined && input.clienteId === undefined) {
      return nonEseguito(nome, "Indica la commessa o il cliente a cui collegare.");
    }
    try {
      const caller = await callerPer(contesto);
      await caller.mail.comunicazioni.collega(
        commessaId != null ? { id: c.id, commessaId } : { id: c.id, clienteId: clienteId ?? null, commessaId: commessaId ?? null }
      );
      const dopo = await getLiveComunicazione(c.id, contesto.sedeId);
      return fatto({
        strumento: nome,
        stato: commessaId != null || clienteId != null ? "collegata" : "scollegata",
        azioneId: `${nome}:comunicazione:${c.id}:${Date.now()}`,
        entitaToccate: [`comunicazione:${c.id}`, ...(commessaId != null ? [`commessa:${commessaId}`] : [])],
        prima: { commessaId: c.commessaId, clienteId: c.clienteId },
        dopo: { id: c.id, commessaId: dopo?.commessaId ?? null, clienteId: dopo?.clienteId ?? null, link: `/messaggi/email?messaggio=${c.id}` },
        evidenze: [{ tipo: "entita", riferimento: `comunicazione:${c.id}`, descrizione: c.oggetto || c.mittente }],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

const classificaComunicazione: StrumentoTars = {
  nome: "classifica_comunicazione",
  versione: "1.0.0",
  categoria: "comunicazioni",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.read"],
  interruttore: ["tarsL2Actions", "tarsCommunications"],
  descrizione:
    "Classifica una comunicazione (operativa, nuovo_lead, amministrativa, fornitore, offerta_marketing, spam). Spam e marketing la escludono dalla coda.",
  schemaInput: z
    .object({
      comunicazioneId: z.number().int().positive(),
      categoria: z.enum(CATEGORIE_COMUNICAZIONE),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "classifica_comunicazione";
    const c = await getLiveComunicazione(input.comunicazioneId, contesto.sedeId);
    if (!c) return nonEseguito(nome, "Comunicazione non trovata in questa sede.");
    try {
      const caller = await callerPer(contesto);
      await caller.mail.comunicazioni.setCategoria({ id: c.id, categoria: input.categoria });
      return fatto({
        strumento: nome,
        stato: "classificata",
        azioneId: `${nome}:comunicazione:${c.id}:${Date.now()}`,
        entitaToccate: [`comunicazione:${c.id}`],
        prima: { categoria: c.categoria },
        dopo: { id: c.id, categoria: input.categoria },
        evidenze: [{ tipo: "entita", riferimento: `comunicazione:${c.id}`, descrizione: c.oggetto || c.mittente }],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

const gestisciComunicazione: StrumentoTars = {
  nome: "segna_gestita_comunicazione",
  versione: "1.0.0",
  categoria: "comunicazioni",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.read"],
  interruttore: ["tarsL2Actions", "tarsCommunications"],
  descrizione:
    "Segna una comunicazione come gestita (o la riapre con gestita=false): esce dalla coda «da gestire» del modulo Messaggi.",
  schemaInput: z
    .object({
      comunicazioneId: z.number().int().positive(),
      gestita: z.boolean().default(true),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "segna_gestita_comunicazione";
    const c = await getLiveComunicazione(input.comunicazioneId, contesto.sedeId);
    if (!c) return nonEseguito(nome, "Comunicazione non trovata in questa sede.");
    try {
      const caller = await callerPer(contesto);
      await caller.mail.comunicazioni.setStato({ id: c.id, stato: input.gestita ? "gestita" : "vista" });
      return fatto({
        strumento: nome,
        stato: input.gestita ? "gestita" : "riaperta",
        azioneId: `${nome}:comunicazione:${c.id}:${Date.now()}`,
        entitaToccate: [`comunicazione:${c.id}`],
        prima: { stato: c.stato },
        dopo: { id: c.id, stato: input.gestita ? "gestita" : "vista" },
        evidenze: [{ tipo: "entita", riferimento: `comunicazione:${c.id}`, descrizione: c.oggetto || c.mittente }],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

// ── Centro Azioni ───────────────────────────────────────────────────────

const risolviCaso: StrumentoTars = {
  nome: "risolvi_caso",
  versione: "1.0.0",
  categoria: "operativita",
  livello: "L2",
  effetto: "interno",
  reversibile: false,
  capability: ["commessa.read"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Risolve un caso del Centro Azioni (chiuso perché sistemato) oppure lo segna non rilevante con un motivo. Solo casi propri o da direzione.",
  schemaInput: z
    .object({
      casoId: z.number().int().positive(),
      esito: z.enum(["risolto", "non_rilevante"]).default("risolto"),
      motivo: z.string().max(300).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "risolvi_caso";
    const repo = getActionCaseRepository();
    const caso = await repo.findById(contesto.sedeId, input.casoId);
    if (!caso) return nonEseguito(nome, "Caso non trovato.");
    if (caso.status === "risolta") return nonEseguito(nome, "Il caso è già risolto.");
    if (input.esito === "non_rilevante" && !input.motivo?.trim()) {
      return nonEseguito(nome, "Per segnarlo non rilevante serve un motivo.");
    }
    try {
      const aggiornato = await transitionActionCase({
        repository: repo,
        sedeId: contesto.sedeId,
        caseId: caso.id,
        expectedFingerprint: caso.signalFingerprint,
        userId: contesto.utenteId,
        roles: contesto.ruoli,
        action: input.esito === "risolto" ? "resolve" : "dismiss",
        reason: input.motivo,
        now: new Date(),
      });
      return fatto({
        strumento: nome,
        stato: input.esito === "risolto" ? "risolto" : "non_rilevante",
        azioneId: `${nome}:caso:${caso.id}:${Date.now()}`,
        entitaToccate: [`caso:${caso.id}`, ...(caso.commessaId != null ? [`commessa:${caso.commessaId}`] : [])],
        prima: { stato: caso.status },
        dopo: { id: caso.id, stato: aggiornato.status, titolo: caso.title, link: caso.link },
        evidenze: [{ tipo: "caso", riferimento: `caso:${caso.id}`, descrizione: caso.title }],
      });
    } catch (errore: any) {
      const messaggio = String(errore?.message ?? "");
      if (messaggio === "FORBIDDEN") return nonEseguito(nome, "Puoi risolvere solo i casi tuoi (o essere direzione).");
      if (messaggio === "STALE_ACTION_CASE") return nonEseguito(nome, "Il caso è cambiato nel frattempo: rileggilo e riprova.");
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

// ── Fatture (FiC) ───────────────────────────────────────────────────────

const collegaFatturaCommessa: StrumentoTars = {
  nome: "collega_fattura_commessa",
  versione: "1.0.0",
  categoria: "economia",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["economia.read"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Collega una fattura di Fatture in Cloud a una commessa della sede: il pattuito si aggiorna dalla fattura, gli incassi si riconciliano e il PDF finisce nel fascicolo. Richiede direzione o amministrazione. Trova prima la fattura con cerca_fatture.",
  schemaInput: z
    .object({
      ficId: z.number().int().positive(),
      commessaId: z.number().int().positive(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "collega_fattura_commessa";
    const fattura: any = (ficFatture as any[]).find(
      f => f.id === input.ficId && f.sedeId === contesto.sedeId
    );
    if (!fattura) return nonEseguito(nome, "Fattura non trovata in questa sede.");
    const commessa = commessaInSede(contesto, input.commessaId);
    if (!commessa) return nonEseguito(nome, "Commessa non trovata in questa sede.");
    if (commessa.archivedAt) {
      return nonEseguito(nome, "La commessa è archiviata: ripristinala prima.");
    }
    if (fattura.commessaId === input.commessaId) {
      return nonEseguito(nome, "La fattura è già collegata a questa commessa.");
    }
    const prima = {
      commessaId: fattura.commessaId ?? null,
      collegataAMano: fattura.collegataAMano ?? false,
    };
    try {
      const caller = await callerPer(contesto);
      const esito = await caller.ficFatture.collega({
        ficId: input.ficId,
        commessaId: input.commessaId,
      });
      return fatto({
        strumento: nome,
        stato: "collegata",
        azioneId: `${nome}:fattura:${input.ficId}:${Date.now()}`,
        entitaToccate: [`fattura:${input.ficId}`, `commessa:${commessa.id}`],
        prima,
        dopo: {
          ficId: input.ficId,
          numero: fattura.numero,
          commessaId: commessa.id,
          commessa: `${commessa.codice} — ${commessa.cliente}`,
          pdfNelFascicolo: esito.pdf.stato === "archiviata",
          documentoId: esito.documentoId,
        },
        evidenze: [
          evidenzaCommessa(commessa),
          {
            tipo: "entita",
            riferimento: `fattura:${input.ficId}`,
            descrizione: `Fattura n. ${fattura.numero} del ${fattura.data} — ${fattura.clienteNome}`,
          },
        ],
        avvertenze: [
          "Pattuito e incassi della commessa ora derivano dalla fattura (dominio FiC).",
          ...(esito.pdf.stato === "errore"
            ? [`PDF non archiviato: ${esito.pdf.errore ?? "errore sconosciuto"}`]
            : []),
        ],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

// ── Documenti del fascicolo ─────────────────────────────────────────────

const spostaDocumento: StrumentoTars = {
  nome: "sposta_documento",
  versione: "1.0.0",
  categoria: "documenti",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.manage_documents"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Sposta un documento nel fascicolo di un'altra commessa della stessa sede (correzione di archiviazione, non una copia). Il gate documentale segue il documento: statoAtUpload diventa lo stato della commessa di destinazione. Trova prima il documento con cerca_documenti.",
  schemaInput: z
    .object({
      documentoId: z.number().int().positive(),
      commessaId: z.number().int().positive(),
      note: z.string().max(300).optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraL2();
    const nome = "sposta_documento";
    if (!contesto.capability.has("commessa.manage_documents")) {
      return nonEseguito(nome, "Non autorizzato: servono i permessi sui documenti delle commesse.");
    }
    const documento = getDocumentoCommessaById(input.documentoId, contesto.sedeId);
    if (!documento) return nonEseguito(nome, "Documento non trovato in questa sede.");
    const prima = {
      commessaId: documento.commessaId,
      nome: documento.nome,
      statoAtUpload: documento.statoAtUpload ?? null,
    };
    try {
      const { documento: spostato, da, a } = spostaDocumentoDiCommessa({
        documentoId: input.documentoId,
        commessaId: input.commessaId,
        sedeId: contesto.sedeId,
        note: input.note,
      });
      const origine: any = getCommessaById(da);
      const destinazione: any = getCommessaById(a);
      return fatto({
        strumento: nome,
        stato: "spostato",
        azioneId: `${nome}:documento:${spostato.id}:${Date.now()}`,
        entitaToccate: [`documento:${spostato.id}`, `commessa:${da}`, `commessa:${a}`],
        prima,
        dopo: {
          documentoId: spostato.id,
          nome: spostato.nome,
          commessaId: a,
          commessa: destinazione ? `${destinazione.codice} — ${destinazione.cliente}` : null,
          statoAtUpload: spostato.statoAtUpload ?? null,
        },
        evidenze: [
          {
            tipo: "entita",
            riferimento: `documento:${spostato.id}`,
            descrizione: `${spostato.tipo} «${spostato.nome}»`,
          },
          ...(destinazione ? [evidenzaCommessa(destinazione)] : []),
        ],
        avvertenze: [
          ...(origine
            ? [`Tolto dal fascicolo di ${origine.codice ?? `commessa ${da}`}: il suo gate documentale va ricontrollato.`]
            : []),
          ...(spostato.nome !== prima.nome
            ? [`Rinominato in «${spostato.nome}»: il nome era già preso nella destinazione.`]
            : []),
        ],
      });
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

export const STRUMENTI_SCRITTURA: readonly StrumentoTars[] = [
  creaCliente,
  aggiornaCliente,
  creaCommessa,
  aggiornaCommessa,
  strumentoArchivioCommessa("archivia"),
  strumentoArchivioCommessa("ripristina"),
  aggiornaTicket,
  chiudiTicket,
  pianificaIntervento,
  collegaComunicazione,
  classificaComunicazione,
  gestisciComunicazione,
  risolviCaso,
  collegaFatturaCommessa,
  spostaDocumento,
];
