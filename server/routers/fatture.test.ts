// Router tRPC `fatture`: valida, autorizza, delega ai servizi di dominio
// (server/fatture/servizio.ts, emissione.ts, sonda.ts, notaCredito.ts) e
// mappa gli errori. Stesso pattern di server/routers/contratti.test.ts.
// `emettiFattura` è mockato: l'emissione vera tocca Fatture in Cloud, e i
// test non devono mai raggiungere la rete (server/_core/testSetup.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import type { TrpcContext } from "../_core/context";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { _resetFattureRepositoryForTests, getFattureRepository } from "../fatture/repository";
import { getClientiStore } from "./clienti";
import { creaCommessa } from "./commesse";

vi.mock("../fatture/emissione", async importOriginal => {
  const actual = await importOriginal<typeof import("../fatture/emissione")>();
  return { ...actual, emettiFattura: vi.fn() };
});
vi.mock("../_core/fileStorage", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/fileStorage")>();
  return { ...actual, getFile: vi.fn(actual.getFile) };
});

import { getFile } from "../_core/fileStorage";
import { emettiFattura } from "../fatture/emissione";
import { appRouter } from "../routers";

function context(sedeId: number, userId: number, ruoli: string[]): TrpcContext {
  return {
    user: { id: userId, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "T" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

async function commessaDiProva(sedeId = 1): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = {
    id: 9600 + clienti.length,
    sedeId,
    nome: "Elena",
    cognome: "Bianchi",
    tipo: "privato",
    commesseIds: [],
    cittaLavoro: "Sarzana",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  clienti.push(cliente);
  const c = await creaCommessa(context(sedeId, 1, ["direzione"]), { clienteId: cliente.id } as any);
  return (c as any).commessa?.id ?? (c as any).id;
}

const contratto = {
  pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null,
  comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18,
  detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
  detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "manuale" as const, documentoId: null,
  opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
};
const riga = {
  categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null,
  oscuranteTipologia: null,
  descrizione: "Finestra", quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null,
  prezzoUnitCent: null, prezzoTotCent: 300000, beneSignificativo: true, accessori: [], note: null,
  origine: "manuale" as const, evidenza: null,
};

/** Commessa con un contratto strutturato valido: il punto di partenza di quasi ogni test (`creaBozza` richiede il contratto). */
async function commessaConContratto(sedeId = 1): Promise<number> {
  const commessaId = await commessaDiProva(sedeId);
  const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
  await direzione.contratti.salva({ commessaId, contratto, righe: [riga] });
  return commessaId;
}

beforeEach(() => {
  _resetContrattiRepositoryForTests();
  _resetFattureRepositoryForTests();
  vi.mocked(emettiFattura).mockReset();
  vi.mocked(getFile).mockClear();
});

describe("router fatture — interruttori", () => {
  it("FLAG_FATTURAZIONE spento blocca anche la direzione (PRECONDITION_FAILED)", async () => {
    const prima = process.env.FLAG_FATTURAZIONE;
    try {
      process.env.FLAG_FATTURAZIONE = "off";
      const direzione = appRouter.createCaller(context(1, 1, ["direzione"]));
      await expect(direzione.fatture.perCommessa({ commessaId: 1 })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    } finally {
      if (prima === undefined) delete process.env.FLAG_FATTURAZIONE;
      else process.env.FLAG_FATTURAZIONE = prima;
    }
  });

  it("FLAG_LIMITI spento blocca la fatturazione anche col flag fatturazione acceso (PRECONDITION_FAILED)", async () => {
    const prima = process.env.FLAG_LIMITI;
    try {
      process.env.FLAG_LIMITI = "off";
      const direzione = appRouter.createCaller(context(1, 1, ["direzione"]));
      await expect(direzione.fatture.perCommessa({ commessaId: 1 })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    } finally {
      if (prima === undefined) delete process.env.FLAG_LIMITI;
      else process.env.FLAG_LIMITI = prima;
    }
  });
});

describe("router fatture — autorizzazione", () => {
  it("il commerciale legge ma non può creare la bozza (FORBIDDEN)", async () => {
    const commessaId = await commessaConContratto();
    const commerciale = appRouter.createCaller(context(1, 20, ["commerciale"]));
    const letto = await commerciale.fatture.perCommessa({ commessaId });
    expect(letto.fatture).toEqual([]);
    expect(letto.puoDraft).toBe(false);
    expect(letto.puoEmettere).toBe(false);
    expect(letto.puoNotaCredito).toBe(false);
    expect(letto).toHaveProperty("dryRun");
    await expect(commerciale.fatture.creaBozza({ commessaId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("il commerciale non può creare una nota di credito", async () => {
    const commerciale = appRouter.createCaller(context(1, 21, ["commerciale"]));
    await expect(
      commerciale.fatture.notaCredito({ fatturaId: 1, selezione: { tipo: "totale" } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("router fatture — ciclo bozza/emissione", () => {
  it("l'amministrazione crea la bozza, la aggiorna ed emette (emissione mockata)", async () => {
    const commessaId = await commessaConContratto();
    const amministrazione = appRouter.createCaller(context(1, 30, ["amministrazione"]));

    const creata = await amministrazione.fatture.creaBozza({ commessaId });
    expect(creata.fattura.stato).toBe("bozza");
    expect(creata.fattura.tipo).toBe("fattura");

    const aggiornata = await amministrazione.fatture.aggiornaBozza({
      id: creata.fattura.id,
      revisione: creata.fattura.revisione,
      modifica: { note: "Pagamento anticipato" },
    });
    expect(aggiornata.fattura.note).toBe("Pagamento anticipato");
    expect(aggiornata.fattura.revisione).toBeGreaterThan(creata.fattura.revisione);

    vi.mocked(emettiFattura).mockResolvedValue({
      fattura: { ...aggiornata.fattura, stato: "emessa" },
      passi: [{ passo: "validazione", esito: "fatto", dettaglio: null }],
    } as any);

    const emessa = await amministrazione.fatture.emetti({
      id: creata.fattura.id,
      revisione: aggiornata.fattura.revisione,
    });
    expect(emessa.fattura.stato).toBe("emessa");
    expect(emessa.passi).toHaveLength(1);
    expect(emettiFattura).toHaveBeenCalledWith(
      expect.objectContaining({
        sedeId: 1,
        id: creata.fattura.id,
        actorUserId: 30,
        revisione: aggiornata.fattura.revisione,
      })
    );
  });

  it("aggiornare con una revisione superata dà CONFLICT", async () => {
    const commessaId = await commessaConContratto();
    const amministrazione = appRouter.createCaller(context(1, 31, ["amministrazione"]));
    const { fattura } = await amministrazione.fatture.creaBozza({ commessaId });
    await amministrazione.fatture.aggiornaBozza({
      id: fattura.id,
      revisione: fattura.revisione,
      modifica: { note: "prima modifica" },
    });
    await expect(
      amministrazione.fatture.aggiornaBozza({
        id: fattura.id,
        revisione: fattura.revisione, // la stessa di prima: ora è superata
        modifica: { note: "seconda modifica" },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("annullare la bozza la porta in stato annullata", async () => {
    const commessaId = await commessaConContratto();
    const amministrazione = appRouter.createCaller(context(1, 32, ["amministrazione"]));
    const { fattura } = await amministrazione.fatture.creaBozza({ commessaId });
    const annullata = await amministrazione.fatture.annullaBozza({ id: fattura.id, motivo: "errore di battitura" });
    expect(annullata.stato).toBe("annullata");
  });
});

describe("router fatture — isolamento di sede", () => {
  it("una commessa di un'altra sede è NOT_FOUND, non FORBIDDEN", async () => {
    const commessaId = await commessaConContratto(1);
    const altra = appRouter.createCaller(context(2, 40, ["direzione"]));
    await expect(altra.fatture.creaBozza({ commessaId })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Commessa non trovata.",
    });
    await expect(altra.fatture.perCommessa({ commessaId })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Commessa non trovata.",
    });
  });

  it("una fattura di un'altra sede è NOT_FOUND in lettura", async () => {
    const commessaId = await commessaConContratto(1);
    const amministrazione = appRouter.createCaller(context(1, 33, ["amministrazione"]));
    const { fattura } = await amministrazione.fatture.creaBozza({ commessaId });
    const altra = appRouter.createCaller(context(2, 41, ["direzione"]));
    await expect(altra.fatture.byId({ id: fattura.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Fattura non trovata.",
    });
  });
});

describe("router fatture — lista e documento", () => {
  it("fatture.lista risolve commessaCodice e clienteNome per riga", async () => {
    const commessaId = await commessaConContratto();
    const amministrazione = appRouter.createCaller(context(1, 34, ["amministrazione"]));
    await amministrazione.fatture.creaBozza({ commessaId });
    const elenco = await amministrazione.fatture.lista({});
    expect(elenco).toHaveLength(1);
    expect(elenco[0].commessaCodice).toEqual(expect.any(String));
    expect(elenco[0].clienteNome).toBe("Bianchi Elena");
    expect(elenco[0].righe).toEqual([]);
  });

  it("fatture.documento dà NOT_FOUND finché il PDF non è archiviato", async () => {
    const commessaId = await commessaConContratto();
    const amministrazione = appRouter.createCaller(context(1, 35, ["amministrazione"]));
    const { fattura } = await amministrazione.fatture.creaBozza({ commessaId });
    await expect(amministrazione.fatture.documento({ id: fattura.id, tipo: "pdf" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("fatture.documento legge il PDF archiviato via getFile", async () => {
    const commessaId = await commessaConContratto();
    const amministrazione = appRouter.createCaller(context(1, 36, ["amministrazione"]));
    const { fattura } = await amministrazione.fatture.creaBozza({ commessaId });
    await getFattureRepository().aggiornaStato({
      sedeId: 1,
      id: fattura.id,
      patch: { pdfStorageKey: "fatture_pdf/1/1/prova.pdf" },
      now: new Date(),
    });
    vi.mocked(getFile).mockResolvedValueOnce(Buffer.from("finto-pdf"));
    const doc = await amministrazione.fatture.documento({ id: fattura.id, tipo: "pdf" });
    expect(doc.mimeType).toBe("application/pdf");
    expect(doc.dataBase64).toBe(Buffer.from("finto-pdf").toString("base64"));
    expect(doc.nome.endsWith(".pdf")).toBe(true);
  });
});
