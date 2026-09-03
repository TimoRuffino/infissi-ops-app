// Le conferme certe si archiviano da sole: mail già collegata alla commessa
// e file che si dichiara conferma. Da lì nascono costo e merce, e il
// registro dice «automatico». Le dubbie non si toccano.

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { insertComunicazione } from "../../comunicazioni/comunicazioni";
import { pdfConTesto } from "../../documenti/pdfMinimo";
import { appRouter } from "../../routers";
import { getCommessaById } from "../../routers/commesse";
import { getMagazzinoStore } from "../../routers/magazzino";
import { getDocumentiDiCommessa } from "../../routers/preventiviContratti";
import { getUtentiStore } from "../../routers/utenti";
import {
  dipendenzeAutoArchivioReali,
  eseguiGiroAutoArchivio,
  NOTA_AUTO_ARCHIVIO,
} from "./confermeAutoArchivio";

const SEDE = 97_501;
const DIREZIONE_ID = 97_511;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Auto",
      email: "auto-dir@example.test",
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

const PDF = pdfConTesto([
  "TESCONI SRL",
  "Conferma d'ordine n. 4471 del 01/09/2026",
  "Consegna prevista: settimana 38",
  "2 pz Finestra 2 ante PVC 1200x1400",
  "Totale imponibile: EUR 3.500,00",
]);

async function mail(extra: Record<string, unknown>) {
  return (await insertComunicazione({
    sedeId: SEDE,
    casellaId: 9,
    messageId: `auto-${Math.random().toString(36).slice(2)}`,
    canale: "email",
    direzione: "in",
    mittente: "ordini@tesconi.it",
    mittenteNome: "Tesconi",
    destinatari: [],
    oggetto: "Conferma ordine",
    testo: "In allegato.",
    allegati: [{ nome: "CO_4471.pdf", mimeType: "application/pdf", size: PDF.length }],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    receivedAt: new Date(),
    ...extra,
  } as any))!;
}

function deps() {
  const reali = dipendenzeAutoArchivioReali();
  return {
    ...reali,
    leggiRaw: async (_c: any, _i: number) => ({
      buffer: PDF,
      nome: "CO_4471.pdf",
      mimeType: "application/pdf",
    }),
  };
}

describe("eseguiGiroAutoArchivio", () => {
  it("archivia la conferma certa (mail collegata + nome conferma), fa nascere costo e merce, non ripete", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Tesconi Giorgio" });
    (getCommessaById(commessa.id) as any).stato = "produzione";
    const collegata = await mail({ commessaId: commessa.id });

    const giro = await eseguiGiroAutoArchivio({ sedeId: SEDE, deps: deps() });
    expect(giro.archiviate).toBe(1);
    expect(giro.errori).toBe(0);
    expect(giro.dettagli[0]).toMatchObject({
      commessaId: commessa.id,
      nomeFile: "CO_4471.pdf",
      esito: "archiviata",
    });

    const documenti = getDocumentiDiCommessa(commessa.id);
    expect(documenti).toHaveLength(1);
    expect(documenti[0]).toMatchObject({
      tipo: "conferma_ordine",
      origine: "automatico",
      note: NOTA_AUTO_ARCHIVIO,
      createdBy: null,
      sourceRef: `${SEDE}:${collegata.id}:0`,
    });
    // Regola del fascicolo: costo e merce nascono dall'archiviazione.
    const salvata: any = getCommessaById(commessa.id);
    expect(salvata.costi).toHaveLength(1);
    expect(salvata.costi[0]).toMatchObject({ importo: 3500, documentoId: documenti[0].id });
    const merce = getMagazzinoStore().filter(p => p.commessaId === commessa.id);
    expect(merce).toHaveLength(1);
    expect(merce[0]).toMatchObject({ nome: "Finestra 2 ante PVC 1200x1400", quantita: 2, dataConsegna: "2026-09-14" });

    // Il registro la elenca come automatica.
    const registro = await direzione().preventiviContratti.registroConferme({ origine: "automatiche" });
    expect(registro.some(r => r.documentoId === documenti[0].id && r.origine === "automatico")).toBe(true);
    expect(registro.find(r => r.documentoId === documenti[0].id)?.costo).toMatchObject({ stato: "registrato", importo: 3500 });

    // Secondo giro: la commessa ha la conferma, niente da fare.
    const secondo = await eseguiGiroAutoArchivio({ sedeId: SEDE, deps: deps() });
    expect(secondo.archiviate).toBe(0);
    expect(getDocumentiDiCommessa(commessa.id)).toHaveLength(1);
  });

  it("una conferma solo «probabile» (mail non collegata) resta una proposta, non si archivia", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Dubbio Rossi" });
    (getCommessaById(commessa.id) as any).stato = "da_ordinare";
    (getCommessaById(commessa.id) as any).clienteId = 424_242;
    await mail({ commessaId: null, clienteId: 424_242 });

    const giro = await eseguiGiroAutoArchivio({ sedeId: SEDE, deps: deps() });
    expect(giro.dettagli.filter(d => d.commessaId === commessa.id)).toHaveLength(0);
    expect(getDocumentiDiCommessa(commessa.id)).toHaveLength(0);
  });
});
