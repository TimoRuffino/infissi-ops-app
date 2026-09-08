// I doppioni nati dalle fatture FiC: trovarli e unirli senza perdere niente.
// Sono cancellazioni di commesse: le regole devono essere noiose.

import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getCommesseStore } from "../routers/commesse";
import { getInterventiStore } from "../routers/interventi";
import { getMagazzinoStore } from "../routers/magazzino";
import { getDocumentiDiCommessa } from "../routers/preventiviContratti";
import { ficFatture } from "../routers/ficFatture";
import { bloccantiDelDoppione, doppioniDaFatture, unisciDoppione } from "./doppioni";

const SEDE = 96_401;

function contesto(): TrpcContext {
  return {
    user: { id: 1, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}
const direzione = () => appRouter.createCaller(contesto());

function fatturaFinta(id: number, commessaId: number | null) {
  return {
    id,
    sedeId: SEDE,
    tipo: "invoice" as const,
    numero: `${id}/A`,
    data: "2026-09-01",
    clienteNome: "Sica Michele",
    clienteId: null,
    commessaId,
    commessaMatch: "automatico_fattura",
    collegataAMano: false,
    presenteInFic: true,
    ignorata: false,
    importoNetto: 1000,
    importoTotale: 1220,
    rate: [],
    pdfSync: { stato: "in_attesa" },
    aggiornataAt: new Date(),
  } as any;
}

async function scenario(nome: string) {
  const cliente = await direzione().clienti.create({ nome: "Michele", cognome: nome });
  const vera = await direzione().commesse.create({ clienteId: cliente.id });
  const doppia = await direzione().commesse.create({ clienteId: cliente.id });
  // La seconda finge di essere nata da una fattura.
  const record = (getCommesseStore() as any[]).find(c => c.id === doppia.id)!;
  record.ficSourceRef = `fic:${SEDE}:${doppia.id}`;
  const fattura = fatturaFinta(900_000 + doppia.id, doppia.id);
  ficFatture.push(fattura);
  return { cliente, vera, doppia, fattura };
}

beforeEach(() => {
  for (let i = ficFatture.length - 1; i >= 0; i--) {
    if (ficFatture[i].sedeId === SEDE) ficFatture.splice(i, 1);
  }
});

describe("doppioniDaFatture", () => {
  it("trova la commessa nata da una fattura quando il cliente ne ha un'altra viva", async () => {
    const { vera, doppia } = await scenario("Doppio");
    const trovati = await doppioniDaFatture(SEDE);
    const caso = trovati.find(d => d.duplicata.id === doppia.id)!;
    expect(caso).toBeTruthy();
    expect(caso.sopravvive.id).toBe(vera.id);
    expect(caso.fatture).toHaveLength(1);
    expect(caso.bloccanti).toEqual([]);
  });

  it("con due altre commesse vive non propone niente: quale resta non lo decide un automatismo", async () => {
    const { cliente, doppia } = await scenario("Tre Lavori");
    await direzione().commesse.create({ clienteId: cliente.id });
    const trovati = await doppioniDaFatture(SEDE);
    expect(trovati.some(d => d.duplicata.id === doppia.id)).toBe(false);
  });

  it("una commessa fatta a mano non è un doppione da unire", async () => {
    const cliente = await direzione().clienti.create({ nome: "A", cognome: "Mano" });
    await direzione().commesse.create({ clienteId: cliente.id });
    const seconda = await direzione().commesse.create({ clienteId: cliente.id });
    const trovati = await doppioniDaFatture(SEDE);
    expect(trovati.some(d => d.duplicata.id === seconda.id)).toBe(false);
  });
});

describe("unisciDoppione", () => {
  it("sposta fatture e documenti sulla commessa che resta, poi elimina il doppione", async () => {
    const { vera, doppia, fattura } = await scenario("Unione");
    await direzione().preventiviContratti.upload({
      commessaId: doppia.id,
      nome: "preventivo.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4 finto").toString("base64"),
      size: Buffer.from("%PDF-1.4 finto").length,
      keepNome: true,
    });

    const esito = await unisciDoppione({
      sedeId: SEDE,
      duplicataId: doppia.id,
      sopravviveId: vera.id,
      utenteId: 1,
    });

    expect(esito.fattureSpostate).toBe(1);
    expect(esito.documentiSpostati).toBe(1);
    expect(fattura.commessaId).toBe(vera.id);
    expect(fattura.collegataAMano).toBe(true);
    expect(getDocumentiDiCommessa(vera.id)).toHaveLength(1);
    expect((getCommesseStore() as any[]).some(c => c.id === doppia.id)).toBe(false);
  });

  it("se dentro c'è lavoro vero si ferma e lo dice", async () => {
    const { vera, doppia } = await scenario("Con Lavoro");
    (getMagazzinoStore() as any[]).push({
      id: 970_001,
      sedeId: SEDE,
      commessaId: doppia.id,
      nome: "PORTA",
      quantita: 1,
      fornitore: null,
      numeroOrdine: null,
      dataOrdine: null,
      dataConsegna: null,
      arrivato: false,
      note: null,
      documentoId: null,
      articoli: null,
      prontaDal: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(bloccantiDelDoppione((getCommesseStore() as any[]).find(c => c.id === doppia.id))).toEqual([
      "1 consegna a magazzino",
    ]);
    await expect(
      unisciDoppione({ sedeId: SEDE, duplicataId: doppia.id, sopravviveId: vera.id, utenteId: 1 })
    ).rejects.toThrow(/PRECONDITION_FAILED/);
    expect((getCommesseStore() as any[]).some(c => c.id === doppia.id)).toBe(true);
  });

  it("non unisce commesse di clienti diversi", async () => {
    const { doppia } = await scenario("Cliente Uno");
    const altro = await direzione().clienti.create({ nome: "Due", cognome: "Cliente Due" });
    const suaCommessa = await direzione().commesse.create({ clienteId: altro.id });
    await expect(
      unisciDoppione({
        sedeId: SEDE,
        duplicataId: doppia.id,
        sopravviveId: suaCommessa.id,
        utenteId: 1,
      })
    ).rejects.toThrow(/stesso cliente/);
  });
});

describe("bloccantiDelDoppione", () => {
  it("elenca appuntamenti, ticket, merce, costi e incassi", async () => {
    const { doppia } = await scenario("Pieno");
    const record = (getCommesseStore() as any[]).find(c => c.id === doppia.id)!;
    record.costi = [{ id: 1, importo: 100 }];
    record.pagamenti = [{ id: 1, importo: 50 }];
    (getInterventiStore() as any[]).push({
      id: 970_101,
      sedeId: SEDE,
      commessaId: doppia.id,
      tipo: "posa",
      stato: "pianificato",
      dataPianificata: "2026-10-01",
    });
    const bloccanti = bloccantiDelDoppione(record);
    expect(bloccanti).toContain("1 appuntamento in agenda");
    expect(bloccanti).toContain("1 costi fornitore");
    expect(bloccanti).toContain("incassi registrati");
  });
});
