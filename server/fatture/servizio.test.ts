// server/fatture/servizio.test.ts
// Il servizio della bozza sul caso reale 127/2026 (fixture del computo):
// contratto e computo veri, non finti, così i servizi proposti e i limiti
// sono i numeri del foglio. Pattuito 1549472 lordo, beni significativi
// 1199677, servizi proposti 347500, somma dei limiti 348008.
import { beforeEach, describe, expect, it } from "vitest";
import type { ContrattoInput, RigaContrattoInput } from "@shared/limiti/tipi";
import type { FatturazioneConfig } from "@shared/fatturazione/tipi";
import casi from "../computo/__fixtures__/casi-reali.json";
import { _resetComputiRepositoryForTests } from "../computo/repository";
import { eseguiComputo } from "../computo/servizio";
import { _resetContrattiRepositoryForTests } from "../contratti/repository";
import { salvaContratto } from "../contratti/servizio";
import { getClientiStore } from "../routers/clienti";
import { creaCommessa } from "../routers/commesse";
import type { TrpcContext } from "../_core/context";
import { createMemoryFattureRepository, type FattureRepository } from "./repository";
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
const SOMMA_LIMITI = 348008;

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
    // Ora la prestazione (447500) supera la somma dei limiti proposti (348008).
    expect(errori(b.controlli)).toEqual(["limite_totale"]);
  });

  it("un servizio oltre il proprio limite: avviso sulla riga, errore sul totale", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    // Posa a 2000,00 (limite 1314,00) e markup portato a 100.000: la
    // prestazione sale a 5161,00 contro 3480,08 di limiti proposti.
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
      { codice: "limite_totale", esito: "errore" },
    ]);
    const riga = esito.controlli.find(c => c.codice === "limite_riga")!;
    expect(riga.messaggio).toContain("supera il limite di € 1314,00");
    expect(esito.controlli.find(c => c.codice === "limite_totale")!.messaggio).toBe(
      "Le prestazioni in fattura (€ 5161,00) superano il limite del computo (€ 3480,08)."
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

  it("lo scavalco dei limiti è registrato con l'evento e il motivo", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    // Prestazione oltre la somma dei limiti (447500 > 348008) con markup 100.000.
    const a = await aggiornaBozza({
      sedeId: SEDE,
      id: fattura.id,
      revisione: 1,
      actorUserId: ATTORE,
      modifica: { riequilibraBeniAMarkupCent: 100000 },
      ...dip(),
    });
    expect(errori(a.controlli)).toEqual(["limite_totale"]);

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
      { codice: "limite_totale", esito: "avviso" },
    ]);
    expect(b.controlli.find(c => c.codice === "limite_totale")!.messaggio).toContain(
      "scavalcato: Extra concordati fuori computo"
    );

    const letta = await leggiFattura(SEDE, fattura.id, dip());
    expect(letta!.eventi.map(e => e.tipo)).toEqual(["creata", "modificata", "modificata", "scavalco_limiti"]);
    expect((letta!.eventi.at(-1)!.payload as any).motivo).toBe("Extra concordati fuori computo");
  });
});

describe("verificaLimiti", () => {
  it("segnala la riga oltre il limite, il totale oltre la somma dei limiti e il markup negativo", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });

    // Il caso base: markup negativo, ma nessuna riga oltre il proprio limite
    // e prestazione (87618) ben sotto la somma dei limiti (348008).
    expect(codici(verificaLimiti(fattura))).toEqual(["markup_negativo"]);

    const posa = fattura.righe.find(r => r.voceComputoCodice === "posa")!;
    const oltre = {
      ...fattura,
      markupCent: 0,
      righe: fattura.righe.map(r => (r.ordine === posa.ordine ? { ...r, importoCent: 200000 } : r)),
    };
    // La riga fuori limite si porta dietro anche il totale (416100 > 348008):
    // l'una è un indicatore, l'altro è un blocco.
    const controlli = verificaLimiti(oltre);
    expect(controlli.map(c => ({ codice: c.codice, esito: c.esito }))).toEqual([
      { codice: "limite_riga", esito: "avviso" },
      { codice: "limite_totale", esito: "errore" },
    ]);
    expect(controlli[0].messaggio).toContain("supera il limite di € 1314,00");

    // Prestazione (servizi + markup) oltre la somma dei limiti proposti.
    const totaleOltre = verificaLimiti({ ...fattura, markupCent: SOMMA_LIMITI - SERVIZI_PROPOSTI + 1 });
    expect(totaleOltre.filter(c => c.esito === "errore").map(c => c.codice)).toEqual(["limite_totale"]);
    expect(verificaLimiti({ ...fattura, markupCent: SOMMA_LIMITI - SERVIZI_PROPOSTI })).toEqual([
      { codice: "limiti", esito: "ok", messaggio: "Prestazioni entro i limiti del computo." },
    ]);

    // Senza voci proposte manca il metro: si dichiara che i limiti non
    // sono stati verificati, mai che sono rispettati (Ruling R8).
    const senzaServizi = verificaLimiti({
      ...fattura,
      markupCent: 0,
      righe: fattura.righe.filter(r => r.tipo !== "servizio"),
    });
    expect(senzaServizi).toEqual([
      {
        codice: "limiti_non_verificati",
        esito: "avviso",
        messaggio: "Limiti non verificati: computo assente o senza voci proposte.",
      },
    ]);
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

  it("la fattura di un'altra sede non esiste", async () => {
    const { commessaId } = await scenario127();
    const { fattura } = await creaBozza({ sedeId: SEDE, commessaId, actorUserId: ATTORE, ...dip() });
    await expect(validaPerEmissione(ALTRA_SEDE, fattura.id, dip())).rejects.toThrow("NOT_FOUND: Fattura non trovata.");
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
