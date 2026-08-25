import { useState } from "react";
import {
  CalendarClock,
  History,
  Pencil,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CapabilityMatrix } from "./CapabilityMatrix";
import { DelegationDialog } from "./DelegationDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const ROLE_LABELS: Record<string, string> = {
  direzione: "Direzione",
  amministrazione: "Amministrazione",
  commerciale: "Commerciale",
  tecnico_rilievi: "Tecnico rilievi",
  squadra_posa: "Squadra posa",
  post_vendita: "Post-vendita",
  ordini: "Ordini",
};

function capabilityLabel(value: string) {
  return value
    .replace("update_operational", "aggiornamento operativo")
    .replace("change_state", "cambio stato")
    .replace("manage_documents", "gestione documenti")
    .replace("approve_low_risk", "approvazione ordinaria")
    .replace("approve_high_risk", "approvazione sensibile")
    .replace("manage_policy", "gestione permessi")
    .replace(/[._]/g, " ");
}

function dateTime(value: Date | string) {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function UserPermissionsDialog({
  user,
  open,
  onOpenChange,
  onEdit,
}: {
  user: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (user: any) => void;
}) {
  const userId = user?.id ?? 0;
  const [delegationOpen, setDelegationOpen] = useState(false);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const preview = trpc.permessi.preview.useQuery(
    { userId },
    { enabled: open && userId > 0 }
  );
  const audit = trpc.permessi.auditSummary.useQuery(
    { userId, days: 30 },
    { enabled: open && userId > 0 }
  );
  const revoke = trpc.permessi.revokeDelegation.useMutation({
    onSuccess: async () => {
      await Promise.all([preview.refetch(), audit.refetch()]);
      setRevokeId(null);
      setRevokeReason("");
      toast.success("Delega revocata");
    },
    onError: error => toast.error(error.message),
  });

  if (!user) return null;
  const ruoli: string[] = Array.isArray(user.ruoli) ? user.ruoli : [];
  const delegations = preview.data?.delegations ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b px-4 py-4 sm:px-6">
            <DialogTitle className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {user.nome?.charAt(0)}
                {user.cognome?.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block truncate">
                  {user.nome} {user.cognome}
                </span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  Accessi e deleghe operative
                </span>
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Gestione del profilo, delle capacita operative, delle deleghe
              temporanee e dello storico permessi.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="profile" className="min-h-0 flex-1 gap-0">
            <div className="border-b px-3 py-2 sm:px-6">
              <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
                <TabsTrigger value="profile">
                  <UserRound /> Profilo
                </TabsTrigger>
                <TabsTrigger value="access">
                  <ShieldCheck /> Accessi
                </TabsTrigger>
                <TabsTrigger value="delegations">
                  <CalendarClock /> Deleghe
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History /> Storico
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <TabsContent value="profile" className="mt-0">
                <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0 divide-y rounded-md border bg-card">
                    <div className="px-4 py-3">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Contatto
                      </p>
                      <p className="mt-1 break-all text-sm font-medium">
                        {user.email}
                      </p>
                      {user.telefono && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {user.telefono}
                        </p>
                      )}
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Ruoli
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ruoli.map(role => (
                          <Badge key={role} variant="secondary">
                            {ROLE_LABELS[role] ?? role}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        Stato
                      </p>
                      <p className="mt-1 text-sm">
                        {user.attivo ? "Utente attivo" : "Utente disattivato"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      onOpenChange(false);
                      onEdit(user);
                    }}
                  >
                    <Pencil className="size-4" /> Modifica profilo
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="access" className="mt-0">
                <CapabilityMatrix userId={userId} />
              </TabsContent>

              <TabsContent value="delegations" className="mt-0 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold">Deleghe temporanee</h3>
                    <p className="text-xs text-muted-foreground">
                      Accessi aggiuntivi con inizio, scadenza e motivazione.
                    </p>
                  </div>
                  <Button onClick={() => setDelegationOpen(true)}>
                    <CalendarClock className="size-4" /> Nuova delega
                  </Button>
                </div>
                {delegations.length === 0 ? (
                  <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                    Nessuna delega registrata.
                  </div>
                ) : (
                  <div className="divide-y rounded-md border bg-card">
                    {delegations.map((item: any) => (
                      <div
                        key={item.id}
                        className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold capitalize">
                              {capabilityLabel(item.capability)}
                            </p>
                            <Badge
                              variant={
                                item.revokedAt
                                  ? "outline"
                                  : new Date(item.expiresAt) > new Date()
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {item.revokedAt
                                ? "Revocata"
                                : new Date(item.expiresAt) > new Date()
                                  ? "Attiva"
                                  : "Scaduta"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {dateTime(item.startsAt)} -{" "}
                            {dateTime(item.expiresAt)}
                          </p>
                          <p className="mt-1 text-xs">{item.reason}</p>
                        </div>
                        {!item.revokedAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRevokeId(item.id)}
                          >
                            Revoca
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {revokeId != null && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                    <Label htmlFor="revoke-reason">Motivo della revoca</Label>
                    <Textarea
                      id="revoke-reason"
                      className="mt-2"
                      value={revokeReason}
                      onChange={event => setRevokeReason(event.target.value)}
                    />
                    <div className="mt-3 flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setRevokeId(null)}>
                        Annulla
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={
                          revokeReason.trim().length < 10 || revoke.isPending
                        }
                        onClick={() =>
                          revoke.mutate({
                            id: revokeId,
                            userId,
                            reason: revokeReason,
                          })
                        }
                      >
                        Conferma revoca
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="history" className="mt-0 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border bg-card p-3">
                    <p className="text-xl font-bold">
                      {audit.data?.totals.changes ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Modifiche</p>
                  </div>
                  <div className="rounded-md border bg-card p-3">
                    <p className="text-xl font-bold">
                      {audit.data?.totals.comparisons ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Controlli</p>
                  </div>
                  <div className="rounded-md border bg-card p-3">
                    <p className="text-xl font-bold">
                      {audit.data?.totals.disagreements ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Differenze</p>
                  </div>
                </div>
                {(audit.data?.changes.length ?? 0) === 0 ? (
                  <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                    Nessuna modifica negli ultimi 30 giorni.
                  </div>
                ) : (
                  <div className="divide-y rounded-md border bg-card">
                    {audit.data?.changes.map((item: any) => (
                      <div key={item.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold capitalize">
                            {capabilityLabel(item.capability)}
                          </p>
                          <time className="text-xs text-muted-foreground">
                            {dateTime(item.createdAt)}
                          </time>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.action.replaceAll("_", " ")}
                        </p>
                        <p className="mt-1 text-xs">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <DelegationDialog
        open={delegationOpen}
        onOpenChange={setDelegationOpen}
        delegateUserId={userId}
        delegateName={`${user.nome} ${user.cognome}`}
        onCreated={() => void Promise.all([preview.refetch(), audit.refetch()])}
      />
    </>
  );
}
