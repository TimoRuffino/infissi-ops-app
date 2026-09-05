// server/fatture/emissione.test.ts
// La pipeline di emissione sul caso reale 127/2026: client FiC finto a
// copione (nessuna rete), repository in memoria, storage finto per
// l'archivio XML/PDF. L'unico effetto reale è il documento del fascicolo,
// che passa dal vero `registraDocumentoFatturaCrm` come in produzione:
// serve a provare che il gate documentale di `fatture_pagamento` viene
// davvero soddisfatto.
//
// Attenzione: proprio per questo i casi che arrivano al fascicolo (a, b,
// e, riarchivio) scrivono davvero un PDF finto sotto `data/files/` con il
// driver `local` di `putFile`. La cartella è ignorata da git e il
// precedente è `server/routers/ficAllegati.test.ts`, che fa lo stesso da
// prima di questo piano.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DICITURE } from "@shared/fatturazione/diciture";
import type { Fattura, FatturazioneConfig } from "@shared/fatturazione/tipi";
import type { ContrattoInput, RigaContrattoInput } from "@shared/limiti/tipi";
import type { TrpcContext } from "../_core/context";
import { sha256Hex } from "../_core/fileStorage";
import casi from "../computo/__fixtures__/casi-reali.json";
import { _resetComputiRepositoryForTests } from "../computo/repository";
import { eseguiComputo } from "../computo/servizio";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { salvaContratto } from "../contratti/servizio";
import type { DocumentoFicCreato } from "../fic/emissione";
import { creaClientFicFinto, type ChiamataFic } from "../fic/fake";
import { getClienteById, getClientiStore } from "../routers/clienti";
import { creaCommessa, getCommessaById } from "../routers/commesse";
import { getDocumentoRecordById } from "../routers/preventiviContratti";
import { getUtentiStore } from "../routers/utenti";
import {
  costruisciClienteFic,
  costruisciDocumentoFic,
  emettiFattura,
  noteFattura,
  type DipendenzeEmissione,
} from "./emissione";
import {
  createMemoryFattureRepository,
  type FattureRepository,
} from "./repository";
import { aggiornaBozza, creaBozza } from "./servizio";

const SEDE = 1;
const ALTRA_SEDE = 2;
const ATTORE = 7701;
const ora = new Date("2026-09-04T10:00:00Z");
const PATTUITO = 1549472;
/** Il pattuito della fattura 127/2026 vera (fixture di `fatture-reali.json`). */
const PATTUITO_REALE = 1549652;
const FIC_DOCUMENT_ID = 88123;
const FIC_ENTITY_NUOVO = 4242;

let repository: FattureRepository;
const dipServizio = () => ({ repository, now: () => ora, bilanciaBozza: false });

const ctx = (
  sedeId: number
): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> =>
  ({
    user: {
      id: ATTORE,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "T",
    } as any,
    sedeId,
    sediIds: [sedeId],
  }) as any;

const caso127 = (casi.casi as any[]).find(c => c.nome === "fattura-127-2026")!;
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
  accessori: (r.accessori as string[]).map(codice => ({
    codice,
    quantita: r.quantita,
  })),
  note: null,
  origine: "manuale" as const,
  evidenza: null,
}));

const CONTRATTO_127 = (
  extra: Partial<ContrattoInput> = {}
): ContrattoInput => ({
  pattuitoCent: PATTUITO,
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
  ...extra,
});

const CONFIG_COMPLETA = (sedeId = SEDE): FatturazioneConfig => ({
  sedeId,
  iban: "IT60X0542811101000000123456",
  banca: "BPM",
  intestatario: "Ruffino Group Srl",
  metodoPagamento: "MP05",
  numerazioneFic: null,
  paymentAccountIdFic: 5,
  vatIdsFic: { 22: 3, 10: 9 },
  dicituraFooter: "Grazie per la fiducia.",
  speseDocumentazioneCent: 15000,
  scopeScritturaOk: true,
  scopeVerificatoAt: ora,
  updatedAt: ora,
});

let progressivoCliente = 0;
function nuovoCliente(sedeId = SEDE, extra: Record<string, unknown> = {}): any {
  const clienti = getClientiStore() as any[];
  const cliente = {
    id: 77000 + progressivoCliente++,
    sedeId,
    nome: "Mario",
    cognome: "Rossi",
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
    createdAt: ora,
    updatedAt: ora,
    ...extra,
  };
  clienti.push(cliente);
  return cliente;
}

async function nuovaCommessa(sedeId = SEDE, cliente = nuovoCliente(sedeId)) {
  const c: any = await creaCommessa(
    ctx(sedeId) as any,
    {
      clienteId: cliente.id,
      indirizzo: "Via Alta 80",
      citta: "Sarzana",
    } as any
  );
  return { commessaId: (c.commessa?.id ?? c.id) as number, cliente };
}

/** Commessa + contratto 127 + computo: la base di ogni scenario. */
async function scenario127(
  extra: Partial<ContrattoInput> = {},
  sedeId = SEDE
): Promise<{ commessaId: number; cliente: any }> {
  const { commessaId, cliente } = await nuovaCommessa(sedeId);
  await salvaContratto({
    sedeId,
    commessaId,
    actorUserId: ATTORE,
    now: ora,
    contratto: CONTRATTO_127(extra),
    righe: RIGHE_127,
  });
  await eseguiComputo({ sedeId, commessaId, actorUserId: ATTORE, now: ora });
  return { commessaId, cliente };
}

/**
 * Bozza pronta all'emissione: configurazione di sede completa e beni
 * riequilibrati a markup 0 (senza, il markup negativo blocca la
 * validazione — v. `servizio.test.ts`).
 */
