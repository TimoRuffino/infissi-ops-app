// La regola del 03/09/2026: «il costo deve nascere nel momento in cui la
// conf. ordine viene allegata alla commessa». Qui si attraversano gli
// agganci veri del fascicolo con PDF veri (parser di produzione, OCR escluso).

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { insertComunicazione } from "../comunicazioni/comunicazioni";
import { pdfConTesto } from "../documenti/pdfMinimo";
import { appRouter } from "../routers";
import { getCommessaById } from "../routers/commesse";
import {
  archiviaAllegatoComunicazione,
  caricaDocumentoCommessaDaBuffer,
  getDocumentiDiCommessa,
  getDocumentoRecordById,
  spostaDocumentoDiCommessa,
  type DocTipo,
} from "../routers/preventiviContratti";
import { getMagazzinoStore } from "../routers/magazzino";
import { getUtentiStore } from "../routers/utenti";
import { confermeSenzaCostoDi, registraCostoDaConferma } from "./costoDaConferma";
import {
  daLeggere,
  documentiDaLeggere,
  eseguiGiroCostiDaConferma,
} from "./costoDaConfermaWorker";

const SEDE = 97_401;
const DIREZIONE_ID = 97_411;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Costi",
      email: "costi-dir@example.test",
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

const RIGHE_TESCONI = [
  "TESCONI SRL - Serramenti",
  "Conferma d'ordine n. 4471 del 01/09/2026",
  "Totale imponibile: EUR 3.500,00",
  "IVA 22%: EUR 770,00",
  "Totale documento: EUR 4.270,00",
];

async function nuovaCommessa(cliente: string) {
  return direzione().commesse.create({ cliente });
}

async function carica(
  commessaId: number,
  righe: string[],
  opzioni: { tipo?: DocTipo; nome?: string } = {}
) {
  return caricaDocumentoCommessaDaBuffer({
    commessaId,
    nome: opzioni.nome ?? "Conferma_ordine_4471.pdf",
    tipo: opzioni.tipo ?? "conferma_ordine",
    mimeType: "application/pdf",
    buffer: pdfConTesto(righe),
    sedeId: SEDE,
    createdBy: DIREZIONE_ID,
    keepNome: true,
  });
}

const costiDi = (commessaId: number): any[] =>
  (getCommessaById(commessaId) as any).costi ?? [];

