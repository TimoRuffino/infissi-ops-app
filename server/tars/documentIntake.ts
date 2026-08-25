import {
  DOC_TIPI,
  DOC_TIPO_LABEL,
  type DocTipo,
} from "../routers/preventiviContratti";

const WHATSAPP_DOCUMENT_CATEGORIES = new Set([
  "operativa",
  "amministrativa",
  "fornitore",
  "nuovo_lead",
]);

export function attachmentIntakeAllowed(input: {
  canale: string;
  direzione: string;
  categoria: string;
}): boolean {
  // Il percorso Email esisteva gia e resta retrocompatibile. Per WhatsApp
  // accettiamo solo messaggi reali in ingresso che Tars ha gia classificato
  // come lavoro: storico, echo, spam e casi ancora dubbi non sono archiviabili.
  if (input.canale === "email") return true;
  return (
    input.canale === "whatsapp" &&
    input.direzione === "in" &&
    WHATSAPP_DOCUMENT_CATEGORIES.has(input.categoria)
  );
}

const TYPE_ALIASES: Record<string, DocTipo> = {
  preventivo: "preventivo",
  offerta: "preventivo",
  contratto: "contratto",
  misure: "misure",
  "misure esecutive": "misure",
  fattura: "fattura",
  ordine: "ordine",
  "ordine fornitore": "ordine",
  "conferma ordine": "conferma_ordine",
  "conferma ordine fornitore": "conferma_ordine",
  "ddt consegna": "ddt_consegna",
  "ddt posa": "ddt_posa",
  "ddt finale": "ddt_finale",
  saldo: "saldo",
  "ricevuta saldo": "saldo",
  foto: "foto",
  altro: "altro",
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDocumentType(value: unknown): DocTipo | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if ((DOC_TIPI as readonly string[]).includes(normalized)) {
    return normalized as DocTipo;
  }
  return TYPE_ALIASES[normalized] ?? null;
}

export function canonicalAttachmentName(input: {
  originalName: string;
  tipo: DocTipo;
  clienteLabel: string;
}): string {
  const dot = input.originalName.lastIndexOf(".");
  const extension =
    dot > 0 && dot < input.originalName.length - 1
      ? `.${input.originalName.slice(dot + 1).toLowerCase()}`
      : "";
  const customer = input.clienteLabel
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stem = `${DOC_TIPO_LABEL[input.tipo]}${customer ? ` ${customer}` : ""}`;
  return `${stem}${extension}`;
}

export type AttachmentMatchInput = {
  requestedCommessaId: number | null;
  candidates: Array<{ id: number; sedeId: number }>;
  sedeId: number;
};

export type AttachmentMatchResult =
  | { ok: true; commessaId: number }
  | { ok: false; reason: "missing" | "ambiguous" | "cross_site" };

export function validateAttachmentMatch(
  input: AttachmentMatchInput
): AttachmentMatchResult {
  if (input.requestedCommessaId != null) {
    const requested = input.candidates.find(
      candidate => candidate.id === input.requestedCommessaId
    );
    if (!requested) return { ok: false, reason: "missing" };
    if (requested.sedeId !== input.sedeId) {
      return { ok: false, reason: "cross_site" };
    }
    return { ok: true, commessaId: requested.id };
  }

  const scoped = input.candidates.filter(
    candidate => candidate.sedeId === input.sedeId
  );
  if (scoped.length === 1) return { ok: true, commessaId: scoped[0].id };
  if (scoped.length > 1) return { ok: false, reason: "ambiguous" };
  if (input.candidates.length > 0) {
    return { ok: false, reason: "cross_site" };
  }
  return { ok: false, reason: "missing" };
}
