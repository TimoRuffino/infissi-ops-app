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
import type { Proposta } from "./stores";

let _appRouterPromise: Promise<any> | null = null;
async function getCaller(ctx: TrpcContext) {
  if (!_appRouterPromise) {
    _appRouterPromise = import("../routers").then((m) => m.appRouter);
  }
  const appRouter = await _appRouterPromise;
  return appRouter.createCaller(ctx);
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