describe("il costo fornitore nasce quando la conferma entra nel fascicolo", () => {
  it("l'upload di una conferma registra l'imponibile sulla commessa, una volta sola", async () => {
    const commessa = await nuovaCommessa("Tesconi Giorgio");
    const documento = await carica(commessa.id, RIGHE_TESCONI);

    const costi = costiDi(commessa.id);
    expect(costi).toHaveLength(1);
    expect(costi[0].importo).toBe(3500);
    expect(costi[0].documentoId).toBe(documento.id);
    expect(costi[0].note).toContain(`documento:${documento.id}`);
    expect(getDocumentoRecordById(documento.id)?.letturaCosto).toMatchObject({
      esito: "registrato",
      imponibile: 3500,
      fonteTesto: "testo_pdf",
      costoId: costi[0].id,
    });

    const margine = await direzione().commesse.margine(commessa.id);
    expect(margine.costiFornitore).toBe(3500);
    expect(margine.costi[0].documentoId).toBe(documento.id);
    expect(margine.confermeSenzaCosto).toEqual([]);

    // Rileggere non raddoppia.
    const secondo = await registraCostoDaConferma({ documentoId: documento.id });
    expect(secondo.esito).toBe("gia_registrato");
    expect(costiDi(commessa.id)).toHaveLength(1);
  });

  it("senza imponibile dichiarato non nasce niente e la scheda dice perché", async () => {
    const commessa = await nuovaCommessa("Solo Totale");
    const documento = await carica(commessa.id, [
      "Conferma d'ordine n. 9",
      "Totale documento: EUR 4.270,00",
    ]);
    expect(costiDi(commessa.id)).toHaveLength(0);
    expect(getDocumentoRecordById(documento.id)?.letturaCosto?.esito).toBe(
      "senza_imponibile"
    );
    const margine = await direzione().commesse.margine(commessa.id);
    expect(margine.confermeSenzaCosto).toHaveLength(1);
    expect(margine.confermeSenzaCosto[0]).toMatchObject({
      documentoId: documento.id,
      esito: "senza_imponibile",
      link: `/api/documenti/${documento.id}/file`,
    });
    expect(margine.confermeSenzaCosto[0].motivo).toContain("a mano");
  });

  it("un costo già scritto a mano per lo stesso ordine viene collegato, non raddoppiato", async () => {
    const commessa = await nuovaCommessa("Doppio No");
    await direzione().commesse.addCosto({
      commessaId: commessa.id,
      importo: 3500,
      fornitore: "Tesconi",
      numeroOrdine: "4471",
    });
    const documento = await carica(commessa.id, RIGHE_TESCONI);
    const costi = costiDi(commessa.id);
    expect(costi).toHaveLength(1);
    expect(costi[0].documentoId).toBe(documento.id);
    expect(getDocumentoRecordById(documento.id)?.letturaCosto?.esito).toBe("collegato");
  });

  it("riclassificare un documento fa nascere o sparire il costo", async () => {
    const commessa = await nuovaCommessa("Riclassifica");
    const documento = await carica(commessa.id, RIGHE_TESCONI, {
      tipo: "altro",
      nome: "allegato.pdf",
    });
    expect(costiDi(commessa.id)).toHaveLength(0);

    await direzione().preventiviContratti.update({ id: documento.id, tipo: "conferma_ordine" });
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].documentoId).toBe(documento.id);

    await direzione().preventiviContratti.update({ id: documento.id, tipo: "altro" });
    expect(costiDi(commessa.id)).toHaveLength(0);
    expect(getDocumentoRecordById(documento.id)?.letturaCosto).toBeNull();
  });

  it("cancellare la conferma toglie il costo nato da lei", async () => {
    const commessa = await nuovaCommessa("Cancella");
    const documento = await carica(commessa.id, RIGHE_TESCONI);
    expect(costiDi(commessa.id)).toHaveLength(1);
    await direzione().preventiviContratti.delete(documento.id);
    expect(costiDi(commessa.id)).toHaveLength(0);
  });

  it("spostare la conferma in un altro fascicolo sposta il costo", async () => {
    const origine = await nuovaCommessa("Origine");
    const destinazione = await nuovaCommessa("Destinazione");
    const documento = await carica(origine.id, RIGHE_TESCONI);
    expect(costiDi(origine.id)).toHaveLength(1);

    spostaDocumentoDiCommessa({
      documentoId: documento.id,
      commessaId: destinazione.id,
      sedeId: SEDE,
    });
    expect(costiDi(origine.id)).toHaveLength(0);
    expect(costiDi(destinazione.id)).toHaveLength(1);
    expect(costiDi(destinazione.id)[0]).toMatchObject({
      importo: 3500,
      documentoId: documento.id,
    });
  });

  it("l'archiviazione da mail registra il costo; il fornitore è il mittente se il documento non lo dice", async () => {
    const commessa = await nuovaCommessa("Da Mail");
    const mail = (await insertComunicazione({
      sedeId: SEDE,
      casellaId: 9,
      messageId: `costo-${commessa.id}`,
      canale: "email",
      direzione: "in",
      mittente: "ordini@tesconi.it",
      mittenteNome: "Tesconi Serramenti",
      destinatari: [],
      oggetto: "Conferma ordine",
      testo: "In allegato.",
      allegati: [{ nome: "CO_4471.pdf", mimeType: "application/pdf", size: 1000 }],
      clienteId: null,
      commessaId: commessa.id,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date(),
    } as any))!;

    const documento = await archiviaAllegatoComunicazione({
      sedeId: SEDE,
      comunicazioneId: mail.id,
      allegatoIndex: 0,
      commessaId: commessa.id,
      nome: "CO_4471.pdf",
      tipo: "conferma_ordine",
      mimeType: "application/pdf",
      buffer: pdfConTesto(["Conferma d'ordine", "Imponibile: EUR 1.200,00"]),
      createdBy: DIREZIONE_ID,
    });
    const costi = costiDi(commessa.id);
    expect(costi).toHaveLength(1);
    expect(costi[0]).toMatchObject({
      importo: 1200,
      fornitore: "Tesconi Serramenti",
      documentoId: documento.id,
    });
  });
});

