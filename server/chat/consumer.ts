// Assegnazioni → chat aziendale.
//
// Consumer separato dal proiettore delle notifiche, di proposito: la
// campanella è dietro il flag `notificationMode`, mentre il messaggio in
// chat deve arrivare comunque. Sono due canali con due scopi — la notifica
// si legge e sparisce, il messaggio resta nella conversazione.

import type { BusinessEventConsumer } from "../events/registry";
import type { BusinessEvent } from "../events/types";
import { getUtentiStore } from "../routers/utenti";
import { annunciaAssegnazione } from "./annunci";

const EVENTI_ASSEGNAZIONE = [
  "cliente.assigned",
  "commessa.assigned",
  "ticket.assigned",
  "intervento.assigned",
  "azione_operativa.assigned",
] as const;

const ETICHETTA_ENTITA: Record<string, string> = {
  cliente: "un cliente",
  commessa: "una commessa",
  ticket: "un ticket",
  intervento: "un intervento",
  azione_operativa: "un'azione operativa",
};

function nomeUtente(utente: any): string {
  return (
    [utente?.nome, utente?.cognome].filter(Boolean).join(" ") ||
    utente?.name ||
    "Un collega"
  );
}

export function createChatAssignmentConsumer(
  options: { getUsers?: () => any[] } = {}
): BusinessEventConsumer {
  const getUsers = options.getUsers ?? getUtentiStore;
  return {
    name: "chat-assignment-v1",
    eventTypes: EVENTI_ASSEGNAZIONE,
    async handle(event: BusinessEvent) {
      const assegnatarioId = event.payload.assigneeId;
      if (typeof assegnatarioId !== "number") return;
      // Assegnarsi qualcosa da soli non merita un messaggio: chi l'ha fatto
      // lo sa già.
      if (event.actorUserId === assegnatarioId) return;

      const utenti = getUsers();
      const assegnatario = utenti.find(
        (u: any) =>
          Number(u.id) === assegnatarioId &&
          u.attivo !== false &&
          Array.isArray(u.sediIds) &&
          u.sediIds.includes(event.sedeId)
      );
      if (!assegnatario) return;
      const attore = utenti.find(
        (u: any) => Number(u.id) === Number(event.actorUserId)
      );

      await annunciaAssegnazione({
        sedeId: event.sedeId,
        assegnatarioId,
        assegnatarioNome: nomeUtente(assegnatario),
        attore: nomeUtente(attore),
        entita: ETICHETTA_ENTITA[event.source.type] ?? "un'attività",
        titolo:
          typeof event.payload.titolo === "string" && event.payload.titolo
            ? event.payload.titolo
            : `${event.source.type} #${event.source.id}`,
        commessaId:
          event.source.type === "commessa" ? Number(event.source.id) : null,
        link:
          typeof event.payload.link === "string" ? event.payload.link : "/",
      });
    },
  };
}
