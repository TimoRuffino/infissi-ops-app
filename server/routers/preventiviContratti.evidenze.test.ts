// La query delle evidenze localizzate di una conferma (anteprime «Dove l'ho
// letto»): restituisce dove sono stati letti i valori, con la guardia della
// sede del documento — un documento di un'altra sede non esiste.

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { pdfConTesto } from "../documenti/pdfMinimo";
import { appRouter } from "../routers";
import { caricaDocumentoCommessaDaBuffer } from "./preventiviContratti";
import { getUtentiStore } from "./utenti";

const SEDE = 97_801;
const ALTRA_SEDE = 97_802;
const DIREZIONE_ID = 97_811;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Evidenze",
      email: "evidenze-dir@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE, ALTRA_SEDE],
    });
  }
}

function caller(sedeId: number) {
  const ctx: TrpcContext = {
    user: {
      id: DIREZIONE_ID,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
  return appRouter.createCaller(ctx);
}

describe("preventiviContratti.evidenzeDocumento", () => {
  it("restituisce le evidenze della lettura, con l'area, solo nella sede del documento", async () => {
    const commessa = await caller(SEDE).commesse.create({ cliente: "Evidenze Query" });
    const documento = await caricaDocumentoCommessaDaBuffer({
      commessaId: commessa.id,
      nome: "Conferma_evidenze.pdf",
      tipo: "conferma_ordine",
      mimeType: "application/pdf",
      buffer: pdfConTesto([
        "PAIL SERRAMENTI SRL",
        "Conferma d'ordine n. 8811 del 01/09/2026",
        "Totale imponibile: EUR 2.400,00",
        "IVA 22%: EUR 528,00",
        "Totale documento: EUR 2.928,00",
      ]),
      sedeId: SEDE,
      createdBy: DIREZIONE_ID,
      keepNome: true,
    });

    const risposta = await caller(SEDE).preventiviContratti.evidenzeDocumento({ documentoId: documento.id });
    expect(risposta.documentoId).toBe(documento.id);
    expect(risposta.fonteTesto).toBe("testo_pdf");
    expect(risposta.valori.imponibile).toBe(2400);
    expect(risposta.evidenze?.imponibile?.pagina).toBe(1);
    expect(risposta.evidenze?.imponibile?.frammento.toLowerCase()).toContain("imponibile");
    expect(risposta.evidenze?.imponibile?.area?.grado).toBe("riquadro");
    expect(risposta.evidenze?.numeroConferma?.area?.grado).toBe("riquadro");
    // Nessuna anteprima resa nel percorso dell'upload: si rende a richiesta.
    expect(risposta.anteprime).toBeNull();

    await expect(
      caller(ALTRA_SEDE).preventiviContratti.evidenzeDocumento({ documentoId: documento.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
