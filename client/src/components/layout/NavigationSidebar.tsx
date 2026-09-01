import { useMemo, useState } from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";

import { useAuth } from "@/_core/hooks/useAuth";
import SedeSwitcher from "@/components/SedeSwitcher";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { avatarSrcSetForName, avatarUrlForName } from "@/lib/avatars";
import {
  isPathActive,
  type MenuItem,
  type NavigationAccess,
  navigationGroups,
  navigationItemState,
} from "@/lib/navigation";
import { getRuoli } from "@/lib/roles";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export type NavigationSidebarProps = {
  currentPath: string;
  collapsed: boolean;
  onNavigate: (path: string) => void;
  onCollapsedChange: (collapsed: boolean) => void;
};

type NavigationSection = {
  label: string;
  items: readonly MenuItem[];
};

const SECTION_LABELS = [
  { label: "Operatività", items: ["Dashboard", "Tars"] },
  { label: "Clienti e commesse", items: ["Clienti", "Commesse"] },
  { label: "Cantiere e controllo", items: ["Cantiere", "Economia"] },
  { label: "Relazioni", items: ["Post-Vendita", "Messaggi"] },
  { label: "Amministrazione", items: ["Utenti", "Sedi", "Impostazioni"] },
] as const;

function navigationSections(items: readonly MenuItem[]): NavigationSection[] {
  return SECTION_LABELS.map(section => ({
    label: section.label,
    items: section.items.flatMap(label => {
      const item = items.find(candidate => candidate.label === label);
      return item ? [item] : [];
    }),
  })).filter(section => section.items.length > 0);
}

