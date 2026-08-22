export const EMAIL_VIEWS = [
  "da_gestire",
  "lead",
  "allegati",
  "collegate",
  "gestite",
  "escluse",
] as const;

export type EmailView = (typeof EMAIL_VIEWS)[number];

const EMAIL_VIEW_SET = new Set<string>(EMAIL_VIEWS);

export function parseEmailView(search: string): EmailView {
  const view = new URLSearchParams(search).get("view");
  return view && EMAIL_VIEW_SET.has(view) ? (view as EmailView) : "da_gestire";
}

export function parseEmailMessageId(search: string): number | null {
  const rawId = new URLSearchParams(search).get("messaggio");
  if (!rawId || !/^\d+$/.test(rawId)) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function emailMessageHref(id: number): string {
  const params = new URLSearchParams({ messaggio: String(id) });
  return `/messaggi/email?${params.toString()}`;
}

export function sourceHref(source: { tipo: "email"; id: number }): string {
  return emailMessageHref(source.id);
}
