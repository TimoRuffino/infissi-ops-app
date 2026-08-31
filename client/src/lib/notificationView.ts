// Stato URL del Centro azioni (`/notifiche?view=...`).
//
// Stessa disciplina di `parseEmailView` in `client/src/lib/messaggi.ts`: la
// vista vive nella query, non in uno stato locale che si perde al refresh o
// condividendo il link. Una vista sconosciuta non è un errore da mostrare,
// ricade sulla coda personale.

export const NOTIFICATION_VIEWS = [
  "mine",
  "critical",
  "resolved",
  "impostazioni",
] as const;

export type NotificationView = (typeof NOTIFICATION_VIEWS)[number];

/** Le tre viste che filtrano davvero la coda; `impostazioni` è una disclosure. */
export type NotificationQueueView = Exclude<NotificationView, "impostazioni">;

const NOTIFICATION_VIEW_SET = new Set<string>(NOTIFICATION_VIEWS);

export function parseNotificationView(search: string): NotificationView {
  const view = new URLSearchParams(search).get("view");
  return view && NOTIFICATION_VIEW_SET.has(view)
    ? (view as NotificationView)
    : "mine";
}

/**
 * La coda resta visibile anche mentre le preferenze sono aperte: le
 * impostazioni sono una sezione in più, non un filtro sulle notifiche.
 */
export function notificationQueueView(
  view: NotificationView
): NotificationQueueView {
  return view === "impostazioni" ? "mine" : view;
}

/** Link canonico: `mine` è la vista di default e non sporca l'indirizzo. */
export function notificationViewHref(view: NotificationView): string {
  return view === "mine" ? "/notifiche" : `/notifiche?view=${view}`;
}
