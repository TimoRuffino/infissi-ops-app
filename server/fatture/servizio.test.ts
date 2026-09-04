// server/fatture/servizio.test.ts
// Il servizio della bozza sul caso reale 127/2026 (fixture del computo):
// contratto e computo veri, non finti, così i servizi proposti e i limiti
// sono i numeri del foglio. Pattuito 1549472 lordo, beni significativi
// 1199677, servizi proposti 347500, somma dei limiti delle opere 348008,
// massimale_A 1603976, limite del computo (min CHECK1/CHECK2) 1930728.
// Riequilibrato al markup reale della fattura 129 (215359): beni senza
// voce di computo 817926 (R25, `describe("verificaLimiti")`).
import { beforeEach, describe, expect, it } from "vitest";
import type { Computo, ContrattoInput, RigaContrattoInput } from "@shared/limiti/tipi";
import type { ClienteSnapshot, FatturazioneConfig } from "@shared/fatturazione/tipi";
import casi from "../computo/__fixtures__/casi-reali.json";
import { _resetComputiRepositoryForTests } from "../computo/repository";
import { eseguiComputo, ultimoComputo } from "../computo/servizio";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { salvaContratto } from "../contratti/servizio";
import { getClientiStore } from "../routers/clienti";
import { creaCommessa } from "../routers/commesse";
import type { TrpcContext } from "../_core/context";
import { createMemoryFattureRepository, type FattureRepository, type FatturaPersist } from "./repository";
import {
  aggiornaBozza,
  annullaBozza,
  creaBozza,
  fatturePerCommessa,
  leggiFattura,
  rigeneraBozza,
  validaPerEmissione,
  verificaLimiti,
} from "./servizio";

const SEDE = 1;
const ALTRA_SEDE = 2;
const ATTORE = 5;
const ora = new Date("2026-09-04T10:00:00Z");
const PATTUITO = 1549472;
const BENI_SIGNIFICATIVI = 1199677;
const SERVIZI_PROPOSTI = 347500;

let repository: FattureRepository;
const dip = () => ({ repository, now: () => ora });

const ctx = (sedeId: number): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> => ({
  user: { id: ATTORE, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "T" } as any,
  sedeId,
  sediIds: [sedeId],
});

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
  comuneCantiere: "Sarzana", // → zona climatica D
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

const CONFIG_COMPLETA = (): FatturazioneConfig => ({
  sedeId: SEDE,
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
  scopeVerificatoAt: ora,
  updatedAt: ora,
});

function nuovoCliente(sedeId = SEDE, extra: Record<string, unknown> = {}): any {
  const clienti = getClientiStore() as any[];
  const cliente = {
    id: 9400 + clienti.length,
    sedeId,
    nome: "Mario",
    cognome: "Rossi",
    tipo: "privato",
    codiceFiscale: "RSSMRA85T10A562S",
    indirizzo: "Via Alta 80",
    cap: "19038",
    citta: "Sarzana (SP)",
    cittaLavoro: "Sarzana",
    commesseIds: [],
    createdAt: ora,
    updatedAt: ora,
    ...extra,
  };
  clienti.push(cliente);
  return cliente;
}

async function nuovaCommessa(sedeId = SEDE, cliente = nuovoCliente(sedeId)): Promise<number> {
  const c: any = await creaCommessa(ctx(sedeId) as any, {
    clienteId: cliente.id,
    indirizzo: "Via Alta 80",
    citta: "Sarzana",
  } as any);
  return c.commessa?.id ?? c.id;
}

/** Commessa + contratto del caso 127 + computo eseguito: il punto di partenza di quasi ogni test. */
async function scenario127(
  extra: Partial<ContrattoInput> = {},
  sedeId = SEDE
): Promise<{ commessaId: number; computoId: number }> {
  const commessaId = await nuovaCommessa(sedeId);
  await salvaContratto({
    sedeId,
    commessaId,
    actorUserId: ATTORE,
    now: ora,
    contratto: CONTRATTO_127(extra),
    righe: RIGHE_127,
  });
  const computo = await eseguiComputo({ sedeId, commessaId, actorUserId: ATTORE, now: ora });
  return { commessaId, computoId: computo.id };
}

const importo = (f: { righe: Array<{ voceComputoCodice: string | null; importoCent: number }> }, codice: string) =>
  f.righe.find(r => r.voceComputoCodice === codice)!.importoCent;
const ordineDi = (f: { righe: Array<{ voceComputoCodice: string | null; ordine: number }> }, codice: string) =>
  f.righe.find(r => r.voceComputoCodice === codice)!.ordine;
const codici = (controlli: Array<{ codice: string }>) => controlli.map(c => c.codice);
const errori = (controlli: Array<{ codice: string; esito: string }>) =>
  controlli.filter(c => c.esito === "errore").map(c => c.codice);

beforeEach(() => {
  _resetContrattiRepositoryForTests();
  _resetComputiRepositoryForTests();
  repository = createMemoryFattureRepository();
});

