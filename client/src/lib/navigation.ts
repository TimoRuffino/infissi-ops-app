import {
  Archive,
  Banknote,
  BrainCircuit,
  Building2,
  Calculator,
  CalendarDays,
  Contact,
  HardHat,
  Kanban,
  Landmark,
  LayoutDashboard,
  Mail,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Package,
  Settings,
  Store,
  TicketCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { hasRuolo, isDirezione, type Ruolo } from "@/lib/roles";
import type { Capability } from "../../../server/authz/capabilities";

export type CapabilityName = Capability;
export type CapabilityStatus = "loading" | "resolved";

export type NavigationAccess = {
  user: unknown;
  capabilities: ReadonlySet<string> | null;
  flags?: { tars?: boolean } | null;
  capabilityStatus: CapabilityStatus;
};

// Modello di navigazione condiviso da sidebar, palette comandi e bottom
// nav: un'unica fonte per voci, gerarchia e regole di visibilità.
export type MenuItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  badge?: string;
  requiredCapabilities?: readonly CapabilityName[];
  roleRule?: "direzione";
  featureFlag?: "tars";
  loadingFallbackRoles?: readonly Ruolo[];
  // Un gruppo: la voce apre/chiude le figlie invece di navigare.
  children?: readonly MenuItem[];
};

const EVERY_AUTHENTICATED_ROLE = [
  "direzione",
  "amministrazione",
  "commerciale",
  "tecnico_rilievi",
  "squadra_posa",
  "post_vendita",
  "ordini",
] as const satisfies readonly Ruolo[];

export const DOCUMENT_INTELLIGENCE_DECISION_CAPABILITIES = [
  "documento.approve_proposals",
  "fornitore.manage_ordini",
] as const satisfies readonly CapabilityName[];

// Unica sorgente per sidebar, drawer, dock e palette. Garanzie, Produzione e
// Fornitori restano fuori dalla navigazione primaria; Squadre di posa resta
// visibile perché la lettura serve sia al campo sia all'ufficio.
export const menuItems: readonly MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  {
    icon: BrainCircuit,
    label: "Tars",
    path: "/tars",
    requiredCapabilities: ["tars.use"],
    featureFlag: "tars",
  },
  {
    icon: Contact,
    label: "Clienti",
    path: "/clienti",
    requiredCapabilities: ["cliente.read"],
    loadingFallbackRoles: EVERY_AUTHENTICATED_ROLE,
  },
  {
    icon: Building2,
    label: "Commesse",
    path: "/commesse",
    children: [
      {
        icon: Building2,
        label: "Commesse",
        path: "/commesse",
        requiredCapabilities: ["commessa.read"],
        loadingFallbackRoles: EVERY_AUTHENTICATED_ROLE,
      },
      {
        icon: Kanban,
        label: "Board",
        path: "/kanban",
        requiredCapabilities: ["commessa.read"],
        loadingFallbackRoles: EVERY_AUTHENTICATED_ROLE,
      },
      { icon: Calculator, label: "Preventivatori", path: "/preventivatori" },
      {
        icon: Archive,
        label: "Archivio",
        path: "/archivio",
        requiredCapabilities: ["commessa.read"],
        loadingFallbackRoles: EVERY_AUTHENTICATED_ROLE,
      },
    ],
  },
  {
    icon: HardHat,
    label: "Cantiere",
    path: "/planning",
    children: [
      { icon: CalendarDays, label: "Calendario", path: "/planning" },
      { icon: HardHat, label: "Squadre di posa", path: "/squadre" },
      {
        icon: Package,
        label: "Magazzino",
        path: "/magazzino",
        requiredCapabilities: ["commessa.read"],
        loadingFallbackRoles: EVERY_AUTHENTICATED_ROLE,
      },
    ],
  },
  {
    icon: TrendingUp,
    label: "Economia",
    path: "/economia",
    children: [
      {
        icon: Landmark,
        label: "Contabilità",
        path: "/economia",
        requiredCapabilities: ["economia.read"],
      },
      {
        icon: Banknote,
        label: "Pagamenti",
        path: "/pagamenti",
        requiredCapabilities: ["pagamento.read"],
        loadingFallbackRoles: ["direzione", "amministrazione"],
      },
      {
        icon: TrendingUp,
        label: "Marginalità",
        path: "/marginalita",
        roleRule: "direzione",
      },
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
      // Interna, non con i clienti: sta accanto agli altri canali perché è
      // lì che si va a cercare "chi mi ha scritto cosa".
      { icon: MessageSquare, label: "Chat aziendale", path: "/chat" },
    ],
  },
  { icon: Users, label: "Utenti", path: "/utenti", roleRule: "direzione" },
  { icon: Store, label: "Sedi", path: "/sedi", roleRule: "direzione" },
  { icon: Settings, label: "Impostazioni", path: "/integrazioni" },
];

/**
 * UX shaping only. `permessi.mie` contains the effective server decision
 * (roles, overrides and active delegations); no visible item grants access to
 * a route or procedure.
 */
export function isNavigationItemVisible(
  item: MenuItem,
  access: NavigationAccess
): boolean {
  if (!access.user) return false;
  if (item.featureFlag && access.flags?.[item.featureFlag] !== true)
    return false;
  if (item.roleRule === "direzione" && !isDirezione(access.user)) return false;

  const required = item.requiredCapabilities ?? [];
  if (required.length === 0) return true;

  if (access.capabilityStatus === "resolved") {
    return Boolean(
      access.capabilities &&
        required.every(capability => access.capabilities?.has(capability))
    );
  }

  // During loading there is no capability guess. A destination is shown only
  // when its contract opts into a role fallback. Economy and Tars deliberately
  // define none, so protected controls never appear optimistically.
  const fallbackRoles = item.loadingFallbackRoles ?? [];
  if (item.featureFlag === "tars" || fallbackRoles.length === 0) return false;
  if (fallbackRoles.some(role => hasRuolo(access.user, role))) return true;
  return false;
}

// Gruppi già sagomati per sidebar e drawer. Un gruppo senza figlie visibili
// scompare, evitando intestazioni vuote o link a superfici non accessibili.
export function navigationGroups(access: NavigationAccess): MenuItem[] {
  return menuItems.flatMap(item => {
    if (!isNavigationItemVisible(item, access)) return [];
    if (!item.children) return [item];

    const children = item.children.filter(child =>
      isNavigationItemVisible(child, access)
    );
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}

// Voci raggiungibili (gruppi appiattiti) per palette, dock e ricerche.
export function navigationDestinations(access: NavigationAccess): MenuItem[] {
  return navigationGroups(access).flatMap(item => item.children ?? [item]);
}

export function isPathActive(location: string, path: string): boolean {
  return path === "/"
    ? location === "/"
    : location === path || location.startsWith(`${path}/`);
}

export function navigationItemState(
  location: string,
  path: string,
  childPaths: string[]
): { active: boolean; containsActiveChild: boolean } {
  const containsActiveChild = childPaths.some(childPath =>
    isPathActive(location, childPath)
  );
  return {
    active: childPaths.length === 0 && isPathActive(location, path),
    containsActiveChild,
  };
}

/**
 * La pagina «Produzione» è stata rimossa il 29/08/2026 (release hardening,
 * PRD §20): non era usata. I segnalibri e i vecchi link atterrano sul
 * Board, la superficie operativa dove la colonna «Produzione» segue le
 * commesse in quello stato. Query string e sottopercorsi si scartano: la
 * vecchia pagina non aveva deep link con stato proprio.
 */
export function produzioneRedirect(_location: string): string {
  return "/kanban";
}