describe("la merce in arrivo nasce a magazzino dalla stessa conferma", () => {
  const RIGHE_CON_MERCE = [
    "TESCONI SRL - Serramenti",
    "Conferma d'ordine n. 4471 del 01/09/2026",
    "Consegna prevista: settimana 38",
    "10   Finestra 2 ante PVC bianco 1200x1400       2    pz   350,00    700,00",
    "20   Portafinestra 1 anta PVC 800x2200          1    pz   420,00    420,00",
    "Totale imponibile: EUR 1.120,00",
  ];
  const inOrdine = async (cliente: string) => {
    const commessa = await nuovaCommessa(cliente);
    (getCommessaById(commessa.id) as any).stato = "da_ordinare";
    return commessa;
  };
  const merceDi = (commessaId: number) =>
    getMagazzinoStore().filter(p => p.commessaId === commessaId);

  it("una riga per articolo, con fornitore, numero d'ordine e data dalla settimana; più conferme = più righe", async () => {
    const commessa = await inOrdine("Tesconi Merce");
    const prima = await carica(commessa.id, RIGHE_CON_MERCE);
    const righe = merceDi(commessa.id);
    expect(righe.map(r => [r.nome, r.quantita])).toEqual([
      ["Finestra 2 ante PVC bianco 1200x1400", 2],
      ["Portafinestra 1 anta PVC 800x2200", 1],
    ]);
    expect(righe[0]).toMatchObject({
      documentoId: prima.id,
      dataConsegna: "2026-09-14",
      dataOrdine: "2026-09-01",
      arrivato: false,
    });
    expect(righe[0].note).toContain("settimana 38");
    expect(getDocumentoRecordById(prima.id)?.letturaCosto?.merce).toMatchObject({
      righe: 2,
      dataConsegna: "2026-09-14",
      motivo: null,
    });

    // Seconda conferma (altro fornitore): altre righe, le prime restano.
    const seconda = await carica(
      commessa.id,
      ["ZANZAR SPA", "Conferma d'ordine n. 77", "Consegna: 20/09/2026", "3 pz Zanzariera a rullo 1200x1400", "Imponibile: EUR 300,00"],
      { nome: "Conferma_zanzariere.pdf" }
    );
    const tutte = merceDi(commessa.id);
    expect(tutte).toHaveLength(3);
    expect(tutte.filter(r => r.documentoId === seconda.id)).toHaveLength(1);
    expect(tutte.find(r => r.documentoId === seconda.id)?.dataConsegna).toBe("2026-09-20");
    // Due costi, uno per conferma.
    expect(costiDi(commessa.id)).toHaveLength(2);

    // Rileggere non raddoppia la merce.
    await registraCostoDaConferma({ documentoId: prima.id, forza: true });
    expect(merceDi(commessa.id)).toHaveLength(3);
  });

  it("senza righe riconoscibili entra una riga sola da completare, e la merce segue il documento", async () => {
    const origine = await inOrdine("Solo Data");
    const destinazione = await inOrdine("Destinazione Merce");
    const documento = await carica(origine.id, [
      "Conferma d'ordine n. 9",
      "Consegna prevista 25/09/2026",
      "Totale documento: EUR 4.270,00",
    ]);
    const righe = merceDi(origine.id);
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({ quantita: 1, dataConsegna: "2026-09-25", documentoId: documento.id });
    expect(righe[0].nome).toContain("Merce conferma d'ordine");
    expect(righe[0].note).toContain("completare a mano");

    spostaDocumentoDiCommessa({ documentoId: documento.id, commessaId: destinazione.id, sedeId: SEDE });
    expect(merceDi(origine.id)).toHaveLength(0);
    expect(merceDi(destinazione.id)).toHaveLength(1);

    await direzione().preventiviContratti.delete(documento.id);
    expect(merceDi(destinazione.id)).toHaveLength(0);
  });

  it("prima di «Da ordinare» il magazzino non parte, e lo dice", async () => {
    const commessa = await nuovaCommessa("Ancora Preventivo");
    const documento = await carica(commessa.id, RIGHE_CON_MERCE);
    expect(merceDi(commessa.id)).toHaveLength(0);
    expect(getDocumentoRecordById(documento.id)?.letturaCosto?.merce?.motivo).toContain("Da ordinare");
    // Il costo invece nasce comunque: il margine non aspetta lo stato.
    expect(costiDi(commessa.id)).toHaveLength(1);
  });
});

