// Ricerche T1: numero di telefono, fattura per numero, documento per
// nome; la sede altrui resta invisibile. Store in memoria condivisi nel
// file: id e nomi unici.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { insertComunicazione } from "../../comunicazioni/comunicazioni";
import { appRouter } from "../../routers";
import { upsertFatture } from "../../routers/ficFatture";
import { caricaDocumentoCommessaDaBuffer } from "../../routers/preventiviContratti";
import { costruisciContesto } from "../contesto";
import { STRUMENTI_RICERCA } from "./ricerca";

const SEDE = 96_821;
const ALTRA_SEDE = 96_822;
const UTENTE = 96_831;

function contestoTrpc(sedeId = SEDE): TrpcContext {
  return {
    user: { id: UTENTE, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione Ricerca" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) => appRouter.createCaller(contestoTrpc(sedeId));
const tool = (nome: string) => STRUMENTI_RICERCA.find(s => s.nome === nome)!;
const contesto = () => costruisciContesto(contestoTrpc());

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_READ_TOOLS = "on";
  process.env.FLAG_TARS_COMMUNICATIONS = "on";
});
afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_COMMUNICATIONS;
});

describe("cerca_comunicazioni", () => {
  it("trova per numero di telefono anche scritto con +39 e spazi; la sede altrui è invisibile", async () => {
    const ctx = await contesto();
    await insertComunicazione({
      sedeId: SEDE, casellaId: 9, messageId: `ric-wa-${Date.now()}`, canale: "whatsapp", direzione: "in",
      mittente: "393371563627", mittenteNome: null, destinatari: [], oggetto: "",
      testo: "Buongiorno, vorrei un preventivo per due finestre",
      allegati: [], clienteId: null, commessaId: null, matchConfidenza: "nessuna", matchMotivo: null,
      stato: "nuova", receivedAt: new Date(),
    });
    await insertComunicazione({
      sedeId: ALTRA_SEDE, casellaId: 9, messageId: `ric-wa-alt-${Date.now()}`, canale: "whatsapp", direzione: "in",
      mittente: "393385550000", mittenteNome: null, destinatari: [], oggetto: "",
      testo: "Messaggio di un'altra sede",
      allegati: [], clienteId: null, commessaId: null, matchConfidenza: "nessuna", matchMotivo: null,
      stato: "nuova", receivedAt: new Date(),
    });

    const esito = await tool("cerca_comunicazioni").esegui(ctx, {
      telefono: "+39 337 156 3627", limite: 10,
    });
    expect(esito.dati.trovate).toBeGreaterThanOrEqual(1);
    expect(esito.dati.comunicazioni[0]).toMatchObject({ canale: "whatsapp", numero: "393371563627" });
    expect(esito.dati.comunicazioni[0].link).toContain("conversazione=");

    const altrove = await tool("cerca_comunicazioni").esegui(ctx, {
      telefono: "393385550000", limite: 10,
    });
    expect(altrove.dati.trovate).toBe(0);

    await expect(
      tool("cerca_comunicazioni").esegui(ctx, { limite: 10 })
    ).rejects.toThrow(/testo o un numero/);
  });
});

describe("cerca_fatture", () => {
  it("trova per numero e segnala le non collegate; la sede altrui è invisibile", async () => {
    const ctx = await contesto();
    upsertFatture([{
      id: 968_201, numero: "777/R", data: "2026-08-10",
      clienteNome: "Ricerca Fatture Srl", clienteVat: null, clienteCf: null,
      importoNetto: 2000, importoLordo: 2440, rate: [],
    }], SEDE);
    upsertFatture([{
      id: 968_202, numero: "778/R", data: "2026-08-11",
      clienteNome: "Sede Estranea Srl", clienteVat: null, clienteCf: null,
      importoNetto: 300, importoLordo: 366, rate: [],
    }], ALTRA_SEDE);

    const esito = await tool("cerca_fatture").esegui(ctx, { numero: "777/R", limite: 10 });
    expect(esito.dati.trovate).toBe(1);
    expect(esito.dati.fatture[0]).toMatchObject({
      ficId: 968_201, numero: "777/R", commessaId: null, collegataAMano: false,
    });

    const altrove = await tool("cerca_fatture").esegui(ctx, { numero: "778/R", limite: 10 });
    expect(altrove.dati.trovate).toBe(0);

    await expect(tool("cerca_fatture").esegui(ctx, { limite: 10 })).rejects.toThrow(/numero, cliente/);
  });
});

describe("cerca_documenti", () => {
  it("trova per nome nella sede; la sede altrui è invisibile", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Ricerca Documenti" });
    await caricaDocumentoCommessaDaBuffer({
      commessaId: commessa.id, nome: "ddt-ricerca-unico.pdf", tipo: "contratto",
      mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 ric"),
      sedeId: SEDE, createdBy: UTENTE, keepNome: true,
    });
    const altrove = await direzione(ALTRA_SEDE).commesse.create({ cliente: "Doc Estraneo" });
    await caricaDocumentoCommessaDaBuffer({
      commessaId: altrove.id, nome: "ddt-estraneo-unico.pdf", tipo: "misure",
      mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 est"),
      sedeId: ALTRA_SEDE, createdBy: UTENTE, keepNome: true,
    });

    const esito = await tool("cerca_documenti").esegui(ctx, { nome: "ddt-ricerca", limite: 10 });
    expect(esito.dati.trovati).toBe(1);
    expect(esito.dati.documenti[0].nome).toContain("ddt-ricerca");
    expect(esito.dati.documenti[0].commessaId).toBe(commessa.id);

    const estraneo = await tool("cerca_documenti").esegui(ctx, { nome: "ddt-estraneo", limite: 10 });
    expect(estraneo.dati.trovati).toBe(0);

    await expect(tool("cerca_documenti").esegui(ctx, { limite: 10 })).rejects.toThrow(/nome, un tipo/);
  });
});
