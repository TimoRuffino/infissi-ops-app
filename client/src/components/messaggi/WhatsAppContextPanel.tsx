import TarsPropostaCard from "@/components/TarsPropostaCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { WhatsAppConversation } from "@/lib/messaggi";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarDays,
  ExternalLink,
  LifeBuoy,
  UserRound,
} from "lucide-react";
import { Link } from "wouter";

function contextDate(value: string | null | undefined): string {
  if (!value) return "Data da definire";
  return new Date(`${value}T00:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
  });
}

export default function WhatsAppContextPanel({
  conversation,
  communicationIds,
}: {
  conversation: WhatsAppConversation;
  communicationIds: number[];
}) {
  const client = trpc.clienti.byId.useQuery(conversation.clienteId ?? 0, {
    enabled: conversation.clienteId != null,
  });
  const job = trpc.commesse.byId.useQuery(conversation.commessaId ?? 0, {
    enabled: conversation.commessaId != null,
  });
  const proposals = trpc.tars.proposte.list.useQuery(
    {
      stato: "pendente",
      commessaId: conversation.commessaId ?? 0,
      comunicazioneIds: communicationIds,
    },
    {
      enabled: conversation.commessaId != null && communicationIds.length > 0,
      retry: false,
    }
  );
  const appointments = trpc.interventi.list.useQuery(
    { commessaId: conversation.commessaId ?? 0 },
    { enabled: conversation.commessaId != null, retry: false }
  );
  const tickets = trpc.ticket.list.useQuery(
    conversation.commessaId != null
      ? { commessaId: conversation.commessaId }
      : { clienteId: conversation.clienteId ?? 0 },
    {
      enabled:
        conversation.commessaId != null || conversation.clienteId != null,
      retry: false,
    }
  );
  const appointmentRows = appointments.data ?? [];
  const ticketRows = tickets.data ?? [];

  return (
    <aside aria-label="Contesto conversazione" className="flex min-h-0 min-w-0 flex-col bg-card">
      <header className="border-b border-border-soft px-4 py-3">
        <h2 className="text-sm font-bold">Contesto</h2>
        <p className="mt-1 text-xs leading-5 text-text-3">{conversation.controparte}</p>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="text-xs font-bold uppercase text-text-3">Cliente</h3>
          {conversation.clienteId == null ? (
            <p className="mt-2 text-sm text-text-2">Nessun cliente collegato</p>
          ) : client.isLoading ? (
            <Skeleton className="mt-2 h-10 w-full" />
          ) : (
            <Link href={`/clienti/${conversation.clienteId}`} className="mt-2 flex min-h-11 items-center gap-2 rounded-md border border-border-soft px-3 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <UserRound className="size-4 shrink-0 text-text-3" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{client.data ? `${client.data.cognome ?? ""} ${client.data.nome ?? ""}`.trim() : conversation.nomeProfilo}</span>
              <ExternalLink className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
            </Link>
          )}
        </section>

        <section>
          <h3 className="text-xs font-bold uppercase text-text-3">Commessa</h3>
          {conversation.commessaId == null ? (
            <p className="mt-2 text-sm text-text-2">Nessuna commessa collegata</p>
          ) : job.isLoading ? (
            <Skeleton className="mt-2 h-10 w-full" />
          ) : (
            <Link href={`/commesse/${conversation.commessaId}`} className="mt-2 flex min-h-11 items-center gap-2 rounded-md border border-border-soft px-3 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <BriefcaseBusiness className="size-4 shrink-0 text-text-3" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{job.data?.codice ?? "Commessa collegata"}</span>
              <ExternalLink className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
            </Link>
          )}
        </section>

        <section>
          <h3 className="text-xs font-bold uppercase text-text-3">Appuntamenti</h3>
          <div className="mt-2 space-y-2">
            {conversation.commessaId == null ? (
              <p className="text-sm text-text-2">Nessuna commessa collegata</p>
            ) : appointments.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : appointments.isError ? (
              <p className="flex gap-2 text-xs leading-5 text-destructive" role="alert">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Appuntamenti non disponibili
              </p>
            ) : appointmentRows.length === 0 ? (
              <p className="text-sm text-text-2">Nessun appuntamento</p>
            ) : (
              appointmentRows.slice(0, 3).map((appointment: any) => (
                <div key={appointment.id} className="flex min-h-11 items-center gap-2 border-b border-border-soft py-2 last:border-b-0">
                  <CalendarDays className="size-4 shrink-0 text-text-3" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold capitalize">{appointment.tipo}</p>
                    <p className="truncate text-xs text-text-3">
                      {contextDate(appointment.dataPianificata)}{appointment.oraInizio ? ` · ${appointment.oraInizio}` : ""} · {appointment.stato}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-bold uppercase text-text-3">Ticket</h3>
          <div className="mt-2 space-y-2">
            {conversation.commessaId == null && conversation.clienteId == null ? (
              <p className="text-sm text-text-2">Nessun cliente o commessa collegata</p>
            ) : tickets.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : tickets.isError ? (
              <p className="flex gap-2 text-xs leading-5 text-destructive" role="alert">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Ticket non disponibili
              </p>
            ) : ticketRows.length === 0 ? (
              <p className="text-sm text-text-2">Nessun ticket</p>
            ) : (
              ticketRows.slice(0, 3).map((ticket: any) => (
                <div key={ticket.id} className="flex min-h-11 items-center gap-2 border-b border-border-soft py-2 last:border-b-0">
                  <LifeBuoy className="size-4 shrink-0 text-text-3" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{ticket.oggetto}</p>
                    <p className="truncate text-xs text-text-3 capitalize">{ticket.stato} · Priorità {ticket.priorita}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-bold uppercase text-text-3">Proposte Tars</h3>
          <div className="mt-2 space-y-2">
            {conversation.commessaId == null ? (
              <p className="text-sm text-text-2">Nessuna commessa collegata</p>
            ) : proposals.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : proposals.isError ? (
              <p className="flex gap-2 text-xs leading-5 text-destructive" role="alert">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Proposte non disponibili
              </p>
            ) : (
              proposals.data?.slice(0, 3).map(proposal => <TarsPropostaCard key={proposal.id} proposta={proposal} />)
            )}
            {conversation.commessaId != null && !proposals.isLoading && !proposals.isError && (proposals.data?.length ?? 0) === 0 && (
              <p className="text-sm text-text-2">Nessuna proposta pendente</p>
            )}
          </div>
        </section>
      </div>
      <div className="shrink-0 border-t border-border-soft p-3">
        <Button asChild className="min-h-11 w-full">
          <Link href="/tars">Gestisci con Tars</Link>
        </Button>
      </div>
    </aside>
  );
}