describe("riscontro nel testo, duplicati e approntamento (caso Giacomazzi, 04/09/2026)", () => {
  // Il testo di una conferma Alias come lo restituisce il parser: il cliente
  // compare come «VS.RIFERIMENTO GIACOMAZZI GIUL» (troncato), la settimana è
  // di APPRONTAMENTO, le righe hanno l'unità incollata davanti.
  const ALIAS = (riferimento: string) => [
    "Conferma Ordine",
    "ALIAS Srl Porte blindate",
    "RUFFINO GROUP SRLS",
    "2026 - CV 003746 del 23/02/2026",
    "VS.RIFERIMENTO",
    riferimento,
    "Approntamento [1]",
    "2026 Settimana 21",
    "KPO44 KIT PORTA",
    "26C0374604 - 003460 - .",
    "NR 1,00 22 99819,47",
    "NR 1,00PORST-C013 PORTA BLIND.STEEL/C < 1900",
    "Tot. Imponibile 948,73",
  ];
  const inOrdine = async (cliente: string) => {
    const commessa = await nuovaCommessa(cliente);
    (getCommessaById(commessa.id) as any).stato = "da_ordinare";
    return commessa;
  };
  const merceDi = (commessaId: number) =>
    getMagazzinoStore().filter(p => p.commessaId === commessaId);

  async function archiviataDalloSmistamento(commessaId: number, nome: string, righe: string[]) {
    const mail = (await insertComunicazione({
      sedeId: SEDE,
      casellaId: 9,
      messageId: `smist-${commessaId}-${nome}`,
      canale: "email",
      direzione: "in",
      mittente: "ordini@aliasblindate.com",
      mittenteNome: "Alias",
      destinatari: [],
      oggetto: "Conferma ordine Giacomazzi Giulia",
      testo: "In allegato.",
      allegati: [{ nome, mimeType: "application/pdf", size: 1000 }],
      clienteId: null,
      commessaId,
      matchConfidenza: "alta",
      matchMotivo: "Nell'oggetto compare il cognome",
      stato: "nuova",
      receivedAt: new Date(),
    } as any))!;
    return archiviaAllegatoComunicazione({
      sedeId: SEDE,
      comunicazioneId: mail.id,
      allegatoIndex: 0,
      commessaId,
      nome,
      tipo: "conferma_ordine",
      mimeType: "application/pdf",
      buffer: pdfConTesto(righe),
      createdBy: null,
      note: "Archiviato automaticamente da Tars (smistamento): Nell'oggetto compare il cognome di Giacomazzi Giulia.",
      origine: "smistamento",
    });
  }

  it("archiviata dallo smistamento senza riscontro nel testo: niente costo né merce, finché una persona non conferma", async () => {
    const commessa = await inOrdine("Giacomazzi Giulia");
    const documento = await archiviataDalloSmistamento(commessa.id, "Ordini_di_Vendi_1602923(1).pdf", ALIAS("ROSSI MARIO"));
    expect(costiDi(commessa.id)).toHaveLength(0);
    expect(merceDi(commessa.id)).toHaveLength(0);
    expect(getDocumentoRecordById(documento.id)?.letturaCosto).toMatchObject({
      esito: "senza_riscontro",
      riferimenti: ["1602923"],
    });
    const margine = await direzione().commesse.margine(commessa.id);
    expect(margine.confermeSenzaCosto[0]).toMatchObject({ documentoId: documento.id, esito: "senza_riscontro", confermabile: true });

    // «È di questa commessa»: costo e merce nascono.
    const conferma = await direzione().preventiviContratti.confermaRiscontroConferma({ documentoId: documento.id });
    expect(conferma.esito).toBe("registrato");
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].importo).toBe(948.73);
    expect(merceDi(commessa.id).map(p => p.nome)).toEqual(["KPO44 KIT PORTA", "PORST-C013 PORTA BLIND.STEEL/C < 1900"]);
  });

  it("con il cognome del cliente nel testo la stessa archiviazione automatica produce costo e merce; la settimana di approntamento non è una consegna", async () => {
    const commessa = await inOrdine("Giacomazzi Giulia");
    const documento = await archiviataDalloSmistamento(commessa.id, "Ordini_di_Vendi_1602923(1).pdf", ALIAS("GIACOMAZZI GIUL"));
    expect(costiDi(commessa.id)).toHaveLength(1);
    const lettura = getDocumentoRecordById(documento.id)?.letturaCosto;
    expect(lettura?.riscontro).toEqual({ ok: true, prove: ["cliente giacomazzi"] });
    expect(lettura?.merce).toMatchObject({ righe: 2, dataConsegna: null, approntamento: { settimana: 21, anno: 2026, dal: "2026-05-18" } });
    const righe = merceDi(commessa.id);
    expect(righe.every(p => p.dataConsegna === null)).toBe(true);
    expect(righe[0].note).toContain("Approntamento: settimana 21/2026");
    expect(righe[0].note).toContain("la consegna va concordata");
  });

  it("la stessa conferma rimandata per mail non entra due volte nel fascicolo (stesso nome base, stessa dimensione)", async () => {
    const commessa = await inOrdine("Giacomazzi Rimando");
    const prima = await archiviataDalloSmistamento(commessa.id, "Ordini_di_Vendi_1602923(1).pdf", ALIAS("GIACOMAZZI RIMANDO"));
    const seconda = await archiviataDalloSmistamento(commessa.id, "Ordini_di_Vendi_1602923(1) (2).pdf", ALIAS("GIACOMAZZI RIMANDO "));
    expect(seconda.id).toBe(prima.id);
    expect(getDocumentiDiCommessa(commessa.id).filter(d => d.tipo === "conferma_ordine")).toHaveLength(1);
    expect(costiDi(commessa.id)).toHaveLength(1);
  });

  it("la stessa conferma inviata tre volte è UN costo e UNA merce: le copie sono duplicati", async () => {
    const commessa = await inOrdine("Giacomazzi Tre Copie");
    const prima = await carica(commessa.id, ALIAS("GIACOMAZZI TRE"), { nome: "Ordini_di_Vendi_1602923(1).pdf" });
    const seconda = await carica(commessa.id, ALIAS("GIACOMAZZI TRE"), { nome: "Ordini_di_Vendi_1602923(1) (2).pdf" });
    const terza = await carica(commessa.id, ALIAS("GIACOMAZZI TRE"), { nome: "Ordini_di_Vendi_1602923(1) (3).pdf" });
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(costiDi(commessa.id)[0].documentoId).toBe(prima.id);
    expect(merceDi(commessa.id).every(p => p.documentoId === prima.id)).toBe(true);
    for (const copia of [seconda, terza]) {
      expect(getDocumentoRecordById(copia.id)?.letturaCosto).toMatchObject({ esito: "duplicato", duplicatoDi: prima.id });
    }
    const margine = await direzione().commesse.margine(commessa.id);
    expect(margine.confermeSenzaCosto.map(r => r.esito)).toEqual(["duplicato", "duplicato"]);
  });

  it("il magazzino si ricontrolla: righe di un estrattore vecchio si rigenerano se nessuno le ha toccate", async () => {
    const commessa = await inOrdine("Rigenera Merce");
    const documento = await carica(commessa.id, ALIAS("RIGENERA MERCE"));
    const record = getDocumentoRecordById(documento.id)!;
    const primeRighe = merceDi(commessa.id);
    expect(primeRighe).toHaveLength(2);

    // Lettura di ieri: estrattore vecchio, versione vecchia.
    record.letturaCosto = { ...record.letturaCosto!, versione: "1.1.0", merce: { ...record.letturaCosto!.merce!, versioneEstrattore: "0.9.0" } };
    const riletta = await registraCostoDaConferma({ documentoId: documento.id });
    expect(riletta.esito).toBe("gia_registrato");
    const nuoveRighe = merceDi(commessa.id);
    expect(nuoveRighe).toHaveLength(2);
    expect(nuoveRighe.map(p => p.id)).not.toEqual(primeRighe.map(p => p.id));

    // Una riga segnata arrivata: si rispetta, niente rigenerazione.
    nuoveRighe[0].arrivato = true;
    record.letturaCosto = { ...record.letturaCosto!, versione: "1.1.0", merce: { ...record.letturaCosto!.merce!, versioneEstrattore: "0.9.0" } };
    await registraCostoDaConferma({ documentoId: documento.id });
    expect(merceDi(commessa.id).map(p => p.id)).toEqual(nuoveRighe.map(p => p.id));
    expect(record.letturaCosto?.merce?.motivo).toContain("modificate a mano");
  });
});