async function bozzaEmettibile(
  extra: Partial<ContrattoInput> = {},
  sedeId = SEDE,
  markupTargetCent = 0
): Promise<{ fattura: Fattura; commessaId: number; cliente: any }> {
  const { commessaId, cliente } = await scenario127(extra, sedeId);
  await repository.salvaConfig(CONFIG_COMPLETA(sedeId));
  const { fattura } = await creaBozza({
    sedeId,
    commessaId,
    actorUserId: ATTORE,
    ...dipServizio(),
  });
  const esito = await aggiornaBozza({
    sedeId,
    id: fattura.id,
    revisione: fattura.revisione,
    actorUserId: ATTORE,
    modifica: { riequilibraBeniAMarkupCent: markupTargetCent },
    ...dipServizio(),
  });
  return { fattura: esito.fattura, commessaId, cliente };
}

// ── Copione FiC ─────────────────────────────────────────────────────────
type Copione = Parameters<typeof creaClientFicFinto>[0];

const documentoFicDa = (
  f: Fattura,
  over: Partial<DocumentoFicCreato> = {}
): DocumentoFicCreato => ({
  id: FIC_DOCUMENT_ID,
  number: 127,
  numeration: "/2026",
  date: "2026-09-04",
  amount_net: f.imponibileCent / 100,
  amount_vat: f.ivaCent / 100,
  amount_gross: f.totaleCent / 100,
  url: "https://fatture.example.test/127.pdf",
  ei_status: null,
  payments_list: f.scadenze.map((s, i) => ({
    id: 9000 + i,
    amount: s.importoCent / 100,
    due_date: s.data,
  })),
  ...over,
});

const XML_FINTO = Buffer.from(
  '<?xml version="1.0"?><FatturaElettronica/>',
  "utf-8"
);
const PDF_FINTO = Buffer.from("%PDF-1.4 finto\n%%EOF\n", "utf-8");

function copioneFelice(f: Fattura, over: Copione = {}): Copione {
  return {
    cercaClienti: async () => [],
    creaCliente: async () => ({ id: FIC_ENTITY_NUOVO }),
    creaDocumento: async () => documentoFicDa(f),
    verificaXml: async () => ({ success: true, errori: [] }),
    inviaEInvoice: async () => ({
      name: "IT01234567890_00001.xml",
      date: "2026-09-04",
    }),
    scaricaXml: async () => XML_FINTO,
    scaricaPdf: async () => PDF_FINTO,
    ...over,
  };
}

type Banco = {
  dip: DipendenzeEmissione;
  registro: ChiamataFic[];
  files: Array<{ collection: string; nome: string; sha: string }>;
  timeline: Array<[number, string, string | null]>;
  ficEntitySalvati: Array<[number, number]>;
};

function banco(
  copione: Copione,
  opzioni: { dryRun?: boolean; salvaFicEntityIdReale?: boolean } = {}
): Banco {
  const registro: ChiamataFic[] = [];
  const files: Banco["files"] = [];
  const timeline: Banco["timeline"] = [];
  const ficEntitySalvati: Banco["ficEntitySalvati"] = [];
  const dip: DipendenzeEmissione = {
    repository,
    now: () => ora,
    client: creaClientFicFinto(copione, registro),
    contesto: async () => ({ companyId: 77, token: "token-finto" }),
    dryRun: () => opzioni.dryRun ?? true,
    storage: {
      putFile: async (collection, parentId, recordId, nome, buffer) => {
        files.push({ collection, nome, sha: sha256Hex(buffer) });
        return {
          storageKey: `${collection}/${parentId}/${recordId}-finto`,
          checksum: sha256Hex(buffer),
        };
      },
    },
    timeline: (commessaId, stato, utente) => {
      timeline.push([commessaId, stato, utente ?? null]);
      return 1;
    },
  };
  if (!opzioni.salvaFicEntityIdReale) {
    dip.salvaFicEntityId = (clienteId, ficEntityId) => {
      ficEntitySalvati.push([clienteId, ficEntityId]);
    };
  }
  return { dip, registro, files, timeline, ficEntitySalvati };
}

const metodi = (registro: ChiamataFic[]) => registro.map(c => c.metodo);
const tipiEvento = async (sedeId: number, fatturaId: number) =>
  (await repository.eventi(sedeId, fatturaId)).map(e => e.tipo);
const evento = async (sedeId: number, fatturaId: number, tipo: string) =>
  (await repository.eventi(sedeId, fatturaId)).find(e => e.tipo === tipo)!;

beforeEach(() => {
  _resetContrattiRepositoryForTests();
  _resetComputiRepositoryForTests();
  repository = createMemoryFattureRepository();
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === ATTORE)) {
    utenti.push({
      id: ATTORE,
      nome: "Timo",
      cognome: "Ruffino",
      ruolo: "direzione",
      ruoli: ["direzione"],
      sedeId: SEDE,
    });
  }
});

