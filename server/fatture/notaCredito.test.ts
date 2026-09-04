// server/fatture/notaCredito.test.ts
// La nota di credito sul caso reale 127/2026 (stessa fixture e stessa
// convenzione di servizio.test.ts ed emissione.test.ts): contratto e
// computo veri, repository in memoria, client FiC finto a copione per il
// solo test che attraversa `emettiFattura` — nessuna rete.
//
// Pattuito e markup della 127/2026 REALE (fixture `fatture-reali.json`,
// v. emissione.test.ts test "(j)"): beni significativi 8847,46,
// prestazione 4798,59 → storno 4798,59, markup 1323,59. Con questi
// numeri il riepilogo della fattura vera è 22 % 4.048,87/890,75 e
// 10 % 9.597,18/959,72, totale 15.496,52 — gli stessi che la nota di
// credito totale deve specchiare esattamente.
import { beforeEach, describe, expect, it } from "vitest";
import type { ContrattoInput, RigaContrattoInput } from "@shared/limiti/tipi";
import type { Fattura, FatturazioneConfig } from "@shared/fatturazione/tipi";
import casi from "../computo/__fixtures__/casi-reali.json";
import { _resetComputiRepositoryForTests } from "../computo/repository";
import { eseguiComputo } from "../computo/servizio";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { salvaContratto } from "../contratti/servizio";
import type { DocumentoFicCreato } from "../fic/emissione";
import { creaClientFicFinto, type ChiamataFic } from "../fic/fake";
import { getClientiStore } from "../routers/clienti";
import { creaCommessa } from "../routers/commesse";
import { getDocumentoRecordById } from "../routers/preventiviContratti";
import { getUtentiStore } from "../routers/utenti";
import type { TrpcContext } from "../_core/context";
import { emettiFattura, type DipendenzeEmissione } from "./emissione";
import { creaNotaCredito } from "./notaCredito";
import { createMemoryFattureRepository, type FattureRepository } from "./repository";
import { aggiornaBozza, creaBozza } from "./servizio";

const SEDE = 1;
const ALTRA_SEDE = 2;
const ATTORE = 5601;
const ora = new Date("2026-09-04T10:00:00Z");
const PATTUITO = 1549472;
/** Il pattuito della fattura 127/2026 vera (fixture di `fatture-reali.json`, v. emissione.test.ts). */
const PATTUITO_REALE = 1549652;
const MARKUP_REALE = 132359;
const FIC_ENTITY_NUOVO = 4242;
const FIC_DOCUMENT_ID_FATTURA = 88123;
const FIC_DOCUMENT_ID_NOTA = 88124;

let repository: FattureRepository;
const dip = () => ({ repository, now: () => ora });

const ctx = (sedeId: number): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> =>
  ({
    user: { id: ATTORE, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "T" } as any,
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
  accessori: (r.accessori as string[]).map(codice => ({ codice, quantita: r.quantita })),
  note: null,
  origine: "manuale" as const,
  evidenza: null,
}));

const CONTRATTO_127 = (extra: Partial<ContrattoInput> = {}): ContrattoInput => ({
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
  scopeScritturaOk: true,
  scopeVerificatoAt: ora,
  updatedAt: ora,
});

