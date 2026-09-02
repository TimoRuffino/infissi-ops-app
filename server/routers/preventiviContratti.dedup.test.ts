// Lo stesso allegato non entra due volte nel fascicolo: byte identici da
// un'altra mail (inoltro, risposta con lo stesso PDF) o già caricati a
// mano restituiscono il documento esistente (mandato direzione 02/09/2026).

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import {
  archiviaAllegatoComunicazione,
  getDocumentiDiCommessa,
  trovaDuplicatoNelFascicolo,
} from "./preventiviContratti";

const SEDE = 96_901;
const UTENTE = 96_911;

function ctx(): TrpcContext {
  return {
    user: { id: UTENTE, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}

const PDF_A = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\nA");
const PDF_B = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\nB");

describe("archiviaAllegatoComunicazione: niente duplicati nel fascicolo", () => {
  it("stessi byte da due allegati diversi → un solo documento; byte diversi → due", async () => {
    const commessa = await appRouter.createCaller(ctx()).commesse.create({ cliente: "Dedup Test" });
    const base = {
      sedeId: SEDE,
      commessaId: commessa.id,
      tipo: "preventivo" as const,
      mimeType: "application/pdf",
      createdBy: UTENTE,
      vietaRiassegnazione: true,
    };
    const primo = await archiviaAllegatoComunicazione({ ...base, comunicazioneId: 501, allegatoIndex: 0, nome: "preventivo.pdf", buffer: PDF_A });
    const inoltro = await archiviaAllegatoComunicazione({ ...base, comunicazioneId: 502, allegatoIndex: 1, nome: "Fwd preventivo.pdf", buffer: PDF_A });
    expect(inoltro.id).toBe(primo.id);
    expect(inoltro.sourceRef).toBe(primo.sourceRef);

    const diverso = await archiviaAllegatoComunicazione({ ...base, comunicazioneId: 503, allegatoIndex: 0, nome: "preventivo.pdf", buffer: PDF_B });
    expect(diverso.id).not.toBe(primo.id);

    const nelFascicolo = getDocumentiDiCommessa(commessa.id);
    expect(nelFascicolo.map(d => d.id).sort()).toEqual([primo.id, diverso.id].sort());
    // Lo stesso sourceRef resta idempotente come prima.
    const ripetuto = await archiviaAllegatoComunicazione({ ...base, comunicazioneId: 501, allegatoIndex: 0, nome: "preventivo.pdf", buffer: PDF_A });
    expect(ripetuto.id).toBe(primo.id);
  });

  it("trovaDuplicatoNelFascicolo: checksum, altrimenti nome+dimensione per i documenti legacy", async () => {
    const commessa = await appRouter.createCaller(ctx()).commesse.create({ cliente: "Dedup Legacy" });
    const doc = await archiviaAllegatoComunicazione({
      sedeId: SEDE, commessaId: commessa.id, comunicazioneId: 601, allegatoIndex: 0,
      nome: "contratto.pdf", tipo: "contratto", mimeType: "application/pdf", buffer: PDF_A, createdBy: UTENTE,
    });
    expect(trovaDuplicatoNelFascicolo(commessa.id, { checksum: doc.checksum!, nome: "altro.pdf", size: 1 })?.id).toBe(doc.id);
    expect(trovaDuplicatoNelFascicolo(commessa.id, { checksum: "0".repeat(64), nome: "contratto.pdf", size: PDF_A.length })).toBeNull();
    (doc as any).checksum = null; // documento legacy
    expect(trovaDuplicatoNelFascicolo(commessa.id, { checksum: "0".repeat(64), nome: "contratto (2).pdf", size: PDF_A.length })?.id).toBe(doc.id);
    expect(trovaDuplicatoNelFascicolo(commessa.id + 1, { checksum: "0".repeat(64), nome: "contratto.pdf", size: PDF_A.length })).toBeNull();
  });
});
