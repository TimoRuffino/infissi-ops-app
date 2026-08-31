
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
import { hasRuolo, isDirezione } from "@/lib/roles";

// Modello di navigazione condiviso da sidebar, palette comandi e bottom
// nav: un'unica fonte per voci, gerarchia e regole di visibilità.
export type MenuItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  badge?: string;
  direzioneOnly?: boolean;
  // Solo direzione e amministrazione (superfici economiche).
  economiaOnly?: boolean;
  // Richiede la capability `pagamento.read` (vista cassa, slice 2). Finché
  // le capability non sono caricate vale il fallback di ruolo.
  pagamentiOnly?: boolean;
  // Visibile solo con FLAG_TARS acceso (kill switch server-side: la voce
  // sparisce a flag spento, e comunque il router rifiuta).
  tarsOnly?: boolean;
  // Un gruppo: la voce apre/chiude le figlie invece di navigare.
  children?: MenuItem[];
};

// Sidebar menu. Items marked `direzioneOnly` are filtered out at render time
// for users without the `direzione` role. Garanzie, Produzione e Fornitori
// restano fuori — si raggiungono dall'hub Impostazioni (anch'esso riservato
// alla direzione) per tenere la sidebar sul lavoro di tutti i giorni.
// Squadre di posa invece è qui: serve a chiunque debba sapere chi è in
// cantiere, e la sola lettura è aperta a tutti i ruoli.
export const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: BrainCircuit, label: "Tars", path: "/tars", tarsOnly: true },
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
      { icon: Banknote, label: "Pagamenti", path: "/pagamenti", pagamentiOnly: true },
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
      // Interna, non con i clienti: sta accanto agli altri canali perché è
      // lì che si va a cercare "chi mi ha scritto cosa".
      { icon: MessageSquare, label: "Chat aziendale", path: "/chat" },
    ],
  },
  { icon: Users, label: "Utenti", path: "/utenti", direzioneOnly: true },
  { icon: Store, label: "Sedi", path: "/sedi", direzioneOnly: true },
  { icon: Settings, label: "Impostazioni", path: "/integrazioni" },
];

// Chi vede una voce: i vincoli rispecchiano quelli del server (il server
// resta l'autorità — qui si evita solo il link morto). Le voci a capability
// usano `permessi.mie` quando disponibile; prima del caricamento vale il
// fallback di ruolo, così direzione e amministrazione non vedono lampeggi e
// un override individuale compare appena la risposta arriva.
export function visibile(
  item: MenuItem,
  user: unknown,
  capacita: ReadonlySet<string> | null,
  interruttori?: { tars?: boolean } | null
): boolean {
  if (item.tarsOnly && !interruttori?.tars) return false;
  if (item.direzioneOnly && !isDirezione(user)) return false;
  if (item.economiaOnly && !isDirezione(user) && !hasRuolo(user, "amministrazione")) {
    return false;
  }
  if (item.pagamentiOnly) {
    if (capacita) return capacita.has("pagamento.read");
    return isDirezione(user) || hasRuolo(user, "amministrazione");
  }
  return true;
}

// Voci raggiungibili (gruppi appiattiti) per palette e ricerche.
export function vociNavigazione(
  user: unknown,
  capacita: ReadonlySet<string> | null,
  interruttori?: { tars?: boolean } | null
): MenuItem[] {
  return menuItems
    .flatMap((i) => (i.children ? i.children : [i]))
    .filter((i) => visibile(i, user, capacita, interruttori));
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