describe("creaBozza", () => {
  it("nasce dal contratto e dal computo, con snapshot cliente ed evento «creata»", async () => {
    const { commessaId, computoId } = await scenario127();
    const { fattura, avvertenze } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });

    expect(fattura.stato).toBe("bozza");
    expect(fattura.tipo).toBe("fattura");
    expect(fattura.computoId).toBe(computoId);
    expect(fattura.pattuitoCent).toBe(PATTUITO);
    expect(fattura.pattuitoTipo).toBe("lordo");
    expect(fattura.detrazioneTipo).toBe("ristrutturazione");
    expect(fattura.hashRighe).toMatch(/^[0-9a-f]{64}$/);
    expect(fattura.numero).toBeNull();
    expect(fattura.revisione).toBe(1);

    // Beni dal contratto, servizi dal computo arrotondati per difetto ai 100 cent.
    const beni = fattura.righe.filter(r => r.tipo === "bene");
    expect(beni.map(r => r.importoCent)).toEqual([778373, 295082, 126222]);
    expect(beni.reduce((s, r) => s + r.importoCent, 0)).toBe(BENI_SIGNIFICATIVI);
    expect(importo(fattura, "posa")).toBe(131400); // limite 1314,00 esatto
    expect(importo(fattura, "rilievo_foro")).toBe(18000); // limite 180,51 → 180,00
    expect(fattura.righe.find(r => r.voceComputoCodice === "rilievo_foro")!.limiteCent).toBe(18051);
    expect(fattura.righe.filter(r => r.tipo === "servizio").reduce((s, r) => s + r.importoCent, 0)).toBe(SERVIZI_PROPOSTI);

    // Derivate dal risolutore: con i servizi al limite il markup è negativo.
    const markup = fattura.righe.find(r => r.tipo === "markup")!;
    expect(markup.derivata).toBe(true);
    expect(markup.importoCent).toBe(-259882);
    expect(fattura.markupCent).toBe(-259882);
    expect(fattura.stornoCent).toBe(0); // markup negativo: niente storno finché i conti non tornano
    expect(fattura.imponibileCent).toBe(1287295);
    expect(fattura.ivaCent).toBe(262177);
    expect(fattura.totaleCent).toBe(PATTUITO);
    expect(fattura.deltaPattuitoCent).toBe(0);
    expect(fattura.riepilogo).toEqual([
      { aliquota: 22, imponibileCent: 1112059, impostaCent: 244653 },
      { aliquota: 10, imponibileCent: 175236, impostaCent: 17524 },
    ]);

    expect(fattura.clienteSnapshot).toMatchObject({
      nome: "Rossi Mario",
      tipo: "privato",
      codiceFiscale: "RSSMRA85T10A562S",
      cap: "19038",
      citta: "Sarzana",
      provincia: "SP",
      codiceDestinatario: "0000000",
    });
    expect(fattura.intestazioneCantiere).toBe("Intervento da effettuare presso Via Alta 80 Sarzana");
    expect(fattura.diciture).toContain("bonifico_ristrutturazione");
    expect(fattura.scadenze.map(s => s.importoCent)).toEqual([774736, 619789, 154947]);
    expect(fattura.scadenze.reduce((s, x) => s + x.importoCent, 0)).toBe(PATTUITO);
    expect(fattura.scadenze.map(s => s.data)).toEqual(["2026-09-04", "2026-11-03", "2026-11-18"]);

    expect(avvertenze).toContain(
      "I servizi e gli altri beni superano il pattuito di € 2598,82: riduci i servizi o riequilibra i beni."
    );

    const letta = await leggiFattura(SEDE, fattura.id, dip());
    expect(letta!.eventi.map(e => e.tipo)).toEqual(["creata"]);
    expect(letta!.eventi[0].actorUserId).toBe(ATTORE);
    expect((letta!.eventi[0].payload as any).avvertenze).toEqual(avvertenze);
    // I controlli della lettura sono cliente + limiti, non la configurazione.
    expect(codici(letta!.controlli)).toEqual(["cliente", "markup_negativo"]);
  });

  it("rifiuta la seconda bozza, la commessa di altra sede e la commessa già fatturata", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });

    await expect(creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() })).rejects.toThrow(
      `PRECONDIZIONE: Esiste già una bozza per questa commessa (#${fattura.id}).`
    );

    const altra = await scenario127({}, ALTRA_SEDE);
    await expect(
      creaBozza({ sedeId: SEDE, commessaId: altra.commessaId, actorUserId: ATTORE, ...dip() })
    ).rejects.toThrow("NOT_FOUND: Commessa non trovata.");

    // Emessa: la seconda fattura sulla stessa commessa è una nota di credito.
    await repository.aggiornaStato({ sedeId: SEDE, id: fattura.id, patch: { stato: "emessa" }, now: ora });
    await expect(creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() })).rejects.toThrow(
      `PRECONDIZIONE: La commessa ha già la fattura #${fattura.id}: usa la nota di credito.`
    );
  });

  it("senza contratto: PRECONDIZIONE", async () => {
    const commessaId = await nuovaCommessa();
    await expect(creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() })).rejects.toThrow(
      "PRECONDIZIONE: Manca il contratto strutturato."
    );
  });

  it("computo non aggiornato: la bozza nasce senza computoId e con l'avvertenza", async () => {
    const { commessaId } = await scenario127();
    // Cambia un parametro dopo il computo: le righe (e quindi i beni) restano identiche.
    await salvaContratto({
      sedeId: SEDE,
      commessaId,
      actorUserId: ATTORE,
      now: ora,
      contratto: CONTRATTO_127({ piano: 3 }),
      righe: RIGHE_127,
    });
    const { fattura, avvertenze } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    expect(fattura.computoId).toBeNull();
    expect(avvertenze).toContain(
      "Computo non aggiornato alle righe correnti: ricalcola i limiti. (I parametri del contratto sono cambiati dopo il computo.)"
    );
    // I servizi ci sono comunque: il computo vecchio resta la migliore stima disponibile.
    expect(importo(fattura, "posa")).toBe(131400);
  });

  // R17 (fatture 92 e 106): con l'opzione attiva le spese di
  // documentazione sono un bene al 22 %, non un servizio al 10 %.
  it("R17: le spese di documentazione nascono fra i beni al 22 %, fuori dal confronto sui limiti dei servizi", async () => {
    const { commessaId } = await scenario127({
      opzioniComputo: { rilievo: "foro", speseProfessionali: true, eventuali: [] },
    });
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });

    const spese = fattura.righe.find(r => r.voceComputoCodice === "spese_professionali")!;
    expect(spese.tipo).toBe("bene");
    expect(spese.aliquota).toBe(22);
    expect(spese.beneSignificativo).toBe(true);
    expect(spese.importoCent).toBe(15000);
    expect(spese.limiteCent).toBe(60000);
    expect(fattura.righe.filter(r => r.tipo === "servizio").map(r => r.voceComputoCodice)).not.toContain(
      "spese_professionali"
    );
    expect(fattura.diciture).not.toContain("spese_professionali_escluse");

    // I 150 € entrano in B e quindi nel blocco al 22 % del riepilogo.
    const beniSignificativi = fattura.righe
      .filter(r => r.tipo === "bene" && r.beneSignificativo)
      .reduce((s, r) => s + r.importoCent, 0);
    expect(beniSignificativi).toBe(BENI_SIGNIFICATIVI + 15000);
    expect(fattura.riepilogo.find(r => r.aliquota === 22)!.imponibileCent).toBe(
      beniSignificativi - Math.min(beniSignificativi, fattura.markupCent + SERVIZI_PROPOSTI)
    );
    // I servizi al 10 % restano quelli del computo: il confronto sui
    // limiti non cambia (la riga al 22 % sta nel blocco beni).
    expect(fattura.righe.filter(r => r.tipo === "servizio").reduce((s, r) => s + r.importoCent, 0)).toBe(SERVIZI_PROPOSTI);
    // La spesa ha una voce di computo: esce dal blocco prodotti (R25) come
    // già usciva dal blocco servizi (R17) — resta solo il markup negativo.
    const { computo } = await ultimoComputo(SEDE, commessaId);
    expect(codici(verificaLimiti(fattura, computo))).toEqual(["markup_negativo"]);
  });
});