let progressivoCliente = 0;
function nuovoCliente(sedeId = SEDE, extra: Record<string, unknown> = {}): any {
  const clienti = getClientiStore() as any[];
  const cliente = {
    id: 78000 + progressivoCliente++,
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
  const c: any = await creaCommessa(ctx(sedeId) as any, {
    clienteId: cliente.id,
    indirizzo: "Via Alta 80",
    citta: "Sarzana",
  } as any);
  return { commessaId: (c.commessa?.id ?? c.id) as number, cliente };
}

/** Commessa + contratto 127 + computo: la base di ogni scenario. */
async function scenario127(extra: Partial<ContrattoInput> = {}, sedeId = SEDE): Promise<{ commessaId: number; cliente: any }> {
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

/** Bozza pronta all'emissione: configurazione di sede completa e beni riequilibrati al markup dato. */
async function bozzaEmettibile(
  extra: Partial<ContrattoInput> = {},
  sedeId = SEDE,
  markupTargetCent = 0
): Promise<{ fattura: Fattura; commessaId: number; cliente: any }> {
  const { commessaId, cliente } = await scenario127(extra, sedeId);
  await repository.salvaConfig(CONFIG_COMPLETA(sedeId));
  const { fattura } = await creaBozza({ sedeId, commessaId, actorUserId: ATTORE, ...dip() });
  const esito = await aggiornaBozza({
    sedeId,
    id: fattura.id,
    revisione: fattura.revisione,
    actorUserId: ATTORE,
    modifica: { riequilibraBeniAMarkupCent: markupTargetCent },
    ...dip(),
  });
  return { fattura: esito.fattura, commessaId, cliente };
}

/** Porta una bozza allo stato «emessa» senza passare dalla pipeline FiC: per i test che non riguardano l'emissione. */
async function comeEmessa(fattura: Fattura, numero = "127/2026", data = "2026-09-04"): Promise<Fattura> {
  return repository.aggiornaStato({
    sedeId: fattura.sedeId,
    id: fattura.id,
    patch: { stato: "emessa", numero, data, emessaDa: ATTORE, emessaAt: ora },
    now: ora,
  });
}

// ── Copione FiC (solo per il test che attraversa emettiFattura) ────────
type Copione = Parameters<typeof creaClientFicFinto>[0];

const documentoFicDa = (f: Fattura, ficDocumentId: number, over: Partial<DocumentoFicCreato> = {}): DocumentoFicCreato => ({
  id: ficDocumentId,
  number: 127,
  numeration: "/2026",
  date: "2026-09-04",
  amount_net: f.imponibileCent / 100,
  amount_vat: f.ivaCent / 100,
  amount_gross: f.totaleCent / 100,
  url: "https://fatture.example.test/127.pdf",
  ei_status: null,
  payments_list: f.scadenze.map((s, i) => ({ id: 9000 + i, amount: s.importoCent / 100, due_date: s.data })),
  ...over,
});

const XML_FINTO = Buffer.from('<?xml version="1.0"?><FatturaElettronica/>', "utf-8");
const PDF_FINTO = Buffer.from("%PDF-1.4 finto\n%%EOF\n", "utf-8");

function copioneFelice(f: Fattura, ficDocumentId: number, over: Copione = {}): Copione {
  return {
    cercaClienti: async () => [],
    creaCliente: async () => ({ id: FIC_ENTITY_NUOVO }),
    creaDocumento: async () => documentoFicDa(f, ficDocumentId),
    verificaXml: async () => ({ success: true, errori: [] }),
    inviaEInvoice: async () => ({ name: "IT01234567890_00001.xml", date: "2026-09-04" }),
    scaricaXml: async () => XML_FINTO,
    scaricaPdf: async () => PDF_FINTO,
    ...over,
  };
}

function banco(copione: Copione): { dip: DipendenzeEmissione; registro: ChiamataFic[] } {
  const registro: ChiamataFic[] = [];
  const dipEmissione: DipendenzeEmissione = {
    repository,
    now: () => ora,
    client: creaClientFicFinto(copione, registro),
    contesto: async () => ({ companyId: 77, token: "token-finto" }),
    dryRun: () => true,
    storage: {
      putFile: async (collection, parentId, recordId, nome, buffer) => ({
        storageKey: `${collection}/${parentId}/${recordId}-finto`,
        checksum: "sha-finto",
      }),
    },
    timeline: () => 1,
    salvaFicEntityId: () => {},
  };
  return { dip: dipEmissione, registro };
}

beforeEach(() => {
  _resetContrattiRepositoryForTests();
  _resetComputiRepositoryForTests();
  repository = createMemoryFattureRepository();
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === ATTORE)) {
    utenti.push({ id: ATTORE, nome: "Timo", cognome: "Ruffino", ruolo: "direzione", ruoli: ["direzione"], sedeId: SEDE });
  }
});

