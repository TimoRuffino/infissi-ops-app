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
import { ChevronDown, LogOut, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import NotificheDropdown from "./NotificheDropdown";
import { PromemoriaPopupHost } from "./PromemoriaPopupHost";
import LoginPage from "@/pages/LoginPage";
import PageContainer from "./PageContainer";
import SedeSwitcher from "./SedeSwitcher";
import {
  isPathActive,
  menuItems,
  navigationItemState,
  visibile,
} from "@/lib/navigation";
import CommandPalette from "./CommandPalette";
import BottomNav from "./BottomNav";
import { useTheme } from "@/contexts/ThemeContext";
import { AnimatePresence } from "framer-motion";
import { useNotificationStream } from "@/hooks/useNotificationStream";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// Il modello di navigazione (voci, gerarchia, regole di visibilità) vive in
// lib/navigation.ts, condiviso con la palette comandi.

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  // UI v2 «Frame & Flow»: la skin segue l'interruttore FLAG_UI_V2
  // (fail-closed, letto dal server). L'attributo sulla radice commuta i
  // token in client/src/index.css; senza attributo la resa è la v1,
  // identica byte per byte. Prima del login l'interruttore non è leggibile
  // (procedura protetta): la pagina di accesso resta v1 per scelta.
  const interruttoriQ = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
    enabled: !loading && !!user,
  });
  const uiV2 = Boolean(user && interruttoriQ.data?.uiV2);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-ui-v2", uiV2);
  }, [uiV2]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return <LoginPage />;
  }

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
  const { theme, toggleTheme } = useTheme();
  const capacitaQ = trpc.permessi.mie.useQuery(undefined, {
    staleTime: 60_000,
  });
  const capacita = capacitaQ.data ? new Set(capacitaQ.data) : null;
  const interruttoriQ = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  // Gruppi aperti/chiusi a mano; senza scelta esplicita, un gruppo è aperto
  // quando contiene la pagina corrente.
  const [gruppiAperti, setGruppiAperti] = useState<Record<string, boolean>>({});
  const sidebarRef = useRef<HTMLDivElement>(null);
  const tutteLeVoci = menuItems.flatMap((i) => (i.children ? i.children : [i]));
  const activeMenuItem = tutteLeVoci.find(item => isPathActive(location, item.path));
  const isMobile = useIsMobile();
  useNotificationStream();

  // Palette comandi (shell v2): scorciatoia e trigger esistono solo con la
  // UI v2 accesa; in v1 il componente non viene nemmeno montato.
  const uiV2 = Boolean(interruttoriQ.data?.uiV2);
  const [paletteAperta, setPaletteAperta] = useState(false);
  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  useEffect(() => {
    if (!uiV2) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteAperta((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [uiV2]);

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
            {uiV2 && (
              <SidebarMenu className="px-2 pt-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setPaletteAperta(true)}
                    tooltip={`Cerca (${isMac ? "⌘K" : "Ctrl+K"})`}
                    className="h-9 font-normal"
                  >
                    <Search className="h-4 w-4" />
                    <span className="flex-1 text-[var(--sidebar-chip-label)]">
                      Cerca…
                    </span>
                    <kbd className="rounded border border-[var(--sidebar-hairline)] px-1 text-[10px] text-[var(--sidebar-chip-label)]">
                      {isMac ? "⌘K" : "Ctrl+K"}
                    </kbd>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            )}
            <SidebarMenu className="px-2 py-1">
              {menuItems
                .map((item) =>
                  item.children
                    ? {
                        ...item,
                        children: item.children.filter((c) =>
                          visibile(c, user, capacita, interruttoriQ.data)
                        ),
                      }
                    : item
                )
                .filter((item) =>
                  item.children
                    ? item.children.length > 0
                    : visibile(item, user, capacita, interruttoriQ.data)
                )
                .map((item) => {
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
                            setGruppiAperti((s) => ({ ...s, [item.label]: !aperto }))
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
                            {figlie.map((c) => {
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
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4 font-medium opacity-60">
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
                      {user?.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-[var(--sidebar-chip-text)]">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-sidebar-foreground truncate mt-1">
                      {(user as any)?.ruolo?.replace(/_/g, " ") || user?.role || "-"}
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
                {uiV2 && toggleTheme && (
                  <DropdownMenuItem
                    onClick={toggleTheme}
                    className="cursor-pointer"
                  >
                    {theme === "dark" ? (
                      <Sun className="mr-2 h-4 w-4" />
                    ) : (
                      <Moon className="mr-2 h-4 w-4" />
                    )}
                    <span>
                      {theme === "dark" ? "Tema chiaro" : "Tema scuro"}
                    </span>
                  </DropdownMenuItem>
                )}
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
        <main
          className={`flex-1 min-h-dvh bg-background p-4 sm:p-5 lg:p-6 ${
            uiV2 && isMobile ? "pb-20" : ""
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            <PageContainer key={location}>{children}</PageContainer>
          </AnimatePresence>
        </main>
        {uiV2 && isMobile && (
          <BottomNav user={user} interruttori={interruttoriQ.data} />
        )}
      </SidebarInset>
      {uiV2 && (
        <CommandPalette
          open={paletteAperta}
          onOpenChange={setPaletteAperta}
          user={user}
          capacita={capacita}
          interruttori={interruttoriQ.data}
        />
      )}
    </>
  );
}