describe("aggiornaBozza", () => {
  it("modifica un servizio e un bene, ricalcola markup e derivate, rifà le scadenze sul nuovo totale", async () => {
    // Pattuito imponibile: qui il totale si muove con i beni (l'IVA cambia
    // col confronto B/P), mentre col pattuito lordo resta inchiodato a G.
    const { commessaId } = await scenario127({ pattuitoTipo: "imponibile" });
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    expect(fattura.markupCent).toBe(2295);
    expect(fattura.totaleCent).toBe(1806405);
    expect(fattura.scadenze.map(s => s.importoCent)).toEqual([903203, 722562, 180640]);

    const primoBene = fattura.righe.find(r => r.tipo === "bene")!;
    const esito = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: fattura.revisione,
      actorUserId: ATTORE,
      modifica: {
        righe: [
          { ordine: ordineDi(fattura, "posa"), importoCent: 100000 },
          { ordine: primoBene.ordine, importoCent: 700000, descrizione: "N.3 Portafinestra 2 ante (rinegoziata)" },
        ],
        note: "Concordato in showroom",
      },
      ...dip(),
    });

    const f = esito.fattura;
    expect(f.revisione).toBe(2);
    expect(f.note).toBe("Concordato in showroom");
    expect(importo(f, "posa")).toBe(100000);
    expect(f.righe.find(r => r.ordine === primoBene.ordine)!.descrizione).toBe("N.3 Portafinestra 2 ante (rinegoziata)");
    expect(f.righe.find(r => r.ordine === primoBene.ordine)!.prezzoUnitCent).toBe(700000);
    expect(f.righe.filter(r => r.tipo === "bene").reduce((s, r) => s + r.importoCent, 0)).toBe(1121304);

    // Derivate rigenerate dal risolutore, non riscritte a mano.
    expect(f.markupCent).toBe(112068);
    expect(f.righe.find(r => r.tipo === "markup")!.importoCent).toBe(112068);
    expect(f.stornoCent).toBe(428168);
    expect(f.righe.find(r => r.tipo === "storno_bs")!.importoCent).toBe(-428168);
    expect(f.righe.find(r => r.tipo === "riaddebito_bs")!.importoCent).toBe(428168);
    expect(f.righe.filter(r => r.derivata)).toHaveLength(3);
    expect(f.imponibileCent).toBe(1549472);
    expect(f.ivaCent).toBe(238124);
    expect(f.totaleCent).toBe(1787596);
    expect(f.riepilogo).toEqual([
      { aliquota: 22, imponibileCent: 693136, impostaCent: 152490 },
      { aliquota: 10, imponibileCent: 856336, impostaCent: 85634 },
    ]);

    // Totale cambiato e scadenze non passate: si rifanno dalle rate del contratto.
    expect(f.scadenze.map(s => s.importoCent)).toEqual([893798, 715038, 178760]);
    expect(f.scadenze.reduce((s, x) => s + x.importoCent, 0)).toBe(f.totaleCent);

    const letta = await leggiFattura(SEDE, f.id, dip());
    expect(letta!.eventi.map(e => e.tipo)).toEqual(["creata", "modificata"]);
    expect((letta!.eventi[1].payload as any).campi).toEqual(["righe", "note"]);
  });

  it("riequilibra i beni a markup 0 e poi a 100.000 cent: il risolutore torna al target", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    expect(fattura.markupCent).toBe(-259882);

    const a = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: fattura.revisione,
      actorUserId: ATTORE,
      modifica: { riequilibraBeniAMarkupCent: 0 },
      ...dip(),
    });
    expect(a.fattura.markupCent).toBe(0);
    expect(a.fattura.righe.filter(r => r.tipo === "bene").map(r => r.importoCent)).toEqual([642928, 243734, 104258]);
    expect(a.fattura.righe.filter(r => r.tipo === "bene").reduce((s, r) => s + r.importoCent, 0)).toBe(990920);
    expect(a.fattura.totaleCent).toBe(PATTUITO); // il pattuito lordo resta il totale
    expect(a.fattura.stornoCent).toBe(347500);
    expect(errori(a.controlli)).toEqual([]); // markup non più negativo, prestazioni entro i limiti

    const b = await aggiornaBozza({
      sedeId: SEDE,
      id: a.fattura.id,
      revisione: a.fattura.revisione,
      actorUserId: ATTORE,
      modifica: { riequilibraBeniAMarkupCent: 100000 },
      ...dip(),
    });
    expect(b.fattura.markupCent).toBe(100000);
    expect(Math.abs(b.fattura.markupCent - 100000)).toBeLessThanOrEqual(3);
    // Il riequilibrio parte dalle righe già riequilibrate sopra, non da
    // quelle del contratto: la ripartizione cumulativa ne risente di un
    // centesimo, la somma no.
    expect(b.fattura.righe.filter(r => r.tipo === "bene").map(r => r.importoCent)).toEqual([590810, 223976, 95806]);
    expect(b.fattura.righe.filter(r => r.tipo === "bene").reduce((s, r) => s + r.importoCent, 0)).toBe(910592);
    expect(b.fattura.totaleCent).toBe(PATTUITO);
    // R25: nessun errore. Il markup sta coi prodotti (910592 + 100000 =
    // 1010592 ≤ massimale_A 1603976), i servizi restano quelli proposti dal
    // computo (347500 ≤ 348008 di opere) e l'imponibile resta sotto il
    // limite del computo — prima della correzione R25 questo stesso caso
    // sommava servizi e markup (447500 > 348008) e dava `limite_totale` per
    // errore: è esattamente il bug del Task 6 che questo task corregge.
    expect(errori(b.controlli)).toEqual([]);
  });

  it("un servizio oltre il proprio limite: avviso sulla riga, errore sul blocco servizi", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    // Posa a 2000,00 (limite 1314,00) e markup portato a 100.000: i servizi
    // salgono a 4161,00 contro 3480,08 di limiti delle opere (R25: il
    // markup non c'entra più — sta coi prodotti, ben sotto il massimale).
    const esito = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: {
        righe: [{ ordine: ordineDi(fattura, "posa"), importoCent: 200000 }],
        riequilibraBeniAMarkupCent: 100000,
      },
      ...dip(),
    });
    expect(importo(esito.fattura, "posa")).toBe(200000);
    expect(esito.fattura.markupCent).toBe(100000);
    expect(esito.fattura.righe.filter(r => r.tipo === "bene").map(r => r.importoCent)).toEqual([555056, 210422, 90009]);
    expect(esito.controlli.map(c => ({ codice: c.codice, esito: c.esito }))).toEqual([
      { codice: "cliente", esito: "ok" },
      { codice: "limite_riga", esito: "avviso" },
      { codice: "limite_servizi", esito: "errore" },
    ]);
    const riga = esito.controlli.find(c => c.codice === "limite_riga")!;
    expect(riga.messaggio).toContain("supera il limite di € 1314,00");
    expect(esito.controlli.find(c => c.codice === "limite_servizi")!.messaggio).toBe(
      "I servizi (€ 4161,00) superano i limiti delle opere (€ 3480,08)."
    );
  });

  it("revisione vecchia → CONFLITTO; fattura emessa → FATTURA_IMMUTABILE", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });

    await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: { note: "prima passata" },
      ...dip(),
    });
    await expect(
      aggiornaBozza({
        sedeId: SEDE,
        id: fattura.id,
        revisione: 1,
        actorUserId: ATTORE,
        modifica: { note: "seconda sessione" },
        ...dip(),
      })
    ).rejects.toThrow("CONFLITTO:");

    await repository.aggiornaStato({ sedeId: SEDE, id: fattura.id, patch: { stato: "emessa" }, now: ora });
    await expect(
      aggiornaBozza({
        sedeId: SEDE,
        id: fattura.id,
        revisione: 2,
        actorUserId: ATTORE,
        modifica: { note: "tardi" },
        ...dip(),
      })
    ).rejects.toThrow(`FATTURA_IMMUTABILE: la fattura #${fattura.id} è in stato «emessa»: correggi con una nota di credito.`);

    // Altra sede: nemmeno l'esistenza si deve poter dedurre.
    await expect(
      aggiornaBozza({
        sedeId: ALTRA_SEDE,
        id: fattura.id,
        revisione: 2,
        actorUserId: ATTORE,
        modifica: { note: "x" },
        ...dip(),
      })
    ).rejects.toThrow("NOT_FOUND: Fattura non trovata.");
  });

  it("scadenze che non sommano al totale → VALIDAZIONE", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    await expect(
      aggiornaBozza({
        sedeId: SEDE,
        id: fattura.id,
        revisione: fattura.revisione,
        actorUserId: ATTORE,
        modifica: {
          scadenze: [{ numero: 1, quotaPct: 100, data: "2026-10-01", importoCent: 1000000, descrizione: "unica" }],
        },
        ...dip(),
      })
    ).rejects.toThrow("VALIDAZIONE: le scadenze sommano € 10.000,00, il totale è € 15.494,72.");

    // Le scadenze giuste passano e sostituiscono le tre proposte.
    const esito = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: fattura.revisione,
      actorUserId: ATTORE,
      modifica: {
        scadenze: [{ numero: 1, quotaPct: 100, data: "2026-10-01", importoCent: PATTUITO, descrizione: "unica" }],
      },
      ...dip(),
    });
    expect(esito.fattura.scadenze).toHaveLength(1);
    expect(esito.fattura.scadenze[0]).toMatchObject({ importoCent: PATTUITO, data: "2026-10-01", stato: "attesa" });
  });

  it("rifiuta le righe derivate, quelle inesistenti e gli importi negativi", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    const modifica = (righe: Array<{ ordine: number; importoCent: number }>) =>
      aggiornaBozza({ sedeId: SEDE, id: fattura.id, revisione: 1, actorUserId: ATTORE, modifica: { righe }, ...dip() });

    const markup = fattura.righe.find(r => r.tipo === "markup")!;
    const posa = ordineDi(fattura, "posa");
    await expect(modifica([{ ordine: markup.ordine, importoCent: 1000 }])).rejects.toThrow(
      `VALIDAZIONE: la riga ${markup.ordine} è derivata dal risolutore: si cambia agendo su beni e servizi.`
    );
    await expect(modifica([{ ordine: 99, importoCent: 1000 }])).rejects.toThrow(
      "VALIDAZIONE: la riga 99 non esiste in questa fattura."
    );
    await expect(modifica([{ ordine: posa, importoCent: -1 }])).rejects.toThrow(
      `VALIDAZIONE: l'importo della riga ${posa} non può essere negativo.`
    );
    await expect(
      modifica([
        { ordine: posa, importoCent: 1000 },
        { ordine: posa, importoCent: 2000 },
      ])
    ).rejects.toThrow(`VALIDAZIONE: ordine di riga duplicato: ${posa}.`);
  });

  // R18 (fatture 106 e 119): maniglie e voci aggiunte a mano in bozza.
  it("R18: una riga manuale entra in coda ai beni, alza B e abbassa il markup; poi si toglie", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    expect(fattura.markupCent).toBe(-259882);

    const aggiunta = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: {
        righeAggiunte: [
          { tipo: "bene", descrizione: "N.6 Maniglie mod. Lama", importoCent: 60000, aliquota: 22, beneSignificativo: true },
        ],
      },
      ...dip(),
    });
    const f = aggiunta.fattura;
    const manuale = f.righe.find(r => r.descrizione === "N.6 Maniglie mod. Lama")!;
    expect(manuale.tipo).toBe("bene");
    expect(manuale.aliquota).toBe(22);
    expect(manuale.beneSignificativo).toBe(true);
    expect(manuale.quantita).toBe(1);
    expect(manuale.prezzoUnitCent).toBe(60000);
    expect(manuale.importoCent).toBe(60000);
    expect(manuale.rigaCommessaId).toBeNull();
    expect(manuale.voceComputoCodice).toBeNull();
    expect(manuale.limiteCent).toBeNull();
    expect(manuale.derivata).toBe(false);
    // In coda al gruppo dei beni: subito prima del markup, e con gli ordini rifatti da `ricalcola`.
    expect(f.righe.filter(r => r.tipo === "bene").at(-1)!.descrizione).toBe("N.6 Maniglie mod. Lama");
    expect(f.righe[f.righe.findIndex(r => r.ordine === manuale.ordine) + 1].tipo).toBe("markup");
    expect(f.righe.map(r => r.ordine)).toEqual(f.righe.map((_, i) => i + 1));

    expect(f.righe.filter(r => r.tipo === "bene").reduce((s, r) => s + r.importoCent, 0)).toBe(BENI_SIGNIFICATIVI + 60000);
    expect(f.markupCent).toBe(-334575);
    expect(f.totaleCent).toBe(PATTUITO);

    const letta = await leggiFattura(SEDE, f.id, dip());
    expect(letta!.eventi.at(-1)!.payload).toMatchObject({ righeAggiunte: 1, righeRimosse: 0 });

    const rimossa = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: f.revisione,
      actorUserId: ATTORE,
      modifica: { righeRimosse: [manuale.ordine] },
      ...dip(),
    });
    expect(rimossa.fattura.righe.some(r => r.descrizione === "N.6 Maniglie mod. Lama")).toBe(false);
    expect(rimossa.fattura.righe.filter(r => r.tipo === "bene").reduce((s, r) => s + r.importoCent, 0)).toBe(BENI_SIGNIFICATIVI);
    expect(rimossa.fattura.markupCent).toBe(-259882);
    expect(rimossa.fattura.righe).toHaveLength(fattura.righe.length);
    expect(rimossa.fattura.righe.map(r => r.ordine)).toEqual(fattura.righe.map(r => r.ordine));
  });

  it("R18: un servizio manuale entra in coda ai servizi e toglie al markup esattamente il suo importo", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    const esito = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: {
        righeAggiunte: [
          { tipo: "servizio", descrizione: "Assistenza muraria aggiuntiva", importoCent: 5000, aliquota: 10, beneSignificativo: false },
        ],
      },
      ...dip(),
    });
    const f = esito.fattura;
    const manuale = f.righe.find(r => r.descrizione === "Assistenza muraria aggiuntiva")!;
    expect(manuale.tipo).toBe("servizio");
    expect(manuale.aliquota).toBe(10);
    expect(manuale.beneSignificativo).toBe(false);
    expect(manuale.limiteCent).toBeNull();
    expect(f.righe.filter(r => r.tipo === "servizio").at(-1)!.descrizione).toBe("Assistenza muraria aggiuntiva");
    // La nota del calcolo limite resta in fondo, dopo le righe.
    expect(f.righe.at(-1)!.tipo).toBe("nota");
    // Il pattuito è lordo: la prestazione P non cambia (dipende da G e B), quindi il markup scende di 5000.
    expect(f.markupCent).toBe(-259882 - 5000);
    // Una riga senza limite non entra nel confronto per riga, ma entra nella prestazione complessiva.
    expect(codici(esito.controlli)).not.toContain("limite_riga");
  });

  it("R18: con lo storno in fattura il servizio manuale resta prima di storno e riaddebito", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    // Markup positivo: B (855487) supera la prestazione (447500), quindi la
    // coppia storno/riaddebito compare davvero in fattura.
    const conStorno = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: { riequilibraBeniAMarkupCent: 100000 },
      ...dip(),
    });
    expect(conStorno.fattura.stornoCent).toBeGreaterThan(0);
    expect(conStorno.fattura.righe.some(r => r.tipo === "storno_bs")).toBe(true);

    const esito = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: conStorno.fattura.revisione,
      actorUserId: ATTORE,
      modifica: {
        righeAggiunte: [
          { tipo: "servizio", descrizione: "Sigillature extra", importoCent: 5000, aliquota: 10, beneSignificativo: false },
        ],
      },
      ...dip(),
    });
    const f = esito.fattura;
    const indice = f.righe.findIndex(r => r.descrizione === "Sigillature extra");
    expect(indice).toBeGreaterThanOrEqual(0);
    expect(f.righe[indice].tipo).toBe("servizio");
    // In coda ai servizi: storno e riaddebito lo seguono, non lo precedono.
    expect(f.righe[indice + 1].tipo).toBe("storno_bs");
    expect(f.righe[indice + 2].tipo).toBe("riaddebito_bs");
    expect(f.righe.map(r => r.tipo).indexOf("storno_bs")).toBeGreaterThan(indice);
    expect(f.righe.filter(r => r.tipo === "servizio").at(-1)!.descrizione).toBe("Sigillature extra");
    expect(f.stornoCent).toBe(conStorno.fattura.stornoCent);
    expect(f.markupCent).toBe(95000);
  });

  it("R18: non si cancellano le righe del contratto, quelle del computo e le derivate", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    const rimuovi = (ordini: number[]) =>
      aggiornaBozza({ sedeId: SEDE, id: fattura.id, revisione: 1, actorUserId: ATTORE, modifica: { righeRimosse: ordini }, ...dip() });

    const bene = fattura.righe.find(r => r.rigaCommessaId != null)!;
    const posa = fattura.righe.find(r => r.voceComputoCodice === "posa")!;
    const markup = fattura.righe.find(r => r.tipo === "markup")!;
    const intestazione = fattura.righe.find(r => r.tipo === "intestazione")!;

    await expect(rimuovi([bene.ordine])).rejects.toThrow(
      `VALIDAZIONE: la riga ${bene.ordine} viene dal contratto o dal computo: azzera l'importo, non si cancella.`
    );
    await expect(rimuovi([posa.ordine])).rejects.toThrow(
      `VALIDAZIONE: la riga ${posa.ordine} viene dal contratto o dal computo: azzera l'importo, non si cancella.`
    );
    await expect(rimuovi([markup.ordine])).rejects.toThrow(
      `VALIDAZIONE: la riga ${markup.ordine} è derivata dal risolutore: si cambia agendo su beni e servizi.`
    );
    await expect(rimuovi([intestazione.ordine])).rejects.toThrow(
      `VALIDAZIONE: la riga ${intestazione.ordine} non è una riga aggiunta a mano.`
    );
    await expect(rimuovi([9999])).rejects.toThrow("VALIDAZIONE: la riga 9999 non esiste in questa fattura.");
    const letta = await leggiFattura(SEDE, fattura.id, dip());
    expect(letta!.fattura.revisione).toBe(1);
  });

  it("R18: tipo e aliquota devono corrispondere, la descrizione serve e le righe aggiunte hanno un tetto", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    const aggiungi = (righeAggiunte: NonNullable<Parameters<typeof aggiornaBozza>[0]["modifica"]["righeAggiunte"]>) =>
      aggiornaBozza({ sedeId: SEDE, id: fattura.id, revisione: 1, actorUserId: ATTORE, modifica: { righeAggiunte }, ...dip() });
    const riga = (over: Record<string, unknown> = {}) =>
      [{ tipo: "bene" as const, descrizione: "Maniglie", importoCent: 1000, aliquota: 22 as const, beneSignificativo: true, ...over }];

    await expect(aggiungi(riga({ aliquota: 10 }) as any)).rejects.toThrow("VALIDAZIONE: una riga «bene» va al 22 %, non al 10 %.");
    await expect(aggiungi(riga({ tipo: "servizio" }) as any)).rejects.toThrow("VALIDAZIONE: una riga «servizio» va al 10 %, non al 22 %.");
    await expect(aggiungi(riga({ descrizione: "   " }) as any)).rejects.toThrow(
      "VALIDAZIONE: una riga aggiunta senza descrizione non si salva."
    );
    await expect(aggiungi(riga({ descrizione: "x".repeat(301) }) as any)).rejects.toThrow(
      "VALIDAZIONE: la descrizione di una riga aggiunta non può superare i 300 caratteri."
    );
    await expect(aggiungi(riga({ importoCent: -1 }) as any)).rejects.toThrow(
      'VALIDAZIONE: l\'importo della riga "Maniglie" non è in centesimi interi non negativi.'
    );
    await expect(aggiungi(riga({ importoCent: 10.5 }) as any)).rejects.toThrow(
      'VALIDAZIONE: l\'importo della riga "Maniglie" non è in centesimi interi non negativi.'
    );
    await expect(
      aggiungi(Array.from({ length: 21 }, () => riga()[0]) as any)
    ).rejects.toThrow("VALIDAZIONE: non si aggiungono più di 20 righe alla volta.");
  });

  it("lo scavalco dei limiti è registrato con l'evento e il motivo", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    // Stesso scenario del test precedente (posa oltre il proprio limite,
    // markup portato a 100.000): i servizi (4161,00) superano le opere
    // (3480,08) — R25, il markup non c'entra, sta coi prodotti.
    const a = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: {
        righe: [{ ordine: ordineDi(fattura, "posa"), importoCent: 200000 }],
        riequilibraBeniAMarkupCent: 100000,
      },
      ...dip(),
    });
    expect(errori(a.controlli)).toEqual(["limite_servizi"]);

    const b = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: a.fattura.revisione,
      actorUserId: ATTORE,
      modifica: { scavalcoLimiti: { attivo: true, motivo: "Extra concordati fuori computo" } },
      ...dip(),
    });
    expect(b.fattura.scavalcoLimiti).toBe(true);
    expect(b.fattura.scavalcoMotivo).toBe("Extra concordati fuori computo");
    expect(b.controlli.map(c => ({ codice: c.codice, esito: c.esito }))).toEqual([
      { codice: "cliente", esito: "ok" },
      { codice: "limite_riga", esito: "avviso" },
      { codice: "limite_servizi", esito: "avviso" },
    ]);
    expect(b.controlli.find(c => c.codice === "limite_servizi")!.messaggio).toContain(
      "scavalcato: Extra concordati fuori computo"
    );

    const letta = await leggiFattura(SEDE, fattura.id, dip());
    expect(letta!.eventi.map(e => e.tipo)).toEqual(["creata", "modificata", "modificata", "scavalco_limiti"]);
    expect((letta!.eventi.at(-1)!.payload as any).motivo).toBe("Extra concordati fuori computo");
  });

  // Ruling R34: «Procedi comunque» si registra, e un registro senza motivo
  // non serve a nessuno. Il controllo sta nel servizio, non solo nel
  // router: vale anche per una chiamata diretta.
  it("attivare lo scavalco senza motivo è un errore di validazione", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    const senzaMotivo = (motivo: string | null) =>
      aggiornaBozza({
        sedeId: SEDE,
        id: fattura.id,
        revisione: fattura.revisione,
        actorUserId: ATTORE,
        modifica: { scavalcoLimiti: { attivo: true, motivo } },
        ...dip(),
      });

    await expect(senzaMotivo(null)).rejects.toThrow("VALIDAZIONE: indica il motivo dello scavalco.");
    await expect(senzaMotivo("   ")).rejects.toThrow("VALIDAZIONE: indica il motivo dello scavalco.");

    // Nessuna scrittura: né lo scavalco né l'evento.
    const letta = await leggiFattura(SEDE, fattura.id, dip());
    expect(letta!.fattura.scavalcoLimiti).toBe(false);
    expect(letta!.eventi.map(e => e.tipo)).toEqual(["creata"]);

    // Spegnere lo scavalco non richiede un motivo: si torna alla regola.
    const spento = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: fattura.revisione,
      actorUserId: ATTORE,
      modifica: { scavalcoLimiti: { attivo: false, motivo: null } },
      ...dip(),
    });
    expect(spento.fattura.scavalcoLimiti).toBe(false);
  });
});

