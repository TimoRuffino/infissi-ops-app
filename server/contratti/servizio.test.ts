import { beforeEach, describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import { MOTIVO_PATTUITO_BLOCCATO } from "../_core/commessaPattuito";
import { _resetContrattiRepositoryForTests } from "./repository";
import { leggiContratto, mqRiga, salvaContratto } from "./servizio";
import { creaCommessa, getCommessaById, getCommesseStore } from "../routers/commesse";
import { getClientiStore } from "../routers/clienti";
import type { TrpcContext } from "../_core/context";

const SEDE = 1;
function ctx(): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> {
  return {
    user: { id: 5, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Test" } as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}
async function commessaDiProva(): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = { id: 9001 + clienti.length, sedeId: SEDE, nome: "Elena", cognome: "Bianchi", tipo: "privato", commesseIds: [], cittaLavoro: "Sarzana", createdAt: new Date(), updatedAt: new Date() };
  clienti.push(cliente);
  const c = await creaCommessa(ctx(), { clienteId: cliente.id } as any);
  return (c as any).commessa?.id ?? (c as any).id;
}
const righe = [
  { categoria: "serramento_pvc" as const, tipologia: "portafinestra_2_ante", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "Portafinestra 2 ante", quantita: 3, larghezzaMm: 1900, altezzaMm: 2400, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 500000, beneSignificativo: true, accessori: [], note: null, origine: "manuale" as const, evidenza: null },
  { categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "Finestra 2 ante", quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null, prezzoUnitCent: null, prezzoTotCent: 324746, beneSignificativo: true, accessori: [{ codice: "ribalta", quantita: 2 }], note: null, origine: "manuale" as const, evidenza: null },
];
const contratto = {
  pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null,
  comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18,
  detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
  detrazionePct: null, dataFirma: "2026-08-20", rate: [
    { numero: 1, quotaPct: 50, giorni: 0, data: null, descrizione: "all'ordine" },
    { numero: 2, quotaPct: 40, giorni: 60, data: null, descrizione: "merce pronta" },
    { numero: 3, quotaPct: 10, giorni: 75, data: null, descrizione: "posa ultimata" },
  ], origine: "manuale" as const, documentoId: null,
  opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
};

describe("servizio contratto", () => {
  beforeEach(() => _resetContrattiRepositoryForTests());

  it("calcola i mq da L×H×quantità esatti a sei decimali (non tre)", () => {
    expect(mqRiga({ quantita: 3, larghezzaMm: 1900, altezzaMm: 2400 })).toBe(13.68);
    expect(mqRiga({ quantita: 2, larghezzaMm: 1660, altezzaMm: 1540 })).toBe(5.1128);
    expect(mqRiga({ quantita: 1, larghezzaMm: 1591, altezzaMm: 800 })).toBe(1.2728);
    expect(mqRiga({ quantita: 1, larghezzaMm: null, altezzaMm: 1540 })).toBe(0);
  });

  it("salva righe e parametri, deriva zona e percentuale, specchia il pattuito sulla commessa", async () => {
    const commessaId = await commessaDiProva();
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto, righe, actorUserId: 5 });
    expect(esito.contratto.zonaClimatica).toBe("D");
    expect(esito.contratto.detrazionePct).toBe(50);
    expect(esito.contratto.hashRighe).toMatch(/^[0-9a-f]{64}$/);
    expect(esito.contratto.opzioniComputo).toEqual(OPZIONI_COMPUTO_DEFAULT);
    expect(esito.righe.map(r => r.mq)).toEqual([13.68, 5.1128]);
    expect(esito.righe.map(r => r.ordine)).toEqual([1, 2]);
    const commessa: any = getCommessaById(commessaId);
    expect(commessa.importoTotale).toBe(15395);
    expect(commessa.pianoRate).toHaveLength(3);
    expect(commessa.pianoRate[1]).toMatchObject({ importo: 6158, origine: "manuale" });
    const letto = await leggiContratto(SEDE, commessaId);
    expect(letto.righe).toHaveLength(2);
  });

  it("segnala il comune non risolto e lascia la zona a null senza bloccare", async () => {
    const commessaId = await commessaDiProva();
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto: { ...contratto, comuneCantiere: "Comune Inventato" }, righe, actorUserId: 5 });
    expect(esito.contratto.zonaClimatica).toBeNull();
    expect(esito.avvertenze.join(" ")).toMatch(/zona climatica/i);
  });

  it("rispetta la zona manuale e le rate che non sommano a 100 sono rifiutate", async () => {
    const commessaId = await commessaDiProva();
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto: { ...contratto, zonaManuale: true, zonaClimatica: "E" }, righe, actorUserId: 5 });
    expect(esito.contratto.zonaClimatica).toBe("E");
    await expect(salvaContratto({ sedeId: SEDE, commessaId, contratto: { ...contratto, rate: [{ numero: 1, quotaPct: 60, giorni: 0, data: null, descrizione: null }] }, righe, actorUserId: 5 })).rejects.toThrow("VALIDAZIONE");
  });

  it("un'altra sede ottiene NOT_FOUND", async () => {
    const commessaId = await commessaDiProva();
    await expect(salvaContratto({ sedeId: 2, commessaId, contratto, righe, actorUserId: 5 })).rejects.toThrow("NOT_FOUND");
    expect((await leggiContratto(2, commessaId)).contratto).toBeNull();
  });

  it("una commessa con pattuito già da FiC non viene sovrascritta: il contratto si salva comunque e lo segnala", async () => {
    const commessaId = await commessaDiProva();
    const commessaFic: any = getCommesseStore().find((c: any) => c.id === commessaId);
    commessaFic.pattuitoFicDocumentoIds = [777];
    commessaFic.pattuitoFonte = "fic";
    commessaFic.importoTotale = 9999;
    commessaFic.pianoRate = [{
      id: 1, numero: 1, importo: 9999, scadenza: null, descrizione: "Fattura 777",
      origine: "fic", ficDocumentoId: 777, ficRataId: 1, ficSourceKey: "fic:777:1",
      stato: "attesa", dataPagamento: null, createdAt: new Date(), updatedAt: null,
    }];

    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto, righe, actorUserId: 5 });
    // Il contratto (righe, hash, zona) si salva comunque: solo il pattuito non si specchia.
    expect(esito.righe).toHaveLength(2);
    expect(esito.avvertenze).toContain(MOTIVO_PATTUITO_BLOCCATO);
    const dopo: any = getCommessaById(commessaId);
    expect(dopo.importoTotale).toBe(9999);
    expect(dopo.pattuitoFonte).toBe("fic");
    expect(dopo.pianoRate).toHaveLength(1);
  });

  it("segnala tipologia DEI mancante o non valida e oscurante senza voce DEI, senza bloccare", async () => {
    const commessaId = await commessaDiProva();
    const righeIncomplete = [
      { ...righe[0], tipologia: null },
      { ...righe[1], tipologia: "non_esiste_nel_catalogo", oscuranteIntegrato: "tapparella" as const, oscuranteTipologia: null },
    ];
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto, righe: righeIncomplete, actorUserId: 5 });
    // Non blocca: il contratto e le righe sono comunque salvati.
    expect(esito.righe).toHaveLength(2);
    expect(esito.avvertenze).toContain("Riga 1: tipologia DEI mancante o non valida: il CHECK2 sarà incompleto.");
    expect(esito.avvertenze).toContain("Riga 2: tipologia DEI mancante o non valida: il CHECK2 sarà incompleto.");
    expect(esito.avvertenze).toContain("Riga 2: oscurante senza voce DEI.");
  });

  it("non segnala niente quando tipologia e oscurante sono voci DEI valide del gruppo giusto", async () => {
    const commessaId = await commessaDiProva();
    const righeValide = [
      { ...righe[0], tipologia: "C25077-e" }, // PVC portafinestra 2 ante, a battente — gruppo serramento
      { ...righe[1], tipologia: "C25077-c", oscuranteIntegrato: "tapparella" as const, oscuranteTipologia: "C25089-a" },
    ];
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto, righe: righeValide, actorUserId: 5 });
    expect(esito.avvertenze).toEqual([]);
  });

  // ── Fix round 1 (review): R12 — atomicità dello specchio ────────────────

  it("se lo specchio del pattuito lancia, il contratto resta salvato e l'errore diventa un'avvertenza (R12)", async () => {
    const commessaId = await commessaDiProva();
    // dataApertura corrotta: applicaPattuitoDaContratto costruisce
    // `new Date(`${dataApertura}T00:00:00`)`, che con questo valore è
    // Invalid Date — poi `.toISOString()` su una scadenza calcolata da una
    // Invalid Date lancia RangeError. Nessun mock: è un vero stato che può
    // capitare su un record legacy.
    const commessaRotta: any = getCommesseStore().find((c: any) => c.id === commessaId);
    commessaRotta.dataApertura = "non-una-data";
    const importoPrima = commessaRotta.importoTotale;

    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto, righe, actorUserId: 5 });
    // Il contratto (righe, hash, zona) si salva comunque: solo lo specchio
    // fallisce, e non fa fallire salvaContratto — il contratto è la fonte di
    // verità e resta leggibile con lo stesso hash appena prodotto.
    expect(esito.righe).toHaveLength(2);
    expect(esito.contratto.hashRighe).toMatch(/^[0-9a-f]{64}$/);
    expect(esito.avvertenze.some(a => a.startsWith("Pattuito non aggiornato sulla commessa: "))).toBe(true);
    // R20: lo specchio assegna soltanto dopo aver costruito tutto il piano
    // rate, quindi il guasto non lascia sulla commessa un importo pattuito
    // senza le rate che lo giustificano.
    const dopoGuasto: any = getCommessaById(commessaId);
    expect(dopoGuasto.importoTotale).toBe(importoPrima);
    const letto = await leggiContratto(SEDE, commessaId);
    expect(letto.contratto?.hashRighe).toBe(esito.contratto.hashRighe);
  });

  // ── Fix round 1 (review): R13 — errori di forma come VALIDAZIONE ────────

  it("una riga con quantità non valida rifiuta con VALIDAZIONE e il percorso del campo (R13)", async () => {
    const commessaId = await commessaDiProva();
    const righeRotte = [{ ...righe[0], quantita: 0 }, righe[1]];
    await expect(
      salvaContratto({ sedeId: SEDE, commessaId, contratto, righe: righeRotte, actorUserId: 5 })
    ).rejects.toThrow(/^VALIDAZIONE: righe\.0\.quantita/);
  });

  it("una data del contratto precedente alle tariffe disponibili rifiuta con VALIDAZIONE (R13)", async () => {
    const commessaId = await commessaDiProva();
    await expect(
      salvaContratto({
        sedeId: SEDE, commessaId, contratto, righe, actorUserId: 5,
        now: new Date("2020-01-01T00:00:00.000Z"), // precede validoDal del seed (2022-04-15)
      })
    ).rejects.toThrow("VALIDAZIONE: tariffe non disponibili per la data del contratto.");
  });

  // ── Fix round 1 (review): percorsi minori senza copertura ───────────────

  it("una riga senza misure genera l'avvertenza mq, senza bloccare", async () => {
    const commessaId = await commessaDiProva();
    const righeSenzaMisure = [{ ...righe[0], larghezzaMm: null }, righe[1]];
    const esito = await salvaContratto({ sedeId: SEDE, commessaId, contratto, righe: righeSenzaMisure, actorUserId: 5 });
    expect(esito.righe[0].mq).toBe(0);
    expect(esito.avvertenze).toContain("Alcune righe non hanno misure: il computo le conterà senza mq.");
  });

  it("zona manuale senza zona indicata rifiuta con VALIDAZIONE", async () => {
    const commessaId = await commessaDiProva();
    await expect(
      salvaContratto({ sedeId: SEDE, commessaId, contratto: { ...contratto, zonaManuale: true, zonaClimatica: null }, righe, actorUserId: 5 })
    ).rejects.toThrow("VALIDAZIONE: zona manuale senza zona indicata.");
  });

  // ── Fix round 2 (review finale): il piano rate somma il pattuito ────────

  it("le rate arrotondate sommano esattamente il pattuito: il resto va sull'ultima", async () => {
    const commessaId = await commessaDiProva();
    await salvaContratto({
      sedeId: SEDE, commessaId, righe, actorUserId: 5,
      contratto: {
        ...contratto,
        pattuitoCent: 10000, // 100,00 €
        rate: [
          { numero: 1, quotaPct: 33.33, giorni: 0, data: null, descrizione: null },
          { numero: 2, quotaPct: 33.33, giorni: 30, data: null, descrizione: null },
          { numero: 3, quotaPct: 33.34, giorni: 60, data: null, descrizione: null },
        ],
      },
    });
    const commessa: any = getCommessaById(commessaId);
    expect(commessa.importoTotale).toBe(100);
    const importi = commessa.pianoRate.map((r: any) => r.importo);
    expect(importi).toEqual([33.33, 33.33, 33.34]);
    expect(Math.round(importi.reduce((s: number, i: number) => s + i, 0) * 100)).toBe(10000);

    // Terzi con tre decimali: arrotondando ogni rata per conto suo il piano
    // sommava 99,99 € su un pattuito di 100,00 €.
    await salvaContratto({
      sedeId: SEDE, commessaId, righe, actorUserId: 5,
      contratto: {
        ...contratto,
        pattuitoCent: 10000,
        rate: [
          { numero: 1, quotaPct: 33.333, giorni: 0, data: null, descrizione: null },
          { numero: 2, quotaPct: 33.333, giorni: 30, data: null, descrizione: null },
          { numero: 3, quotaPct: 33.334, giorni: 60, data: null, descrizione: null },
        ],
      },
    });
    const terzi: any = getCommessaById(commessaId);
    const importiTerzi = terzi.pianoRate.map((r: any) => r.importo);
    expect(importiTerzi).toEqual([33.33, 33.33, 33.34]);
    expect(Math.round(importiTerzi.reduce((s: number, i: number) => s + i, 0) * 100)).toBe(10000);
  });

  // ── Fix round 2 (review finale): R33 — aliquote per anno di firma ───────

  it("una firma del 2025 o del 2027 deriva la sua aliquota, senza avvertenze", async () => {
    const commessaId = await commessaDiProva();
    const nel2025 = await salvaContratto({
      sedeId: SEDE, commessaId, righe, actorUserId: 5,
      contratto: { ...contratto, dataFirma: "2025-11-10" },
    });
    expect(nel2025.contratto.detrazionePct).toBe(50);
    expect(nel2025.avvertenze.some(a => a.toLowerCase().includes("detrazione"))).toBe(false);

    const nel2027 = await salvaContratto({
      sedeId: SEDE, commessaId, righe, actorUserId: 5,
      contratto: { ...contratto, dataFirma: "2027-03-01", detrazioneImmobile: "altro" },
    });
    expect(nel2027.contratto.detrazionePct).toBe(30);
  });

  it("un anno senza aliquota lo dice con l'anno, non con un generico «indicarla a mano»", async () => {
    const commessaId = await commessaDiProva();
    const esito = await salvaContratto({
      sedeId: SEDE, commessaId, righe, actorUserId: 5,
      contratto: { ...contratto, dataFirma: "2023-05-04" },
    });
    expect(esito.contratto.detrazionePct).toBeNull();
    expect(esito.avvertenze).toContain(
      "Percentuale di detrazione non calcolabile per l'anno 2023: le tariffe non hanno un'aliquota per quell'anno, il detraibile resta vuoto."
    );
  });

  it("detrazioneTipo nessuna lascia detrazionePct a null e non genera l'avvertenza di detrazione", async () => {
    const commessaId = await commessaDiProva();
    const esito = await salvaContratto({
      sedeId: SEDE, commessaId,
      contratto: { ...contratto, detrazioneTipo: "nessuna", detrazioneImmobile: null, detrazionePct: null },
      righe, actorUserId: 5,
    });
    expect(esito.contratto.detrazionePct).toBeNull();
    expect(esito.avvertenze.some(a => a.toLowerCase().includes("detrazione"))).toBe(false);
  });
});