describe("creaNotaCredito", () => {
  it("totale: specchio esatto della fattura 127 (caso reale), riepilogo e scadenza unica", async () => {
    const { fattura } = await bozzaEmettibile({ pattuitoCent: PATTUITO_REALE }, SEDE, MARKUP_REALE);
    const origine = await comeEmessa(fattura);
    expect(origine.totaleCent).toBe(PATTUITO_REALE);

    const { fattura: nota, avvertenze } = await creaNotaCredito({
      sedeId: SEDE,
      fatturaId: origine.id,
      actorUserId: ATTORE,
      selezione: { tipo: "totale" },
      ...dip(),
    });

    expect(avvertenze).toEqual([]);
    expect(nota.tipo).toBe("nota_credito");
    expect(nota.notaCreditoDi).toBe(origine.id);
    expect(nota.stato).toBe("bozza");
    expect(nota.sedeId).toBe(SEDE);
    expect(nota.commessaId).toBe(origine.commessaId);
    expect(nota.computoId).toBe(origine.computoId);
    expect(nota.hashRighe).toBe(origine.hashRighe);
    expect(nota.detrazioneTipo).toBe(origine.detrazioneTipo);
    expect(nota.pattuitoTipo).toBe(origine.pattuitoTipo);
    expect(nota.clienteSnapshot).toEqual(origine.clienteSnapshot);
    expect(nota.scavalcoLimiti).toBe(false);
    expect(nota.diciture).toEqual(["copia_ade"]);
    expect(nota.note).toBe(`Nota di credito a storno della fattura n. ${origine.numero} del ${origine.data}`);

    // Riepilogo IVA del caso reale 127/2026 (fixture fatture-reali.json).
    expect(nota.riepilogo).toEqual([
      { aliquota: 22, imponibileCent: 404887, impostaCent: 89075 },
      { aliquota: 10, imponibileCent: 959718, impostaCent: 95972 },
    ]);
    expect(nota.imponibileCent).toBe(404887 + 959718);
    expect(nota.ivaCent).toBe(89075 + 95972);
    expect(nota.totaleCent).toBe(PATTUITO_REALE);
    expect(nota.pattuitoCent).toBe(nota.totaleCent);
    expect(nota.deltaPattuitoCent).toBe(0);
    expect(nota.markupCent).toBe(origine.markupCent);
    expect(nota.stornoCent).toBe(origine.stornoCent);

    // Le righe sono lo specchio esatto dell'origine: stessi tipi, stessi
    // importi, segno compreso — lo storno beni significativi resta
    // negativo (è un trasferimento fra aliquote, non un importo in più).
    expect(nota.righe.map(r => ({ tipo: r.tipo, aliquota: r.aliquota, importoCent: r.importoCent }))).toEqual(
      origine.righe.map(r => ({ tipo: r.tipo, aliquota: r.aliquota, importoCent: r.importoCent }))
    );
    const storno = nota.righe.find(r => r.tipo === "storno_bs")!;
    expect(storno.importoCent).toBeLessThan(0);
    expect(storno.importoCent).toBe(-origine.stornoCent);

    expect(nota.scadenze).toHaveLength(1);
    expect(nota.scadenze[0]).toMatchObject({
      numero: 1,
      quotaPct: 100,
      data: "2026-09-04",
      importoCent: nota.totaleCent,
      descrizione: "storno",
    });

    const eventiOrigine = await repository.eventi(SEDE, origine.id);
    const eventoNotaCredito = eventiOrigine.find(e => e.tipo === "nota_credito")!;
    expect(eventoNotaCredito.payload).toEqual({ notaCreditoId: nota.id, tipo: "totale", totaleCent: nota.totaleCent });

    const eventiNota = await repository.eventi(SEDE, nota.id);
    const eventoCreata = eventiNota.find(e => e.tipo === "creata")!;
    expect(eventoCreata.payload).toMatchObject({ notaCreditoDi: origine.id, selezione: { tipo: "totale" } });
  });

  it("parziale: storno di due servizi (120 + 85 euro) — solo 10 %, nessuno storno beni significativi", async () => {
    const { fattura } = await bozzaEmettibile({ pattuitoCent: PATTUITO_REALE }, SEDE, MARKUP_REALE);
    const origine = await comeEmessa(fattura);
    const servizi = origine.righe.filter(r => r.tipo === "servizio");
    const rilievo = servizi.find(r => r.descrizione.startsWith("Rilievo misure"))!;
    const progettazione = servizi.find(r => r.descrizione.startsWith("Progettazione"))!;
    expect(rilievo.importoCent).toBeGreaterThanOrEqual(12000);
    expect(progettazione.importoCent).toBeGreaterThanOrEqual(8500);

    const { fattura: nota } = await creaNotaCredito({
      sedeId: SEDE,
      fatturaId: origine.id,
      actorUserId: ATTORE,
      selezione: {
        tipo: "parziale",
        righe: [
          { ordine: rilievo.ordine, importoCent: 12000 },
          { ordine: progettazione.ordine, importoCent: 8500 },
        ],
      },
      ...dip(),
    });

    expect(nota.righe).toHaveLength(2);
    expect(nota.righe.every(r => r.tipo === "servizio" && r.aliquota === 10)).toBe(true);
    expect(nota.righe.map(r => r.importoCent).sort((a, b) => a - b)).toEqual([8500, 12000]);
    expect(nota.righe.some(r => r.tipo === "storno_bs" || r.tipo === "riaddebito_bs")).toBe(false);

    expect(nota.riepilogo).toEqual([{ aliquota: 10, imponibileCent: 20500, impostaCent: 2050 }]);
    expect(nota.imponibileCent).toBe(20500);
    expect(nota.ivaCent).toBe(2050);
    expect(nota.totaleCent).toBe(22550);
    expect(nota.stornoCent).toBe(0);
    expect(nota.markupCent).toBe(0);
    expect(nota.scadenze).toEqual([
      expect.objectContaining({ numero: 1, quotaPct: 100, importoCent: 22550, descrizione: "storno" }),
    ]);
  });

  it("l'importo di una riga scelta non può superare l'originale", async () => {
    const { fattura } = await bozzaEmettibile({ pattuitoCent: PATTUITO_REALE }, SEDE, MARKUP_REALE);
    const origine = await comeEmessa(fattura);
    const rilievo = origine.righe.find(r => r.descrizione.startsWith("Rilievo misure"))!;

    await expect(
      creaNotaCredito({
        sedeId: SEDE,
        fatturaId: origine.id,
        actorUserId: ATTORE,
        selezione: { tipo: "parziale", righe: [{ ordine: rilievo.ordine, importoCent: rilievo.importoCent + 1 }] },
        ...dip(),
      })
    ).rejects.toThrow("VALIDAZIONE");
  });

  it("l'origine ancora in bozza non si può stornare", async () => {
    const { fattura } = await bozzaEmettibile();

    await expect(
      creaNotaCredito({ sedeId: SEDE, fatturaId: fattura.id, actorUserId: ATTORE, selezione: { tipo: "totale" }, ...dip() })
    ).rejects.toThrow("PRECONDIZIONE");
  });

  it("una seconda nota in bozza sulla stessa origine non si crea", async () => {
    const { fattura } = await bozzaEmettibile();
    const origine = await comeEmessa(fattura);
    await creaNotaCredito({ sedeId: SEDE, fatturaId: origine.id, actorUserId: ATTORE, selezione: { tipo: "totale" }, ...dip() });

    await expect(
      creaNotaCredito({ sedeId: SEDE, fatturaId: origine.id, actorUserId: ATTORE, selezione: { tipo: "totale" }, ...dip() })
    ).rejects.toThrow("PRECONDIZIONE");
  });

  it("una nota di credito si può riaprire dopo che la prima è stata annullata", async () => {
    const { fattura } = await bozzaEmettibile();
    const origine = await comeEmessa(fattura);
    const { fattura: prima } = await creaNotaCredito({
      sedeId: SEDE,
      fatturaId: origine.id,
      actorUserId: ATTORE,
      selezione: { tipo: "totale" },
      ...dip(),
    });
    await repository.aggiornaStato({ sedeId: SEDE, id: prima.id, patch: { stato: "annullata" }, now: ora });

    const { fattura: seconda } = await creaNotaCredito({
      sedeId: SEDE,
      fatturaId: origine.id,
      actorUserId: ATTORE,
      selezione: { tipo: "totale" },
      ...dip(),
    });
    expect(seconda.id).not.toBe(prima.id);
  });

  it("la fattura di un'altra sede non esiste", async () => {
    const { fattura } = await bozzaEmettibile();
    const origine = await comeEmessa(fattura);

    await expect(
      creaNotaCredito({ sedeId: ALTRA_SEDE, fatturaId: origine.id, actorUserId: ATTORE, selezione: { tipo: "totale" }, ...dip() })
    ).rejects.toThrow("NOT_FOUND: Fattura non trovata.");
  });
});