describe("emettiFattura", () => {
  it("(a) percorso felice in dry-run: cliente, documento, XML, invio, archivio, fascicolo e timeline", async () => {
    const { fattura, commessaId, cliente } = await bozzaEmettibile();
    const b = banco(copioneFelice(fattura));

    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    // Ordine esatto delle chiamate a Fatture in Cloud.
    expect(metodi(b.registro)).toEqual([
      "cercaClienti",
      "creaCliente",
      "creaDocumento",
      "verificaXml",
      "inviaEInvoice",
      "scaricaXml",
      "scaricaPdf",
    ]);
    expect(b.registro[3].body).toMatchObject({ documentId: FIC_DOCUMENT_ID });
    expect(b.registro[4].body).toMatchObject({
      opzioni: { dry_run: true },
    });
    expect((b.registro[2].body as any).opzioni).toEqual({ fix_payments: true });

    // Dry-run: la fattura resta «emessa» e porta il segno del giro di prova.
    const f = esito.fattura;
    expect(f.stato).toBe("emessa");
    expect(f.inviataDryRun).toBe(true);
    expect(f.ficDocumentId).toBe(FIC_DOCUMENT_ID);
    expect(f.numero).toBe("127/2026");
    expect(f.data).toBe("2026-09-04");
    expect(f.emessaDa).toBe(ATTORE);
    expect(f.emessaAt).toEqual(ora);
    expect(f.eiErrore).toBeNull();
    expect(f.revisione).toBe(fattura.revisione + 1);
    expect(f.clienteSnapshot!.ficEntityId).toBe(FIC_ENTITY_NUOVO);
    expect(b.ficEntitySalvati).toEqual([[cliente.id, FIC_ENTITY_NUOVO]]);

    // Scadenze appaiate ai pagamenti FiC per indice.
    expect(f.scadenze.map(s => s.ficPaymentId)).toEqual([9000, 9001, 9002]);

    // Archivio: XML con checksum, PDF nello storage.
    expect(b.files.map(x => x.collection)).toEqual([
      "fatture_xml",
      "fatture_pdf",
    ]);
    expect(b.files[0].nome).toBe("127-2026.xml");
    expect(b.files[1].nome).toBe("127-2026.pdf");
    expect(f.xmlStorageKey).toContain("fatture_xml/");
    expect(f.xmlSha256).toBe(sha256Hex(XML_FINTO));
    expect(f.pdfStorageKey).toContain("fatture_pdf/");

    // Documento nel fascicolo: soddisfa il gate «fattura» di fatture_pagamento.
    expect(f.documentoId).not.toBeNull();
    const documento = getDocumentoRecordById(f.documentoId!)!;
    expect(documento).toMatchObject({
      commessaId,
      nome: "Fattura 127-2026.pdf",
      tipo: "fattura",
      mimeType: "application/pdf",
      source: "crm",
      sourceRef: `crm:fattura:${f.id}`,
      origine: "automatico",
      createdBy: ATTORE,
    });

    // Timeline allineata al board con il nome dell'attore.
    const commessa: any = getCommessaById(commessaId);
    expect(b.timeline).toEqual([[commessaId, commessa.stato, "Timo Ruffino"]]);

    // Eventi in ordine (i primi due vengono dalla bozza).
    expect(await tipiEvento(SEDE, f.id)).toEqual([
      "creata",
      "modificata",
      "emissione_avviata",
      "cliente_fic",
      "creata_fic",
      "xml_ok",
      "inviata",
      "xml_archiviato",
      "pdf_archiviato",
    ]);
    expect((await evento(SEDE, f.id, "cliente_fic")).payload).toMatchObject({
      ficEntityId: FIC_ENTITY_NUOVO,
      creato: true,
    });
    expect((await evento(SEDE, f.id, "creata_fic")).payload).toMatchObject({
      ficDocumentId: FIC_DOCUMENT_ID,
      numero: "127/2026",
      amount_gross: f.totaleCent / 100,
    });
    expect((await evento(SEDE, f.id, "inviata")).payload).toMatchObject({
      dryRun: true,
    });

    expect(esito.passi.map(p => [p.passo, p.esito])).toEqual([
      ["validazione", "fatto"],
      ["cliente_fic", "fatto"],
      ["documento_fic", "fatto"],
      ["confronto_totali", "fatto"],
      ["xml", "fatto"],
      ["invio", "fatto"],
      ["archivio", "fatto"],
      ["documento_fascicolo", "fatto"],
      ["timeline", "fatto"],
    ]);
  });

  it("(b) cliente già su Fatture in Cloud: nessuna creazione, id salvato anche sull'anagrafica CRM", async () => {
    const { fattura, cliente } = await bozzaEmettibile();
    const b = banco(
      copioneFelice(fattura, {
        cercaClienti: async () => [
          {
            id: 5150,
            name: "Bianchi Luca",
            tax_code: "rssmra85t10a562s",
            vat_number: null,
          },
        ],
      }),
      { salvaFicEntityIdReale: true }
    );

    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    expect(metodi(b.registro)).not.toContain("creaCliente");
    expect(b.registro[0]).toMatchObject({
      metodo: "cercaClienti",
      path: "RSSMRA85T10A562S",
    });
    expect(esito.fattura.clienteSnapshot!.ficEntityId).toBe(5150);
    // Il default scrive davvero sul record del cliente CRM.
    expect((getClienteById(cliente.id) as any).ficEntityId).toBe(5150);
    expect(
      (await evento(SEDE, fattura.id, "cliente_fic")).payload
    ).toMatchObject({ ficEntityId: 5150, creato: false });

    // Seconda passata: lo snapshot ha già l'id, nessuna ricerca.
    const b2 = banco(copioneFelice(esito.fattura));
    const ripresa = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: esito.fattura.revisione,
      ...b2.dip,
    });
    // Ripetizione sicura: su una fattura già completa l'unica chiamata
    // che resta è la riverifica dell'XML (una GET senza effetti: dopo un
    // giro in dry-run l'invio vero non deve partire alla cieca).
    expect(metodi(b2.registro)).toEqual(["verificaXml"]);
    expect(ripresa.passi.map(p => [p.passo, p.esito])).toEqual([
      ["validazione", "saltato"],
      ["cliente_fic", "saltato"],
      ["documento_fic", "saltato"],
      ["confronto_totali", "saltato"],
      ["xml", "fatto"],
      ["invio", "saltato"],
      ["archivio", "saltato"],
      ["documento_fascicolo", "saltato"],
      ["timeline", "fatto"], // la timeline è idempotente per costruzione
    ]);
    expect(ripresa.fattura.documentoId).toBe(esito.fattura.documentoId);
    expect(ripresa.fattura.eiErrore).toBeNull();
  });

  it("(c) totali diversi: si ferma in «in_emissione» e la ripresa non crea un secondo documento", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(
      copioneFelice(fattura, {
        creaDocumento: async () =>
          documentoFicDa(fattura, {
            amount_gross: fattura.totaleCent / 100 + 10,
          }),
      })
    );

    const primo = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    expect(primo.fattura.stato).toBe("in_emissione");
    expect(primo.fattura.ficDocumentId).toBe(FIC_DOCUMENT_ID);
    expect(primo.fattura.eiErrore).toContain("Totali FiC diversi dai nostri");
    expect(metodi(b.registro)).toEqual([
      "cercaClienti",
      "creaCliente",
      "creaDocumento",
    ]);
    expect(await tipiEvento(SEDE, fattura.id)).toEqual([
      "creata",
      "modificata",
      "emissione_avviata",
      "cliente_fic",
      "creata_fic",
      "errore_totali",
    ]);
    const errore = await evento(SEDE, fattura.id, "errore_totali");
    expect(errore.payload).toMatchObject({
      nostri: { totaleCent: fattura.totaleCent },
    });
    expect(primo.passi.map(p => [p.passo, p.esito])).toEqual([
      ["validazione", "fatto"],
      ["cliente_fic", "fatto"],
      ["documento_fic", "fatto"],
      ["confronto_totali", "errore"],
    ]);

    // Ripresa: il documento esiste già, si rilegge e si va avanti. La
    // revisione passata è quella vecchia di proposito: da «in_emissione»
    // il blocco ottimistico non si applica più (Ruling R1).
    const b2 = banco(
      copioneFelice(fattura, {
        leggiDocumento: async () => documentoFicDa(fattura),
      })
    );
    const secondo = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b2.dip,
    });

    expect(metodi(b2.registro)).toEqual([
      "leggiDocumento",
      "verificaXml",
      "inviaEInvoice",
      "scaricaXml",
      "scaricaPdf",
    ]);
    expect(secondo.fattura.stato).toBe("emessa");
    expect(secondo.fattura.numero).toBe("127/2026");
    expect(secondo.fattura.eiErrore).toBeNull();
    expect(secondo.passi.find(p => p.passo === "documento_fic")!.esito).toBe(
      "saltato"
    );
  });

  it("(d) XML non valido: la fattura resta «emessa» e non parte nessun invio", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(
      copioneFelice(fattura, {
        verificaXml: async () => ({
          success: false,
          errori: ["00305: CodiceDestinatario non valido"],
        }),
      })
    );

    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    expect(esito.fattura.stato).toBe("emessa");
    expect(esito.fattura.inviataDryRun).toBe(false);
    expect(esito.fattura.eiErrore).toContain("CodiceDestinatario non valido");
    expect(metodi(b.registro)).not.toContain("inviaEInvoice");
    expect(
      (await evento(SEDE, fattura.id, "xml_errore")).payload
    ).toMatchObject({ errori: ["00305: CodiceDestinatario non valido"] });
    expect(esito.passi.at(-1)).toMatchObject({ passo: "xml", esito: "errore" });
  });

  it("(e) dry-run spento: la fattura passa a «inviata»", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(copioneFelice(fattura), { dryRun: false });

    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    expect(esito.fattura.stato).toBe("inviata");
    expect(esito.fattura.inviataDryRun).toBe(false);
    expect(
      b.registro.find(c => c.metodo === "inviaEInvoice")!.body
    ).toMatchObject({ opzioni: { dry_run: false } });
    expect((await evento(SEDE, fattura.id, "inviata")).payload).toMatchObject({
      dryRun: false,
      date: "2026-09-04",
    });
  });

  it("(f) archivio PDF fallito: la fattura resta emessa, l'errore è solo un evento", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(
      copioneFelice(fattura, {
        scaricaPdf: async () => {
          throw new Error("Download PDF fattura fallito (HTTP 502).");
        },
      })
    );

    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    expect(esito.fattura.stato).toBe("emessa");
    expect(esito.fattura.inviataDryRun).toBe(true);
    expect(esito.fattura.xmlStorageKey).toContain("fatture_xml/");
    expect(esito.fattura.pdfStorageKey).toBeNull();
    expect(esito.fattura.documentoId).toBeNull();
    expect(esito.fattura.eiErrore).toContain("Download PDF fattura fallito");
    expect(
      (await evento(SEDE, fattura.id, "pdf_archiviato")).payload
    ).toMatchObject({ errore: "Download PDF fattura fallito (HTTP 502)." });
    expect(esito.passi.find(p => p.passo === "archivio")!.esito).toBe("errore");
    expect(
      esito.passi.find(p => p.passo === "documento_fascicolo")!.esito
    ).toBe("errore");
  });

  it("riarchivio riuscito dopo un fallimento del PDF azzera eiErrore", async () => {
    const { fattura } = await bozzaEmettibile();
    const rotto = banco(
      copioneFelice(fattura, {
        scaricaPdf: async () => {
          throw new Error("Download PDF fattura fallito (HTTP 502).");
        },
      })
    );
    const primo = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...rotto.dip,
    });
    expect(primo.fattura.eiErrore).toContain("PDF non archiviato");

    // Secondo giro con lo storage in salute: quello che era rimasto da
    // fare si fa, e l'errore del giro prima non deve sopravvivergli.
    const sano = banco(copioneFelice(primo.fattura));
    const secondo = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: primo.fattura.revisione,
      ...sano.dip,
    });

    expect(secondo.fattura.eiErrore).toBeNull();
    expect(secondo.fattura.pdfStorageKey).toContain("fatture_pdf/");
    expect(secondo.fattura.documentoId).not.toBeNull();
    expect(secondo.passi.find(p => p.passo === "archivio")).toMatchObject({
      esito: "fatto",
      dettaglio: "1 file archiviati",
    });
    expect(
      secondo.passi.find(p => p.passo === "documento_fascicolo")!.esito
    ).toBe("fatto");
    // L'XML era già a posto: non si riscarica.
    expect(metodi(sano.registro)).not.toContain("scaricaXml");
  });

  it("(g) validazione fallita: PRECONDIZIONE, stato invariato, nessuna chiamata a FiC", async () => {
    // Nessuna configurazione di sede e markup negativo: la bozza non è emettibile.
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({
      sedeId: SEDE,
      commessaId,
      actorUserId: ATTORE,
      ...dipServizio(),
    });
    const b = banco(copioneFelice(fattura));

    await expect(
      emettiFattura({
        sedeId: SEDE,
        id: fattura.id,
        actorUserId: ATTORE,
        revisione: fattura.revisione,
        ...b.dip,
      })
    ).rejects.toThrow("PRECONDIZIONE:");

    expect(b.registro).toEqual([]);
    const dopo = await repository.perId(SEDE, fattura.id);
    expect(dopo!.stato).toBe("bozza");
    expect(dopo!.revisione).toBe(fattura.revisione);
    expect(await tipiEvento(SEDE, fattura.id)).toEqual(["creata"]);
  });

  it("(h) revisione superata: CONFLITTO prima di toccare Fatture in Cloud", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(copioneFelice(fattura));

    await expect(
      emettiFattura({
        sedeId: SEDE,
        id: fattura.id,
        actorUserId: ATTORE,
        revisione: fattura.revisione - 1,
        ...b.dip,
        // Una richiesta già superata non deve nemmeno far rinnovare un
        // token: se il contesto FiC viene risolto, il test lo dice.
        contesto: async () => {
          throw new Error("contesto FiC risolto per una revisione vecchia");
        },
      })
    ).rejects.toThrow("CONFLITTO:");

    expect(b.registro).toEqual([]);
    expect((await repository.perId(SEDE, fattura.id))!.stato).toBe("bozza");
  });

  // ── Il lease (Ruling R35) ─────────────────────────────────────────────
  // Due chiamate sovrapposte sulla stessa fattura — doppio click da due
  // schede, ricarica della pagina, un secondo amministratore — non devono
  // mai arrivare entrambe a `creaDocumento`: sarebbero due numeri fiscali
  // veri, che su Fatture in Cloud non si cancellano.
  //
  // Il montaggio: `contesto` (l'ultimo await prima del lease) parcheggia
  // le due run finché entrambe hanno letto la stessa revisione; poi le
  // sblocca insieme. Esito scelto: chi perde riceve SEMPRE `CONFLITTO`,
  // anche se il lease è già stato consumato — ha in mano una revisione
  // superata e deve ricaricare, non proseguire alla cieca su uno stato
  // che non ha letto.
  function cancelloContesto(quante: number): {
    contesto: () => Promise<{ companyId: number; token: string }>;
    entrambeInAttesa: () => Promise<void>;
    sblocca: () => void;
  } {
    let arrivate = 0;
    let apri: () => void = () => {};
    const cancello = new Promise<void>(resolve => {
      apri = resolve;
    });
    return {
      contesto: async () => {
        arrivate++;
        await cancello;
        return { companyId: 77, token: "token-finto" };
      },
      entrambeInAttesa: () => vi.waitFor(() => expect(arrivate).toBe(quante)),
      sblocca: () => apri(),
    };
  }

  it("due emissioni sovrapposte sulla stessa bozza: un solo documento FiC, l'altra riceve CONFLITTO", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(copioneFelice(fattura));
    const cancello = cancelloContesto(2);
    const dip = { ...b.dip, contesto: cancello.contesto };
    const avvia = () =>
      emettiFattura({
        sedeId: SEDE,
        id: fattura.id,
        actorUserId: ATTORE,
        revisione: fattura.revisione,
        ...dip,
      });

    const prima = avvia();
    const seconda = avvia();
    await cancello.entrambeInAttesa();
    cancello.sblocca();
    const esiti = await Promise.allSettled([prima, seconda]);

    const respinte = esiti.filter(e => e.status === "rejected");
    expect(esiti.filter(e => e.status === "fulfilled")).toHaveLength(1);
    expect(respinte).toHaveLength(1);
    expect(
      String((respinte[0] as PromiseRejectedResult).reason?.message)
    ).toMatch(/^CONFLITTO/);

    expect(metodi(b.registro).filter(m => m === "creaDocumento")).toEqual([
      "creaDocumento",
    ]);
    const salvata = await repository.perId(SEDE, fattura.id);
    expect(salvata!.ficDocumentId).toBe(FIC_DOCUMENT_ID);
    // Un solo `emissione_avviata`: il lease è stato preso una volta sola.
    expect(
      (await tipiEvento(SEDE, fattura.id)).filter(
        t => t === "emissione_avviata"
      )
    ).toHaveLength(1);
  });

  it("due riprese sovrapposte da «in_emissione»: il lease vale anche lì", async () => {
    const { fattura } = await bozzaEmettibile();
    // Lo stato che resta se il processo muore dopo il lease e prima di
    // `creaDocumento`: in emissione, ancora senza documento su FiC.
    const interrotta = await repository.aggiornaStato({
      sedeId: SEDE,
      id: fattura.id,
      patch: { stato: "in_emissione" },
      atteso: { stato: fattura.stato, revisione: fattura.revisione },
      now: ora,
    });
    const b = banco(copioneFelice(fattura));
    const cancello = cancelloContesto(2);
    const dip = { ...b.dip, contesto: cancello.contesto };
    const avvia = () =>
      emettiFattura({
        sedeId: SEDE,
        id: fattura.id,
        actorUserId: ATTORE,
        revisione: interrotta.revisione,
        ...dip,
      });

    const prima = avvia();
    const seconda = avvia();
    await cancello.entrambeInAttesa();
    cancello.sblocca();
    const esiti = await Promise.allSettled([prima, seconda]);

    expect(esiti.filter(e => e.status === "fulfilled")).toHaveLength(1);
    const respinte = esiti.filter(e => e.status === "rejected");
    expect(respinte).toHaveLength(1);
    expect(
      String((respinte[0] as PromiseRejectedResult).reason?.message)
    ).toMatch(/^CONFLITTO/);
    expect(metodi(b.registro).filter(m => m === "creaDocumento")).toEqual([
      "creaDocumento",
    ]);
    expect((await repository.perId(SEDE, fattura.id))!.ficDocumentId).toBe(
      FIC_DOCUMENT_ID
    );
  });

  it("(i) fattura di un'altra sede: NOT_FOUND, mai un indizio che esista", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(copioneFelice(fattura));

    await expect(
      emettiFattura({
        sedeId: ALTRA_SEDE,
        id: fattura.id,
        actorUserId: ATTORE,
        revisione: fattura.revisione,
        ...b.dip,
      })
    ).rejects.toThrow("NOT_FOUND: Fattura non trovata.");
    expect(b.registro).toEqual([]);
  });

  it("FiC restituisce meno scadenze delle nostre: collegamento parziale, dichiarato", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(
      copioneFelice(fattura, {
        creaDocumento: async () =>
          documentoFicDa(fattura, {
            payments_list: [
              {
                id: 9000,
                amount: fattura.totaleCent / 100,
                due_date: fattura.scadenze[0].data,
              },
            ],
          }),
      })
    );

    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    // L'emissione va avanti (la fattura su FiC è quella giusta), ma il
    // collegamento parziale non resta muto.
    expect(esito.fattura.stato).toBe("emessa");
    expect(esito.fattura.scadenze.map(s => s.ficPaymentId)).toEqual([
      9000,
      null,
      null,
    ]);
    const messaggio =
      "FiC ha restituito 1 scadenze, il CRM ne ha 3: verifica il piano di pagamento.";
    expect(esito.passi.find(p => p.passo === "documento_fic")!.dettaglio).toBe(
      `127/2026 · ${messaggio}`
    );
    expect(esito.fattura.eiErrore).toBe(messaggio);
  });

  it("interruzione dopo la creazione del documento: la ripresa riappaia i ficPaymentId", async () => {
    const { fattura } = await bozzaEmettibile();
    // Lo stato che resterebbe se il processo morisse fra `creaDocumento` e
    // l'appaiamento: documento su FiC, scadenze ancora scollegate.
    const interrotta = await repository.aggiornaStato({
      sedeId: SEDE,
      id: fattura.id,
      patch: {
        stato: "in_emissione",
        ficDocumentId: FIC_DOCUMENT_ID,
        numero: "127/2026",
        data: "2026-09-04",
        revisione: fattura.revisione + 1,
      },
      now: ora,
    });
    expect(interrotta.scadenze.map(s => s.ficPaymentId)).toEqual([
      null,
      null,
      null,
    ]);

    const b = banco(
      copioneFelice(fattura, {
        leggiDocumento: async () => documentoFicDa(fattura),
      })
    );
    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: interrotta.revisione,
      ...b.dip,
    });

    expect(metodi(b.registro)).not.toContain("creaDocumento");
    expect(esito.fattura.scadenze.map(s => s.ficPaymentId)).toEqual([
      9000, 9001, 9002,
    ]);
    expect(esito.passi.find(p => p.passo === "documento_fic")!.dettaglio).toBe(
      `già creato (#${FIC_DOCUMENT_ID}) · 3 scadenze riappaiate`
    );
    expect(esito.fattura.stato).toBe("emessa");
    expect(esito.fattura.eiErrore).toBeNull();
  });

  it("scadenze scollegate su una fattura già emessa: si riprova a ogni giro finché non tornano", async () => {
    const { fattura } = await bozzaEmettibile();
    const unSoloPagamento = [
      {
        id: 9000,
        amount: fattura.totaleCent / 100,
        due_date: fattura.scadenze[0].data,
      },
    ];

    // Giro 1: FiC restituisce una scadenza sola e il PDF non si scarica.
    const primo = banco(
      copioneFelice(fattura, {
        creaDocumento: async () =>
          documentoFicDa(fattura, { payments_list: unSoloPagamento }),
        scaricaPdf: async () => {
          throw new Error("Download PDF fattura fallito (HTTP 502).");
        },
      })
    );
    const g1 = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...primo.dip,
    });
    expect(g1.fattura.stato).toBe("emessa");
    expect(g1.fattura.scadenze.map(s => s.ficPaymentId)).toEqual([
      9000,
      null,
      null,
    ]);
    expect(g1.fattura.eiErrore).toContain("FiC ha restituito 1 scadenze");
    expect(g1.fattura.eiErrore).toContain("PDF non archiviato");

    // Giro 2: il PDF si archivia, ma FiC insiste con una scadenza sola.
    // L'archivio riuscito non deve cancellare il disallineamento, e la
    // fattura non è più «in_emissione»: il riappaiamento si tenta lo
    // stesso (Ruling R12).
    const secondo = banco(
      copioneFelice(g1.fattura, {
        leggiDocumento: async () =>
          documentoFicDa(fattura, { payments_list: unSoloPagamento }),
      })
    );
    const g2 = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: g1.fattura.revisione,
      ...secondo.dip,
    });
    expect(metodi(secondo.registro)).toContain("leggiDocumento");
    expect(g2.fattura.pdfStorageKey).toContain("fatture_pdf/");
    expect(g2.fattura.documentoId).not.toBeNull();
    expect(g2.fattura.eiErrore).toContain("FiC ha restituito 1 scadenze");
    expect(g2.fattura.eiErrore).not.toContain("PDF non archiviato");
    expect(g2.passi.find(p => p.passo === "documento_fic")!.dettaglio).toBe(
      `già creato (#${FIC_DOCUMENT_ID}) · riappaiamento tentato · ` +
        "FiC ha restituito 1 scadenze, il CRM ne ha 3: verifica il piano di pagamento."
    );

    // Giro 3: FiC restituisce il piano completo. Le due scadenze rimaste
    // si collegano e l'avviso sparisce perché non è più vero.
    const terzo = banco(
      copioneFelice(g2.fattura, {
        leggiDocumento: async () => documentoFicDa(fattura),
      })
    );
    const g3 = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: g2.fattura.revisione,
      ...terzo.dip,
    });
    expect(g3.fattura.scadenze.map(s => s.ficPaymentId)).toEqual([
      9000, 9001, 9002,
    ]);
    expect(g3.fattura.eiErrore).toBeNull();
    expect(g3.passi.find(p => p.passo === "documento_fic")!.dettaglio).toBe(
      `già creato (#${FIC_DOCUMENT_ID}) · 2 scadenze riappaiate`
    );

    // Giro 4: tutto appaiato, nessuna rilettura del documento.
    const quarto = banco(copioneFelice(g3.fattura));
    const g4 = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: g3.fattura.revisione,
      ...quarto.dip,
    });
    expect(metodi(quarto.registro)).toEqual(["verificaXml"]);
    expect(g4.passi.find(p => p.passo === "documento_fic")!.dettaglio).toBe(
      `già creato (#${FIC_DOCUMENT_ID})`
    );
    expect(g4.fattura.eiErrore).toBeNull();
  });

  it("senza numerazione FiC il numero si compone con l'anno della data", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(
      copioneFelice(fattura, {
        creaDocumento: async () =>
          documentoFicDa(fattura, {
            number: 128,
            numeration: null,
            date: "2026-12-31",
          }),
      })
    );

    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    expect(esito.fattura.numero).toBe("128/2026");
    expect(esito.fattura.data).toBe("2026-12-31");
    expect(b.files.map(x => x.nome)).toEqual(["128-2026.xml", "128-2026.pdf"]);
  });

  // La data della fattura è il giorno di calendario ITALIANO, non quello
  // UTC: alle 00:30 di Sarzana l'UTC è ancora ieri, e una fattura emessa
  // il primo dell'anno nascerebbe datata 31 dicembre — anno fiscale
  // sbagliato, numerazione sbagliata.
  it("la data del documento segue Europe/Rome, non UTC", async () => {
    const { fattura } = await bozzaEmettibile();
    const capodanno = new Date("2026-12-31T23:30:00Z");
    const b = banco(copioneFelice(fattura));

    await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
      now: () => capodanno,
    });

    const creazione = b.registro.find(c => c.metodo === "creaDocumento")!;
    expect((creazione.body as any).documento.date).toBe("2027-01-01");
  });

  it("un omonimo con codice fiscale diverso non è il nostro cliente: si crea lo stesso", async () => {
    const { fattura } = await bozzaEmettibile();
    const b = banco(
      copioneFelice(fattura, {
        cercaClienti: async () => [
          {
            id: 6001,
            name: "Rossi Mario",
            tax_code: "RSSMRA85T10A562X",
            vat_number: null,
          },
        ],
      })
    );

    const esito = await emettiFattura({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      revisione: fattura.revisione,
      ...b.dip,
    });

    expect(metodi(b.registro).slice(0, 2)).toEqual([
      "cercaClienti",
      "creaCliente",
    ]);
    expect(esito.fattura.clienteSnapshot!.ficEntityId).toBe(FIC_ENTITY_NUOVO);
    expect(
      (await evento(SEDE, fattura.id, "cliente_fic")).payload
    ).toMatchObject({ creato: true });
  });
});