describe("verificaLimiti", () => {
  it("segnala la riga oltre il limite, il blocco servizi oltre le opere, il totale oltre il computo e il markup negativo", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    const { computo } = await ultimoComputo(SEDE, commessaId);

    // Il caso base: markup negativo, ma nessuna riga oltre il proprio
    // limite e nessun blocco oltre il proprio — beni+markup (939795) sotto
    // il massimale (1603976), servizi (347500) sotto le opere (348008),
    // imponibile (1287295) sotto il limite del computo (1930728).
    expect(codici(verificaLimiti(fattura, computo))).toEqual(["markup_negativo"]);

    const posa = fattura.righe.find(r => r.voceComputoCodice === "posa")!;
    const oltre = {
      ...fattura,
      markupCent: 0,
      righe: fattura.righe.map(r => (r.ordine === posa.ordine ? { ...r, importoCent: 200000 } : r)),
    };
    // La riga fuori limite si porta dietro il blocco servizi (416100 >
    // 348008, R25): l'una è un indicatore, l'altro è un blocco. Beni
    // (invariati) e totale (invariato) restano dentro i propri limiti.
    const controlli = verificaLimiti(oltre, computo);
    expect(controlli.map(c => ({ codice: c.codice, esito: c.esito }))).toEqual([
      { codice: "limite_riga", esito: "avviso" },
      { codice: "limite_servizi", esito: "errore" },
    ]);
    expect(controlli[0].messaggio).toContain("supera il limite di € 1314,00");
    expect(controlli[1].messaggio).toBe("I servizi (€ 4161,00) superano i limiti delle opere (€ 3480,08).");

    // Imponibile esattamente al limite del computo: ok; un centesimo sopra: errore.
    expect(verificaLimiti({ ...fattura, markupCent: 0, imponibileCent: computo!.limiteCent }, computo)).toEqual([
      { codice: "limiti", esito: "ok", messaggio: "Prestazioni entro i limiti del computo." },
    ]);
    const totaleOltre = verificaLimiti({ ...fattura, markupCent: 0, imponibileCent: computo!.limiteCent + 1 }, computo);
    expect(totaleOltre.map(c => c.codice)).toEqual(["limite_totale"]);
    expect(totaleOltre[0].messaggio).toBe("L'imponibile (€ 19.307,29) supera il limite del computo (€ 19.307,28).");

    // Senza computo manca il metro: si dichiara che i limiti non sono stati
    // verificati, mai che sono rispettati (Ruling R8) — indipendentemente
    // dalle righe, ora che il confronto guarda le voci del computo.
    const senzaComputo = verificaLimiti({ ...fattura, markupCent: 0 });
    expect(senzaComputo).toEqual([
      {
        codice: "limiti_non_verificati",
        esito: "avviso",
        messaggio: "Limiti non verificati: computo assente o senza voci proposte.",
      },
    ]);
  });

  // Ruling R25 (prova sul demo 04/09): il caso 127 riequilibrato al markup
  // reale della fattura 129 — il foglio e la fattura sommano beni e markup
  // contro il massimale dei prodotti, mai markup e servizi contro le opere.
  it("R25: il markup sta nei prodotti (col massimale), non nei servizi (con le opere)", async () => {
    const { commessaId } = await scenario127();
    const { fattura: base } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    const { computo } = await ultimoComputo(SEDE, commessaId);
    const { fattura } = await aggiornaBozza({
      sedeId: SEDE,
      id: base.id,
      revisione: base.revisione,
      actorUserId: ATTORE,
      modifica: { riequilibraBeniAMarkupCent: 215359 },
      ...dip(),
    });

    // Scenario del foglio/fattura 129: beni senza voce di computo 817926 +
    // markup 215359 = 1033285, sotto il massimale_A (1603976); servizi
    // proposti dal computo invariati (347500), sotto le opere (348008);
    // imponibile (1380785) sotto il limite del computo (1930728). Tre
    // blocchi ok, nessun errore (markup non più negativo).
    expect(fattura.markupCent).toBe(215359);
    const beniSenzaVoce = fattura.righe
      .filter(r => r.tipo === "bene" && r.voceComputoCodice == null)
      .reduce((s, r) => s + r.importoCent, 0);
    expect(beniSenzaVoce).toBe(817926);
    expect(beniSenzaVoce + fattura.markupCent).toBe(1033285);
    expect(computo!.voci.find(v => v.codice === "massimale_A")!.limiteCent).toBe(1603976);
    expect(fattura.righe.filter(r => r.tipo === "servizio").reduce((s, r) => s + r.importoCent, 0)).toBe(
      SERVIZI_PROPOSTI
    );
    expect(fattura.imponibileCent).toBe(1380785);
    expect(verificaLimiti(fattura, computo)).toEqual([
      { codice: "limiti", esito: "ok", messaggio: "Prestazioni entro i limiti del computo." },
    ]);

    // R26: una riga bene derivata non entra nel blocco prodotti — oggi solo
    // markup/storno/riaddebito lo sono, con un `tipo` proprio che le esclude
    // già da sole; `!r.derivata` è difensivo, e questo lo dimostra: un
    // importo enorme (5.000.000, ben oltre il massimale) non sposta l'esito.
    const beneDerivato = {
      ...fattura.righe.find(r => r.tipo === "bene" && r.voceComputoCodice == null)!,
      ordine: Math.max(...fattura.righe.map(r => r.ordine)) + 1,
      importoCent: 5000000,
      derivata: true,
    };
    expect(verificaLimiti({ ...fattura, righe: [...fattura.righe, beneDerivato] }, computo)).toEqual([
      { codice: "limiti", esito: "ok", messaggio: "Prestazioni entro i limiti del computo." },
    ]);

    // Un servizio manuale da 500.000: solo il blocco servizi sfora (i
    // prodotti e il totale restano quelli di sopra, invariati).
    const servizioManuale: (typeof fattura.righe)[number] = {
      ...fattura.righe.find(r => r.tipo === "servizio")!,
      ordine: Math.max(...fattura.righe.map(r => r.ordine)) + 1,
      descrizione: "Extra manuale",
      voceComputoCodice: null,
      limiteCent: null,
      importoCent: 500000,
      prezzoUnitCent: 500000,
      derivata: false,
    };
    const conServizioExtra = { ...fattura, righe: [...fattura.righe, servizioManuale] };
    const soloServizi = verificaLimiti(conServizioExtra, computo);
    expect(codici(soloServizi)).toEqual(["limite_servizi"]);
    expect(soloServizi[0].messaggio).toBe("I servizi (€ 8475,00) superano i limiti delle opere (€ 3480,08).");

    // Beni (senza voce) portati a 1.600.000: solo il blocco prodotti sfora.
    const primoBene = fattura.righe.find(r => r.tipo === "bene" && r.voceComputoCodice == null)!;
    const altriBeniSenzaVoce = beniSenzaVoce - primoBene.importoCent;
    const conBeniAlti = {
      ...fattura,
      righe: fattura.righe.map(r =>
        r.ordine === primoBene.ordine ? { ...r, importoCent: 1600000 - altriBeniSenzaVoce } : r
      ),
    };
    const soloProdotti = verificaLimiti(conBeniAlti, computo);
    expect(codici(soloProdotti)).toEqual(["limite_prodotti"]);
    expect(soloProdotti[0].messaggio).toBe(
      "Beni e markup (€ 18.153,59) superano il massimale dei prodotti (€ 16.039,76)."
    );

    // Entrambi insieme, con lo scavalco: due avvisi, non due errori.
    const combinato = { ...conBeniAlti, righe: [...conBeniAlti.righe, servizioManuale] };
    const scavalcato = verificaLimiti(
      { ...combinato, scavalcoLimiti: true, scavalcoMotivo: "Extra concordati fuori computo" },
      computo
    );
    expect(scavalcato.map(c => ({ codice: c.codice, esito: c.esito }))).toEqual([
      { codice: "limite_prodotti", esito: "avviso" },
      { codice: "limite_servizi", esito: "avviso" },
    ]);
    expect(scavalcato.every(c => c.messaggio.includes("scavalcato: Extra concordati fuori computo"))).toBe(true);
  });

  // Ruling R26: un computo con termine di paragone a zero non è «ok» (il
  // blocco non è mai stato davvero confrontato) né un blocco vero (non è
  // colpa della fattura). Ogni blocco lo dichiara per conto proprio.
  it("R26: un computo senza voci non finge «ok» — ogni blocco si dichiara non verificabile", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    const computoVuoto: Computo = {
      id: 999999,
      sedeId: SEDE,
      commessaId,
      hashRighe: "hash-vuoto",
      hashParametri: "hash-vuoto",
      tariffeAl: "2026-01",
      zona: null,
      esito: "ok",
      check1Cent: 0,
      check2Cent: 0,
      deiProdottiCent: 0,
      limiteCent: 0,
      detraibileCent: 0,
      detrazioneStimataCent: 0,
      avvertenze: [],
      voci: [],
      createdBy: ATTORE,
      createdAt: ora,
    };
    // markup a 0: isola i tre blocchi da `markup_negativo`.
    const controlli = verificaLimiti({ ...fattura, markupCent: 0 }, computoVuoto);
    expect(controlli).toEqual([
      {
        codice: "limiti_non_verificati",
        esito: "avviso",
        messaggio: "Limiti dei prodotti non verificabili: il computo non ha massimali.",
      },
      {
        codice: "limiti_non_verificati",
        esito: "avviso",
        messaggio: "Limiti dei servizi non verificabili: il computo non propone opere.",
      },
      { codice: "limiti_non_verificati", esito: "avviso", messaggio: "Limite complessivo non verificabile." },
    ]);
    expect(controlli.some(c => c.esito === "errore")).toBe(false);
  });
});

