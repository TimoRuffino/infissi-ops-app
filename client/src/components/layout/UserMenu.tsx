import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/contexts/ThemeContext";
import { getRuoli } from "@/lib/roles";
import { ChevronDown, LogOut, Moon, Settings, Sun } from "lucide-react";
import { useLocation } from "wouter";

function initials(name: string | null | undefined): string {
  return (name ?? "Utente")
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function roleLabel(role: string): string {
  return role.replaceAll("_", " ");
}

export default function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, setLocation] = useLocation();
  const roles = getRuoli(user);
  const roleSummary = roles.length
    ? roles.map(roleLabel).join(" · ")
    : "profilo operativo";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex min-h-11 min-w-11 items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-left text-text-1 transition-colors hover:bg-surface-2 focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)] sm:px-2"
          aria-label={`Menu profilo di ${user?.name ?? "utente"}`}
        >
          <Avatar className="h-8 w-8 shrink-0 border border-border-soft bg-brand-soft">
            <AvatarFallback className="bg-brand-soft text-xs font-semibold text-accent-text">
              {initials(user?.name)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 max-w-40 flex-1 lg:block">
            <span className="block truncate text-sm font-semibold leading-4">
              {user?.name ?? "Utente"}
            </span>
            <span className="mt-0.5 block truncate text-[11px] capitalize leading-4 text-text-3">
              {roleSummary}
            </span>
          </span>
          <ChevronDown
            className="hidden h-3.5 w-3.5 shrink-0 text-text-3 lg:block"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-1 font-normal">
          <span className="block truncate text-sm font-semibold text-text-1">
            {user?.name ?? "Utente"}
          </span>
          <span className="block truncate text-xs text-text-3">
            {user?.email ?? roleSummary}
          </span>
          <span className="block truncate text-[11px] capitalize text-text-3">
            {roleSummary}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setLocation("/integrazioni")}>
          <Settings className="h-4 w-4" aria-hidden="true" />
          Impostazioni
        </DropdownMenuItem>
        {toggleTheme ? (
          <DropdownMenuItem onClick={toggleTheme}>
            {theme === "dark" ? (
              <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4" aria-hidden="true" />
            )}
            {theme === "dark" ? "Tema chiaro" : "Tema scuro"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-danger focus:text-danger"
          onClick={() => void logout()}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Esci
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
