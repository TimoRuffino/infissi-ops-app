import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { toast } from "sonner";

import { useAuth } from "@/_core/hooks/useAuth";
import BottomNav from "@/components/BottomNav";
import CommandPalette from "@/components/CommandPalette";
import NotificheDropdown from "@/components/NotificheDropdown";
import PageContainer from "@/components/PageContainer";
import { PromemoriaPopupHost } from "@/components/PromemoriaPopupHost";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { useIsMobile } from "@/hooks/useMobile";
import { useNotificationStream } from "@/hooks/useNotificationStream";
import type { NavigationAccess } from "@/lib/navigation";
import { scopedStorageKey } from "@/lib/operationalContext";
import { routeContractForLocation } from "@/lib/routeContract";
import {
  predictableMobileBackTarget,
  routeOccupaAreaDiLavoro,
  routePresentation,
} from "@/lib/shellPresentation";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import CompactNavigation from "./CompactNavigation";
import ContextBar from "./ContextBar";
import MobileTopBar from "./MobileTopBar";
import NavigationSidebar from "./NavigationSidebar";
import ShellWorkspace from "./ShellWorkspace";
import UserMenu from "./UserMenu";

const NAVIGATION_COLLAPSED_KEY = "layout.modular-navigation-collapsed";

export type ModularControlLayoutProps = {
  children: React.ReactNode;
};

export default function ModularControlLayout({
  children,
}: ModularControlLayoutProps) {
  const { user } = useAuth();
  const { capabilities, flags, scopeKey } = useOperationalContext();
  const [location, setLocation] = useLocation();
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const isMobile = useIsMobile();
  const navigationReturnFocus = useRef<HTMLElement | null>(null);
  const commandReturnFocus = useRef<HTMLElement | null>(null);
  const hydratedStorageKey = useRef<string | null>(null);
  const navigationStorageKey = scopeKey
    ? scopedStorageKey(NAVIGATION_COLLAPSED_KEY, scopeKey)
    : null;
  const access = useMemo<NavigationAccess>(
    () => ({
      user,
      capabilities,
      flags,
      capabilityStatus: capabilities === null ? "loading" : "resolved",
    }),
    [capabilities, flags, user]
  );
  const currentRoute = routeContractForLocation(location);
  const currentPresentation = routePresentation(currentRoute);

  useNotificationStream();

  useEffect(() => {
    hydratedStorageKey.current = null;
    if (!navigationStorageKey) {
      setNavigationCollapsed(false);
      return;
    }
    try {
      setNavigationCollapsed(
        window.localStorage.getItem(navigationStorageKey) === "true"
      );
    } catch {
      setNavigationCollapsed(false);
    }
  }, [navigationStorageKey]);

  useEffect(() => {
    if (!navigationStorageKey) return;
    if (hydratedStorageKey.current !== navigationStorageKey) {
      hydratedStorageKey.current = navigationStorageKey;
      return;
    }
    try {
      window.localStorage.setItem(
        navigationStorageKey,
        String(navigationCollapsed)
      );
    } catch {
      // Il layout resta operativo anche se lo storage del browser è bloccato.
    }
  }, [navigationCollapsed, navigationStorageKey]);

  useEffect(() => {
    const handleCommandShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(open => {
          if (!open && document.activeElement instanceof HTMLElement) {
            commandReturnFocus.current = document.activeElement;
          }
          if (open) {
            window.requestAnimationFrame(() =>
              commandReturnFocus.current?.focus()
            );
          }
          return !open;
        });
      }
    };
    window.addEventListener("keydown", handleCommandShortcut);
    return () => window.removeEventListener("keydown", handleCommandShortcut);
  }, []);

  const chat = trpc.chat.nonLetti.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: 15_000,
    retry: false,
  });
  const lastNotifiedMessage = useRef(0);

  useEffect(() => {
    const last = chat.data?.ultimo;
    if (!last) return;
    if (lastNotifiedMessage.current === 0) {
      lastNotifiedMessage.current = last.messaggioId;
      return;
    }
    if (last.messaggioId <= lastNotifiedMessage.current) return;
    lastNotifiedMessage.current = last.messaggioId;
    if (location.startsWith("/chat")) return;
    toast(`${last.autore} · ${last.canaleNome}`, {
      description: last.anteprima,
      action: { label: "Apri", onClick: () => setLocation("/chat") },
    });
  }, [chat.data?.ultimo, location, setLocation]);

  const changeNavigationOpen = (open: boolean) => {
    if (open && document.activeElement instanceof HTMLElement) {
      navigationReturnFocus.current = document.activeElement;
    }
    setNavigationOpen(open);
    if (!open) {
      window.requestAnimationFrame(() =>
        navigationReturnFocus.current?.focus()
      );
    }
  };

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1200px)");
    const closeCompactNavigation = () => {
      if (desktop.matches) setNavigationOpen(false);
    };
    desktop.addEventListener("change", closeCompactNavigation);
    closeCompactNavigation();
    return () => desktop.removeEventListener("change", closeCompactNavigation);
  }, []);

  const navigate = (path: string) => {
    if (navigationOpen) changeNavigationOpen(false);
    setLocation(path);
  };

  const changeCommandOpen = (open: boolean) => {
    if (open && document.activeElement instanceof HTMLElement) {
      commandReturnFocus.current = document.activeElement;
    }
    setCommandOpen(open);
    if (!open) {
      window.requestAnimationFrame(() => commandReturnFocus.current?.focus());
    }
  };

  const navigation = (
    <div
      className={cn(
        "sticky top-4 h-[calc(100dvh-32px)] min-h-0 transition-[width] duration-(--duration-base) ease-(--ease-standard)",
        navigationCollapsed ? "w-[72px]" : "w-60"
      )}
    >
      <NavigationSidebar
        currentPath={location}
        collapsed={navigationCollapsed}
        onNavigate={navigate}
        onCollapsedChange={setNavigationCollapsed}
      />
    </div>
  );

  return (
    <>
      <ShellWorkspace
        fillsWorkspace={routeOccupaAreaDiLavoro(location)}
        navigation={navigation}
        contextBar={
          isMobile ? (
            <MobileTopBar
              title={currentPresentation.title}
              backTarget={predictableMobileBackTarget(location)}
              onNavigate={navigate}
              onOpenCommand={() => changeCommandOpen(true)}
              onOpenNavigation={() => changeNavigationOpen(true)}
              notificationTrigger={
                <NotificheDropdown triggerClassName="h-11 w-11" />
              }
              profileTrigger={<UserMenu />}
            />
          ) : (
            <ContextBar
              currentRoute={currentRoute}
              onOpenCommand={() => changeCommandOpen(true)}
              onOpenNavigation={() => changeNavigationOpen(true)}
            />
          )
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          <PageContainer key={location}>{children}</PageContainer>
        </AnimatePresence>
      </ShellWorkspace>

      <CompactNavigation
        open={navigationOpen}
        onOpenChange={changeNavigationOpen}
        currentPath={location}
        onNavigate={navigate}
      />

      {isMobile ? (
        <BottomNav
          access={access}
          currentPath={location}
          drawerOpen={navigationOpen}
          onOpenDrawer={() => changeNavigationOpen(true)}
        />
      ) : null}

      <CommandPalette
        open={commandOpen}
        onOpenChange={changeCommandOpen}
        access={access}
        scopeKey={scopeKey}
      />
      <PromemoriaPopupHost />
    </>
  );
}