describe("costruisciDocumentoFic", () => {
  it("(j) la bozza del caso 127 diventa il documento FiC della fattura vera", async () => {
    // Pattuito e markup della 127/2026 reale: beni significativi 8847,46,
    // prestazione 4798,59 → storno 4798,59 (fixture fatture-reali.json).
    const { fattura, commessaId } = await bozzaEmettibile(
      { pattuitoCent: PATTUITO_REALE },
      SEDE,
      132359
    );
    expect(fattura.totaleCent).toBe(PATTUITO_REALE);
    expect(fattura.stornoCent).toBe(479859);

    const commessa: any = getCommessaById(commessaId);
    const documento = costruisciDocumentoFic(
      fattura,
      CONFIG_COMPLETA(),
      FIC_ENTITY_NUOVO,
      commessa.codice,
      "2026-09-04"
    );

    expect(documento.type).toBe("invoice");
    expect(documento.entity).toEqual({ id: FIC_ENTITY_NUOVO });
    expect(documento.visible_subject).toBe(commessa.codice);
    expect(documento.date).toBe("2026-09-04");
    expect(documento.e_invoice).toBe(true);
    expect(documento.ei_data).toMatchObject({
      payment_method: "MP05",
      bank_iban: "IT60X0542811101000000123456",
      bank_name: "BPM",
      bank_beneficiary: "Ruffino Group Srl",
    });

    // Lo storno è l'unica riga negativa, al 22 %; il riaddebito la specchia al 10 %.
    const storno = documento.items_list.find(
      i => i.name === DICITURE.storno_bs
    )!;
    expect(storno.net_price).toBe(-4798.59);
    expect(storno.vat).toEqual({ id: 3 });
    expect(storno.qty).toBe(1);
    const riaddebito = documento.items_list.find(
      i => i.name === DICITURE.riaddebito_bs
    )!;
    expect(riaddebito.net_price).toBe(4798.59);
    expect(riaddebito.vat).toEqual({ id: 9 });
    const markup = documento.items_list.find(i => i.name === DICITURE.markup)!;
    expect(markup.net_price).toBe(1323.59);
    expect(markup.vat).toEqual({ id: 9 });
    expect(documento.items_list.filter(i => i.net_price < 0)).toHaveLength(1);

    // Le intestazioni restano righe descrittive a importo zero (IVA 22 %);
    // le note del computo non sono righe, finiscono in `notes`.
    const intestazione = documento.items_list[0];
    expect(intestazione.name).toBe(DICITURE.intestazione);
    expect(intestazione.description).toBe(DICITURE.seguira_ddt);
    expect(intestazione.net_price).toBe(0);
    expect(intestazione.vat).toEqual({ id: 3 });
    expect(
      documento.items_list.some(i => i.name.startsWith("Calcolo limite"))
    ).toBe(false);
    expect(documento.notes).toContain("Calcolo limite massimo spesa");

    // Le voci con importo sommano all'imponibile della fattura.
    const somma = documento.items_list.reduce(
      (s, i) => s + Math.round(i.net_price * 100),
      0
    );
    expect(somma).toBe(fattura.imponibileCent);

    // Scadenze → payments_list: somma 15496,52, conto di pagamento configurato.
    expect(documento.payments_list).toHaveLength(3);
    expect(
      Math.round(
        documento.payments_list.reduce((s, p) => s + p.amount, 0) * 100
      )
    ).toBe(1549652);
    expect(documento.payments_list[0]).toMatchObject({
      status: "not_paid",
      payment_account: { id: 5 },
      due_date: fattura.scadenze[0].data,
    });
  });

  it("senza conto di pagamento configurato la scadenza non lo dichiara", async () => {
    const { fattura } = await bozzaEmettibile();
    const documento = costruisciDocumentoFic(
      fattura,
      { ...CONFIG_COMPLETA(), paymentAccountIdFic: null, numerazioneFic: "/B" },
      1,
      "COM-2026-001",
      "2026-09-04"
    );
    expect(documento.payments_list[0].payment_account).toBeUndefined();
    expect(documento.numeration).toBe("/B");
  });

  it("una numerazione che non è una numerazione FiC (es. l'anno) non viene mandata: FiC la rifiuterebbe con 422", async () => {
    const { fattura } = await bozzaEmettibile();
    for (const valore of ["2026", "B", " ", null]) {
      const documento = costruisciDocumentoFic(fattura, { ...CONFIG_COMPLETA(), numerazioneFic: valore }, 1, "COM-2026-001", "2026-09-04");
      expect(documento.numeration, `numerazione ${JSON.stringify(valore)}`).toBeUndefined();
    }
  });
});

