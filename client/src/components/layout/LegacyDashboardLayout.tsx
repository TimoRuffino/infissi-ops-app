import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import { ChevronDown, LogOut, PanelLeft } from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import NotificheDropdown from "../NotificheDropdown";
import { PromemoriaPopupHost } from "../PromemoriaPopupHost";
import PageContainer from "../PageContainer";
import SedeSwitcher from "../SedeSwitcher";
import {
  isPathActive,
  type NavigationAccess,
  navigationDestinations,
  navigationGroups,
  navigationItemState,
} from "@/lib/navigation";
import { AnimatePresence } from "framer-motion";
import { useNotificationStream } from "@/hooks/useNotificationStream";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { scopedStorageKey } from "@/lib/operationalContext";

// Il modello di navigazione (voci, gerarchia, regole di visibilità) vive in
// lib/navigation.ts, condiviso con la palette comandi.

const SIDEBAR_WIDTH_KEY = "layout.sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function LegacyDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { scopeKey } = useOperationalContext();
  const sidebarStorageKey = scopeKey
    ? scopedStorageKey(SIDEBAR_WIDTH_KEY, scopeKey)
    : null;
  const hydratedStorageKey = useRef<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    hydratedStorageKey.current = null;
    if (!sidebarStorageKey) {
      setSidebarWidth(DEFAULT_WIDTH);
      return;
    }
    const saved = localStorage.getItem(sidebarStorageKey);
    const parsed = saved ? Number.parseInt(saved, 10) : DEFAULT_WIDTH;
    setSidebarWidth(
      Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH
        ? parsed
        : DEFAULT_WIDTH
    );
  }, [sidebarStorageKey]);

  useEffect(() => {
    if (!sidebarStorageKey) return;
    if (hydratedStorageKey.current !== sidebarStorageKey) {
      hydratedStorageKey.current = sidebarStorageKey;
      return;
    }
    localStorage.setItem(sidebarStorageKey, sidebarWidth.toString());
  }, [sidebarStorageKey, sidebarWidth]);

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
      <PromemoriaPopupHost />
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const { capabilities: capacita, flags } = useOperationalContext();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  // Gruppi aperti/chiusi a mano; senza scelta esplicita, un gruppo è aperto
  // quando contiene la pagina corrente.
  const [gruppiAperti, setGruppiAperti] = useState<Record<string, boolean>>({});
  const sidebarRef = useRef<HTMLDivElement>(null);
  const navigationAccess = useMemo<NavigationAccess>(
    () => ({
      user,
      capabilities: capacita,
      flags,
      capabilityStatus: capacita === null ? "loading" : "resolved",
    }),
    [capacita, flags, user]
  );
  const gruppiNavigazione = useMemo(
    () => navigationGroups(navigationAccess),
    [navigationAccess]
  );
  const tutteLeVoci = useMemo(
    () => navigationDestinations(navigationAccess),
    [navigationAccess]
  );
  const activeMenuItem = tutteLeVoci.find(item =>
    isPathActive(location, item.path)
  );
  const isMobile = useIsMobile();
  useNotificationStream();

  // Non letti in chat: badge nel menu e avviso all'arrivo.
  //
  // Sta qui e non nella pagina perché una notifica che si vede solo quando sei
  // già sulla chat non è una notifica. Polling a 15 secondi: la campanella SSE
  // dipende da un feature flag, questo funziona comunque.
  const chat = trpc.chat.nonLetti.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 15_000,
    retry: false,
  });
  const chatNonLetti = chat.data?.totale ?? 0;
  const ultimoAvvisato = useRef<number>(0);

  useEffect(() => {
    const ultimo = chat.data?.ultimo;
    if (!ultimo) return;
    // Primo caricamento: si registra il punto senza avvisare, altrimenti
    // aprire il CRM sparerebbe un avviso per messaggi già vecchi.
    if (ultimoAvvisato.current === 0) {
      ultimoAvvisato.current = ultimo.messaggioId;
      return;
    }
    if (ultimo.messaggioId <= ultimoAvvisato.current) return;
    ultimoAvvisato.current = ultimo.messaggioId;
    // Già sulla chat: il messaggio si vede da sé, l'avviso sarebbe rumore.
    if (location.startsWith("/chat")) return;
    toast(`${ultimo.autore} · ${ultimo.canaleNome}`, {
      description: ultimo.anteprima,
      action: { label: "Apri", onClick: () => setLocation("/chat") },
    });
  }, [chat.data?.ultimo, location, setLocation]);

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r border-sidebar-border"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center border-b border-sidebar-border">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <img
                    src="/logo.svg"
                    alt="Ruffino Group"
                    className="sidebar-logo h-5 w-auto max-w-[116px] shrink-0"
                  />
                  <div className="ml-auto text-sidebar-foreground [&_button]:hover:bg-sidebar-accent [&_button]:focus-visible:ring-sidebar-ring [&_svg]:text-sidebar-foreground">
                    <NotificheDropdown />
                  </div>
                </div>
              ) : null}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            {/* Active sede + switcher */}
            <div className="px-2 pt-2 pb-1">
              <SedeSwitcher collapsed={isCollapsed} />
            </div>
            <SidebarMenu className="px-2 py-1">
              {gruppiNavigazione.map(item => {
                const figlie = item.children ?? [];
                const itemState = navigationItemState(
                  location,
                  item.path,
                  figlie.map(c => c.path)
                );

                // Gruppo: la voce apre/chiude; le figlie navigano. Aperto
                // da solo quando una figlia è la pagina corrente.
                if (figlie.length > 0) {
                  const aperto =
                    gruppiAperti[item.label] ?? itemState.containsActiveChild;
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        onClick={() =>
                          setGruppiAperti(s => ({
                            ...s,
                            [item.label]: !aperto,
                          }))
                        }
                        tooltip={item.label}
                        className="relative h-10 font-normal transition-all"
                      >
                        <item.icon className="h-4 w-4 transition-colors" />
                        <span className="flex-1">{item.label}</span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 opacity-60 transition-transform ${aperto ? "" : "-rotate-90"}`}
                        />
                      </SidebarMenuButton>
                      {aperto && (
                        <div className="ml-4 border-l border-[var(--sidebar-hairline)] pl-1 mt-0.5 space-y-0.5">
                          {figlie.map(c => {
                            const attiva = isPathActive(location, c.path);
                            return (
                              <SidebarMenuButton
                                key={c.path}
                                isActive={attiva}
                                onClick={() => setLocation(c.path)}
                                tooltip={c.label}
                                className={`relative h-9 transition-all ${
                                  attiva
                                    ? "bg-sidebar-accent hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                                    : "font-normal"
                                }`}
                              >
                                {attiva && (
                                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                                )}
                                <c.icon
                                  className={`h-4 w-4 transition-colors ${attiva ? "text-sidebar-accent-foreground" : ""}`}
                                />
                                <span className="flex-1">{c.label}</span>
                                {c.path === "/chat" && chatNonLetti > 0 && (
                                  <Badge className="h-5 shrink-0 px-1.5 text-[10px]">
                                    {chatNonLetti > 9 ? "9+" : chatNonLetti}
                                  </Badge>
                                )}
                              </SidebarMenuButton>
                            );
                          })}
                        </div>
                      )}
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.path}>
                    {/* Keep the active destination crisp against the dark rail. */}
                    <SidebarMenuButton
                      isActive={itemState.active}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`relative h-10 transition-all ${
                        itemState.active
                          ? "bg-sidebar-accent hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                          : "font-normal"
                      }`}
                    >
                      {itemState.active && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                      )}
                      <item.icon
                        className={`h-4 w-4 transition-colors ${itemState.active ? "text-sidebar-accent-foreground" : ""}`}
                      />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1.5 py-0 h-4 font-medium opacity-60"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  <Avatar className="h-9 w-9 border border-sidebar-border shrink-0 bg-[var(--sidebar-avatar-bg)]">
                    <AvatarFallback className="text-xs font-semibold text-[var(--sidebar-avatar-fg)] bg-[var(--sidebar-avatar-bg)]">
                      {user?.name
                        ?.split(" ")
                        .map((n: string) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-[var(--sidebar-chip-text)]">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-sidebar-foreground truncate mt-1">
                      {(user as any)?.ruolo?.replace(/_/g, " ") ||
                        user?.role ||
                        "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Esci</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-card px-2 shadow-xs sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-11 w-11 rounded-lg bg-background lg:h-9 lg:w-9" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
            <NotificheDropdown />
          </div>
        )}
        <main className="flex-1 min-h-dvh bg-background p-4 sm:p-5 lg:p-6">
          <AnimatePresence mode="wait" initial={false}>
            <PageContainer key={location}>{children}</PageContainer>
          </AnimatePresence>
        </main>
      </SidebarInset>
    </>
  );
}