describe("validaPerEmissione", () => {
  it("elenca computo, cliente, configurazione e limiti; emettibile solo senza errori", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });

    const prima = await validaPerEmissione(SEDE, fattura.id, dip());
    expect(prima.emettibile).toBe(false);
    expect(errori(prima.controlli)).toEqual([
      "config_iban",
      "config_vat_22",
      "config_vat_10",
      "config_conto",
      "config_scope",
      "markup_negativo",
    ]);
    expect(prima.controlli.find(c => c.codice === "config_iban")!.messaggio).toBe(
      "Configura l'IBAN in Impostazioni → Fatturazione."
    );
    expect(codici(prima.controlli)).toContain("cliente"); // anagrafica completa

    await repository.salvaConfig(CONFIG_COMPLETA());
    await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: { riequilibraBeniAMarkupCent: 0 },
      ...dip(),
    });

    const dopo = await validaPerEmissione(SEDE, fattura.id, dip());
    expect(errori(dopo.controlli)).toEqual([]);
    expect(dopo.emettibile).toBe(true);
    expect(dopo.fattura.markupCent).toBe(0);
  });

  it("cliente incompleto, computo non valido e scadenza passata: due errori e un avviso", async () => {
    const cliente = nuovoCliente(SEDE, { codiceFiscale: null, cap: "", citta: "Sarzana" });
    const commessaId = await nuovaCommessa(SEDE, cliente);
    await salvaContratto({
      sedeId: SEDE,
      commessaId,
      actorUserId: ATTORE,
      now: ora,
      contratto: CONTRATTO_127(),
      righe: RIGHE_127,
    });
    // Nessun computo eseguito: la bozza nasce senza computoId.
    await repository.salvaConfig(CONFIG_COMPLETA());
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    expect(fattura.computoId).toBeNull();
    // Senza computo non ci sono servizi: il markup vale tutta la prestazione.
    expect(fattura.righe.filter(r => r.tipo === "servizio")).toHaveLength(0);

    await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: {
        scadenze: [
          { numero: 1, quotaPct: 100, data: "2026-01-15", importoCent: fattura.totaleCent, descrizione: "scaduta" },
        ],
      },
      ...dip(),
    });

    const esito = await validaPerEmissione(SEDE, fattura.id, dip());
    expect(errori(esito.controlli)).toEqual(
      expect.arrayContaining(["cliente_cap", "cliente_provincia", "cliente_cf", "cliente_cf_bonus", "computo_non_valido"])
    );
    const avviso = esito.controlli.find(c => c.codice === "scadenza_passata")!;
    expect(avviso.esito).toBe("avviso");
    expect(avviso.messaggio).toContain("2026-01-15");
    expect(esito.emettibile).toBe(false);
    // Nessuna voce proposta: i limiti non sono verificati, e non si finge
    // che siano a posto (Ruling R8).
    expect(esito.controlli.find(c => c.codice === "limiti_non_verificati")).toMatchObject({
      esito: "avviso",
      messaggio: "Limiti non verificati: computo assente o senza voci proposte.",
    });
    expect(codici(esito.controlli)).not.toContain("limiti");

    // Lo scavalco registrato sostituisce il computo valido (spec §7.3).
    await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 2,
      actorUserId: ATTORE,
      modifica: { scavalcoLimiti: { attivo: true, motivo: "Limiti verificati a mano" } },
      ...dip(),
    });
    const dopo = await validaPerEmissione(SEDE, fattura.id, dip());
    expect(errori(dopo.controlli)).not.toContain("computo_non_valido");
  });

  // R19 (fatture 106 e 119): la riga della pratica edilizia nasce come
  // template e va compilata a mano prima di emettere.
  it("R19: i segnaposto della pratica edilizia rimasti nelle note sono un avviso, non un blocco", async () => {
    const commessaId = await nuovaCommessa(SEDE, nuovoCliente(SEDE, { praticaEdilizia: "cila" }));
    await salvaContratto({
      sedeId: SEDE, commessaId, actorUserId: ATTORE, now: ora, contratto: CONTRATTO_127(), righe: RIGHE_127,
    });
    await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: ATTORE, now: ora });
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    expect(fattura.diciture).toContain("intervento_straordinaria");
    expect(fattura.note).toBe("CILA N. {numero} del {data}, rilasciata dal Comune di {comune} e intestata a {intestatario}.");

    const prima = await validaPerEmissione(SEDE, fattura.id, dip());
    const avviso = prima.controlli.find(c => c.codice === "pratica_edilizia_incompleta")!;
    expect(avviso.esito).toBe("avviso");

    await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: fattura.revisione,
      actorUserId: ATTORE,
      modifica: { note: "CILA N. 41 del 02/03/2026, rilasciata dal Comune di Sarzana e intestata a Mario Rossi." },
      ...dip(),
    });
    const dopo = await validaPerEmissione(SEDE, fattura.id, dip());
    expect(codici(dopo.controlli)).not.toContain("pratica_edilizia_incompleta");
  });

  it("la fattura di un'altra sede non esiste", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    await expect(validaPerEmissione(ALTRA_SEDE, fattura.id, dip())).rejects.toThrow("NOT_FOUND: Fattura non trovata.");
  });

  it("Ruling R14: una nota di credito salta computo e limiti, non cliente/configurazione/scadenze", async () => {
    const snapshotValido: ClienteSnapshot = {
      clienteId: null,
      nome: "Rossi Mario",
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
      praticaEdilizia: "nessuna",
    };
    const persist: FatturaPersist = {
      sedeId: SEDE,
      commessaId: 1,
      computoId: null,
      hashRighe: null,
      tipo: "nota_credito",
      notaCreditoDi: 1,
      stato: "bozza",
      ficDocumentId: null,
      numero: null,
      data: null,
      clienteSnapshot: snapshotValido,
      pattuitoTipo: "lordo",
      pattuitoCent: 10000,
      imponibileCent: 10000,
      ivaCent: 0,
      totaleCent: 10000,
      deltaPattuitoCent: 0,
      markupCent: 0,
      stornoCent: 0,
      diciture: ["copia_ade"],
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
      createdBy: ATTORE,
      emessaDa: null,
      emessaAt: null,
    };
    const nota = await repository.crea({
      fattura: persist,
      righe: [],
      riepilogo: [],
      // Scadenza deliberatamente disallineata dal totale: prova che il
      // controllo sulle scadenze resta attivo per la nota di credito.
      scadenze: [{ numero: 1, quotaPct: 100, data: "2026-09-04", importoCent: 5000, descrizione: "storno" }],
      now: ora,
    });

    const esito = await validaPerEmissione(SEDE, nota.id, dip());
    // Computo e limiti: saltati (R14).
    expect(errori(esito.controlli)).not.toContain("computo_non_valido");
    expect(codici(esito.controlli)).not.toContain("limiti_non_verificati");
    expect(codici(esito.controlli)).not.toContain("limite_totale");
    expect(codici(esito.controlli)).not.toContain("limiti");
    expect(codici(esito.controlli)).not.toContain("markup_negativo");
    // Cliente, configurazione, scadenze: controllati come sempre.
    expect(codici(esito.controlli)).toContain("cliente"); // anagrafica valida: il controllo resta e passa
    expect(errori(esito.controlli)).toEqual(
      expect.arrayContaining([
        "scadenze_totale",
        "config_iban",
        "config_vat_22",
        "config_vat_10",
        "config_conto",
        "config_scope",
      ])
    );
  });

  it("Ruling R15: una nota di credito salta anche cantiere e dicitura del bonifico (detrazione)", async () => {
    const snapshotValido: ClienteSnapshot = {
      clienteId: null,
      nome: "Rossi Mario",
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
      praticaEdilizia: "nessuna",
    };
    const persist: FatturaPersist = {
      sedeId: SEDE,
      commessaId: 1,
      computoId: null,
      hashRighe: null,
      tipo: "nota_credito",
      notaCreditoDi: 1,
      stato: "bozza",
      ficDocumentId: null,
      numero: null,
      data: null,
      clienteSnapshot: snapshotValido,
      pattuitoTipo: "lordo",
      pattuitoCent: 10000,
      imponibileCent: 10000,
      ivaCent: 0,
      totaleCent: 10000,
      deltaPattuitoCent: 0,
      markupCent: 0,
      stornoCent: 0,
      // Detrazione presente ma senza cantiere né dicitura del bonifico:
      // se R15 non saltasse questi controlli, "cantiere" e
      // "dicitura_bonifico" bloccherebbero l'emissione.
      diciture: ["copia_ade"],
      note: null,
      intestazioneCantiere: null,
      detrazioneTipo: "ristrutturazione",
      pdfStorageKey: null,
      xmlStorageKey: null,
      xmlSha256: null,
      documentoId: null,
      eiStatusFic: null,
      eiErrore: null,
      inviataDryRun: false,
      scavalcoLimiti: false,
      scavalcoMotivo: null,
      createdBy: ATTORE,
      emessaDa: null,
      emessaAt: null,
    };
    const nota = await repository.crea({
      fattura: persist,
      righe: [],
      riepilogo: [],
      // Scadenza allineata e configurazione completa: isola il test sul
      // solo cantiere/dicitura, il resto è già a posto.
      scadenze: [{ numero: 1, quotaPct: 100, data: "2026-09-04", importoCent: 10000, descrizione: "storno" }],
      now: ora,
    });
    await repository.salvaConfig(CONFIG_COMPLETA());

    const esito = await validaPerEmissione(SEDE, nota.id, dip());
    expect(codici(esito.controlli)).not.toContain("cantiere");
    expect(codici(esito.controlli)).not.toContain("dicitura_bonifico");
    expect(errori(esito.controlli)).toEqual([]);
    expect(esito.emettibile).toBe(true);
  });
});