describe("il worker legge le conferme archiviate prima della regola", () => {
  it("a lotti, le più recenti prima, senza rimettere un costo tolto a mano", async () => {
    const commessa = await nuovaCommessa("Pregresso");
    // Una conferma «vecchia»: archiviata come altro, poi diventata conferma
    // senza passare dagli agganci (com'era prima di questa regola).
    const documento = await carica(commessa.id, RIGHE_TESCONI, { tipo: "altro" });
    const record = getDocumentoRecordById(documento.id)!;
    record.tipo = "conferma_ordine";
    record.letturaCosto = null;
    expect(daLeggere(record)).toBe(true);
    expect(documentiDaLeggere(100).map(d => d.id)).toContain(documento.id);

    const giro = await eseguiGiroCostiDaConferma({ limite: 100, ocr: false });
    expect(giro.registrati).toBeGreaterThanOrEqual(1);
    expect(costiDi(commessa.id)).toHaveLength(1);
    expect(daLeggere(record)).toBe(false);

    // Tolto a mano: il worker lo rispetta, la scheda lo dice.
    await direzione().commesse.removeCosto({
      commessaId: commessa.id,
      costoId: costiDi(commessa.id)[0].id,
    });
    const rispettato = await registraCostoDaConferma({ documentoId: documento.id });
    expect(rispettato.esito).toBe("rimosso_a_mano");
    expect(costiDi(commessa.id)).toHaveLength(0);
    expect(confermeSenzaCostoDi(commessa.id)[0]).toMatchObject({
      documentoId: documento.id,
      esito: "rimosso_a_mano",
    });

    // Su richiesta esplicita (Tars) il costo torna.
    const forzato = await registraCostoDaConferma({ documentoId: documento.id, forza: true });
    expect(forzato.esito).toBe("registrato");
    expect(costiDi(commessa.id)).toHaveLength(1);
  });

  it("una scansione resta al worker (da OCR); se l'OCR non la legge, diventa non leggibile", async () => {
    const commessa = await nuovaCommessa("Scansione");
    const documento = await carica(commessa.id, ["vuoto"], { tipo: "altro" });
    const record = getDocumentoRecordById(documento.id)!;
    record.tipo = "conferma_ordine";
    record.letturaCosto = null;
    const scansione = async () =>
      ({ esito: "scansione_senza_testo", parser: "pdf-testo-nativo", versione: "1" }) as const;

    const inAttesa = await registraCostoDaConferma({
      documentoId: documento.id,
      ocr: false,
      deps: { estraiTesto: scansione },
    });
    expect(inAttesa.esito).toBe("da_ocr");
    expect(daLeggere(record)).toBe(true);

    const senzaOcr = await registraCostoDaConferma({
      documentoId: documento.id,
      ocr: true,
      deps: { estraiTesto: scansione },
    });
    expect(senzaOcr.esito).toBe("non_leggibile");
    expect(daLeggere(record)).toBe(false);
    expect(costiDi(commessa.id)).toHaveLength(0);
  });

  it("un errore dello storage si ritenta tre volte, poi si ferma", async () => {
    const commessa = await nuovaCommessa("Storage Giù");
    const documento = await carica(commessa.id, RIGHE_TESCONI, { tipo: "altro" });
    const record = getDocumentoRecordById(documento.id)!;
    record.tipo = "conferma_ordine";
    record.letturaCosto = null;
    let chiamate = 0;
    const rotto = async () => {
      chiamate += 1;
      throw new Error("R2 non risponde");
    };
    for (let i = 1; i <= 3; i += 1) {
      const esito = await registraCostoDaConferma({
        documentoId: documento.id,
        deps: { leggiDocumento: rotto },
      });
      expect(esito.esito).toBe("errore");
      expect(record.letturaCosto?.tentativi).toBe(i);
      expect(daLeggere(record)).toBe(i < 3);
    }
    const quarto = await registraCostoDaConferma({
      documentoId: documento.id,
      deps: { leggiDocumento: rotto },
    });
    expect(quarto.esito).toBe("errore");
    expect(chiamate).toBe(3);
    expect(costiDi(commessa.id)).toHaveLength(0);
  });
});
