// Un PDF con più conferme (Bertolotto): il costo è la somma degli
// imponibili delle sezioni, la nota lo dice; se una sezione non ha
// l'imponibile non nasce niente e la scheda spiega perché.

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { pdfConTesto } from "../documenti/pdfMinimo";
import { appRouter } from "../routers";
import { getCommessaById } from "../routers/commesse";
import {
  caricaDocumentoCommessaDaBuffer,
  getDocumentoRecordById,
} from "../routers/preventiviContratti";
import { getUtentiStore } from "../routers/utenti";
import { registraCostoDaConferma } from "./costoDaConferma";

const SEDE = 97_601;
const DIREZIONE_ID = 97_611;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Sezioni",
      email: "sezioni-dir@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(): TrpcContext {
  return {
    user: { id: DIREZIONE_ID, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}
const direzione = () => appRouter.createCaller(contestoTrpc());
const costiDi = (commessaId: number): any[] => (getCommessaById(commessaId) as any).costi ?? [];

function sezione(numero: string, imponibile: string, imposta: string, totale: string): string {
  return [
    "BERTOLOTTO S.p.A unipersonale",
    "NUMERO   DATA   PAGINA",
    `${numero}   19/02/2026   1/1`,
    "1 PORTA MODELLO A   NR 1,00   1.000,00",
    "RIEPILOGO COSTI",
    `TOTALE IMPONIBILE ${imponibile}`,
    `TOTALE IMPOSTA ${imposta}`,
    `TOTALE ORDINE ${totale} |EUR`,
  ].join("\n");
}

async function documentoConPagine(commessaId: number, nome: string) {
  // Il PDF vero è un segnaposto: il testo arriva dalle dipendenze iniettate.
  return caricaDocumentoCommessaDaBuffer({
    commessaId,
    nome,
    tipo: "altro",
    mimeType: "application/pdf",
    buffer: pdfConTesto(["segnaposto"]),
    sedeId: SEDE,
    createdBy: DIREZIONE_ID,
    keepNome: true,
  });
}

describe("più conferme in un file", () => {
  it("il costo è la somma degli imponibili delle sezioni, la nota lo spiega, la lettura ricorda le sezioni", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Bertolotto Somma" });
    const documento = await documentoConPagine(commessa.id, "Conferme Bertolotto.pdf");
    await direzione().preventiviContratti.update({ id: documento.id, tipo: "conferma_ordine" });
    const pagine = [
      sezione("VI/26/2292", "4846,65", "1108,15", "5.954,80"),
      sezione("VT/26/96", "542,64", "119,38", "662,02"),
      sezione("VI/26/2293", "529,48", "116,49", "645,97"),
    ];

    const esito = await registraCostoDaConferma({
      documentoId: documento.id,
      forza: true,
      deps: {
        estraiTesto: async () => ({ esito: "estratto", parser: "finto", versione: "1", pagine, avvertenze: [] }),
      },
    });

    expect(esito.esito).toBe("registrato");
    expect(esito.imponibile).toBe(5918.77);
    const costi = costiDi(commessa.id).filter(c => c.documentoId === documento.id);
    expect(costi).toHaveLength(1);
    expect(costi[0].importo).toBe(5918.77);
    expect(costi[0].note).toContain("3 conferme nel file");
    expect(costi[0].note).toContain("4.846,65 + 542,64 + 529,48");
    expect(getDocumentoRecordById(documento.id)?.letturaCosto).toMatchObject({
      esito: "registrato",
      imponibile: 5918.77,
      sezioni: 3,
    });
  });

  it("se una sezione non ha l'imponibile non nasce niente, e il motivo dice quale", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Bertolotto Monca" });
    const documento = await documentoConPagine(commessa.id, "Conferme monche.pdf");
    await direzione().preventiviContratti.update({ id: documento.id, tipo: "conferma_ordine" });
    const pagine = [
      sezione("VI/26/2292", "4846,65", "1108,15", "5.954,80"),
      "NUMERO   DATA   PAGINA\nVT/26/96   19/02/2026   1/1\nRIEPILOGO COSTI\nTOTALE ORDINE 662,02 |EUR",
    ];

    const esito = await registraCostoDaConferma({
      documentoId: documento.id,
      forza: true,
      deps: {
        estraiTesto: async () => ({ esito: "estratto", parser: "finto", versione: "1", pagine, avvertenze: [] }),
      },
    });

    expect(esito.esito).toBe("senza_imponibile");
    expect(esito.motivo).toContain("2 conferme");
    expect(esito.motivo).toContain("pagine 2-2");
    expect(costiDi(commessa.id).filter(c => c.documentoId === documento.id)).toHaveLength(0);
  });
});