describe("rigeneraBozza", () => {
  it("ricrea righe e scadenze dal contratto e dal computo correnti", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: {
        righe: [{ ordine: ordineDi(fattura, "posa"), importoCent: 100000 }],
        note: "a mano",
        scavalcoLimiti: { attivo: true, motivo: "limiti verificati a mano" },
      },
      ...dip(),
    });

    // Il contratto cambia pattuito; il computo si rifà sulle stesse righe.
    await salvaContratto({
      sedeId: SEDE,
      commessaId,
      actorUserId: ATTORE,
      now: ora,
      contratto: CONTRATTO_127({ pattuitoCent: 1600000 }),
      righe: RIGHE_127,
    });
    const nuovoComputo = await eseguiComputo({ sedeId: SEDE, commessaId, actorUserId: ATTORE, now: ora });

    const esito = await rigeneraBozza({ sedeId: SEDE, id: fattura.id, revisione: 2, actorUserId: ATTORE, ...dip() });
    expect(esito.fattura.pattuitoCent).toBe(1600000);
    expect(esito.fattura.computoId).toBe(nuovoComputo.id);
    expect(esito.fattura.revisione).toBe(3);
    expect(importo(esito.fattura, "posa")).toBe(131400); // la modifica a mano è stata riscritta
    expect(esito.fattura.note).toBe("a mano"); // la nota di chi fattura non è un derivato del contratto: resta
    // Lo scavalco riguardava righe che non ci sono più: torna a zero.
    expect(esito.fattura.scavalcoLimiti).toBe(false);
    expect(esito.fattura.scavalcoMotivo).toBeNull();
    expect(esito.fattura.markupCent).toBe(-208322);
    expect(esito.fattura.totaleCent).toBe(1600001);
    // Il centesimo che l'IVA non restituisce: dichiarato, non nascosto.
    expect(esito.fattura.deltaPattuitoCent).toBe(1);
    expect(esito.fattura.scadenze.reduce((s, x) => s + x.importoCent, 0)).toBe(1600001);
    expect(esito.avvertenze.join(" ")).toMatch(/superano il pattuito/);

    const letta = await leggiFattura(SEDE, fattura.id, dip());
    expect((letta!.eventi.at(-1)!.payload as any).rigenerata).toBe(true);
  });

  it("non si rigenera una fattura emessa", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    await repository.aggiornaStato({ sedeId: SEDE, id: fattura.id, patch: { stato: "inviata" }, now: ora });
    await expect(
      rigeneraBozza({ sedeId: SEDE, id: fattura.id, revisione: 1, actorUserId: ATTORE, ...dip() })
    ).rejects.toThrow("FATTURA_IMMUTABILE:");
  });

  it("Ruling R16: una nota di credito in bozza non si rigenera (non ha contratto né computo propri)", async () => {
    const persist: FatturaPersist = {
      sedeId: SEDE,
      commessaId: 1,
      computoId: null,
      hashRighe: null,
      tipo: "nota_credito",
      notaCreditoDi: 1,
      stato: "bozza",
      ficDocumentId: null,
      numero: null,
      data: null,
      clienteSnapshot: null,
      pattuitoTipo: "lordo",
      pattuitoCent: 10000,
      imponibileCent: 10000,
      ivaCent: 0,
      totaleCent: 10000,
      deltaPattuitoCent: 0,
      markupCent: 0,
      stornoCent: 0,
      diciture: ["copia_ade"],
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
      createdBy: ATTORE,
      emessaDa: null,
      emessaAt: null,
    };
    const nota = await repository.crea({
      fattura: persist,
      righe: [],
      riepilogo: [],
      scadenze: [{ numero: 1, quotaPct: 100, data: "2026-09-04", importoCent: 10000, descrizione: "storno" }],
      now: ora,
    });

    await expect(
      rigeneraBozza({ sedeId: SEDE, id: nota.id, revisione: 1, actorUserId: ATTORE, ...dip() })
    ).rejects.toThrow("PRECONDIZIONE: la nota di credito rispecchia la fattura di origine e non si rigenera.");
  });
});