function iniziali(name: string | null | undefined): string {
  return (name ?? "U")
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function roleSummary(user: unknown): string {
  const roles = getRuoli(user);
  return roles.length
    ? roles.map(role => role.replaceAll("_", " ")).join(" · ")
    : "profilo operativo";
}

function CollapsedTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function NavigationSidebar({
  currentPath,
  collapsed,
  onNavigate,
  onCollapsedChange,
}: NavigationSidebarProps) {
  const { user } = useAuth();
  const { capabilities, flags } = useOperationalContext();
  const access = useMemo<NavigationAccess>(
    () => ({
      user,
      capabilities,
      flags,
      capabilityStatus: capabilities === null ? "loading" : "resolved",
    }),
    [capabilities, flags, user]
  );
  const sections = useMemo(
    () => navigationSections(navigationGroups(access)),
    [access]
  );
  const unread = trpc.chat.nonLetti.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: 15_000,
    retry: false,
  });
  const unreadChat = unread.data?.totale ?? 0;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Il nome accanto resta il testo accessibile: l'immagine è decorativa e su
  // errore di caricamento Radix ricade sul monogramma.
  const userName = user?.name ?? null;
  const avatarUrl = avatarUrlForName(userName);
  const avatarSrcSet = avatarSrcSetForName(userName);
  const avatarImage = avatarUrl ? (
    <AvatarImage
      src={avatarUrl}
      srcSet={avatarSrcSet ?? undefined}
      className="object-cover"
      alt=""
      aria-hidden="true"
    />
  ) : null;

  return (
    <aside
      aria-label="Navigazione Ruffino Flow"
      className="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground"
      data-navigation-collapsed={collapsed ? "true" : "false"}
    >
      <div className="flex h-[72px] shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <div className="flex min-w-0 flex-1 items-center justify-center px-1 group-data-[drawer=true]:justify-start">
          {collapsed ? (
            <span
              className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-soft text-sm font-extrabold text-accent-text"
              aria-label="Ruffino Flow"
            >
              R
            </span>
          ) : (
            <img
              src="/logo.svg"
              alt="Ruffino Group"
              className="sidebar-logo h-5 w-auto max-w-[132px]"
            />
          )}
        </div>
        <button
          type="button"
          data-nav-collapse
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-3 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[var(--focus-width)] focus-visible:ring-sidebar-ring"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={
            collapsed ? "Espandi navigazione" : "Comprimi navigazione"
          }
          aria-pressed={collapsed}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <div className={cn("shrink-0 px-3 py-3", collapsed && "px-2")}>
        <SedeSwitcher collapsed={collapsed} />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        {sections.map(section => (
          <section key={section.label} className="mb-3 last:mb-0">
            {!collapsed ? (
              <h2 className="mb-1 px-2 text-[10px] font-semibold uppercase leading-5 text-text-3">
                {section.label}
              </h2>
            ) : (
              <div
                className="mx-2 mb-1 border-t border-sidebar-border"
                aria-hidden="true"
              />
            )}
            <div className="space-y-1">
              {section.items.map(item => {
                const children = item.children ?? [];
                const state = navigationItemState(
                  currentPath,
                  item.path,
                  children.map(child => child.path)
                );

                if (children.length === 0) {
                  return (
                    <NavigationButton
                      key={item.path}
                      item={item}
                      active={state.active}
                      collapsed={collapsed}
                      unreadChat={unreadChat}
                      onNavigate={onNavigate}
                    />
                  );
                }

                const groupOpen =
                  openGroups[item.path] ?? state.containsActiveChild;
                if (collapsed) {
                  const destination =
                    children.find(child =>
                      isPathActive(currentPath, child.path)
                    ) ?? children[0];
                  return (
                    <NavigationButton
                      key={item.path}
                      item={{ ...item, path: destination.path }}
                      active={state.containsActiveChild}
                      collapsed
                      unreadChat={unreadChat}
                      onNavigate={onNavigate}
                    />
                  );
                }

                const regionId = `nav-group-${item.path.replaceAll("/", "-") || "root"}`;
                return (
                  <div key={item.path}>
                    <button
                      type="button"
                      className={cn(
                        "relative flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 text-left text-sm font-medium text-text-2 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[var(--focus-width)] focus-visible:ring-sidebar-ring",
                        state.containsActiveChild &&
                          "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                      onClick={() =>
                        setOpenGroups(current => ({
                          ...current,
                          [item.path]: !groupOpen,
                        }))
                      }
                      aria-expanded={groupOpen}
                      aria-controls={regionId}
                    >
                      {state.containsActiveChild ? (
                        <span
                          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-primary"
                          aria-hidden="true"
                        />
                      ) : null}
                      <item.icon
                        className="h-[18px] w-[18px] shrink-0"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-text-3 transition-transform duration-(--duration-base)",
                          !groupOpen && "-rotate-90"
                        )}
                        aria-hidden="true"
                      />
                    </button>
                    {groupOpen ? (
                      <div
                        id={regionId}
                        className="ml-[18px] mt-1 space-y-1 border-l border-sidebar-border pl-2"
                      >
                        {children.map(child => (
                          <NavigationButton
                            key={child.path}
                            item={child}
                            active={isPathActive(currentPath, child.path)}
                            collapsed={false}
                            child
                            unreadChat={unreadChat}
                            onNavigate={onNavigate}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div
        className={cn(
          "shrink-0 border-t border-sidebar-border p-3",
          collapsed && "px-2"
        )}
      >
        {collapsed ? (
          <CollapsedTooltip
            label={`${userName ?? "Utente"} · ${roleSummary(user)}`}
          >
            {avatarImage ? (
              <Avatar className="mx-auto size-10 border border-sidebar-border bg-brand-soft">
                {avatarImage}
                <AvatarFallback className="bg-brand-soft text-xs font-bold text-accent-text">
                  {iniziali(userName)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-brand-soft text-xs font-bold text-accent-text">
                {iniziali(userName)}
              </div>
            )}
          </CollapsedTooltip>
        ) : (
          <div className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2.5">
            {avatarImage ? (
              <Avatar className="size-9 shrink-0 border border-sidebar-border bg-brand-soft">
                {avatarImage}
                <AvatarFallback className="bg-brand-soft text-[11px] font-bold text-accent-text">
                  {iniziali(userName)}
                </AvatarFallback>
              </Avatar>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text-1">
                {userName ?? "Utente"}
              </p>
              <p className="mt-0.5 truncate text-[11px] capitalize text-text-3">
                {roleSummary(user)}
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function NavigationButton({
  item,
  active,
  collapsed,
  child = false,
  unreadChat,
  onNavigate,
}: {
  item: MenuItem;
  active: boolean;
  collapsed: boolean;
  child?: boolean;
  unreadChat: number;
  onNavigate: (path: string) => void;
}) {
  const button = (
    <button
      type="button"
      className={cn(
        "relative flex min-h-10 w-full min-w-0 items-center gap-3 rounded-[var(--radius-control)] px-2.5 text-left text-sm text-text-2 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[var(--focus-width)] focus-visible:ring-sidebar-ring",
        collapsed && "justify-center px-0",
        child && "min-h-9 text-[13px]",
        active &&
          "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
      )}
      onClick={() => onNavigate(item.path)}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
    >
      {active ? (
        <span
          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-primary"
          aria-hidden="true"
        />
      ) : null}
      <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.path === "/chat" && unreadChat > 0 ? (
            <Badge className="h-5 min-w-5 justify-center px-1.5 text-[10px]">
              {unreadChat > 9 ? "9+" : unreadChat}
            </Badge>
          ) : null}
        </>
      ) : null}
    </button>
  );

  return collapsed ? (
    <CollapsedTooltip label={item.label}>{button}</CollapsedTooltip>
  ) : (
    button
  );
}
