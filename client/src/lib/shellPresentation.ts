import type { RouteContractEntry } from "@/lib/routeContract";

export type RoutePresentation = { section: string; title: string };

const ROUTE_PRESENTATION: Record<string, RoutePresentation> = {
  "/": { section: "Oggi", title: "Dashboard" },
  "/clienti": { section: "Clienti", title: "Elenco clienti" },
  "/clienti/:id": { section: "Clienti", title: "Dettaglio cliente" },
  "/kanban": { section: "Commesse", title: "Board operativo" },
  "/magazzino": { section: "Ordini e cantiere", title: "Magazzino" },
  "/pagamenti": { section: "Economia", title: "Pagamenti" },
  "/economia": { section: "Economia", title: "Contabilità" },
  "/marginalita": { section: "Economia", title: "Marginalità" },
  "/commesse": { section: "Commesse", title: "Elenco commesse" },
  "/commesse/:id": { section: "Commesse", title: "Commessa 360" },
  "/commesse/:commessaId/aperture/:aperturaId/rilievo": {
    section: "Commesse",
    title: "Rilievo apertura",
  },
  "/verbale/:interventoId": {
    section: "Cantiere",
    title: "Verbale di chiusura",
  },
  "/planning": { section: "Cantiere", title: "Planning" },
  "/ticket": { section: "Post-vendita", title: "Ticket" },
  "/garanzie": { section: "Post-vendita", title: "Garanzie" },
  "/squadre": { section: "Cantiere", title: "Squadre di posa" },
  "/fornitori": { section: "Ordini", title: "Fornitori e ordini" },
  "/preventivatori": { section: "Commesse", title: "Preventivatori" },
  "/preventivatori/fivizzanese/persiane": {
    section: "Preventivatori",
    title: "Fivizzanese · Persiane",
  },
  "/preventivatori/punto-del-serramento/persiane": {
    section: "Preventivatori",
    title: "Punto del Serramento · Persiane",
  },
  "/reclami": { section: "Post-vendita", title: "Reclami e rifacimenti" },
  "/archivio": { section: "Commesse", title: "Archivio" },
  "/utenti": { section: "Amministrazione", title: "Utenti" },
  "/sedi": { section: "Amministrazione", title: "Sedi" },
  "/messaggi/email": { section: "Comunicazioni", title: "Email" },
  "/messaggi/whatsapp": { section: "Comunicazioni", title: "WhatsApp" },
  "/chat": { section: "Comunicazioni", title: "Chat aziendale" },
  "/notifiche": { section: "Oggi", title: "Centro azioni" },
  "/conoscenza": { section: "Amministrazione", title: "Conoscenza" },
  "/integrazioni": { section: "Amministrazione", title: "Impostazioni" },
  "/tars": { section: "Tars", title: "Centro decisionale" },
  "/404": { section: "Navigazione", title: "Pagina non trovata" },
  "*": { section: "Navigazione", title: "Pagina non trovata" },
};

export function routePresentation(
  route: RouteContractEntry
): RoutePresentation {
  return (
    ROUTE_PRESENTATION[route.path] ?? {
      section: "Ruffino Flow",
      title: route.target,
    }
  );
}

/**
 * Route che occupano esattamente l'area di lavoro invece di allungarla: la
 * conversazione (o la lista) scorre dentro il proprio riquadro, mentre le
 * colonne laterali restano ferme. Sopra 1200px la shell fissa l'altezza del
 * contenuto per queste route; altrove il contenuto scorre con la pagina.
 */
const ROUTE_A_PIENA_ALTEZZA = new Set([
  "/tars",
  "/chat",
  "/messaggi/email",
  "/messaggi/whatsapp",
]);

export function routeOccupaAreaDiLavoro(location: string): boolean {
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  return ROUTE_A_PIENA_ALTEZZA.has(pathname);
}

export function predictableMobileBackTarget(location: string): string | null {
  const pathname = location.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  const rilievo = pathname.match(
    /^\/commesse\/([^/]+)\/aperture\/[^/]+\/rilievo$/
  );
  if (rilievo) return `/commesse/${rilievo[1]}`;
  if (/^\/commesse\/[^/]+$/.test(pathname)) return "/commesse";
  if (/^\/clienti\/[^/]+$/.test(pathname)) return "/clienti";
  if (/^\/preventivatori\/[^/]+\/[^/]+$/.test(pathname)) {
    return "/preventivatori";
  }
  if (/^\/verbale\/[^/]+$/.test(pathname)) return "/planning";
  return null;
}
