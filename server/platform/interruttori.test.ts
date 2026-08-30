// Release hardening — kill switch della Document Intelligence. Questi
// test dimostrano che: (1) il default in produzione è SPENTO e altrove
// acceso, con override espliciti via env; (2) a interruttore spento gli
// endpoint muoiono con PRECONDITION_FAILED anche per la direzione — il
// flag non si aggira chiamando direttamente l'API, qualunque sia il
// ruolo; (3) l'OCR spento produce lo stato onesto con il motivo, mai
// un'analisi.

import { afterEach, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import {
  assicuraInterruttore,
  assicuraTars,
  interruttoreAttivo,
  statoInterruttori,
  tarsAttivo,
} from "./interruttori";
import { estraiTestoDocumento } from "../documenti/parserRegistry";
import { firmaOcrCorrente } from "../documenti/ocr";

function direzione(sedeId = 94001) {
  const ctx: TrpcContext = {
    user: {
      id: 94011,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione Interruttori",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
  return appRouter.createCaller(ctx);
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.FLAG_DOCUMENT_INTELLIGENCE;
  delete process.env.FLAG_PROPOSTE;
  delete process.env.FLAG_OCR;
});

describe("interruttori — default e override", () => {
  it("in produzione il default è SPENTO per OGNI interruttore; on esplicito li accende", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spenti = statoInterruttori();
    for (const [nome, attivo] of Object.entries(spenti)) {
      expect(attivo, `interruttore ${nome} deve nascere spento in produzione`).toBe(false);
    }
    vi.stubEnv("FLAG_DOCUMENT_INTELLIGENCE", "on");
    vi.stubEnv("FLAG_PROPOSTE", "true");
    vi.stubEnv("FLAG_OCR", "1");
    const parziale = statoInterruttori();
    expect(parziale.documentIntelligence).toBe(true);
    expect(parziale.proposte).toBe(true);
    expect(parziale.ocr).toBe(true);
    expect(parziale.tars).toBe(false); // i flag Tars restano spenti
  });

  it("Tars: il master spento vince su ogni funzione (fail-closed)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FLAG_TARS_READ_TOOLS", "on");
    expect(tarsAttivo("tarsReadTools")).toBe(false); // master off
    expect(() => assicuraTars("tarsReadTools")).toThrow();
    vi.stubEnv("FLAG_TARS", "on");
    expect(tarsAttivo()).toBe(true);
    expect(tarsAttivo("tarsReadTools")).toBe(true);
    expect(tarsAttivo("tarsReminders")).toBe(false); // funzione senza flag
    expect(() => assicuraTars("tarsReminders")).toThrow();
  });

  it("fuori produzione il default è acceso; off esplicito li spegne; valori ignoti ricadono sul default", () => {
    expect(interruttoreAttivo("documentIntelligence")).toBe(true);
    process.env.FLAG_DOCUMENT_INTELLIGENCE = "off";
    expect(interruttoreAttivo("documentIntelligence")).toBe(false);
    process.env.FLAG_DOCUMENT_INTELLIGENCE = "boh";
    expect(interruttoreAttivo("documentIntelligence")).toBe(true);
    expect(() => assicuraInterruttore("documentIntelligence")).not.toThrow();
  });
});

describe("interruttori — gli endpoint non si aggirano", () => {
  it("Document Intelligence spenta: OGNI endpoint di analisi e collegamento rifiuta anche la direzione", async () => {
    process.env.FLAG_DOCUMENT_INTELLIGENCE = "off";
    const caller = direzione();
    const attesa = { code: "PRECONDITION_FAILED" };
    await expect(
      caller.analisiDocumenti.perOrdine({ ordineId: 1 })
    ).rejects.toMatchObject(attesa);
    await expect(
      caller.analisiDocumenti.analizzaConferma({ ordineId: 1, documentoId: 1 })
    ).rejects.toMatchObject(attesa);
    await expect(
      caller.analisiDocumenti.candidati({ documentoId: 1 })
    ).rejects.toMatchObject(attesa);
    await expect(
      caller.analisiDocumenti.collega({ documentoId: 1, ordineId: 1 })
    ).rejects.toMatchObject(attesa);
    await expect(
      caller.analisiDocumenti.rifiuta({ documentoId: 1, ordineId: 1 })
    ).rejects.toMatchObject(attesa);
    await expect(
      caller.analisiDocumenti.annulla({ documentoId: 1 })
    ).rejects.toMatchObject(attesa);
  });

  it("proposte spente: OGNI endpoint del gateway rifiuta anche la direzione", async () => {
    process.env.FLAG_PROPOSTE = "off";
    const caller = direzione();
    const attesa = { code: "PRECONDITION_FAILED" };
    await expect(
      caller.proposte.perOrdine({ ordineId: 1 })
    ).rejects.toMatchObject(attesa);
    await expect(
      caller.proposte.genera({ ordineId: 1, documentoId: 1 })
    ).rejects.toMatchObject(attesa);
    await expect(caller.proposte.approva({ id: 1 })).rejects.toMatchObject(
      attesa
    );
    await expect(caller.proposte.rifiuta({ id: 1 })).rejects.toMatchObject(
      attesa
    );
    await expect(caller.proposte.annulla({ id: 1 })).rejects.toMatchObject(
      attesa
    );
    await expect(caller.proposte.applica({ id: 1 })).rejects.toMatchObject(
      attesa
    );
  });

  it("gli interruttori sono indipendenti: DI accesa funziona anche con proposte spente", async () => {
    process.env.FLAG_PROPOSTE = "off";
    const caller = direzione();
    // Non PRECONDITION_FAILED da interruttore: l'analisi risponde nel
    // merito (qui NOT_FOUND perché l'ordine non esiste in questa sede).
    await expect(
      caller.analisiDocumenti.perOrdine({ ordineId: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("la UI legge lo stato da platform.interruttori", async () => {
    process.env.FLAG_PROPOSTE = "off";
    const stato = await direzione().platform.interruttori();
    expect(stato.proposte).toBe(false);
    expect(stato.documentIntelligence).toBe(true);
  });
});

describe("interruttori — OCR", () => {
  it("OCR spento: la scansione resta ferma col motivo del flag e la firma è «assente»", async () => {
    process.env.FLAG_OCR = "off";
    expect(await firmaOcrCorrente()).toBe("assente");
    // Un PDF di sole immagini: senza OCR non deve MAI risultare analizzato.
    const doc = new jsPDF();
    doc.setFillColor(200, 200, 200);
    doc.rect(10, 10, 100, 100, "F");
    const bytes = Buffer.from(doc.output("arraybuffer"));
    const esito = await estraiTestoDocumento(
      bytes,
      "application/pdf",
      "scan-flag.pdf"
    );
    expect(esito.esito).toBe("scansione_senza_testo");
    expect((esito as any).motivo).toContain("FLAG_OCR");
  });
});
