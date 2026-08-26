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
import {
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Building2,
  CalendarDays,
  TicketCheck,
  Users,
  Shield,
  Contact,
  Settings,
  Truck,
  Factory,
  Kanban,
  AlertTriangle,
  User,
  Calculator,
  Archive,
  Store,
  Package,
  Banknote,
  TrendingUp,
  HardHat,
  Bot,
  Mail,
  MessageCircle,
  MessagesSquare,
  ChevronDown,
  Landmark,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import NotificheDropdown from "./NotificheDropdown";
import { TarsChatFloating } from "./TarsChat";
import { PromemoriaPopupHost } from "./PromemoriaPopupHost";
import LoginPage from "@/pages/LoginPage";
import PageContainer from "./PageContainer";
import SedeSwitcher from "./SedeSwitcher";
import { hasRuolo, isDirezione } from "@/lib/roles";
import { isPathActive, navigationItemState } from "@/lib/navigation";
import { AnimatePresence } from "framer-motion";
import { useNotificationStream } from "@/hooks/useNotificationStream";

// Sidebar menu. Items marked `direzioneOnly` are filtered out at render time
// for users without the `direzione` role. Garanzie, Produzione e Fornitori
// restano fuori — si raggiungono dall'hub Impostazioni (anch'esso riservato
// alla direzione) per tenere la sidebar sul lavoro di tutti i giorni.
// Squadre di posa invece è qui: serve a chiunque debba sapere chi è in
// cantiere, e la sola lettura è aperta a tutti i ruoli.
type MenuItem = {
  icon: any;
  label: string;
  path: string;
  badge?: string;
  direzioneOnly?: boolean;
  // Solo direzione e amministrazione (superfici economiche).
  economiaOnly?: boolean;
  // Un gruppo: la voce apre/chiude le figlie invece di navigare.
  children?: MenuItem[];
};

const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Contact, label: "Clienti", path: "/clienti" },
  {
    icon: Building2,
    label: "Commesse",
    path: "/commesse",
    children: [
      { icon: Building2, label: "Commesse", path: "/commesse" },
      { icon: Kanban, label: "Board", path: "/kanban" },
      { icon: Calculator, label: "Preventivatori", path: "/preventivatori" },
      { icon: Archive, label: "Archivio", path: "/archivio" },
    ],
  },
  {
    icon: HardHat,
    label: "Cantiere",
    path: "/planning",
    children: [
      { icon: CalendarDays, label: "Calendario", path: "/planning" },
      { icon: HardHat, label: "Squadre di posa", path: "/squadre" },
      { icon: Package, label: "Magazzino", path: "/magazzino" },
    ],
  },
  {
    icon: TrendingUp,
    label: "Economia",
    path: "/economia",
    children: [
      { icon: Landmark, label: "Contabilità", path: "/economia", economiaOnly: true },
      { icon: Banknote, label: "Pagamenti", path: "/pagamenti" },
      { icon: TrendingUp, label: "Marginalità", path: "/marginalita", direzioneOnly: true },
    ],
  },
  { icon: TicketCheck, label: "Post-Vendita", path: "/reclami" },
  {
    icon: MessagesSquare,
    label: "Messaggi",
    path: "/messaggi/email",
    children: [
      { icon: Mail, label: "Email", path: "/messaggi/email" },
      { icon: MessageCircle, label: "WhatsApp", path: "/messaggi/whatsapp" },
    ],
  },
  { icon: Bot, label: "Tars", path: "/tars" },
  { icon: Users, label: "Utenti", path: "/utenti", direzioneOnly: true },
  { icon: Store, label: "Sedi", path: "/sedi", direzioneOnly: true },
  { icon: Settings, label: "Impostazioni", path: "/integrazioni" },
];

// Chi vede una voce: i vincoli di ruolo rispecchiano quelli del server
// (il server resta l'autorità — qui si evita solo il link morto).
function visibile(item: MenuItem, user: unknown): boolean {
  if (item.direzioneOnly && !isDirezione(user)) return false;
  if (item.economiaOnly && !isDirezione(user) && !hasRuolo(user, "amministrazione")) {
    return false;
  }
  return true;
}

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
      {/* Tars sempre a portata di mano, su ogni pagina (solo se attivo). */}
      <TarsChatFloating />
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
                    className="h-5 w-auto max-w-[116px] brightness-0 invert shrink-0"
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
              {menuItems
                .map((item) =>
                  item.children
                    ? {
                        ...item,
                        children: item.children.filter((c) => visibile(c, user)),
                      }
                    : item
                )
                .filter((item) =>
                  item.children ? item.children.length > 0 : visibile(item, user)
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
                          <div className="ml-4 border-l border-white/10 pl-1 mt-0.5 space-y-0.5">
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
                                      ? "bg-sidebar-accent hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent text-white font-semibold"
                                      : "font-normal"
                                  }`}
                                >
                                  {attiva && (
                                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                                  )}
                                  <c.icon
                                    className={`h-4 w-4 transition-colors ${attiva ? "text-white" : ""}`}
                                  />
                                  <span className="flex-1">{c.label}</span>
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
                            ? "bg-sidebar-accent hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent text-white font-semibold"
                            : "font-normal"
                        }`}
                      >
                        {itemState.active && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                        )}
                        <item.icon
                          className={`h-4 w-4 transition-colors ${itemState.active ? "text-white" : ""}`}
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
                  <Avatar className="h-9 w-9 border border-sidebar-border shrink-0 bg-sidebar-primary/15">
                    <AvatarFallback className="text-xs font-semibold text-sidebar-primary bg-sidebar-primary/15">
                      {user?.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-white">
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
