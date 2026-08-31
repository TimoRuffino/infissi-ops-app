import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

import { isDirezione } from "@/lib/roles";
import { useAuth } from "@/_core/hooks/useAuth";
import { useOperationalContext } from "@/contexts/OperationalContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Sede (location) switcher. Shows the active sede and lets the operator
// switch among the sedi assigned to them. Cache isolation and the transition
// screen live in OperationalContext; this component is presentation only.
export default function SedeSwitcher({ collapsed }: { collapsed?: boolean }) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { activeSede, sedi, status, switchSede } = useOperationalContext();
  const canManage = isDirezione(user);
  const canSwitch = sedi.length > 1;
  const pending = status === "switching";

  const pickSede = async (id: number) => {
    if (id === activeSede?.id || pending) return;
    const selected = sedi.find(sede => sede.id === id);
    try {
      await switchSede(id);
      toast.success(`Sede attiva: ${selected?.nome ?? ""}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Cambio sede non riuscito"
      );
    }
  };

  // Compact icon badge reused by both layouts.
  const Badge = (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground shadow-xs">
      <Building2 className="h-4 w-4" />
    </span>
  );

  // ── Collapsed sidebar: just the badge (optionally a dropdown). ──
  if (collapsed) {
    if (!activeSede && !canManage) return null;
    if (!canSwitch) {
      return (
        <div className="flex justify-center" title={`Sede: ${activeSede?.nome ?? ""}`}>
          {Badge}
        </div>
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full justify-center rounded-lg p-0.5 transition-colors hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring" title="Cambia sede">
            {Badge}
          </button>
        </DropdownMenuTrigger>
        <SwitcherMenu
          sedi={sedi}
          activeId={activeSede?.id}
          canManage={canManage}
          pending={pending}
          onPick={id => void pickSede(id)}
          onManage={() => setLocation("/sedi")}
        />
      </DropdownMenu>
    );
  }

  // ── Static card (single sede, no switching). ──
  if (!canSwitch) {
    if (!activeSede) return null;
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-[var(--sidebar-chip-bg)] px-2.5 py-2 text-sidebar-foreground shadow-xs">
        {Badge}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[10px] font-medium uppercase text-[var(--sidebar-chip-label)]">
            Sede attiva
          </div>
          <div className="truncate text-sm font-semibold text-[var(--sidebar-chip-text)]">
            {activeSede.nome}
          </div>
        </div>
      </div>
    );
  }

  // ── Full switcher. ──
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="group flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-[var(--sidebar-chip-bg)] px-2.5 py-2 text-sidebar-foreground shadow-xs transition-[background-color,border-color,box-shadow] hover:border-sidebar-primary/45 hover:bg-[var(--sidebar-chip-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          title="Cambia sede"
        >
          {Badge}
          <div className="min-w-0 flex-1 text-left leading-tight">
            <div className="text-[10px] font-medium uppercase text-[var(--sidebar-chip-label)]">
              Sede attiva
            </div>
            <div className="truncate text-sm font-semibold text-[var(--sidebar-chip-text)]">
              {activeSede?.nome ?? "Seleziona sede"}
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--sidebar-chip-label)] transition-colors group-hover:text-[var(--sidebar-chip-text)]" />
        </button>
      </DropdownMenuTrigger>
      <SwitcherMenu
        sedi={sedi}
        activeId={activeSede?.id}
        canManage={canManage}
        pending={pending}
        onPick={id => void pickSede(id)}
        onManage={() => setLocation("/sedi")}
      />
    </DropdownMenu>
  );
}

// ── Shared dropdown body ──────────────────────────────────────────────────
function SwitcherMenu({
  sedi,
  activeId,
  canManage,
  pending,
  onPick,
  onManage,
}: {
  sedi: any[];
  activeId?: number;
  canManage: boolean;
  pending: boolean;
  onPick: (id: number) => void;
  onManage: () => void;
}) {
  return (
    <DropdownMenuContent align="start" className="w-60">
      <DropdownMenuLabel className="text-[11px] uppercase text-muted-foreground">
        Le tue sedi
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {sedi.map((s) => {
        const isActive = s.id === activeId;
        return (
          <DropdownMenuItem
            key={s.id}
            className="cursor-pointer gap-2 py-2"
            disabled={pending}
            onClick={() => onPick(s.id)}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{s.nome}</div>
              {s.citta && (
                <div className="truncate text-[11px] text-muted-foreground">
                  {s.citta}
                </div>
              )}
            </div>
            {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        );
      })}
      {canManage && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer gap-2 text-muted-foreground" onClick={onManage}>
            <Plus className="h-4 w-4" />
            Gestisci sedi
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );
}
