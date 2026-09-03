export type RouteKind = "page" | "guarded" | "redirect" | "fallback";

export type RouteNavigation =
  | "primary"
  | "secondary"
  | "hidden"
  | "redirect"
  | "fallback";

export type MobileTreatment =
  | "standard"
  | "record"
  | "workbench"
  | "inbox"
  | "field"
  | "redirect"
  | "fallback";

export type RouteMigrationStatus =
  | "planned"
  | "redirect"
  | "migrata"
  | "esclusa";

/**
 * Metadata for migration and UI shaping only. Server procedures remain the
 * authorization and sede-isolation boundary for every route.
 */
export type RouteContractEntry = {
  path: string;
  kind: RouteKind;
  target: string;
  uxGuard: string;
  serverAuthority: string;
  requiredCapabilities: readonly string[];
  roleRule: string | null;
  featureFlag: "FLAG_TARS" | null;
  navigation: RouteNavigation;
  mobileTreatment: MobileTreatment;
  migrationStatus: RouteMigrationStatus;
};

const route = (entry: RouteContractEntry): RouteContractEntry => entry;

export const APP_ROUTE_CONTRACT = [
  route({
    path: "/",
    kind: "page",
    target: "Dashboard",
    uxGuard: "authenticated shell",
    serverAuthority: "multiple protected sede-scoped routers",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/clienti",
    kind: "page",
    target: "ClientiList",
    uxGuard: "navigation capability shaping",
    serverAuthority: "clientiRouter + policy engine",
    requiredCapabilities: ["cliente.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/clienti/:id",
    kind: "page",
    target: "ClienteDetail",
    uxGuard: "record visibility from server payload",
    serverAuthority: "clientiRouter + sede scope",
    requiredCapabilities: ["cliente.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "record",
    migrationStatus: "migrata",
  }),
  route({
    path: "/kanban",
    kind: "page",
    target: "KanbanBoard",
    uxGuard: "navigation capability shaping",
    serverAuthority: "commesseRouter + policy engine",
    requiredCapabilities: ["commessa.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "workbench",
    migrationStatus: "migrata",
  }),
  route({
    path: "/magazzino",
    kind: "page",
    target: "Magazzino",
    uxGuard: "authenticated shell",
    serverAuthority: "magazzinoRouter + parent commessa sede scope",
    requiredCapabilities: ["commessa.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/conferme-ordine",
    kind: "page",
    target: "ConfermeOrdine",
    uxGuard: "authenticated shell",
    serverAuthority: "preventiviContrattiRouter.registroConferme (sede scope)",
    requiredCapabilities: ["commessa.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/pagamenti",
    kind: "page",
    target: "Pagamenti",
    uxGuard: "capability:pagamento.read",
    serverAuthority: "commesseRouter + policy engine",
    requiredCapabilities: ["pagamento.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/economia",
    kind: "page",
    target: "Economia",
    uxGuard: "capability:economia.read",
    serverAuthority:
      "ficFattureRouter + ficCostiRouter + commesseRouter policy enforcement",
    requiredCapabilities: ["economia.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "workbench",
    migrationStatus: "migrata",
  }),
  route({
    path: "/marginalita",
    kind: "guarded",
    target: "Marginalita",
    uxGuard: "RequireDirezione",
    serverAuthority:
      "commesseRouter.marginalita + requireDirezione + sede scope",
    requiredCapabilities: [],
    roleRule: "direzione",
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/commesse",
    kind: "page",
    target: "CommesseList",
    uxGuard: "navigation capability shaping",
    serverAuthority: "commesseRouter + policy engine",
    requiredCapabilities: ["commessa.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/commesse/:id",
    kind: "page",
    target: "CommessaDetail",
    uxGuard: "capability-shaped fields and actions",
    serverAuthority: "commesseRouter + policy engine + sede scope",
    requiredCapabilities: ["commessa.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "record",
    migrationStatus: "migrata",
  }),
  route({
    path: "/commesse/:commessaId/aperture/:aperturaId/rilievo",
    kind: "page",
    target: "RilievoDetail",
    uxGuard: "parent record visibility",
    serverAuthority: "apertureRouter + commesseRouter sede scope",
    requiredCapabilities: ["commessa.read", "commessa.update_operational"],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "field",
    migrationStatus: "migrata",
  }),
  route({
    path: "/verbale/:interventoId",
    kind: "page",
    target: "VerbaleChiusura",
    uxGuard: "parent intervention visibility",
    serverAuthority: "verbaliRouter + interventiRouter sede scope",
    requiredCapabilities: ["intervento.plan"],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "field",
    migrationStatus: "migrata",
  }),
  route({
    path: "/planning",
    kind: "page",
    target: "Planning",
    uxGuard: "capability-shaped actions",
    serverAuthority: "interventiRouter + externalCalendarsRouter",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "workbench",
    migrationStatus: "migrata",
  }),
  route({
    path: "/ticket",
    kind: "page",
    target: "TicketList",
    uxGuard: "capability-shaped actions",
    serverAuthority: "ticketRouter + ticketAllegatiRouter",
    requiredCapabilities: ["ticket.create"],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/garanzie",
    kind: "guarded",
    target: "GaranzieList",
    uxGuard: "RequireDirezione",
    serverAuthority:
      "garanzieRouter protected sede-scoped reads + adminProcedure writes",
    requiredCapabilities: [],
    roleRule: "direzione",
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/squadre",
    kind: "page",
    target: "SquadreList",
    uxGuard: "read for all; mutations direction-only",
    serverAuthority: "squadreRouter + adminProcedure on writes",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/fornitori",
    kind: "guarded",
    target: "FornitoriList",
    uxGuard: "RequireDirezione",
    serverAuthority:
      "fornitoriRouter protected sede-scoped reads + adminProcedure writes; proposteRouter dual-capability gateway",
    requiredCapabilities: [
      "documento.approve_proposals",
      "fornitore.manage_ordini",
    ],
    roleRule: "direzione",
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "workbench",
    migrationStatus: "esclusa",
  }),
  route({
    path: "/preventivatori",
    kind: "page",
    target: "Preventivatori",
    uxGuard: "authenticated shell",
    serverAuthority:
      "authenticated shell; calculator contracts are client-side",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/preventivatori/fivizzanese/persiane",
    kind: "page",
    target: "PreventivatoreFivizzanese",
    uxGuard: "authenticated shell",
    serverAuthority:
      "authenticated shell; calculator contracts are client-side",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "field",
    migrationStatus: "migrata",
  }),
  route({
    path: "/preventivatori/punto-del-serramento/persiane",
    kind: "page",
    target: "PreventivatorePuntoDelSerramento",
    uxGuard: "authenticated shell",
    serverAuthority:
      "authenticated shell; calculator contracts are client-side",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "field",
    migrationStatus: "migrata",
  }),
  route({
    path: "/produzione/*?",
    kind: "redirect",
    target: "/kanban",
    uxGuard: "produzioneRedirect",
    serverAuthority: "redirect only; destination uses commesseRouter",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "redirect",
    mobileTreatment: "redirect",
    migrationStatus: "redirect",
  }),
  route({
    path: "/reclami",
    kind: "page",
    target: "ReclamiRifacimenti",
    uxGuard: "capability-shaped actions",
    serverAuthority: "reclamiRifacimentiRouter + sede scope",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/archivio",
    kind: "page",
    target: "Archivio",
    uxGuard: "navigation capability shaping",
    serverAuthority: "commesseRouter + sede scope",
    requiredCapabilities: ["commessa.read"],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/utenti",
    kind: "guarded",
    target: "UtentiList",
    uxGuard: "RequireDirezione",
    serverAuthority:
      "utentiRouter sede-scoped protected reads + adminProcedure writes",
    requiredCapabilities: [],
    roleRule: "direzione",
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "workbench",
    migrationStatus: "migrata",
  }),
  route({
    path: "/sedi",
    kind: "guarded",
    target: "SediList",
    uxGuard: "RequireDirezione",
    serverAuthority: "sediRouter.listAll/create/update + adminProcedure",
    requiredCapabilities: [],
    roleRule: "direzione",
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/messaggi/email",
    kind: "page",
    target: "EmailPage",
    uxGuard: "channel configuration and sede scope",
    serverAuthority: "mailRouter.email + mailRouter.comunicazioni",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "inbox",
    migrationStatus: "migrata",
  }),
  route({
    path: "/messaggi/whatsapp",
    kind: "page",
    target: "WhatsAppPage",
    uxGuard: "channel configuration and sede scope",
    serverAuthority: "mailRouter.whatsapp + mailRouter.comunicazioni",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "inbox",
    migrationStatus: "migrata",
  }),
  route({
    path: "/chat",
    kind: "page",
    target: "ChatAziendale",
    uxGuard: "authenticated principal and sede scope",
    serverAuthority: "chatRouter",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "inbox",
    migrationStatus: "migrata",
  }),
  route({
    path: "/notifiche",
    kind: "page",
    target: "Notifiche",
    uxGuard: "authenticated principal",
    serverAuthority: "notificheRouter",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/comunicazioni",
    kind: "redirect",
    target: "/messaggi/email",
    uxGuard: "legacyMessageRedirect",
    serverAuthority: "redirect only; destination uses mailRouter",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "redirect",
    mobileTreatment: "redirect",
    migrationStatus: "redirect",
  }),
  route({
    path: "/conoscenza",
    kind: "guarded",
    target: "Conoscenza",
    uxGuard: "RequireDirezione",
    serverAuthority:
      "conoscenzaRouter protected procedures + requireDirezione + sede scope",
    requiredCapabilities: [],
    roleRule: "direzione",
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "standard",
    migrationStatus: "migrata",
  }),
  route({
    path: "/integrazioni",
    kind: "page",
    target: "Integrazioni",
    uxGuard: "capability and role shaped panels",
    serverAuthority: "integration routers + server role checks",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "primary",
    mobileTreatment: "workbench",
    migrationStatus: "migrata",
  }),
  route({
    path: "/tars",
    kind: "page",
    target: "Tars",
    uxGuard: "feature flag and capability-shaped tools",
    serverAuthority: "tarsRouter + procedureConInterruttore(tars)",
    requiredCapabilities: ["tars.use"],
    roleRule: null,
    featureFlag: "FLAG_TARS",
    navigation: "primary",
    mobileTreatment: "workbench",
    migrationStatus: "migrata",
  }),
  route({
    path: "/404",
    kind: "page",
    target: "NotFound",
    uxGuard: "none",
    serverAuthority: "none",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "hidden",
    mobileTreatment: "fallback",
    migrationStatus: "migrata",
  }),
  route({
    path: "*",
    kind: "fallback",
    target: "NotFound",
    uxGuard: "none",
    serverAuthority: "none",
    requiredCapabilities: [],
    roleRule: null,
    featureFlag: null,
    navigation: "fallback",
    mobileTreatment: "fallback",
    migrationStatus: "migrata",
  }),
] as const satisfies readonly RouteContractEntry[];

/** Extracts the concrete Wouter surface from App.tsx for drift tests. */
export function registeredRoutePaths(source: string): string[] {
  const tags = source.match(/<Route\b[^>]*>/gs) ?? [];
  return tags.flatMap(tag => {
    const path = /\bpath\s*=\s*"([^"]+)"/.exec(tag)?.[1];
    if (path) return [path];
    return /\bcomponent\s*=\s*\{NotFound\}/.test(tag) ? ["*"] : [];
  });
}

function normalizedPathname(location: string): string {
  const pathname = location.split(/[?#]/, 1)[0] || "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function routeMatches(pattern: string, location: string): boolean {
  const pathname = normalizedPathname(location);
  if (pattern === "*") return true;
  if (pattern.endsWith("/*?")) {
    const base = pattern.slice(0, -3);
    return pathname === base || pathname.startsWith(`${base}/`);
  }

  const expected = pattern.split("/");
  const actual = pathname.split("/");
  if (expected.length !== actual.length) return false;
  return expected.every(
    (segment, index) =>
      segment === actual[index] ||
      (segment.startsWith(":") && actual[index].length > 0)
  );
}

export function routeContractForLocation(location: string): RouteContractEntry {
  return (
    APP_ROUTE_CONTRACT.find(
      entry => entry.kind !== "fallback" && routeMatches(entry.path, location)
    ) ?? APP_ROUTE_CONTRACT[APP_ROUTE_CONTRACT.length - 1]
  );
}