describe("leggiFattura e fatturePerCommessa", () => {
  it("la lettura isola la sede e la lista torna dalla più recente", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    await annullaBozza({ sedeId: SEDE, id: fattura.id, actorUserId: ATTORE, motivo: "rifatta", ...dip() });
    const seconda = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });

    expect(await leggiFattura(ALTRA_SEDE, fattura.id, dip())).toBeNull();
    expect(await leggiFattura(SEDE, 987654, dip())).toBeNull();
    const lista = await fatturePerCommessa(SEDE, commessaId, dip());
    expect(lista.map(f => f.id)).toEqual([seconda.fattura.id, fattura.id]);
    expect(lista.map(f => f.stato)).toEqual(["bozza", "annullata"]);
    expect(await fatturePerCommessa(ALTRA_SEDE, commessaId, dip())).toEqual([]);
  });

  // Stessa ragione del Ruling R14 su `validaPerEmissione`: i limiti del
  // computo non dicono nulla su una nota di credito, e in lettura
  // sarebbero solo rumore («limiti non verificati» su ogni nota).
  it("la lettura di una nota di credito non passa dai limiti del computo", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    // Stessa fattura, ribattezzata nota di credito: i campi che il
    // repository assegna da sé (id, revisione, date, figli) restano fuori.
    const { id, revisione: _rev, createdAt: _c, updatedAt: _u, righe: _r, riepilogo: _ri, scadenze: _s, ...persist } = fattura;
    const nota = await repository.crea({
      fattura: { ...persist, tipo: "nota_credito", notaCreditoDi: id, computoId: null },
      righe: [],
      riepilogo: [],
      scadenze: [],
      now: ora,
    });

    const letta = await leggiFattura(SEDE, nota.id, dip());
    expect(letta!.fattura.tipo).toBe("nota_credito");
    expect(codici(letta!.controlli)).not.toContain("limiti_non_verificati");
    expect(codici(letta!.controlli)).not.toContain("limiti");
    expect(codici(letta!.controlli)).not.toContain("markup_negativo");
    // La fattura di origine, invece, i limiti li vede eccome.
    expect(codici((await leggiFattura(SEDE, fattura.id, dip()))!.controlli)).toContain("markup_negativo");
  });
});

describe("annullaBozza", () => {
  it("solo una bozza si annulla; evento «annullata» con il motivo", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });

    const annullata = await annullaBozza({
      sedeId: SEDE,
      id: fattura.id,
      actorUserId: ATTORE,
      motivo: "Cliente ha cambiato idea",
      ...dip(),
    });
    expect(annullata.stato).toBe("annullata");

    const letta = await leggiFattura(SEDE, fattura.id, dip());
    expect(letta!.eventi.map(e => e.tipo)).toEqual(["creata", "annullata"]);
    expect((letta!.eventi[1].payload as any).motivo).toBe("Cliente ha cambiato idea");

    // Due volte no, e nemmeno da un'altra sede.
    await expect(
      annullaBozza({ sedeId: SEDE, id: fattura.id, actorUserId: ATTORE, motivo: null, ...dip() })
    ).rejects.toThrow("FATTURA_IMMUTABILE:");
    await expect(
      annullaBozza({ sedeId: ALTRA_SEDE, id: fattura.id, actorUserId: ATTORE, motivo: null, ...dip() })
    ).rejects.toThrow("NOT_FOUND: Fattura non trovata.");
  });
});
