// Cosa succede quando la stessa conferma viene RILETTA meglio, o arriva la
// sua versione aggiornata (04/09/2026, mattina). Due fatti di produzione:
// tre conferme Pail registrate a «22,00» (l'aliquota IVA letta come
// imponibile da un estrattore vecchio) e le «(2).pdf» Oskura dello stesso
// ordine con il totale rivisto, scartate come copie.

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { pdfConTesto } from "../documenti/pdfMinimo";
import { appRouter } from "../routers";
import { getCommessaById } from "../routers/commesse";
import {
  caricaDocumentoCommessaDaBuffer,
  getDocumentoRecordById,
  salvaLetturaCostoDocumento,
} from "../routers/preventiviContratti";
import { getUtentiStore } from "../routers/utenti";
import { registraCostoDaConferma } from "./costoDaConferma";

const SEDE = 97_501;
const DIREZIONE_ID = 97_511;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Rilettura",
      email: "rilettura-dir@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(): TrpcContext {
  return {
    user: {
      id: DIREZIONE_ID,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}
const direzione = () => appRouter.createCaller(contestoTrpc());

function righeConferma(numero: string, imponibile: string, iva: string, totale: string): string[] {
  return [
    "PAIL SERRAMENTI SRL",
    `Conferma d'ordine n. ${numero} del 01/09/2026`,
    `Totale imponibile: EUR ${imponibile}`,
    `IVA 22%: EUR ${iva}`,
    `Totale documento: EUR ${totale}`,
  ];
}

async function carica(commessaId: number, nome: string, righe: string[]) {
  return caricaDocumentoCommessaDaBuffer({
    commessaId,
    nome,
    tipo: "conferma_ordine",
    mimeType: "application/pdf",
    buffer: pdfConTesto(righe),
    sedeId: SEDE,
    createdBy: DIREZIONE_ID,
    keepNome: true,
  });
}

const costiDi = (commessaId: number): any[] =>
  (getCommessaById(commessaId) as any).costi ?? [];

/** Finge che una lettura VECCHIA abbia scritto un importo sbagliato. */
function letturaVecchiaConImporto(documentoId: number, importo: number) {
  const documento = getDocumentoRecordById(documentoId)!;
  salvaLetturaCostoDocumento(documentoId, {
    ...documento.letturaCosto!,
    versione: "0.9.0",
    imponibile: importo,
  });
}

describe("la rilettura di una conferma già letta", () => {
  it("corregge l'importo di un costo nato dalla regola e mai toccato, e lo dice nella nota", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Berardi Rilettura" });
    const documento = await carica(
      commessa.id,
      "conf. ordine Berardi.pdf",
      righeConferma("2609952", "1.117,10", "245,76", "1.362,86")
    );
    const [costo] = costiDi(commessa.id);
    expect(costo.importo).toBe(1117.1);
    // L'estrattore vecchio aveva letto «22» e lo aveva scritto a registro.
    costo.importo = 22;
    letturaVecchiaConImporto(documento.id, 22);

    const esito = await registraCostoDaConferma({ documentoId: documento.id });

    expect(esito.esito).toBe("registrato");
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].importo).toBe(1117.1);
    expect(costiDi(commessa.id)[0].note).toContain("Importo corretto dalla rilettura");
    expect(costiDi(commessa.id)[0].note).toContain("era 22,00");
    expect(getDocumentoRecordById(documento.id)?.letturaCosto).toMatchObject({
      esito: "registrato",
      imponibile: 1117.1,
      costoId: costo.id,
    });
  });

  it("corregge anche se la lettura precedente aveva già letto giusto senza toccare il costo (le Pail a «22,00»)", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Pail Ventidue" });
    const documento = await carica(
      commessa.id,
      "conf. ordine Berardi (rapido).pdf",
      righeConferma("2610056", "185,85", "40,89", "226,74")
    );
    const [costo] = costiDi(commessa.id);
    costo.importo = 22;
    // La lettura precedente dice 185,85 (giusto) ma il costo è rimasto a 22.
    letturaVecchiaConImporto(documento.id, 185.85);

    await registraCostoDaConferma({ documentoId: documento.id });

    expect(costiDi(commessa.id)[0].importo).toBe(185.85);
    expect(costiDi(commessa.id)[0].note).toContain("era 22,00");
  });

  it("non tocca un costo che una persona ha modificato dalla scheda, ma lo segnala", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Modificato A Mano" });
    const documento = await carica(
      commessa.id,
      "conf. ordine modificata.pdf",
      righeConferma("2610056", "185,85", "40,89", "226,74")
    );
    const [costo] = costiDi(commessa.id);
    // Una persona ha corretto l'importo dalla scheda.
    await direzione().commesse.updateCosto({
      commessaId: commessa.id,
      costoId: costo.id,
      importo: 190,
    });
    expect(costiDi(commessa.id)[0].modificatoAMano).toBe(true);
    letturaVecchiaConImporto(documento.id, 185.85);

    const esito = await registraCostoDaConferma({ documentoId: documento.id });

    expect(esito.esito).toBe("gia_registrato");
    expect(costiDi(commessa.id)[0].importo).toBe(190);
    expect(esito.motivo).toContain("non lo tocco");
    expect(getDocumentoRecordById(documento.id)?.letturaCosto?.motivo).toContain("190,00");
  });
});