describe("nota di credito attraverso emettiFattura", () => {
  it("creaDocumento riceve type «credit_note» e il fascicolo registra tipo «nota_credito»", async () => {
    // Detrazione «nessuna»: isola il test sulla meccanica della pipeline,
    // senza intrecciarlo con cantiere/dicitura del bonifico parlante
    // (non toccati da questo task per la nota di credito).
    const { fattura: bozzaOrigine } = await bozzaEmettibile({ detrazioneTipo: "nessuna" });
    const bancoOrigine = banco(copioneFelice(bozzaOrigine, FIC_DOCUMENT_ID_FATTURA));
    const esitoOrigine = await emettiFattura({
      sedeId: SEDE,
      id: bozzaOrigine.id,
      actorUserId: ATTORE,
      revisione: bozzaOrigine.revisione,
      ...bancoOrigine.dip,
    });
    const origine = esitoOrigine.fattura;
    expect(origine.stato).toBe("emessa");
    expect(origine.ficDocumentId).toBe(FIC_DOCUMENT_ID_FATTURA);

    const { fattura: nota } = await creaNotaCredito({
      sedeId: SEDE,
      fatturaId: origine.id,
      actorUserId: ATTORE,
      selezione: { tipo: "totale" },
      ...dip(),
    });
    expect(nota.tipo).toBe("nota_credito");

    const bancoNota = banco(copioneFelice(nota, FIC_DOCUMENT_ID_NOTA));
    const esitoNota = await emettiFattura({
      sedeId: SEDE,
      id: nota.id,
      actorUserId: ATTORE,
      revisione: nota.revisione,
      ...bancoNota.dip,
    });

    const creaDocumento = bancoNota.registro.find(c => c.metodo === "creaDocumento")!;
    expect((creaDocumento.body as any).documento.type).toBe("credit_note");
    expect(esitoNota.fattura.stato).toBe("emessa");
    expect(esitoNota.fattura.ficDocumentId).toBe(FIC_DOCUMENT_ID_NOTA);

    expect(esitoNota.fattura.documentoId).not.toBeNull();
    const documento = getDocumentoRecordById(esitoNota.fattura.documentoId!)!;
    expect(documento.tipo).toBe("nota_credito");
    expect(documento.nome).toContain("Nota di credito");
  });
});
