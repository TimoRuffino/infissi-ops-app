import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";

// ── Types ───────────────────────────────────────────────────────────────────

// Extended tipo enum — one slot per board state so each transition can be
// gated by the right artefact. "foto" and "altro" remain for miscellaneous
// uploads that do not satisfy any gate.
export const DOC_TIPI = [
  "preventivo",
  "contratto",
  "misure",
  "fattura",
  "ordine",
  "conferma_ordine",
  "ddt_consegna",
  "ddt_posa",
  "ddt_finale",
  "saldo",
  "foto",
  "altro",
] as const;
export type DocTipo = typeof DOC_TIPI[number];

type Documento = {
  id: number;
  commessaId: number;
  nome: string;
  tipo: DocTipo;
  mimeType: string;
  size: number;
  dataBase64: string; // base64-encoded file content
  note: string | null;
  statoAtUpload: string | null; // commessa.stato at time of upload (for gates)
  createdBy: number | null;
  createdAt: Date;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let nextId = 1;
const _documentiStore = persistedStore<Documento>("preventivi_documenti", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  // Backfill statoAtUpload on legacy docs: default to "preventivo" so the
  // first transition still works for existing commesse.
  for (const d of loaded) {
    if ((d as any).statoAtUpload === undefined) {
      (d as any).statoAtUpload = "preventivo";
    }
  }
});
const documenti = _documentiStore.items;

// Cap per-file size: ~10MB base64 = ~7.5MB raw.
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

// ── State-gate config ─────────────────────────────────────────────────────
// For each stato, lists the doc tipi that count as "mandatory output". The
// commessa cannot leave the stato until at least one doc with one of these
// tipi has been uploaded WHILE the commessa was in that stato.
export const REQUIRED_DOC_TIPI_PER_STATO: Record<string, DocTipo[]> = {
  preventivo: ["preventivo", "contratto"],
  misure_esecutive: ["misure"],
  aggiornamento_contratto: ["contratto"],
  fatture_pagamento: ["fattura"],
  da_ordinare: ["ordine", "conferma_ordine"],
  produzione: [], // gated by dataConsegnaConfermata elsewhere
  ordini_ultimazione: ["saldo", "fattura"],
  attesa_posa: ["ddt_consegna"],
  finiture_saldo: ["ddt_posa"],
  interventi_regolazioni: ["ddt_finale"],
  archiviata: [],
};

// Convenience label map used by the UI and error messages.
export const DOC_TIPO_LABEL: Record<DocTipo, string> = {
  preventivo: "Preventivo",
  contratto: "Contratto",
  misure: "Misure esecutive",
  fattura: "Fattura",
  ordine: "Ordine fornitore",
  conferma_ordine: "Conferma ordine fornitore",
  ddt_consegna: "DDT consegna",
  ddt_posa: "DDT posa",
  ddt_finale: "DDT finale",
  saldo: "Ricevuta saldo",
  foto: "Foto",
  altro: "Altro",
};

// Legacy helper kept for backward compat.
export function hasPreventivoOrContratto(commessaId: number): boolean {
  return documenti.some(
    (d) =>
      d.commessaId === commessaId &&
      (d.tipo === "preventivo" || d.tipo === "contratto")
  );
}

// Does the commessa have at least one doc satisfying the gate for `stato`?
export function statoHasRequiredDoc(commessaId: number, stato: string): boolean {
  const required = REQUIRED_DOC_TIPI_PER_STATO[stato] ?? [];
  if (required.length === 0) return true;
  return documenti.some(
    (d) =>
      d.commessaId === commessaId &&
      required.includes(d.tipo) &&
      // Only count docs uploaded WHILE the commessa was in this stato — so
      // that an old preventivo cannot satisfy a later gate.
      (d.statoAtUpload === stato ||
        // Legacy fallback: if statoAtUpload unset and tipo matches, accept.
        d.statoAtUpload == null)
  );
}

export const preventiviContrattiRouter = router({
  byCommessa: publicProcedure.input(z.number()).query(({ input }) => {
    return documenti
      .filter((d) => d.commessaId === input)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      // Strip heavy payload from list
      .map(({ dataBase64, ...rest }) => ({ ...rest, hasData: !!dataBase64 }));
  }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return documenti.find((d) => d.id === input) ?? null;
  }),

  upload: publicProcedure
    .input(
      z.object({
        commessaId: z.number(),
        nome: z.string().min(1),
        tipo: z.enum(DOC_TIPI),
        mimeType: z.string().min(1),
        size: z.number().int().min(0),
        dataBase64: z.string().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      if (input.size > MAX_SIZE_BYTES) {
        throw new Error(`File troppo grande (max ${MAX_SIZE_BYTES / (1024 * 1024)}MB)`);
      }
      const commessa = getCommessaById(input.commessaId);
      const doc: Documento = {
        id: nextId++,
        commessaId: input.commessaId,
        nome: input.nome,
        tipo: input.tipo,
        mimeType: input.mimeType,
        size: input.size,
        dataBase64: input.dataBase64,
        note: input.note ?? null,
        statoAtUpload: commessa?.stato ?? null,
        createdBy: ctx.user?.id ?? null,
        createdAt: new Date(),
      };
      documenti.push(doc);
      _documentiStore.save();
      const { dataBase64, ...rest } = doc;
      return { ...rest, hasData: true };
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = documenti.findIndex((d) => d.id === input);
    if (idx === -1) throw new Error("Documento non trovato");
    documenti.splice(idx, 1);
    _documentiStore.save();
    return { success: true };
  }),

  // UI helper: list of doc tipi + whether each is satisfied for the current
  // stato gate. Lets the CommessaDetail page render a neat required/done
  // indicator.
  statoGate: publicProcedure.input(z.number()).query(({ input }) => {
    const commessa = getCommessaById(input);
    if (!commessa) return null;
    const required = REQUIRED_DOC_TIPI_PER_STATO[commessa.stato] ?? [];
    const uploaded = documenti.filter(
      (d) => d.commessaId === input && d.statoAtUpload === commessa.stato
    );
    return {
      stato: commessa.stato,
      required: required.map((tipo) => ({
        tipo,
        label: DOC_TIPO_LABEL[tipo],
        satisfied: uploaded.some((u) => u.tipo === tipo) ||
          // Legacy fallback across all docs on this commessa
          documenti.some(
            (d) => d.commessaId === input && d.tipo === tipo && d.statoAtUpload == null
          ),
      })),
      canAdvance: required.length === 0 || required.some((tipo) =>
        uploaded.some((u) => u.tipo === tipo) ||
        documenti.some(
          (d) => d.commessaId === input && d.tipo === tipo && d.statoAtUpload == null
        )
      ),
    };
  }),
});
