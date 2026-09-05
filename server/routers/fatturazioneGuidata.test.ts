// server/routers/fatturazioneGuidata.test.ts
// Router tRPC `fatturazioneGuidata`: l'elenco delle commesse da fatturare
// (§4.2 del design) e i passi di una commessa (§4.1), dietro FLAG_LIMITI.
// Stesso pattern di server/routers/contratti.test.ts e computo.test.ts.
//
// Ogni test usa una sede propria (mai la 1, mai condivisa fra test): lo
// store delle commesse è un modulo condiviso per tutto il file, e senza
// questa scelta un elenco «della sede» di un test vedrebbe anche le
// commesse create da un test precedente nello stesso processo.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getClientiStore } from "./clienti";
import { creaCommessa, getCommessaById } from "./commesse";
import { ficFatture, type FatturaFic } from "./ficFatture";
import { getFattureRepository, type FatturaPersist } from "../fatture/repository";

function context(sedeId: number, userId: number, ruoli: string[]): TrpcContext {
  return {
    user: { id: userId, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "T" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

let prossimoClienteId = 9800;
async function commessaDiProva(sedeId: number): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = {
    id: prossimoClienteId++,
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

/** Fattura minima per il repository diretto: stessa forma di fatture/repository.test.ts. */
function fatturaMinima(
  sedeId: number,
  commessaId: number,
  overrides: Partial<FatturaPersist> = {}
): FatturaPersist {
  return {
    sedeId,
    commessaId,
    computoId: null,
    hashRighe: null,
    tipo: "fattura",
    notaCreditoDi: null,
    stato: "bozza",
    ficDocumentId: null,
    numero: null,
    data: null,
    clienteSnapshot: null,
    pattuitoTipo: "lordo",
    pattuitoCent: 100000,
    imponibileCent: 0,
    ivaCent: 0,
    totaleCent: 100000,
    deltaPattuitoCent: 0,
    markupCent: 0,
    stornoCent: 0,
    diciture: [],
    note: null,
    intestazioneCantiere: null,
    detrazioneTipo: "nessuna",
    pdfStorageKey: null,
    xmlStorageKey: null,
    xmlSha256: null,
    documentoId: null,
    eiStatusFic: null,
    eiErrore: null,
    inviataDryRun: false,
    scavalcoLimiti: false,
    scavalcoMotivo: null,
    createdBy: null,
    emessaDa: null,
    emessaAt: null,
    ...overrides,
  };
}

let prossimoFicId = 500_001;
/** Registra nello store FiC (in memoria) una fattura già collegata alla commessa. */
function pushFatturaFicCollegata(sedeId: number, commessaId: number): void {
  const fattura: FatturaFic = {
    id: prossimoFicId++,
    sedeId,
    tipo: "invoice",
    numero: "1/2026",
    data: "2026-01-01",
    clienteNome: "Cliente Fic",
    clienteVat: null,
    clienteCf: null,
    clienteEmail: null,
    clienteTelefono: null,
    clienteIndirizzo: null,
    clienteCitta: null,
    clienteCap: null,
    descrizione: null,
    importoNetto: 100000,
    importoIva: 22000,
    importoLordo: 122000,
    rate: [],
    clienteId: null,
    clienteMatch: "nessuno",
    commessaId,
    commessaMatch: "manuale",
    collegataAMano: true,
    commesseEscluse: [],
    ignorata: false,
    tarsAnalizzata: false,
    presenteInFic: true,
    ultimoSyncId: null,
    ultimoVistoAt: null,
    aggiornataAt: new Date(),
    pdfSync: { stato: "archiviata", ultimoTentativoAt: null, ultimoErrore: null },
  };
  ficFatture.push(fattura);
}

beforeAll(async () => {
  // La commessa 1 esce dal seed demo di server/routers/timeline.ts con tre
  // step di timeline già "completato" (agganciato all'id, non alla sede):
  // la si consuma qui, inutilizzata, così nessuna commessa dei test veri
  // eredita quella cronologia quando il router calcola `statoDal`.
  await commessaDiProva(999_999);
});

afterEach(() => {
  // Store condiviso in memoria: senza questo, una fattura FiC "collegata"
  // di un test resterebbe visibile (con lo stesso sedeId/commessaId, mai
  // riusati) ma soprattutto un elenco "di sede" letto con find() reagirebbe
  // a residui imprevisti.
  ficFatture.length = 0;
});

describe("router fatturazioneGuidata", () => {
  it("(a) elenca solo le commesse della sede negli stati aggiornamento_contratto e fatture_pagamento", async () => {
    const sedeId = 9101;
    const inContratto = await commessaDiProva(sedeId);
    (getCommessaById(inContratto) as any).stato = "aggiornamento_contratto";
    const inFatture = await commessaDiProva(sedeId);
    (getCommessaById(inFatture) as any).stato = "fatture_pagamento";
    const inProduzione = await commessaDiProva(sedeId);
    (getCommessaById(inProduzione) as any).stato = "produzione";

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const elenco = await direzione.fatturazioneGuidata.daFare();

    const ids = elenco.map((c) => c.commessaId).sort((a, b) => a - b);
    expect(ids).toEqual([inContratto, inFatture].sort((a, b) => a - b));
  });

  it("(b) esclude una commessa con una fattura FiC già collegata", async () => {
    const sedeId = 9102;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "aggiornamento_contratto";
    pushFatturaFicCollegata(sedeId, id);

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const elenco = await direzione.fatturazioneGuidata.daFare();

    expect(elenco.map((c) => c.commessaId)).not.toContain(id);
  });

  it("(c) una bozza CRM resta in elenco (fatturaStato bozza); una volta emessa la commessa esce", async () => {
    const sedeId = 9103;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "fatture_pagamento";

    const repo = getFattureRepository();
    const bozza = await repo.crea({
      fattura: fatturaMinima(sedeId, id),
      righe: [],
      riepilogo: [],
      scadenze: [],
      now: new Date(),
    });

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const primaElenco = await direzione.fatturazioneGuidata.daFare();
    const riga = primaElenco.find((c) => c.commessaId === id);
    expect(riga).toBeDefined();
    expect(riga?.fatturaStato).toBe("bozza");
    expect(riga?.passi.fattura).toBe("in_corso");

    await repo.aggiornaStato({
      sedeId,
      id: bozza.id,
      patch: { stato: "emessa" },
      now: new Date(),
    });
    const dopoElenco = await direzione.fatturazioneGuidata.daFare();
    expect(dopoElenco.map((c) => c.commessaId)).not.toContain(id);
  });

  it("(d) senza economia.read gli importi sono nulli; con economia.read sono valorizzati", async () => {
    const sedeId = 9104;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "aggiornamento_contratto";
    (getCommessaById(id) as any).importoTotale = 12_000; // euro, nessun contratto strutturato

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const commerciale = appRouter.createCaller(context(sedeId, 2, ["commerciale"]));

    const [elencoDirezione, elencoCommerciale] = await Promise.all([
      direzione.fatturazioneGuidata.daFare(),
      commerciale.fatturazioneGuidata.daFare(),
    ]);

    const rigaDirezione = elencoDirezione.find((c) => c.commessaId === id);
    const rigaCommerciale = elencoCommerciale.find((c) => c.commessaId === id);
    expect(rigaDirezione).toBeDefined();
    expect(rigaCommerciale).toBeDefined();
    // La direzione ha economia.read: vede il pattuito derivato da importoTotale.
    expect(rigaDirezione?.pattuitoCent).toBe(1_200_000);
    // Il commerciale ha contratto.read (legge l'elenco) ma non economia.read.
    expect(rigaCommerciale?.pattuitoCent).toBeNull();
    expect(rigaCommerciale?.fatturaPrevistaCent).toBeNull();
  });

  it("(e) passi legge la commessa della propria sede; da un'altra sede NOT_FOUND", async () => {
    const sedeId = 9105;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "aggiornamento_contratto";

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const record = await direzione.fatturazioneGuidata.passi({ commessaId: id });
    expect(record.commessaId).toBe(id);
    expect(record.stato).toBe("aggiornamento_contratto");
    expect(record.passi.documenti).toBe("da_fare");
    expect(record.prossimoPasso).toBe("documenti");

    const altraSede = appRouter.createCaller(context(sedeId + 1, 1, ["direzione"]));
    await expect(altraSede.fatturazioneGuidata.passi({ commessaId: id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("(f) FLAG_LIMITI spento blocca anche la direzione (PRECONDITION_FAILED)", async () => {
    const prima = process.env.FLAG_LIMITI;
    try {
      process.env.FLAG_LIMITI = "off";
      const direzione = appRouter.createCaller(context(9106, 1, ["direzione"]));
      await expect(direzione.fatturazioneGuidata.daFare()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    } finally {
      if (prima === undefined) delete process.env.FLAG_LIMITI;
      else process.env.FLAG_LIMITI = prima;
    }
  });

  it("(g) ordina per giorni nello stato decrescente: chi è fermo da più tempo viene prima", async () => {
    const sedeId = 9107;
    const recente = await commessaDiProva(sedeId);
    (getCommessaById(recente) as any).stato = "aggiornamento_contratto";
    (getCommessaById(recente) as any).updatedAt = new Date(Date.now() - 5 * 86_400_000); // ~5 giorni

    const vecchia = await commessaDiProva(sedeId);
    (getCommessaById(vecchia) as any).stato = "fatture_pagamento";
    (getCommessaById(vecchia) as any).updatedAt = new Date(Date.now() - 66 * 86_400_000); // ~66 giorni

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const elenco = await direzione.fatturazioneGuidata.daFare();

    expect(elenco.map((c) => c.commessaId)).toEqual([vecchia, recente]);
    expect(elenco[0].giorniNelloStato).toBeGreaterThan(elenco[1].giorniNelloStato ?? 0);
  });
});
