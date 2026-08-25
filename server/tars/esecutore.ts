// Esecutore delle proposte approvate.
//
// All'approvazione la proposta passa dalla STESSA mutation tRPC che
// chiamerebbe un umano, con il ctx dell'operatore che approva: doc gate,
// validateTransizione, assertSedeScope e permessi di ruolo valgono
// automaticamente. Tars non ha una porta di servizio.
//
// Se la mutation fallisce (es. doc gate), la proposta va in stato "errore"
// con il messaggio: l'operatore vede PERCHÉ, e la coda non mente mai.

import type { TrpcContext } from "../_core/context";
import {
  getWorkflowOperation,
  saveWorkflowOperation,
  type Proposta,
} from "./stores";
import {
  executeCreateCustomerJobSaga,
  type CreateCustomerJobResult,
  type CreateCustomerJobServices,
} from "./workflows/createCustomerJob";

const activeCustomerJobOperations = new Map<
  string,
  Promise<CreateCustomerJobResult>
>();

let _appRouterPromise: Promise<any> | null = null;
async function getCaller(ctx: TrpcContext) {
  if (!_appRouterPromise) {
    _appRouterPromise = import("../routers").then(m => m.appRouter);
  }
  const appRouter = await _appRouterPromise;
  return appRouter.createCaller(ctx);
}

