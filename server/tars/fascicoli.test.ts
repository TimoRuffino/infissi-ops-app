// Tars T3 — le prove dei fascicoli C3 e di C0 v2: il fascicolo è al
// pavimento di capability (anti-leak: MAI importi nel payload), si riusa
// finché le versioni osservate coincidono con le correnti, si
// ricostruisce al cambio (commessa toccata, ordine NUOVO), su errore
// serve l'ultima versione valida MARCATA stale; cross-sede NOT_FOUND; il
// pannello tars.fascicolo sta dietro i kill switch; C0 non serve più
// risposte su entità cambiate nel TTL.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Fattura, FatturazioneConfig } from "@shared/fatturazione/tipi";
import type { ContrattoInput, RigaContrattoInput } from "@shared/limiti/tipi";
import type { TrpcContext } from "../_core/context";
import { sha256Hex } from "../_core/fileStorage";
import casiFatture from "../computo/__fixtures__/casi-reali.json";
import { _resetComputiRepositoryForTests } from "../computo/repository";
import { eseguiComputo } from "../computo/servizio";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { salvaContratto } from "../contratti/servizio";
import type { DocumentoFicCreato } from "../fic/emissione";
import { creaClientFicFinto, type ChiamataFic } from "../fic/fake";
import { emettiFattura, type DipendenzeEmissione } from "../fatture/emissione";
import {
  _resetFattureRepositoryForTests,
  getFattureRepository,
} from "../fatture/repository";
import { aggiornaBozza, annullaBozza, creaBozza } from "../fatture/servizio";
import { getClientiStore } from "../routers/clienti";
import { creaCommessa, getCommessaById } from "../routers/commesse";
import { appRouter } from "../routers";
import { azzeraArchivioPerTest } from "./archivio";
import { costruisciContesto } from "./contesto";
import {
  azzeraFascicoliPerTest,
  CONTATORI_FASCICOLI,
  fascicoloCommessa,
} from "./fascicoli";
import { chiamataTool, creaProviderFinto, rispostaTesto } from "./openai/fake";
import { azzeraCacheTarsPerTest, eseguiRun } from "./orchestratore";
import { versioneCorrente } from "./versioni";

const SEDE = 98001;
const ALTRA_SEDE = 98002;
const DIREZIONE_ID = 98011;

function contestoTrpc(sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: DIREZIONE_ID,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione T3",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) => appRouter.createCaller(contestoTrpc(sedeId));

async function scenario() {
  const commessa = await direzione().commesse.create({
    cliente: "Fascicolo Prova Srl",
  });
  const fornitore = await direzione().fornitori.create({
    ragioneSociale: "Fornitore Fascicoli Srl",
    partitaIva: "01234567890",
    categoria: "pvc",
  });
  const inRitardo = await direzione().fornitori.ordini.create({
    fornitoreId: fornitore.id,
    commessaId: commessa.id,
    codiceOrdine: `ORD-T3-${commessa.id}-1`,
    dataConsegnaPrevista: "2020-01-10",
    righe: [
      { descrizione: "Telai", quantita: 2, unitaMisura: "pz", prezzoUnitario: 100 },
    ],
  });
  const senzaData = await direzione().fornitori.ordini.create({
    fornitoreId: fornitore.id,
    commessaId: commessa.id,
    codiceOrdine: `ORD-T3-${commessa.id}-2`,
    righe: [{ descrizione: "Vetri", quantita: 1, unitaMisura: "pz" }],
  });
  return { commessa, fornitore, inRitardo, senzaData };
}

function toccaCommessa(id: number) {
  const c: any = getCommessaById(id);
  c.updatedAt = new Date(new Date(c.updatedAt).getTime() + 1000);
}

beforeEach(() => {
  azzeraFascicoliPerTest();
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
});

afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_FATTURAZIONE;
  delete process.env.FLAG_LIMITI;
});

