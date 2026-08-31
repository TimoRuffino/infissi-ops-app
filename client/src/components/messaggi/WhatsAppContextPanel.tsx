import SearchSelect from "@/components/SearchSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { WhatsAppConversation } from "@/lib/messaggi";
import { personName } from "@/lib/name";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  BriefcaseBusiness,
  CalendarDays,
  ExternalLink,
  LifeBuoy,
  Link2,
  Loader2,
  Unlink,
  UserRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

/**
 * Un record collegato si mostra solo quando il payload autorizzato è
 * arrivato davvero: assenza, caricamento ed errore restano tre stati
 * distinti e nessuno di loro promette una scheda che non possiamo aprire.
 */
function DatoNonDisponibile({ testo }: { testo: string }) {
  return (
    <p className="mt-2 flex gap-2 text-xs leading-5 text-text-2" role="status">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
      {testo}
    </p>
  );
}

function contextDate(value: string | null | undefined): string {
  if (!value) return "Data da definire";
  return new Date(`${value}T00:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "short",
  });
}

/**
 * Collegare a mano cliente e commessa.
 *
 * Il match automatico sbaglia o non trova: un numero nuovo, un cliente che
 * scrive dal telefono della moglie, una commessa il cui codice non compare
 * mai nei messaggi. Senza questo la conversazione restava senza contesto per
 * sempre — niente appuntamenti e niente ticket.
 */
function Collegamento({
  conversation,
  tipo,
}: {
  conversation: WhatsAppConversation;
  tipo: "cliente" | "commessa";
}) {
  const utils = trpc.useUtils();
  const [aperto, setAperto] = useState(false);
  const [scelta, setScelta] = useState<string | null>(null);

  const clienti = trpc.clienti.list.useQuery(undefined, {
    enabled: aperto && tipo === "cliente",
  });
  const commesse = trpc.commesse.list.useQuery(undefined, {
    enabled: aperto && tipo === "commessa",
  });

  const collega = trpc.mail.whatsapp.collegaConversazione.useMutation({
    onSuccess: () => {
      toast.success(
        tipo === "cliente" ? "Cliente collegato" : "Commessa collegata"
      );
      setAperto(false);
      setScelta(null);
      void utils.mail.whatsapp.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const scollega = trpc.mail.whatsapp.collegaConversazione.useMutation({
    onSuccess: () => {
      toast.success("Collegamento rimosso");
      void utils.mail.whatsapp.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const opzioni =
    tipo === "cliente"
      ? (clienti.data ?? []).map((c: any) => ({
          value: String(c.id),
          label: personName(c, `Cliente ${c.id}`),
          keywords: `${c.telefono ?? ""} ${c.citta ?? ""} ${c.email ?? ""}`,
        }))
      : (commesse.data ?? []).map((c: any) => ({
          value: String(c.id),
          label: `${c.codice} — ${c.cliente}`,
          keywords: `${c.citta ?? ""} ${c.cliente ?? ""}`,
        }));

  const salva = () => {
    if (!scelta) return;
    const id = Number(scelta);
    collega.mutate({
      casellaId: conversation.casellaId,
      controparte: conversation.controparte,
      // Collegare una commessa detta anche il cliente: lo decide il server
      // dalla commessa, così non restano due verità sulla stessa
      // conversazione.
      clienteId: tipo === "cliente" ? id : conversation.clienteId,
      commessaId: tipo === "commessa" ? id : conversation.commessaId,
    });
  };

  const rimuovi = () =>
    scollega.mutate({
      casellaId: conversation.casellaId,
      controparte: conversation.controparte,
      // Togliere il cliente toglie anche la commessa: una commessa senza il
      // suo cliente non è un collegamento, è un residuo.
      clienteId: tipo === "cliente" ? null : conversation.clienteId,
      commessaId: tipo === "cliente" ? null : null,
    });

  const collegato =
    tipo === "cliente"
      ? conversation.clienteId != null
      : conversation.commessaId != null;
  const inCorso = collega.isPending || scollega.isPending;

  if (aperto) {
    const caricamento =
      tipo === "cliente" ? clienti.isLoading : commesse.isLoading;
    return (
      <div className="mt-2 space-y-2 rounded-md border border-primary/40 bg-surface-2 p-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">
            {tipo === "cliente" ? "Collega a un cliente" : "Collega a una commessa"}
          </p>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            aria-label="Chiudi"
            onClick={() => {
              setAperto(false);
              setScelta(null);
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <SearchSelect
          value={scelta}
          onChange={setScelta}
          options={opzioni}
          disabled={caricamento || inCorso}
          placeholder={caricamento ? "Caricamento…" : "Cerca…"}
          searchPlaceholder={
            tipo === "cliente" ? "Nome, telefono, città…" : "Codice, cliente, città…"
          }
          emptyText="Nessun risultato"
        />
        <Button
          type="button"
          className="min-h-11 w-full"
          disabled={!scelta || inCorso}
          onClick={salva}
        >
          {collega.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Link2 className="size-4" />
          )}
          Collega
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11 text-xs"
        disabled={inCorso}
        onClick={() => setAperto(true)}
      >
        <Link2 className="size-3.5" />
        {collegato ? "Cambia" : tipo === "cliente" ? "Collega cliente" : "Collega commessa"}
      </Button>
      {collegato && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11 text-xs"
          disabled={inCorso}
          onClick={rimuovi}
        >
          {scollega.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Unlink className="size-3.5" />
          )}
          Scollega
        </Button>
      )}
    </div>
  );
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
    <aside
      aria-label="Contesto conversazione"
      className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--inspector-surface)]"
    >
      <header className="border-b border-border-soft px-4 py-3">
        <h2 className="text-sm font-bold">Contesto</h2>
        <p className="mt-1 text-xs leading-5 text-text-3">
          {conversation.controparte}
          {communicationIds.length > 0
            ? ` · ${communicationIds.length} messaggi caricati`
            : ""}
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase text-text-3">Cliente</h3>
            {/* Chi ha deciso il collegamento: il matcher può sbagliare, una
                persona no — e chi legge deve sapere quale dei due sta
                guardando. */}
            {conversation.clienteId != null && (
              <Badge variant="outline" className="text-[10px]">
                {conversation.collegamentoManuale ? "a mano" : "automatico"}
              </Badge>
            )}
          </div>
          {conversation.clienteId == null ? (
            <p className="mt-2 text-sm text-text-2">Nessun cliente collegato</p>
          ) : client.isLoading ? (
            <Skeleton className="mt-2 h-11 w-full" />
          ) : client.isError || !client.data ? (
            <DatoNonDisponibile testo="Scheda cliente non disponibile: il record non è leggibile da qui." />
          ) : (
            <Link href={`/clienti/${conversation.clienteId}`} className="mt-2 flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft px-3 text-sm font-semibold hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <UserRound className="size-4 shrink-0 text-text-3" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {personName(client.data, `Cliente #${conversation.clienteId}`)}
              </span>
              <ExternalLink className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
            </Link>
          )}
          <Collegamento conversation={conversation} tipo="cliente" />
        </section>

        <section>
          <h3 className="text-xs font-bold uppercase text-text-3">Commessa</h3>
          {conversation.commessaId == null ? (
            <p className="mt-2 text-sm text-text-2">Nessuna commessa collegata</p>
          ) : job.isLoading ? (
            <Skeleton className="mt-2 h-11 w-full" />
          ) : job.isError || !job.data ? (
            <DatoNonDisponibile testo="Scheda commessa non disponibile: il record non è leggibile da qui." />
          ) : (
            <Link href={`/commesse/${conversation.commessaId}`} className="mt-2 flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft px-3 text-sm font-semibold hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <BriefcaseBusiness className="size-4 shrink-0 text-text-3" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{job.data.codice}</span>
              <ExternalLink className="size-3.5 shrink-0 text-text-3" aria-hidden="true" />
            </Link>
          )}
          <Collegamento conversation={conversation} tipo="commessa" />
        </section>

        <section>
          <h3 className="text-xs font-bold uppercase text-text-3">Appuntamenti</h3>
          <div className="mt-2 space-y-2">
            {conversation.commessaId == null ? (
              <p className="text-sm text-text-2">Nessuna commessa collegata</p>
            ) : appointments.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : appointments.isError ? (
              <p className="flex gap-2 text-xs leading-5 text-danger" role="alert">
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
              <p className="flex gap-2 text-xs leading-5 text-danger" role="alert">
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

      </div>
    </aside>
  );
}