function normalizza(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function soloCifre(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function prodottiKey(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map(item => `${normalizza(item?.nome)}:${Number(item?.quantita) || 1}`)
    .filter(Boolean)
    .sort()
    .join("|");
}

async function createCustomerJobServices(
  ctx: TrpcContext
): Promise<CreateCustomerJobServices> {
  const caller = await getCaller(ctx);
  const sedeId = ctx.sedeId ?? 1;
  const { getClientiStore, getClienteById } = await import(
    "../routers/clienti"
  );
  const { getCommesseStore, getCommessaById } = await import(
    "../routers/commesse"
  );
  const { getUtentiStore } = await import("../routers/utenti");
  const { getComunicazione, setMatchComunicazione } = await import(
    "./comunicazioni"
  );
  return {
    async loadOperation(operationKey, operationSedeId) {
      return getWorkflowOperation(operationKey, operationSedeId);
    },
    async saveOperation(operation) {
      saveWorkflowOperation(operation);
    },
    async findEquivalentCustomer(customer, operationSedeId) {
      const email = normalizza(customer.email);
      const phone = soloCifre(customer.telefono);
      const name = normalizza(`${customer.cognome} ${customer.nome}`);
      const found = getClientiStore().find((item: any) => {
        if (item.sedeId !== operationSedeId || item.archivedAt) return false;
        if (email && normalizza(item.email) === email) return true;
        if (phone.length >= 6 && soloCifre(item.telefono) === phone)
          return true;
        return (
          !email &&
          !phone &&
          normalizza(`${item.cognome} ${item.nome}`) === name
        );
      });
      return found ? { id: found.id, sedeId: found.sedeId } : null;
    },
    async findEquivalentJob(customerId, job, operationSedeId) {
      const note = normalizza(job.note);
      const products = prodottiKey(job.prodotti);
      const found = getCommesseStore().find((item: any) => {
        if (
          item.sedeId !== operationSedeId ||
          item.clienteId !== customerId ||
          item.archivedAt
        ) {
          return false;
        }
        const sameNote = note && normalizza(item.note) === note;
        const sameProducts =
          products && prodottiKey(item.prodotti) === products;
        return Boolean(sameNote && sameProducts);
      });
      return found
        ? { id: found.id, clienteId: found.clienteId, sedeId: found.sedeId }
        : null;
    },
    async validateAssignee(assigneeId, operationSedeId) {
      const current: any = ctx.user;
      if (Number(current?.id) === assigneeId) {
        return { id: assigneeId, sedeId: operationSedeId, active: true };
      }
      const user: any = getUtentiStore().find(
        (item: any) => item.id === assigneeId
      );
      if (!user || !(user.attivo ?? true)) return null;
      const validSite =
        !Array.isArray(user.sediIds) || user.sediIds.includes(operationSedeId);
      return validSite
        ? { id: assigneeId, sedeId: operationSedeId, active: true }
        : null;
    },
    async createCustomer(customer) {
      const created = await caller.clienti.create(customer);
      return { id: created.id, sedeId: created.sedeId };
    },
    async createJob(customerId, job) {
      const created = await caller.commesse.create({
        ...job,
        clienteId: customerId,
      });
      return {
        id: created.id,
        clienteId: created.clienteId,
        sedeId: created.sedeId,
      };
    },
    async linkCommunication(communicationId, customerId, jobId) {
      return setMatchComunicazione(communicationId, sedeId, {
        clienteId: customerId,
        commessaId: jobId,
        confidenza: "alta",
        motivo: "Nuovo lead creato da Tars e approvato da un operatore.",
      });
    },
    async verify({
      customerId,
      jobId,
      communicationId,
      sedeId: operationSedeId,
    }) {
      const customer: any = getClienteById(customerId);
      const job: any = getCommessaById(jobId);
      if (communicationId != null) {
        const communication = await getComunicazione(
          communicationId,
          operationSedeId
        );
        if (
          !communication ||
          communication.clienteId !== customerId ||
          communication.commessaId !== jobId
        ) {
          return { customer: null, job: null };
        }
      }
      return {
        customer: customer
          ? { id: customer.id, sedeId: customer.sedeId }
          : null,
        job: job
          ? { id: job.id, clienteId: job.clienteId, sedeId: job.sedeId }
          : null,
      };
    },
  };
}

// Esegue la mutation target della proposta. Ritorna una descrizione
// leggibile dell'esito. Lancia se la mutation fallisce.
export async function eseguiProposta(
  proposta: Proposta,
  ctx: TrpcContext
): Promise<string> {
  const caller = await getCaller(ctx);
  const p = proposta.payload ?? {};

  switch (proposta.tipo) {
    case "collega_fattura": {
      // Il collegamento passa dalla stessa mutation dell'operatore: sede
      // scope verificato lì, e la riconciliazione deterministica riparte
      // subito — le proposte su pattuito e incassi arrivano da sole.
      const esito = await caller.ficFatture.collega({
        ficId: p.ficId,
        commessaId: p.commessaId,
      });
      return esito.proposteCreate > 0
        ? `Fattura ${p.fatturaNumero} collegata a ${p.commessaCodice} — ${esito.proposteCreate} proposte su pattuito/incassi in coda`
        : `Fattura ${p.fatturaNumero} collegata a ${p.commessaCodice}`;
    }
    case "collega_comunicazione": {
      const { setMatchComunicazione } = await import("./comunicazioni");
      const ok = await setMatchComunicazione(
        p.comunicazioneId,
        ctx.sedeId ?? 1,
        {
          clienteId: p.clienteId ?? null,
          commessaId: p.commessaId,
          confidenza: "alta",
          motivo: "Collegamento proposto da Tars, approvato da un operatore.",
        }
      );
      if (!ok) throw new Error("Comunicazione non trovata.");
      return `Comunicazione collegata a ${p.commessaCodice ?? `commessa #${p.commessaId}`}`;
    }
    case "archivia_allegato": {
      const sedeId = ctx.sedeId ?? 1;
      const { getComunicazione, setMatchComunicazione } = await import(
        "./comunicazioni"
      );
      const { leggiAllegatoRaw } = await import("./allegati");
      const {
        archiviaAllegatoComunicazione,
        DOC_TIPI,
      } = await import("../routers/preventiviContratti");
      const { getCommessaById } = await import("../routers/commesse");

      const comunicazione = await getComunicazione(
        Number(p.comunicazioneId),
        sedeId
      );
      if (
        !comunicazione ||
        comunicazione.deletedAt ||
        comunicazione.canale !== "email"
      ) {
        throw new Error("Email non trovata.");
      }
      const allegatoIndex = Number(p.allegatoIndex);
      const allegato = comunicazione.allegati[allegatoIndex];
      if (!allegato) throw new Error("Allegato non trovato.");
      if (
        allegato.nome !== p.attachmentName ||
        allegato.mimeType !== p.expectedMimeType
      ) {
        throw new Error(
          "L'allegato e cambiato dopo la proposta: serve una nuova verifica."
        );
      }
      const commessa: any = getCommessaById(Number(p.commessaId));
      if (!commessa || Number(commessa.sedeId) !== sedeId) {
        throw new Error("Commessa non trovata.");
      }
      if (
        comunicazione.commessaId != null &&
        comunicazione.commessaId !== commessa.id
      ) {
        throw new Error(
          "L'email e stata collegata a un'altra commessa dopo la proposta."
        );
      }
      if (!(DOC_TIPI as readonly string[]).includes(String(p.tipoDocumento))) {
        throw new Error("Tipo documento non valido.");
      }

      if (comunicazione.commessaId == null) {
        const linked = await setMatchComunicazione(
          comunicazione.id,
          sedeId,
          {
            clienteId: Number(commessa.clienteId) || null,
            commessaId: commessa.id,
            confidenza: "alta",
            motivo:
              "Allegato operativo verificato da Tars e approvato da un operatore.",
          }
        );
        if (!linked) throw new Error("Email non trovata.");
      }

      const raw = await leggiAllegatoRaw(comunicazione, allegatoIndex);
      const documento = await archiviaAllegatoComunicazione({
        sedeId,
        comunicazioneId: comunicazione.id,
        allegatoIndex,
        commessaId: commessa.id,
        nome: String(p.nomeSuggerito),
        tipo: p.tipoDocumento,
        note: "Classificato da Tars e approvato da un operatore.",
        mimeType: raw.mimeType,
        buffer: raw.buffer,
        createdBy: Number((ctx.user as any)?.id) || null,
      });
      if (
        documento.commessaId !== commessa.id ||
        documento.tipo !== p.tipoDocumento ||
        (!documento.storageKey && !documento.dataBase64)
      ) {
        throw new Error(
          "Il documento non risulta disponibile nel fascicolo dopo l'archiviazione."
        );
      }
      return `${documento.nome} archiviato nella commessa ${commessa.codice ?? `#${commessa.id}`} (documento #${documento.id})`;
    }
    case "crea_lead": {
      const { getComunicazione, setClassificazioneComunicazione } =
        await import("./comunicazioni");
      const parsedComunicazioneId = Number(p.comunicazioneId);
      const comunicazioneId =
        p.comunicazioneId != null &&
        Number.isSafeInteger(parsedComunicazioneId) &&
        parsedComunicazioneId > 0
          ? parsedComunicazioneId
          : null;
      const comunicazione =
        comunicazioneId != null
          ? await getComunicazione(comunicazioneId, ctx.sedeId ?? 1)
          : null;
      if (
        comunicazioneId != null &&
        (!comunicazione || comunicazione.deletedAt)
      ) {
        throw new Error("Comunicazione non trovata.");
      }
      if (comunicazione?.commessaId != null) {
        throw new Error(
          "La comunicazione è già collegata: il nuovo lead non è stato creato."
        );
      }
      const operationKey =
        p.operationKey ?? proposta.chiaveAzione ?? `crea_lead:${proposta.id}`;
      const flightKey = `${ctx.sedeId ?? 1}:${operationKey}`;
      let active = activeCustomerJobOperations.get(flightKey);
      if (!active) {
        active = executeCreateCustomerJobSaga({
          sedeId: ctx.sedeId ?? 1,
          operationKey,
          input: {
            customer: p.cliente,
            job: p.commessa,
            ...(comunicazioneId != null
              ? { communicationId: comunicazioneId }
              : {}),
          },
          services: await createCustomerJobServices(ctx),
        });
        activeCustomerJobOperations.set(flightKey, active);
        void active.then(
          () => activeCustomerJobOperations.delete(flightKey),
          () => activeCustomerJobOperations.delete(flightKey)
        );
      }
      const result = await active;
      if (result.status === "waiting_user") {
        throw Object.assign(new Error("Assegnatario mancante o non valido."), {
          code: result.errorCode,
        });
      }
      if (result.status === "failed") {
        throw Object.assign(
          new Error(`Creazione non avviata (${result.errorCode}).`),
          { code: result.errorCode }
        );
      }
      if (result.status === "partially_completed") {
        throw Object.assign(
          new Error(
            `Creazione parziale: cliente #${result.customerId} conservato; riprovare per completare la commessa (${result.errorCode}).`
          ),
          { code: result.errorCode }
        );
      }
      if (comunicazioneId != null) {
        await setClassificazioneComunicazione(
          comunicazioneId,
          ctx.sedeId ?? 1,
          {
            categoria: "nuovo_lead",
            motivo: "Cliente e commessa creati da una proposta Tars approvata.",
            fonte: "tars",
          }
        );
      }
      return comunicazioneId != null
        ? `Cliente #${result.customerId} e commessa #${result.jobId} pronti; comunicazione collegata`
        : `Cliente #${result.customerId} e commessa #${result.jobId} pronti`;
    }
    case "rinomina_documento": {
      const updates: any = { id: p.documentoId };
      if (p.nome) updates.nome = p.nome;
      if (p.tipo) updates.tipo = p.tipo;
      const doc = await caller.preventiviContratti.update(updates);
      return `Documento aggiornato: ${doc.nome} (${doc.tipo})`;
    }
    case "nota_timeline": {
      await caller.timeline.updateStep({ id: p.stepId, note: p.note });
      return "Nota della timeline aggiornata";
    }
    case "aggiornamento_magazzino": {
      await caller.magazzino.update({ id: p.prodottoId, ...p.campi });
      return "Prodotto a magazzino aggiornato";
    }
    case "modifica_cliente": {
      await caller.clienti.update({ id: p.clienteId, ...p.campi });
      return "Anagrafica cliente aggiornata";
    }
    case "modifica_commessa": {
      await caller.commesse.update({ id: p.commessaId, ...p.campi });
      return "Commessa aggiornata";
    }
    case "ticket": {
      const t = await caller.ticket.create({
        commessaId: p.commessaId ?? null,
        clienteId: p.clienteId ?? null,
        contatto: p.contatto ?? null,
        oggetto: p.oggetto,
        descrizione: p.descrizione,
        categoria: p.categoria,
        priorita: p.priorita,
      });
      return `Ticket #${t.id} aperto`;
    }
    case "pagamento": {
      const c = await caller.commesse.addPagamento({
        commessaId: p.commessaId,
        importo: p.importo,
        data: p.data ?? null,
        metodo: p.metodo ?? null,
        tipo: p.tipo ?? null,
        note: p.note,
      });
      return `Rata registrata. Incassato aggiornato: € ${c.importoIncassato}`;
    }
    case "avanzamento_stato": {
      // Nessun force: il doc gate resta pienamente attivo. Se blocca,
      // l'errore DOC_GATE_BLOCKED arriva all'operatore così com'è.
      const c = await caller.commesse.update({
        id: p.commessaId,
        stato: p.nuovoStato,
      });
      return `Commessa spostata in "${c.stato}"`;
    }
    // Nessuna mutation: l'approvazione è una presa d'atto.
    case "bozza_risposta":
      return "Bozza approvata — da copiare e inviare a mano";
    case "segnalazione":
      return "Segnalazione presa in carico";
    case "miglioramento_processo":
      return "Miglioramento di processo preso in carico dalla direzione";
    case "domanda":
      // Le domande non si "approvano": si risponde (tars.rispondi).
      throw new Error(
        "Le domande non si approvano: usa la risposta con le opzioni proposte."
      );
    default:
      throw new Error(`Tipo proposta non gestito: ${proposta.tipo}`);
  }
}