describe("tars T3 — fascicolo C3", () => {
  it("contiene gate, ordini e domande aperte deterministiche", async () => {
    const { commessa } = await scenario();
    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(f).not.toBeNull();
    expect(f!.ordini).toHaveLength(2);
    expect(f!.ordini.filter(o => o.inRitardo)).toHaveLength(1);
    const testoDomande = f!.domandeAperte.join(" | ");
    expect(testoDomande).toContain("manca la data di consegna prevista");
    expect(testoDomande).toContain("superata senza consegna effettiva");
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(1);
  });

  it("ANTI-LEAK: il payload condiviso non contiene mai importi", async () => {
    const { commessa } = await scenario();
    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    const serializzato = JSON.stringify(f);
    expect(serializzato).not.toMatch(/importo/i);
    expect(serializzato).not.toMatch(/prezzo/i);
    expect(serializzato).not.toMatch(/residuo/i);
    // Il booleano operativo sanzionato invece c'è.
    expect(f).toHaveProperty("daSaldare");
  });

  it("riusa finché nulla cambia; ricostruisce quando la commessa viene toccata", async () => {
    const { commessa } = await scenario();
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(1);
    expect(CONTATORI_FASCICOLI.riusi).toBe(1);

    toccaCommessa(commessa.id);
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(CONTATORI_FASCICOLI.invalidazioniVersione).toBe(1);
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(2);
  });

  it("un DOCUMENTO nuovo invalida il fascicolo: il gate non resta stantio (revisione)", async () => {
    const { commessa } = await scenario();
    const prima = await fascicoloCommessa({
      sedeId: SEDE,
      commessaId: commessa.id,
    });
    expect(prima!.gate.soddisfatto).toBe(false);

    const bytes = Buffer.from("finto-pdf-di-prova");
    await direzione().preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "preventivo-t3.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      size: bytes.length,
      dataBase64: bytes.toString("base64"),
      keepNome: true,
    });

    const dopo = await fascicoloCommessa({
      sedeId: SEDE,
      commessaId: commessa.id,
    });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(2); // ricostruito
    expect(dopo!.gate.soddisfatto).toBe(true);
  });

  it("un ordine NUOVO invalida il fascicolo (hash della lista)", async () => {
    const { commessa, fornitore } = await scenario();
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    await direzione().fornitori.ordini.create({
      fornitoreId: fornitore.id,
      commessaId: commessa.id,
      codiceOrdine: `ORD-T3-${commessa.id}-3`,
      righe: [{ descrizione: "Maniglie", quantita: 4, unitaMisura: "pz" }],
    });
    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(2);
    expect(f!.ordini).toHaveLength(3);
  });

  it("su errore di ricostruzione serve l'ultima versione valida MARCATA stale", async () => {
    const { commessa } = await scenario();
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    toccaCommessa(commessa.id); // versioni non più valide → serve ricostruire
    const f = await fascicoloCommessa(
      { sedeId: SEDE, commessaId: commessa.id },
      {
        costruttore: () => {
          throw new Error("boom di prova");
        },
      }
    );
    expect(f!.stale).toBe(true);
    expect(f!.commessaId).toBe(commessa.id);
    expect(CONTATORI_FASCICOLI.staleServiti).toBe(1);
  });

  it("cross-sede: il fascicolo di un'altra sede non esiste", async () => {
    const { commessa } = await scenario();
    expect(
      await fascicoloCommessa({ sedeId: ALTRA_SEDE, commessaId: commessa.id })
    ).toBeNull();
    await expect(
      direzione(ALTRA_SEDE).tars.fascicolo({ commessaId: commessa.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tars T3 — pannello tars.fascicolo", () => {
  it("serve il fascicolo alla pagina commessa, dietro i kill switch", async () => {
    const { commessa } = await scenario();
    const f = await direzione().tars.fascicolo({ commessaId: commessa.id });
    expect(f.commessaId).toBe(commessa.id);
    expect(Array.isArray(f.domandeAperte)).toBe(true);

    process.env.FLAG_TARS_READ_TOOLS = "off";
    await expect(
      direzione().tars.fascicolo({ commessaId: commessa.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    delete process.env.FLAG_TARS_READ_TOOLS;
    process.env.FLAG_TARS = "off";
    await expect(
      direzione().tars.fascicolo({ commessaId: commessa.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("tars T3 — C0 v2 con versioni di entità", () => {
  it("riusa entro il TTL solo se le entità osservate NON sono cambiate", async () => {
    const { commessa } = await scenario();
    const contesto = await costruisciContesto(contestoTrpc());
    let chiamateProvider = 0;
    const copione = () =>
      creaProviderFinto(() => {
        chiamateProvider += 1;
        return rispostaTesto("Stato letto.");
      });
    // Il riferimento canonico fa sì che entrambe le conversazioni partano
    // dallo stesso contesto verificato; un id numerico non è un riferimento
    // commessa e non deve ereditare il fingerprint appreso da un altro run.
    const messaggio = `Com'è messa la commessa ${commessa.codice}?`;

    const prima = await eseguiRun({ contesto, provider: copione(), messaggio });
    expect(prima.cache.c0Hit).toBe(false);
    const dopoPrima = chiamateProvider;

    const seconda = await eseguiRun({ contesto, provider: copione(), messaggio });
    expect(seconda.cache.c0Hit).toBe(true);
    expect(chiamateProvider).toBe(dopoPrima); // zero model call

    toccaCommessa(commessa.id);
    const terza = await eseguiRun({ contesto, provider: copione(), messaggio });
    expect(terza.cache.c0Hit).toBe(false); // entità cambiata → niente riuso
    expect(chiamateProvider).toBeGreaterThan(dopoPrima);
  });
});

describe("tars T3 — fascicolo racconta la fattura (Task 17)", () => {
  const ATTORE_FATTURE = DIREZIONE_ID;
  const ORA_FATTURE = new Date("2026-09-04T10:00:00Z");
  const PATTUITO_FATTURE = 1549472;

  // Stesso caso reale 127/2026 usato da servizio.test.ts, emissione.test.ts
  // e notaCredito.test.ts: contratto e computo veri (non inventati), per
  // non inseguire un edge case del risolutore che non ha niente a che
  // fare con questo task.
  const caso127 = (casiFatture.casi as any[]).find(c => c.nome === "fattura-127-2026")!;
  const RIGHE_127: RigaContrattoInput[] = caso127.righe.map((r: any) => ({
    categoria: r.categoria,
    tipologia: r.tipologia,
    oscuranteIntegrato: null,
    oscuranteTipologia: null,
    descrizione: r.descrizione,
    quantita: r.quantita,
    larghezzaMm: r.larghezzaMm,
    altezzaMm: r.altezzaMm,
    misuraDei: null,
    prezzoUnitCent: null,
    prezzoTotCent: r.prezzoTotCent,
    beneSignificativo: true,
    accessori: (r.accessori as string[]).map((codice: string) => ({ codice, quantita: r.quantita })),
    note: null,
    origine: "manuale" as const,
    evidenza: null,
  }));

  const CONTRATTO_127 = (): ContrattoInput => ({
    pattuitoCent: PATTUITO_FATTURE,
    pattuitoTipo: "lordo",
    posaInclusa: true,
    notePosa: null,
    comuneCantiere: "Sarzana",
    zonaManuale: false,
    piano: 2,
    distanzaKm: null,
    detrazioneTipo: "ristrutturazione",
    detrazioneImmobile: "prima_casa",
    detrazionePct: null,
    dataFirma: "2026-09-03",
    rate: [],
    origine: "manuale",
    documentoId: null,
    opzioniComputo: { rilievo: "foro", speseProfessionali: false, eventuali: [] },
  });

  const CONFIG_FATTURAZIONE_COMPLETA = (sedeId: number): FatturazioneConfig => ({
    sedeId,
    iban: "IT60X0542811101000000123456",
    banca: "BPM",
    intestatario: "Ruffino Group",
    metodoPagamento: "MP05",
    numerazioneFic: null,
    paymentAccountIdFic: 5,
    vatIdsFic: { 22: 3, 10: 9 },
    dicituraFooter: null,
    speseDocumentazioneCent: 15000,
    scopeScritturaOk: true,
    scopeVerificatoAt: ORA_FATTURE,
    updatedAt: ORA_FATTURE,
  });

  let progressivoClienteFatture = 0;
  function nuovoClienteFatture(sedeId: number): any {
    const clienti = getClientiStore() as any[];
    const cliente = {
      id: 98900 + progressivoClienteFatture++,
      sedeId,
      nome: "Cliente",
      cognome: "Prova T17",
      tipo: "privato",
      codiceFiscale: "RSSMRA85T10A562S",
      indirizzo: "Via Alta 80",
      cap: "19038",
      citta: "Sarzana (SP)",
      cittaLavoro: "Sarzana",
      pec: null,
      codiceDestinatario: null,
      ficEntityId: null,
      commesseIds: [],
      createdAt: ORA_FATTURE,
      updatedAt: ORA_FATTURE,
    };
    clienti.push(cliente);
    return cliente;
  }

  const ctxDiretto = (sedeId: number): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> => ({
    user: { id: ATTORE_FATTURE, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "T17" } as any,
    sedeId,
    sediIds: [sedeId],
  });

  async function nuovaCommessaConContratto(sedeId: number): Promise<number> {
    const cliente = nuovoClienteFatture(sedeId);
    const c: any = await creaCommessa(ctxDiretto(sedeId) as any, {
      clienteId: cliente.id,
      indirizzo: "Via Alta 80",
      citta: "Sarzana",
    } as any);
    return (c.commessa?.id ?? c.id) as number;
  }

  /**
   * Bozza pronta all'emissione: configurazione di sede completa e beni
   * riequilibrati a markup 0 (senza, il markup negativo blocca la
   * validazione — v. servizio.test.ts).
   */
  async function bozzaFatturabile(sedeId: number): Promise<{ fattura: Fattura; commessaId: number }> {
    const commessaId = await nuovaCommessaConContratto(sedeId);
    await salvaContratto({
      sedeId,
      commessaId,
      actorUserId: ATTORE_FATTURE,
      now: ORA_FATTURE,
      contratto: CONTRATTO_127(),
      righe: RIGHE_127,
    });
    await eseguiComputo({ sedeId, commessaId, actorUserId: ATTORE_FATTURE, now: ORA_FATTURE });
    await getFattureRepository().salvaConfig(CONFIG_FATTURAZIONE_COMPLETA(sedeId));
    const { fattura } = await creaBozza({
      sedeId,
      commessaId,
      actorUserId: ATTORE_FATTURE,
      now: () => ORA_FATTURE,
    });
    const esito = await aggiornaBozza({
      sedeId,
      id: fattura.id,
      revisione: fattura.revisione,
      actorUserId: ATTORE_FATTURE,
      modifica: { riequilibraBeniAMarkupCent: 0 },
      now: () => ORA_FATTURE,
    });
    return { fattura: esito.fattura, commessaId };
  }

  const documentoFicDa = (f: Fattura): DocumentoFicCreato => ({
    id: 88900 + f.id,
    number: 127,
    numeration: "/2026",
    date: "2026-09-04",
    amount_net: f.imponibileCent / 100,
    amount_vat: f.ivaCent / 100,
    amount_gross: f.totaleCent / 100,
    url: "https://fatture.example.test/127.pdf",
    ei_status: null,
    payments_list: f.scadenze.map((s, i) => ({ id: 9900 + i, amount: s.importoCent / 100, due_date: s.data })),
  });

  const XML_FINTO = Buffer.from('<?xml version="1.0"?><FatturaElettronica/>', "utf-8");
  const PDF_FINTO = Buffer.from("%PDF-1.4 finto\n%%EOF\n", "utf-8");

  /** Stesso montaggio del banco() di emissione.test.ts, senza registro/timeline: qui serve solo l'esito, non le sue tappe. */
  function emettiInDryRun(fattura: Fattura, sedeId: number) {
    const registro: ChiamataFic[] = [];
    const dip: DipendenzeEmissione = {
      now: () => ORA_FATTURE,
      client: creaClientFicFinto(
        {
          cercaClienti: async () => [],
          creaCliente: async () => ({ id: 424242 }),
          creaDocumento: async () => documentoFicDa(fattura),
          verificaXml: async () => ({ success: true, errori: [] }),
          inviaEInvoice: async () => ({ name: "IT01234567890_00001.xml", date: "2026-09-04" }),
          scaricaXml: async () => XML_FINTO,
          scaricaPdf: async () => PDF_FINTO,
        },
        registro
      ),
      contesto: async () => ({ companyId: 77, token: "token-finto" }),
      dryRun: () => true,
      storage: {
        putFile: async (collection, parentId, recordId, _nome, buffer) => ({
          storageKey: `${collection}/${parentId}/${recordId}-finto`,
          checksum: sha256Hex(buffer),
        }),
      },
      salvaFicEntityId: () => {},
      timeline: () => 1,
    };
    return emettiFattura({
      sedeId,
      id: fattura.id,
      actorUserId: ATTORE_FATTURE,
      revisione: fattura.revisione,
      ...dip,
    });
  }

  beforeEach(() => {
    _resetContrattiRepositoryForTests();
    _resetComputiRepositoryForTests();
    _resetFattureRepositoryForTests();
  });

  it("Caso 1: fattura emessa in dry-run — «prova SdI» nel fascicolo, mai importi", async () => {
    process.env.FLAG_FATTURAZIONE = "on";
    process.env.FLAG_LIMITI = "on";
    const { fattura, commessaId } = await bozzaFatturabile(SEDE);
    await emettiInDryRun(fattura, SEDE);

    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(f!.fatturazione).toHaveLength(1);
    expect(f!.fatturazione[0]).toContain("Fattura n.");
    expect(f!.fatturazione[0]).toContain("prova SdI");

    // ANTI-LEAK (Ruling R31): niente importi, mai un «totale € X».
    const serializzato = JSON.stringify(f);
    expect(serializzato).not.toMatch(/importo/i);
    expect(JSON.stringify(f!.fatturazione)).not.toContain("€");
  });

  it("Caso 2: col flag spento la sezione non compare, anche con una fattura vera", async () => {
    // Non basta `delete`: senza la variabile, interruttoreAttivo ricade sul
    // default d'ambiente, acceso in test (v. server/platform/interruttori.ts).
    process.env.FLAG_FATTURAZIONE = "off";
    process.env.FLAG_LIMITI = "on";
    const { commessaId } = await bozzaFatturabile(SEDE);

    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(f!.fatturazione).toEqual([]);
    expect(JSON.stringify(f)).not.toContain("Fattura");
    // Fix round 1 (item 5b): la fonte e la chiave di versione legate alla
    // fatturazione non compaiono affatto col flag spento, non solo la riga.
    expect(f!.fonti.some(riga => riga.includes("fatture CRM"))).toBe(false);
    expect(
      Object.keys(f!.versioni).some(chiave => chiave.startsWith("fatture-di-commessa:"))
    ).toBe(false);
  });

  it("Caso 3: una scrittura sulla fattura invalida il fascicolo (nuova versione)", async () => {
    process.env.FLAG_FATTURAZIONE = "on";
    process.env.FLAG_LIMITI = "on";
    const { fattura, commessaId } = await bozzaFatturabile(SEDE);

    const prima = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(prima!.fatturazione).toHaveLength(1);
    // Ruling R36: la bozza dice quello che è, non un conteggio calcolato
    // senza il computo fresco che lo renderebbe vero.
    expect(prima!.fatturazione[0]).toMatch(/^Fattura: bozza #\d+$/);
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(1);

    await annullaBozza({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE_FATTURE,
      motivo: "prova T17",
      now: () => ORA_FATTURE,
    });

    const dopo = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(2);
    expect(dopo!.fatturazione[0]).not.toBe(prima!.fatturazione[0]);
    expect(dopo!.fatturazione[0]).toContain("Annullata");
  });

  it("Caso 4: nessuna fattura — «nessuna» solo nello stato fatture_pagamento", async () => {
    process.env.FLAG_FATTURAZIONE = "on";
    process.env.FLAG_LIMITI = "on";
    const commessaId = await nuovaCommessaConContratto(SEDE);

    // Stato di default («preventivo»): nessuna fattura non è una domanda
    // aperta, la sezione resta vuota.
    const primaDelGate = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(primaDelGate!.fatturazione).toEqual([]);

    const c: any = getCommessaById(commessaId);
    c.stato = "fatture_pagamento";
    toccaCommessa(commessaId); // stessa versione «commessa:<id>»: senza, il fascicolo servirebbe la voce di prima

    const dopoIlGate = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(dopoIlGate!.fatturazione).toEqual([
      "Fattura: nessuna (bozza da generare dai limiti)",
    ]);
  });

  // Ruling R36: `eiErrore` è testo che nasce da Fatture in Cloud e dal
  // confronto dei totali — ci finiscono dentro gli importi. Il fascicolo
  // sta al pavimento `commessa.read`: la coda avviso è una frase FISSA
  // che rimanda alla tab Fattura, mai il messaggio vero.
  it("Caso 6 (anti-leak): un eiErrore con dentro un importo non arriva mai nel fascicolo", async () => {
    process.env.FLAG_FATTURAZIONE = "on";
    process.env.FLAG_LIMITI = "on";
    const { fattura, commessaId } = await bozzaFatturabile(SEDE);
    await emettiInDryRun(fattura, SEDE);

    const repo = getFattureRepository();
    const emessa = (await repo.perCommessa(SEDE, commessaId))[0];
    await repo.aggiornaStato({
      sedeId: SEDE,
      id: emessa.id,
      patch: {
        eiErrore: "Totali FiC diversi dai nostri: totale € 1.234,56 contro € 1.200,00.",
      },
      now: ORA_FATTURE,
    });

    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(f!.fatturazione[0]).toContain(
      " · avviso: esito SdI/FiC da verificare nella tab Fattura"
    );
    const serializzato = JSON.stringify(f);
    expect(serializzato).not.toContain("€");
    expect(serializzato).not.toContain("1.234");
    expect(serializzato).not.toContain("Totali FiC");
  });

  it("la bozza con lo scavalco dei limiti attivo lo dichiara, senza conteggi", async () => {
    process.env.FLAG_FATTURAZIONE = "on";
    process.env.FLAG_LIMITI = "on";
    const { fattura, commessaId } = await bozzaFatturabile(SEDE);
    await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: fattura.revisione,
      actorUserId: ATTORE_FATTURE,
      modifica: { scavalcoLimiti: { attivo: true, motivo: "Extra concordati fuori computo" } },
      now: () => ORA_FATTURE,
    });

    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(f!.fatturazione[0]).toMatch(
      /^Fattura: bozza #\d+ · scavalco limiti attivo$/
    );
    // Il motivo è testo libero di un operatore: resta nel registro della
    // fattura, non nel fascicolo condiviso di sede.
    expect(JSON.stringify(f)).not.toContain("Extra concordati");
  });

  it("versioneCorrente(\"fatture-di-commessa:<id>\", ALTRA_SEDE) è null: la commessa non è di quella sede", async () => {
    const commessaId = await nuovaCommessaConContratto(SEDE);
    expect(versioneCorrente(`fatture-di-commessa:${commessaId}`, ALTRA_SEDE)).toBeNull();
    expect(versioneCorrente(`fatture-di-commessa:${commessaId}`, SEDE)).not.toBeNull();
  });

  // Il registro delle versioni è fail-closed sui nomi che non conosce: un
  // nome ereditato dal prototipo di Object non è un interruttore.
  it("versioneCorrente(\"flag:<nome>\") conosce solo gli interruttori veri", () => {
    process.env.FLAG_FATTURAZIONE = "on";
    expect(versioneCorrente("flag:fatturazione", SEDE)).toBe("true");
    for (const finto of ["constructor", "toString", "hasOwnProperty", "inventato"]) {
      expect(versioneCorrente(`flag:${finto}`, SEDE)).toBeNull();
    }
  });

  it("Caso 5 (Ruling R33): un flip del flag a runtime invalida il fascicolo cacheato", async () => {
    process.env.FLAG_FATTURAZIONE = "off";
    process.env.FLAG_LIMITI = "on";
    const commessaId = await nuovaCommessaConContratto(SEDE);
    const c: any = getCommessaById(commessaId);
    // Nello stato in cui, a flag acceso, comparirebbe la riga «nessuna»:
    // se il flip non invalidasse, il fascicolo servirebbe per sempre la
    // voce costruita col flag spento (fatturazione: []).
    c.stato = "fatture_pagamento";

    const conFlagSpento = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(conFlagSpento!.fatturazione).toEqual([]);
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(1);

    // Nessun'altra versione cambia: né la commessa (stato già impostato
    // sopra, updatedAt intatto) né ordini/documenti/pagamenti/giorno.
    process.env.FLAG_FATTURAZIONE = "on";
    const conFlagAcceso = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(2);
    expect(conFlagAcceso!.fatturazione).toEqual([
      "Fattura: nessuna (bozza da generare dai limiti)",
    ]);

    process.env.FLAG_FATTURAZIONE = "off";
    const conFlagSpentoDiNuovo = await fascicoloCommessa({ sedeId: SEDE, commessaId });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(3);
    expect(conFlagSpentoDiNuovo!.fatturazione).toEqual([]);
  });
});
