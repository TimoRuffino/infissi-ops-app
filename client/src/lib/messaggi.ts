import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type EmailMessage = RouterOutputs["mail"]["email"]["list"][number];
export type EmailDetail = RouterOutputs["mail"]["email"]["byId"];
export type EmailAttachment = EmailDetail["allegati"][number];
export type TarsProposal = RouterOutputs["tars"]["proposte"]["list"][number];
export type WhatsAppConversation =
  RouterOutputs["mail"]["whatsapp"]["conversazioni"][number];
export type WhatsAppThread = RouterOutputs["mail"]["whatsapp"]["thread"];

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

function redirectWithQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function legacyMessageRedirect(location: string): string {
  const url = new URL(location, "https://ruffino-flow.local");
  const params = new URLSearchParams();
  const view = url.searchParams.get("view");
  const messageId = parseEmailMessageId(url.search);

  if (view && EMAIL_VIEW_SET.has(view)) params.set("view", view);
  if (messageId != null) params.set("messaggio", String(messageId));

  return redirectWithQuery("/messaggi/email", params);
}

const TARS_TAB_SET = new Set([
  "oggi",
  "proposte",
  "analisi",
  "chat",
  "pendenti",
  "decise",
  "registro",
]);

export function legacyTarsRedirect(location: string): string {
  const url = new URL(location, "https://ruffino-flow.local");
  const params = new URLSearchParams();
  const tab = url.searchParams.get("tab");

  if (tab && TARS_TAB_SET.has(tab)) params.set("tab", tab);

  return redirectWithQuery("/tars", params);
}

export type WhatsAppConversationKey = {
  casellaId: number;
  controparte: string;
};

export function parseConversationKey(
  value: string | null | undefined
): WhatsAppConversationKey | null {
  const match = /^wa:(\d+):(.+)$/.exec(value ?? "");
  if (!match || !/^\+?[\d\s().-]+$/.test(match[2])) return null;
  const casellaId = Number(match[1]);
  if (!Number.isSafeInteger(casellaId) || casellaId <= 0) return null;
  return { casellaId, controparte: match[2] };
}

export function parseWhatsAppConversationSelection(search: string): {
  key: string | null;
  conversation: WhatsAppConversationKey | null;
  invalid: boolean;
} {
  const key = new URLSearchParams(search).get("conversazione");
  if (!key) return { key: null, conversation: null, invalid: false };
  const conversation = parseConversationKey(key);
  return { key, conversation, invalid: conversation == null };
}

export function restoredScrollTop(
  previousTop: number,
  previousHeight: number,
  nextHeight: number
): number {
  return previousTop + Math.max(0, nextHeight - previousHeight);
}

export function initialThreadScrollTop(scrollHeight: number): number {
  return scrollHeight;
}

export function communicationIdsForConversation(
  selectedKey: string,
  loaded: { key: string; ids: number[] }
): number[] {
  return loaded.key === selectedKey ? loaded.ids : [];
}

export function emailBulkExclusionCopy(
  category: "spam" | "offerta_marketing",
  count: number
): { title: string; description: string; confirmLabel: string } {
  const emailLabel = `${count} email`;
  const description =
    count === 1
      ? "L'email selezionata verrà esclusa dalla coda operativa."
      : `Le ${emailLabel} selezionate verranno escluse dalla coda operativa.`;
  return category === "spam"
    ? {
        title: `Segnare ${emailLabel} come spam?`,
        description,
        confirmLabel: "Segna come spam",
      }
    : {
        title: `Escludere ${emailLabel} come newsletter?`,
        description,
        confirmLabel: "Escludi newsletter",
      };
}

export function whatsappConversationHref(key: string): string {
  const params = new URLSearchParams({ conversazione: key });
  return `/messaggi/whatsapp?${params.toString()}`;
}

export function sourceHref(source: { tipo: "email"; id: number }): string {
  return emailMessageHref(source.id);
}