describe("costruisciClienteFic", () => {
  it("privato: persona con cognome e nome separati al primo spazio", async () => {
    const { fattura } = await bozzaEmettibile();
    const cliente = costruisciClienteFic(fattura.clienteSnapshot!);
    expect(cliente).toMatchObject({
      type: "person",
      name: "Rossi Mario",
      last_name: "Rossi",
      first_name: "Mario",
      tax_code: "RSSMRA85T10A562S",
      vat_number: null,
      address_street: "Via Alta 80",
      address_postal_code: "19038",
      address_city: "Sarzana",
      address_province: "SP",
      country: "Italia",
      ei_code: "0000000",
      e_invoice: true,
    });
  });

  it("privato con un nome solo: company, perché FiC rifiuta una persona senza nome proprio", () => {
    const cliente = costruisciClienteFic({
      clienteId: 9,
      nome: "Rossi",
      tipo: "privato",
      codiceFiscale: "RSSMRA85T10A562S",
      partitaIva: null,
      indirizzo: "Via Alta 80",
      cap: "19038",
      citta: "Sarzana",
      provincia: "SP",
      email: null,
      pec: null,
      codiceDestinatario: "0000000",
      ficEntityId: null,
    });
    expect(cliente.type).toBe("company");
    expect(cliente.name).toBe("Rossi");
    expect(cliente.first_name).toBeUndefined();
    expect(cliente.tax_code).toBe("RSSMRA85T10A562S");
  });

  it("azienda: ragione sociale indivisa, P.IVA e recapito SdI", () => {
    const cliente = costruisciClienteFic({
      clienteId: 3,
      nome: "Serramenti Alfa Srl",
      tipo: "azienda",
      codiceFiscale: "01234567890",
      partitaIva: "01234567890",
      indirizzo: "Via Industria 4",
      cap: "19038",
      citta: "Sarzana",
      provincia: "SP",
      email: "info@alfa.test",
      pec: "alfa@pec.test",
      codiceDestinatario: "ABC1234",
      ficEntityId: null,
    });
    expect(cliente).toMatchObject({
      type: "company",
      name: "Serramenti Alfa Srl",
      vat_number: "01234567890",
      tax_code: "01234567890",
      certified_email: "alfa@pec.test",
      ei_code: "ABC1234",
    });
    expect(cliente.first_name).toBeUndefined();
  });
});

describe("noteFattura", () => {
  it("mette in fila diciture, cantiere, nota del computo, note libere e footer", async () => {
    const { fattura } = await bozzaEmettibile();
    const testo = noteFattura(fattura, CONFIG_COMPLETA());
    expect(testo).toContain(DICITURE.intervento_manutenzione);
    expect(testo).toContain(DICITURE.bonifico_ristrutturazione);
    expect(testo).toContain(
      "Intervento da effettuare presso Via Alta 80 Sarzana"
    );
    expect(testo).toContain("Calcolo limite massimo spesa");
    expect(testo.trimEnd().endsWith("Grazie per la fiducia.")).toBe(true);
  });
});
