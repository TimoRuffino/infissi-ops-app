import { describe, expect, it } from "vitest";
import {
  attachmentIntakeAllowed,
  canonicalAttachmentName,
  normalizeDocumentType,
  validateAttachmentMatch,
} from "./documentIntake";

describe("Tars document intake", () => {
  it("normalizza il tipo e costruisce un nome canonico", () => {
    expect(normalizeDocumentType("misure esecutive")).toBe("misure");
    expect(normalizeDocumentType("conferma ordine fornitore")).toBe(
      "conferma_ordine"
    );
    expect(normalizeDocumentType("istruzioni segrete")).toBeNull();

    expect(
      canonicalAttachmentName({
        originalName: "Misure Picchia.PDF",
        tipo: "misure",
        clienteLabel: "Picchia Marco",
      })
    ).toBe("Misure esecutive Picchia Marco.pdf");
  });

  it("accetta soltanto un match univoco nella sede", () => {
    expect(
      validateAttachmentMatch({
        requestedCommessaId: null,
        candidates: [{ id: 11, sedeId: 1 }],
        sedeId: 1,
      })
    ).toEqual({ ok: true, commessaId: 11 });

    expect(
      validateAttachmentMatch({
        requestedCommessaId: null,
        candidates: [
          { id: 11, sedeId: 1 },
          { id: 12, sedeId: 1 },
        ],
        sedeId: 1,
      })
    ).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("rifiuta id mancanti e candidati di un'altra sede", () => {
    expect(
      validateAttachmentMatch({
        requestedCommessaId: 99,
        candidates: [{ id: 99, sedeId: 2 }],
        sedeId: 1,
      })
    ).toEqual({ ok: false, reason: "cross_site" });

    expect(
      validateAttachmentMatch({
        requestedCommessaId: 99,
        candidates: [{ id: 11, sedeId: 1 }],
        sedeId: 1,
      })
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("accetta da WhatsApp soltanto allegati in ingresso gia classificati come lavoro", () => {
    expect(
      attachmentIntakeAllowed({
        canale: "whatsapp",
        direzione: "in",
        categoria: "operativa",
      })
    ).toBe(true);
    expect(
      attachmentIntakeAllowed({
        canale: "whatsapp",
        direzione: "out",
        categoria: "operativa",
      })
    ).toBe(false);
    expect(
      attachmentIntakeAllowed({
        canale: "whatsapp",
        direzione: "in",
        categoria: "da_classificare",
      })
    ).toBe(false);
    expect(
      attachmentIntakeAllowed({
        canale: "whatsapp",
        direzione: "in",
        categoria: "spam",
      })
    ).toBe(false);
    // Retrocompatibilita: il flusso Email gia esistente non cambia.
    expect(
      attachmentIntakeAllowed({
        canale: "email",
        direzione: "out",
        categoria: "operativa",
      })
    ).toBe(true);
  });
});