describe("la conferma aggiornata dello stesso ordine", () => {
  it("sostituisce la vecchia: il costo e la lettura seguono la versione più recente; una copia identica resta un duplicato", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Salvetti Revisione" });
    const prima = await carica(
      commessa.id,
      "Commessa-N-1012779 Salvetti (ORDINE).pdf",
      righeConferma("1012779", "4.710,50", "1.036,31", "5.746,81")
    );
    expect(costiDi(commessa.id)).toEqual([expect.objectContaining({ importo: 4710.5, documentoId: prima.id })]);

    const seconda = await carica(
      commessa.id,
      "Commessa-N-1012779 Salvetti (ORDINE MODIFICATO).pdf",
      righeConferma("1012779", "5.793,83", "1.274,64", "7.068,47")
    );

    const costi = costiDi(commessa.id);
    expect(costi).toHaveLength(1);
    expect(costi[0]).toMatchObject({ importo: 5793.83, documentoId: seconda.id });
    expect(getDocumentoRecordById(seconda.id)?.letturaCosto).toMatchObject({
      esito: "registrato",
      imponibile: 5793.83,
    });
    expect(getDocumentoRecordById(prima.id)?.letturaCosto).toMatchObject({
      esito: "duplicato",
      duplicatoDi: seconda.id,
      costoId: null,
    });
    expect(getDocumentoRecordById(prima.id)?.letturaCosto?.motivo).toContain("versione più recente");

    // La vecchia riletta non si riprende il costo.
    const rilettaPrima = await registraCostoDaConferma({ documentoId: prima.id, forza: true });
    expect(rilettaPrima.esito).toBe("duplicato");
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].documentoId).toBe(seconda.id);

    // Una terza copia identica alla seconda è una copia: niente cambia.
    const terza = await carica(
      commessa.id,
      "Commessa-N-1012779 Salvetti (ORDINE MODIFICATO) inviata di nuovo.pdf",
      righeConferma("1012779", "5.793,83", "1.274,64", "7.068,47")
    );
    expect(getDocumentoRecordById(terza.id)?.letturaCosto?.esito).toBe("duplicato");
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0]).toMatchObject({ importo: 5793.83, documentoId: seconda.id });
  });

  it("non sostituisce un costo che una persona ha modificato: la nuova versione resta un duplicato, con l'avviso", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Revisione Bloccata" });
    const prima = await carica(
      commessa.id,
      "Commessa-N-1012780 (ORDINE).pdf",
      righeConferma("1012780", "1.391,87", "306,21", "1.698,08")
    );
    await direzione().commesse.updateCosto({
      commessaId: commessa.id,
      costoId: costiDi(commessa.id)[0].id,
      importo: 1400,
    });

    const seconda = await carica(
      commessa.id,
      "Commessa-N-1012780 (ORDINE MODIFICATO).pdf",
      righeConferma("1012780", "1.709,44", "376,08", "2.085,52")
    );

    expect(costiDi(commessa.id)).toEqual([expect.objectContaining({ importo: 1400, documentoId: prima.id })]);
    expect(getDocumentoRecordById(seconda.id)?.letturaCosto).toMatchObject({
      esito: "duplicato",
      duplicatoDi: prima.id,
    });
    expect(getDocumentoRecordById(seconda.id)?.letturaCosto?.motivo).toContain("1.709,44");
  });
});

describe("il salto alla lettura 1.9.0 (anteprime delle evidenze)", () => {
  it("rilegge, riempie le evidenze e non tocca un solo costo", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Berardi Evidenze" });
    const documento = await carica(commessa.id, "Conferma_evidenze.pdf", righeConferma("9101", "1.500,00", "330,00", "1.830,00"));
    const [costo] = costiDi(commessa.id);
    expect(costo.importo).toBe(1500);
    // Una lettura della versione prima, senza evidenze.
    const vecchia = getDocumentoRecordById(documento.id)!.letturaCosto!;
    salvaLetturaCostoDocumento(documento.id, { ...vecchia, versione: "1.8.0", evidenze: undefined });

    const esito = await registraCostoDaConferma({ documentoId: documento.id });
    expect(esito.esito).toBe("gia_registrato");
    const [dopo] = costiDi(commessa.id);
    expect(dopo.id).toBe(costo.id);
    expect(dopo.importo).toBe(1500);
    expect(dopo.note).toBe(costo.note);
    const lettura = getDocumentoRecordById(documento.id)!.letturaCosto!;
    expect(lettura.versione).toBe("1.9.0");
    expect(lettura.esito).toBe("registrato");
    expect(lettura.evidenze?.imponibile?.area?.grado).toBe("riquadro");
  });
});
