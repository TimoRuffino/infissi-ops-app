import { Building, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Sede (location) switcher. Shows the active sede and lets the operator
// switch among the sedi assigned to them. Switching writes the server-side
// `active_sede` cookie (via sedi.switch) then invalidates ALL queries so every
// page re-fetches scoped to the new sede.
export default function SedeSwitcher({ collapsed }: { collapsed?: boolean }) {
  const utils = trpc.useUtils();
  const sediList = trpc.sedi.list.useQuery();
  const active = trpc.sedi.active.useQuery();

  const switchSede = trpc.sedi.switch.useMutation({
    onSuccess: async (sede) => {
      // Refresh everything — data is scoped to the active sede server-side.
      await utils.invalidate();
      toast.success(`Sede attiva: ${sede?.nome ?? ""}`, { icon: "🏢" });
    },
    onError: (err) => toast.error(err.message ?? "Cambio sede non riuscito"),
  });

  const sedi = sediList.data ?? [];
  const activeSede = active.data;

  // Single sede → no switcher, just a static label (still useful context).
  if (sedi.length <= 1) {
    if (!activeSede) return null;
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-sm ${
          collapsed ? "justify-center" : ""
        }`}
        title={`Sede: ${activeSede.nome}`}
      >
        <Building className="h-4 w-4 shrink-0 text-primary" />
        {!collapsed && (
          <span className="truncate font-medium">{activeSede.nome}</span>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-sm transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            collapsed ? "justify-center" : ""
          }`}
          title="Cambia sede"
        >
          <Building className="h-4 w-4 shrink-0 text-primary" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left font-medium">
                {activeSede?.nome ?? "Seleziona sede"}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Le tue sedi
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sedi.map((s: any) => {
          const isActive = s.id === activeSede?.id;
          return (
            <DropdownMenuItem
              key={s.id}
              className="cursor-pointer"
              disabled={switchSede.isPending}
              onClick={() => {
                if (isActive) return;
                switchSede.mutate({ sedeId: s.id });
              }}
            >
              <Building className="mr-2 h-4 w-4 text-muted-foreground" />
              <span className="flex-1 truncate">{s.nome}</span>
              {isActive && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
