import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const DELEGABLE = [
  ["cliente.assign", "Assegnare clienti"],
  ["commessa.assign", "Assegnare commesse"],
  ["commessa.change_state", "Cambiare stato commesse"],
  ["ticket.assign", "Assegnare ticket"],
  ["ticket.manage", "Gestire ticket"],
  ["intervento.plan", "Pianificare interventi"],
  ["intervento.assign", "Assegnare interventi"],
  ["pagamento.read", "Consultare pagamenti"],
  ["economia.read", "Consultare economia"],
  ["tars.approve_low_risk", "Approvare azioni Tars ordinarie"],
  ["tars.approve_high_risk", "Approvare azioni Tars sensibili"],
] as const;

function localDateTime(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function DelegationDialog({
  open,
  onOpenChange,
  delegateUserId,
  delegateName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  delegateUserId: number;
  delegateName: string;
  onCreated: () => void;
}) {
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const users = trpc.utenti.list.useQuery(undefined);
  const [delegatorId, setDelegatorId] = useState("");
  const [capability, setCapability] = useState("");
  const [startsAt, setStartsAt] = useState(localDateTime(new Date()));
  const [expiresAt, setExpiresAt] = useState(
    localDateTime(new Date(Date.now() + 7 * 86_400_000))
  );
  const [reason, setReason] = useState("");
  const mutation = trpc.permessi.createDelegation.useMutation({
    onSuccess: () => {
      toast.success("Delega creata");
      onCreated();
      onOpenChange(false);
      setCapability("");
      setReason("");
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (open && me.data?.id) setDelegatorId(String(me.data.id));
  }, [open, me.data?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" /> Nuova delega
            temporanea
          </DialogTitle>
          <DialogDescription>
            Concedi a {delegateName} una capacita aggiuntiva per un periodo
            definito.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            Destinatario: <strong>{delegateName}</strong>
          </div>
          <div className="space-y-1.5">
            <Label>Delegante</Label>
            <Select value={delegatorId} onValueChange={setDelegatorId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona chi delega" />
              </SelectTrigger>
              <SelectContent>
                {(users.data ?? [])
                  .filter(
                    (user: any) => user.attivo && user.id !== delegateUserId
                  )
                  .map((user: any) => (
                    <SelectItem key={user.id} value={String(user.id)}>
                      {user.nome} {user.cognome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Capacita</Label>
            <Select value={capability} onValueChange={setCapability}>
              <SelectTrigger>
                <SelectValue placeholder="Scegli cosa delegare" />
              </SelectTrigger>
              <SelectContent>
                {DELEGABLE.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="delegation-start">Inizio</Label>
              <Input
                id="delegation-start"
                type="datetime-local"
                value={startsAt}
                onChange={event => setStartsAt(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delegation-end">Scadenza</Label>
              <Input
                id="delegation-end"
                type="datetime-local"
                value={expiresAt}
                onChange={event => setExpiresAt(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delegation-reason">Motivazione</Label>
            <Textarea
              id="delegation-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Per quale esigenza e fino a quando serve questa delega?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Annulla
            </Button>
            <Button
              disabled={
                !delegatorId ||
                !capability ||
                !startsAt ||
                !expiresAt ||
                reason.trim().length < 10 ||
                mutation.isPending
              }
              onClick={() =>
                mutation.mutate({
                  delegatorUserId: Number(delegatorId),
                  delegateUserId,
                  capability: capability as any,
                  startsAt: new Date(startsAt),
                  expiresAt: new Date(expiresAt),
                  reason,
                })
              }
            >
              Crea delega
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
