// server/routers/fatturazioneGuidata.test.ts
// Router tRPC `fatturazioneGuidata`: l'elenco delle commesse da fatturare
// (§4.2 del design) e i passi di una commessa (§4.1), dietro FLAG_LIMITI.
// Stesso pattern di server/routers/contratti.test.ts e computo.test.ts.
//
// Ogni test usa una sede propria (mai la 1, mai condivisa fra test): lo
// store delle commesse è un modulo condiviso per tutto il file, e senza
// questa scelta un elenco «della sede» di un test vedrebbe anche le
// commesse create da un test precedente nello stesso processo.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContrattoInput, RigaContrattoInput } from "@shared/limiti/tipi";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { salvaContratto } from "../contratti/servizio";
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

    // Sede esclusiva a questo test: l'unica commessa creata qui è esclusa,
    // quindi l'elenco non è solo "senza id" ma vuoto del tutto.
    expect(elenco).toHaveLength(0);
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
    // La bozza è un importo vero (il totale della fattura in lavorazione),
    // non una stima dal pattuito: fatturaPrevistaCent la rispecchia diretta.
    expect(riga?.fatturaPrevistaCent).toBe(100000);
    expect(riga?.fatturaPrevistaStima).toBe(false);

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
    // Non solo l'ordine: i giorni contati devono essere quelli veri, non
    // un valore qualunque che capiti a rispettare la disuguaglianza.
    expect(elenco[0].giorniNelloStato).toBe(66);
    expect(elenco[1].giorniNelloStato).toBe(5);
  });

  it("(h) giorniNelloStato conta il giorno di calendario Europe/Rome, non quello UTC (Ruling P4-R4)", async () => {
    const sedeId = 9108;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "aggiornamento_contratto";

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));

    try {
      vi.useFakeTimers();

      // 23:30 UTC del 4 settembre è già l'1:30 del 5 a Roma (CEST, +2): con
      // updatedAt esattamente 5 giorni prima alla stessa ora UTC, il giorno
      // di calendario Roma dista comunque 5 giorni, non 6 come prima della
      // fix (che prendeva il giorno UTC di updatedAt e il giorno Roma di
      // adesso, disallineati proprio in questa finestra 22-24 UTC).
      const adesso = new Date("2026-09-04T23:30:00.000Z");
      (getCommessaById(id) as any).updatedAt = new Date(adesso.getTime() - 5 * 86_400_000);
      vi.setSystemTime(adesso);
      const elenco = await direzione.fatturazioneGuidata.daFare();
      expect(elenco.find((c) => c.commessaId === id)?.giorniNelloStato).toBe(5);

      // Controllo a mezzogiorno, lontano da qualunque confine di giorno:
      // stessa differenza reale di 5 giorni, stesso risultato — la fix non
      // cambia il conteggio nel caso già corretto prima.
      const mezzogiorno = new Date("2026-09-04T12:00:00.000Z");
      (getCommessaById(id) as any).updatedAt = new Date(mezzogiorno.getTime() - 5 * 86_400_000);
      vi.setSystemTime(mezzogiorno);
      const elencoMezzogiorno = await direzione.fatturazioneGuidata.daFare();
      expect(elencoMezzogiorno.find((c) => c.commessaId === id)?.giorniNelloStato).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(i) contratto strutturato reale (salvaContratto): pattuito lordo diretto, imponibile maggiorato del 10% e dichiarato stima", async () => {
    const pattuitoCent = 1_549_472;
    const riga: RigaContrattoInput = {
      categoria: "serramento_pvc",
      tipologia: "finestra_2_ante",
      oscuranteIntegrato: null,
      oscuranteTipologia: null,
      descrizione: "Finestra",
      quantita: 2,
      larghezzaMm: 1660,
      altezzaMm: 1540,
      misuraDei: null,
      prezzoUnitCent: null,
      prezzoTotCent: 300000,
      beneSignificativo: true,
      accessori: [],
      note: null,
      origine: "manuale",
      evidenza: null,
    };
    const contrattoDi = (pattuitoTipo: "lordo" | "imponibile"): ContrattoInput => ({
      pattuitoCent,
      pattuitoTipo,
      posaInclusa: true,
      notePosa: null,
      comuneCantiere: "Sarzana",
      zonaManuale: false,
      piano: 2,
      distanzaKm: 18,
      detrazioneTipo: "ristrutturazione",
      detrazioneImmobile: "prima_casa",
      detrazionePct: null,
      dataFirma: "2026-09-01",
      rate: [],
      origine: "manuale",
      documentoId: null,
      opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
    });

    const sedeId = 9109;
    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));

    const idLordo = await commessaDiProva(sedeId);
    (getCommessaById(idLordo) as any).stato = "aggiornamento_contratto";
    await salvaContratto({
      sedeId,
      commessaId: idLordo,
      actorUserId: 1,
      contratto: contrattoDi("lordo"),
      righe: [riga],
    });
    const rigaLordo = await direzione.fatturazioneGuidata.passi({ commessaId: idLordo });
    expect(rigaLordo.pattuitoCent).toBe(pattuitoCent);
    expect(rigaLordo.pattuitoTipo).toBe("lordo");
    expect(rigaLordo.passi.contratto).toBe("fatto");
    expect(rigaLordo.fatturaPrevistaCent).toBe(pattuitoCent);
    expect(rigaLordo.fatturaPrevistaStima).toBe(false);

    const idImponibile = await commessaDiProva(sedeId);
    (getCommessaById(idImponibile) as any).stato = "aggiornamento_contratto";
    await salvaContratto({
      sedeId,
      commessaId: idImponibile,
      actorUserId: 1,
      contratto: contrattoDi("imponibile"),
      righe: [riga],
    });
    const rigaImponibile = await direzione.fatturazioneGuidata.passi({ commessaId: idImponibile });
    expect(rigaImponibile.pattuitoCent).toBe(pattuitoCent);
    expect(rigaImponibile.pattuitoTipo).toBe("imponibile");
    expect(rigaImponibile.passi.contratto).toBe("fatto");
    expect(rigaImponibile.fatturaPrevistaCent).toBe(Math.round(pattuitoCent * 1.1));
    expect(rigaImponibile.fatturaPrevistaStima).toBe(true);
  });

  // Giro di fix 3 (final-review.md, Test mancante 1): `contratto.read` è
  // condivisa da tutti i ruoli definiti (SHARED_CAPABILITIES) — l'unico
  // contesto senza quella capability è uno senza ruoli riconosciuti.
  it("(j) un contesto senza ruoli/capability è FORBIDDEN su daFare e su passi", async () => {
    const sedeId = 9110;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "aggiornamento_contratto";

    const senzaRuoli = appRouter.createCaller(context(sedeId, 1, []));
    await expect(senzaRuoli.fatturazioneGuidata.daFare()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      senzaRuoli.fatturazioneGuidata.passi({ commessaId: id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Test mancante 2: il test (f) copre solo `daFare`.
  it("(k) FLAG_LIMITI spento blocca anche passi, non solo daFare (PRECONDITION_FAILED)", async () => {
    const prima = process.env.FLAG_LIMITI;
    try {
      process.env.FLAG_LIMITI = "off";
      const direzione = appRouter.createCaller(context(9111, 1, ["direzione"]));
      await expect(
        direzione.fatturazioneGuidata.passi({ commessaId: 1 })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      if (prima === undefined) delete process.env.FLAG_LIMITI;
      else process.env.FLAG_LIMITI = prima;
    }
  });

  // I1 / Ruling P4-R13: una commessa soft-archiviata resta nello stato
  // `fatture_pagamento` (l'archiviazione non lo tocca) ma non deve più
  // comparire fra le commesse da lavorare.
  it("(l) una commessa archiviata (soft-archive) non compare in daFare anche nello stato giusto", async () => {
    const sedeId = 9112;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "fatture_pagamento";
    (getCommessaById(id) as any).archivedAt = new Date().toISOString();

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const elenco = await direzione.fatturazioneGuidata.daFare();
    expect(elenco.map((c) => c.commessaId)).not.toContain(id);
  });

  // I3 / Ruling P4-R15: protegge il raggruppamento per `commessaId` di
  // `perCommesse` in `daFare` — una fattura mal raggruppata finirebbe sulla
  // commessa sbagliata senza che nessun altro test se ne accorga.
  it("(m) due commesse candidate con fatture miste: fatturaStato corretto per ciascuna", async () => {
    const sedeId = 9113;
    const conBozza = await commessaDiProva(sedeId);
    (getCommessaById(conBozza) as any).stato = "fatture_pagamento";
    const senzaFattura = await commessaDiProva(sedeId);
    (getCommessaById(senzaFattura) as any).stato = "fatture_pagamento";

    const repo = getFattureRepository();
    await repo.crea({
      fattura: fatturaMinima(sedeId, conBozza),
      righe: [],
      riepilogo: [],
      scadenze: [],
      now: new Date(),
    });

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const elenco = await direzione.fatturazioneGuidata.daFare();

    expect(elenco.find((c) => c.commessaId === conBozza)?.fatturaStato).toBe("bozza");
    expect(elenco.find((c) => c.commessaId === senzaFattura)?.fatturaStato).toBeNull();
  });

  // I4 / Test mancante 3: il test (d) verificava solo pattuitoCent e
  // fatturaPrevistaCent — questo avrebbe intercettato la fuga di
  // `fatturaPrevistaStima` (oracolo su pattuitoTipo === "imponibile") fuori
  // dal gate `economia.read`.
  it("(n) gating completo degli importi: il commerciale non vede né pattuitoTipo né fatturaPrevistaStima (I4)", async () => {
    const pattuitoCent = 500_000;
    const riga: RigaContrattoInput = {
      categoria: "serramento_pvc",
      tipologia: "finestra_2_ante",
      oscuranteIntegrato: null,
      oscuranteTipologia: null,
      descrizione: "Finestra",
      quantita: 1,
      larghezzaMm: 1200,
      altezzaMm: 1400,
      misuraDei: null,
      prezzoUnitCent: null,
      prezzoTotCent: 300000,
      beneSignificativo: true,
      accessori: [],
      note: null,
      origine: "manuale",
      evidenza: null,
    };
    const sedeId = 9114;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "aggiornamento_contratto";
    await salvaContratto({
      sedeId,
      commessaId: id,
      actorUserId: 1,
      contratto: {
        pattuitoCent,
        pattuitoTipo: "imponibile",
        posaInclusa: true,
        notePosa: null,
        comuneCantiere: "Sarzana",
        zonaManuale: false,
        piano: 1,
        distanzaKm: 10,
        detrazioneTipo: "nessuna",
        detrazioneImmobile: null,
        detrazionePct: null,
        dataFirma: "2026-09-01",
        rate: [],
        origine: "manuale",
        documentoId: null,
        opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
      },
      righe: [riga],
    });

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const commerciale = appRouter.createCaller(context(sedeId, 2, ["commerciale"]));
    const [elencoDirezione, elencoCommerciale] = await Promise.all([
      direzione.fatturazioneGuidata.daFare(),
      commerciale.fatturazioneGuidata.daFare(),
    ]);

    const rigaCommerciale = elencoCommerciale.find((c) => c.commessaId === id);
    const rigaDirezione = elencoDirezione.find((c) => c.commessaId === id);
    // Il commerciale ha contratto.read (legge l'elenco) ma non economia.read:
    // niente pattuitoTipo, e niente fatturaPrevistaStima anche se sarebbe
    // vero (un contratto imponibile senza bozza) — prima della fix questo
    // secondo campo restava valorizzato.
    expect(rigaCommerciale?.pattuitoTipo).toBeNull();
    expect(rigaCommerciale?.fatturaPrevistaStima).toBe(false);
    expect(rigaDirezione?.pattuitoTipo).toBe("imponibile");
    expect(rigaDirezione?.fatturaPrevistaStima).toBe(true);
  });

  // Test mancante 7 / Ruling P4-R16.
  it("(o) statoDal nel futuro non produce un giorniNelloStato negativo", async () => {
    const sedeId = 9115;
    const id = await commessaDiProva(sedeId);
    (getCommessaById(id) as any).stato = "aggiornamento_contratto";
    (getCommessaById(id) as any).updatedAt = new Date(Date.now() + 3 * 86_400_000);

    const direzione = appRouter.createCaller(context(sedeId, 1, ["direzione"]));
    const elenco = await direzione.fatturazioneGuidata.daFare();
    expect(elenco.find((c) => c.commessaId === id)?.giorniNelloStato).toBe(0);
  });
});
