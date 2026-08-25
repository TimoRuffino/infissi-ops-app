import { useMemo, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const CAPABILITY_META: Record<string, { label: string; group: string }> = {
  "cliente.read": { label: "Consultare clienti", group: "Clienti" },
  "cliente.create": { label: "Creare clienti", group: "Clienti" },
  "cliente.update_operational": {
    label: "Aggiornare clienti",
    group: "Clienti",
  },
  "cliente.assign": { label: "Assegnare clienti", group: "Clienti" },
  "cliente.archive": { label: "Archiviare clienti", group: "Clienti" },
  "cliente.delete": { label: "Eliminare clienti", group: "Clienti" },
  "commessa.read": { label: "Consultare commesse", group: "Commesse" },
  "commessa.create": { label: "Creare commesse", group: "Commesse" },
  "commessa.update_operational": {
    label: "Aggiornare commesse",
    group: "Commesse",
  },
  "commessa.assign": { label: "Assegnare commesse", group: "Commesse" },
  "commessa.change_state": { label: "Cambiare stato", group: "Commesse" },
  "commessa.manage_documents": {
    label: "Gestire documenti",
    group: "Commesse",
  },
  "commessa.delete": { label: "Eliminare commesse", group: "Commesse" },
  "ticket.create": { label: "Creare ticket", group: "Post-vendita" },
  "ticket.assign": { label: "Assegnare ticket", group: "Post-vendita" },
  "ticket.manage": { label: "Gestire ticket", group: "Post-vendita" },
  "ticket.delete": { label: "Eliminare ticket", group: "Post-vendita" },
  "intervento.plan": { label: "Pianificare interventi", group: "Interventi" },
  "intervento.assign": { label: "Assegnare interventi", group: "Interventi" },
  "intervento.delete": { label: "Eliminare interventi", group: "Interventi" },
  "pagamento.read": { label: "Consultare pagamenti", group: "Economia" },
  "pagamento.record": { label: "Registrare pagamenti", group: "Economia" },
  "economia.read": { label: "Consultare economia", group: "Economia" },
  "tars.use": { label: "Usare Tars", group: "Tars" },
  "tars.approve_low_risk": {
    label: "Approvare azioni ordinarie",
    group: "Tars",
  },
  "tars.approve_high_risk": {
    label: "Approvare azioni sensibili",
    group: "Tars",
  },
  "tars.manage_policy": { label: "Gestire permessi", group: "Tars" },
};

type OverrideEffect = "allow" | "deny" | "inherit";
type PendingChange = {
  capability: string;
  effect: OverrideEffect;
  label: string;
} | null;

function activeOverride(preview: any, capability: string) {
  return preview?.overrides?.find(
    (item: any) => item.capability === capability && item.revokedAt == null
  );
}

export function CapabilityMatrix({ userId }: { userId: number }) {
  const utils = trpc.useUtils();
  const preview = trpc.permessi.preview.useQuery({ userId });
  const [pending, setPending] = useState<PendingChange>(null);
  const [reason, setReason] = useState("");
  const mutation = trpc.permessi.updateOverride.useMutation({
    onSuccess: async () => {
      await utils.permessi.preview.invalidate({ userId });
      await utils.permessi.auditSummary.invalidate();
      setPending(null);
      setReason("");
      toast.success("Permesso aggiornato");
    },
    onError: error => toast.error(error.message),
  });

  const groups = useMemo(() => {
    const result = new Map<string, any[]>();
    for (const item of preview.data?.capabilities ?? []) {
      const meta = CAPABILITY_META[item.capability] ?? {
        label: item.capability,
        group: "Altro",
      };
      const current = result.get(meta.group) ?? [];
      current.push({ ...item, label: meta.label });
      result.set(meta.group, current);
    }
    return Array.from(result.entries());
  }, [preview.data]);

  if (preview.isLoading) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Caricamento accessi...
      </div>
    );
  }
  if (!preview.data) {
    return (
      <div className="py-10 text-center text-sm text-destructive">
        Impossibile caricare gli accessi.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 p-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Accessi effettivi</p>
          <p className="text-xs leading-5 text-muted-foreground">
            I ruoli definiscono la base. Le eccezioni individuali devono essere
            motivate e restano nello storico.
          </p>
        </div>
      </div>

      {groups.map(([group, items]) => (
        <section key={group} aria-labelledby={`capability-${group}`}>
          <h3
            id={`capability-${group}`}
            className="mb-2 text-xs font-bold uppercase text-muted-foreground"
          >
            {group}
          </h3>
          <div className="divide-y rounded-md border bg-card">
            {items.map(item => {
              const override = activeOverride(preview.data, item.capability);
              const selected: OverrideEffect = override?.effect ?? "inherit";
              return (
                <div
                  key={item.capability}
                  className="grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_9rem]"
                >
                  <Checkbox
                    checked={item.effective}
                    disabled
                    aria-label={`${item.label}: ${item.effective ? "consentito" : "negato"}`}
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{item.label}</span>
                      {item.inherited && (
                        <Badge variant="secondary" className="text-[10px]">
                          Dal ruolo
                        </Badge>
                      )}
                      {item.source === "delegation" && (
                        <Badge variant="outline" className="text-[10px]">
                          Delegato
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.reason}
                    </p>
                  </div>
                  <Select
                    value={selected}
                    onValueChange={(effect: OverrideEffect) => {
                      if (effect === selected) return;
                      setPending({
                        capability: item.capability,
                        effect,
                        label: item.label,
                      });
                      setReason("");
                    }}
                  >
                    <SelectTrigger
                      className="col-start-2 h-9 w-full sm:col-start-3"
                      aria-label={`Regola per ${item.label}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Eredita dal ruolo</SelectItem>
                      <SelectItem value="allow">Consenti</SelectItem>
                      <SelectItem value="deny">Nega</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {pending && (
        <div className="sticky bottom-0 rounded-md border bg-card p-3 shadow-lg">
          <Label htmlFor="permission-reason">
            Motivo della modifica: {pending.label}
          </Label>
          <Textarea
            id="permission-reason"
            value={reason}
            onChange={event => setReason(event.target.value)}
            placeholder="Descrivi l'esigenza operativa e la durata prevista..."
            className="mt-2 min-h-20"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)}>
              Annulla
            </Button>
            <Button
              onClick={() =>
                mutation.mutate({
                  userId,
                  capability: pending.capability as any,
                  effect: pending.effect,
                  reason,
                })
              }
              disabled={reason.trim().length < 10 || mutation.isPending}
            >
              <Check className="size-4" /> Conferma modifica
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
