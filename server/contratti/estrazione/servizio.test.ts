// Servizio di lettura del contratto (piano 3, Task 6): disponibilità,
// esecuzione idempotente con un solo retry sulla risposta invalida del
// modello, applicazione tramite l'unico percorso di scrittura
// (salvaContratto) e scarto. Il provider è sempre finto qui — nessuna
// chiamata di rete — stesso principio di modello.test.ts e di
// server/tars/smistamento/analisi.test.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT, type ContrattoInput, type RigaContrattoInput } from "@shared/limiti/tipi";
import type { TrpcContext } from "../../_core/context";
import { pdfConTesto } from "../../documenti/pdfMinimo";
import { getClientiStore } from "../../routers/clienti";
import { creaCommessa, getCommessaById } from "../../routers/commesse";
import { caricaDocumentoCommessaDaBuffer } from "../../routers/preventiviContratti";
import { timelineRouter } from "../../routers/timeline";
import type { estraiTestoDocumento, EsitoParser } from "../../documenti/parserRegistry";
import { creaProviderFinto, rispostaTesto } from "../../tars/openai/fake";
import { leggiContratto } from "../servizio";
import { PROMPT_ESTRAZIONE_VERSIONE } from "./prompt";
import { createMemoryEstrazioniRepository, type EstrazioniRepository } from "./repository";
import type { EsitoModello } from "./schema";
import {
  applicaEstrazione,
  disponibilitaEstrazione,
  eseguiEstrazioneContratto,
  scartaEstrazione,
} from "./servizio";

const SEDE = 84_601;
const ALTRA_SEDE = 84_602;

function ctx(sedeId: number): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> {
  return {
    user: { id: 5, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Test" } as any,
    sedeId,
    sediIds: [sedeId],
  };
}

let prossimoClienteId = 900_000;

// Cliente anonimo e sintetico (nessun nome reale): la zona nei test si
// dichiara sempre a mano (zonaManuale), quindi il cliente non porta né
// città né indirizzo.
async function nuovaCommessa(sedeId: number): Promise<number> {
  const clienti = getClientiStore() as any[];
  const cliente = {
    id: prossimoClienteId++,
    sedeId,
    nome: "Prova",
    cognome: "Cliente",
    tipo: "privato",
    commesseIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  clienti.push(cliente);
  const creata = await creaCommessa(ctx(sedeId), { clienteId: cliente.id } as any);
  return (creata as any).commessa?.id ?? (creata as any).id;
}

const RIGHE_DOCUMENTO = [
  "CONTRATTO DI FORNITURA E POSA",
  "Finestra 2 ante PVC",
  "Larghezza 1200 mm Altezza 1400 mm - quantita 1 - 1.000,00 EUR",
  "Totale IVA Inclusa 1.000,00 EUR",
];

async function nuovoDocumento(
  commessaId: number,
  sedeId: number,
  opzioni: { tipo?: "contratto" | "preventivo" } = {}
): Promise<number> {
  const doc = await caricaDocumentoCommessaDaBuffer({
    commessaId,
    nome: "Contratto.pdf",
    tipo: opzioni.tipo ?? "contratto",
    mimeType: "application/pdf",
    buffer: pdfConTesto(RIGHE_DOCUMENTO),
    sedeId,
    createdBy: 5,
    keepNome: true,
  });
  return doc.id;
}

function esitoValido(): EsitoModello {
  return {
    righe: [
      {
        descrizione: "Finestra 2 ante PVC",
        tipoProdotto: "finestra",
        materiale: "pvc",
        nAnte: 2,
        quantita: 1,
        larghezzaMm: 1200,
        altezzaMm: 1400,
        prezzoTotale: 1000,
        prezzoUnitario: null,
        oscuranteAbbinato: "nessuno",
        lamelleOrientabili: false,
        accessori: [],
        pagina: 1,
        frammento: "Finestra 2 ante PVC",
      },
    ],
    pattuito: {
      totaleLordo: 1000,
      totaleImponibile: null,
      ivaDescrizione: null,
      pagina: 1,
      frammento: "Totale IVA Inclusa 1.000,00 EUR",
    },
    posa: { inclusa: false, prezzo: null, descrizione: null, pagina: 1, frammento: "" },
    rate: [],
    cantiere: { indirizzo: null, comune: null, provincia: null, piano: null, pagina: 1, frammento: "" },
    cliente: { nome: null, codiceFiscale: null, pagina: 1, frammento: "" },
    dataDocumento: null,
    dataFirma: null,
    riferimento: null,
    detrazione: "non_indicata",
    note: "",
  };
}

function providerCheConta(risposta: () => string) {
  const conta = { n: 0 };
  const provider = creaProviderFinto(() => {
    conta.n++;
    return rispostaTesto(risposta());
  });
  return { provider, conta };
}

/** Parser finto che conta le letture: serve a provare che il riuso non estrae il testo. */
function parserCheConta(parser: string) {
  const conta = { n: 0 };
  const estraiTesto = async (): Promise<EsitoParser> => {
    conta.n++;
    return {
      esito: "estratto",
      parser,
      versione: "test",
      pagine: [RIGHE_DOCUMENTO.join("\n")],
      avvertenze: [],
    };
  };
  return { estraiTesto: estraiTesto as unknown as typeof estraiTestoDocumento, conta };
}

const CONTRATTO_BASE: ContrattoInput = {
  pattuitoCent: 100_000,
  pattuitoTipo: "lordo",
  posaInclusa: false,
  notePosa: null,
  comuneCantiere: null,
  zonaManuale: true,
  zonaClimatica: "D",
  piano: null,
  distanzaKm: null,
  detrazioneTipo: "nessuna",
  detrazioneImmobile: null,
  detrazionePct: null,
  dataFirma: null,
  rate: [],
  opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
  origine: "manuale",
  documentoId: null,
};

const RIGHE_BASE: RigaContrattoInput[] = [
  {
    categoria: "serramento_pvc",
    tipologia: null,
    oscuranteIntegrato: null,
    oscuranteTipologia: null,
    descrizione: "Finestra 2 ante PVC",
    quantita: 1,
    larghezzaMm: 1200,
    altezzaMm: 1400,
    misuraDei: null,
    prezzoUnitCent: null,
    prezzoTotCent: 100_000,
    beneSignificativo: true,
    accessori: [],
    note: null,
    origine: "manuale",
    evidenza: { pagina: 1, frammento: "Finestra 2 ante PVC" },
  },
];

const ENV_ORIGINALE = { ...process.env };

describe("servizio di lettura del contratto (piano 3, Task 6)", () => {
  let repo: EstrazioniRepository;

  beforeEach(() => {
    repo = createMemoryEstrazioniRepository();
  });

  afterEach(() => {
    process.env = { ...ENV_ORIGINALE };
  });

  it("(a) propone con righe e runId; senza forza riusa senza richiamare il provider; con forza rilegge", async () => {
    const commessaId = await nuovaCommessa(SEDE);
    const documentoId = await nuovoDocumento(commessaId, SEDE);
    const { provider, conta } = providerCheConta(() => JSON.stringify(esitoValido()));

    const prima = await eseguiEstrazioneContratto({
      sedeId: SEDE,
      commessaId,
      documentoId,
      actorUserId: 5,
      repository: repo,
      provider,
    });
    expect(prima.riusata).toBe(false);
    expect(prima.estrazione.runId).toBeTruthy();
    expect(prima.estrazione.stato).toBe("proposta");
    expect(prima.estrazione.proposta.righe.length).toBeGreaterThan(0);
    expect(conta.n).toBe(1);

    const seconda = await eseguiEstrazioneContratto({
      sedeId: SEDE,
      commessaId,
      documentoId,
      actorUserId: 5,
      repository: repo,
      provider,
    });
    expect(seconda.riusata).toBe(true);
    expect(seconda.estrazione.id).toBe(prima.estrazione.id);
    expect(conta.n).toBe(1); // il provider non è stato richiamato

    const forzata = await eseguiEstrazioneContratto({
      sedeId: SEDE,
      commessaId,
      documentoId,
      actorUserId: 5,
      forza: true,
      repository: repo,
      provider,
    });
    expect(forzata.riusata).toBe(false);
    expect(forzata.estrazione.id).not.toBe(prima.estrazione.id);
    expect(conta.n).toBe(2);
  });

  it("(b) documento di un'altra sede è NOT_FOUND; un documento non di tipo contratto è PRECONDIZIONE", async () => {
    const commessaId = await nuovaCommessa(SEDE);
    const documentoId = await nuovoDocumento(commessaId, SEDE);
    const { provider } = providerCheConta(() => JSON.stringify(esitoValido()));

    await expect(
      eseguiEstrazioneContratto({
        sedeId: ALTRA_SEDE,
        commessaId,
        documentoId,
        actorUserId: 5,
        repository: repo,
        provider,
      })
    ).rejects.toThrow("NOT_FOUND");

    const documentoPreventivo = await nuovoDocumento(commessaId, SEDE, { tipo: "preventivo" });
    await expect(
      eseguiEstrazioneContratto({
        sedeId: SEDE,
        commessaId,
        documentoId: documentoPreventivo,
        actorUserId: 5,
        repository: repo,
        provider,
      })
    ).rejects.toThrow("PRECONDIZIONE");
  });

  it("(c) risposta JSON rotta due volte: precondizione a riprovare e nessuna estrazione salvata", async () => {
    const commessaId = await nuovaCommessa(SEDE);
    const documentoId = await nuovoDocumento(commessaId, SEDE);
    const { provider, conta } = providerCheConta(() => "questo non è json valido");

    await expect(
      eseguiEstrazioneContratto({ sedeId: SEDE, commessaId, documentoId, actorUserId: 5, repository: repo, provider })
    ).rejects.toThrow(/PRECONDIZIONE.*riprova/i);
    expect(conta.n).toBe(2); // un tentativo più un solo retry
    expect(await repo.ultimaPerDocumento(SEDE, documentoId)).toBeNull();
  });

  it("(d) applicaEstrazione salva con origine estrazione ed evidenza; una seconda applicazione è precondizione", async () => {
    const commessaId = await nuovaCommessa(SEDE);
    const documentoId = await nuovoDocumento(commessaId, SEDE);
    const { provider } = providerCheConta(() => JSON.stringify(esitoValido()));
    const { estrazione } = await eseguiEstrazioneContratto({
      sedeId: SEDE,
      commessaId,
      documentoId,
      actorUserId: 5,
      repository: repo,
      provider,
    });

    const esito = await applicaEstrazione({
      sedeId: SEDE,
      commessaId,
      estrazioneId: estrazione.id,
      contratto: CONTRATTO_BASE,
      righe: RIGHE_BASE,
      actorUserId: 5,
      repository: repo,
    });
    expect(esito.contratto.origine).toBe("estrazione");
    expect(esito.contratto.estrazioneId).toBe(estrazione.id);
    expect(esito.contratto.documentoId).toBe(documentoId);
    expect(esito.righe[0].origine).toBe("estrazione");
    expect(esito.righe[0].evidenza).toEqual({ pagina: 1, frammento: "Finestra 2 ante PVC" });

    const letto = await leggiContratto(SEDE, commessaId);
    expect(letto.contratto?.origine).toBe("estrazione");
    expect(letto.contratto?.estrazioneId).toBe(estrazione.id);
    expect(letto.righe[0]?.evidenza).toEqual({ pagina: 1, frammento: "Finestra 2 ante PVC" });

    const dopo = await repo.perId(SEDE, estrazione.id);
    expect(dopo?.stato).toBe("applicata");

    await expect(
      applicaEstrazione({
        sedeId: SEDE,
        commessaId,
        estrazioneId: estrazione.id,
        contratto: CONTRATTO_BASE,
        righe: RIGHE_BASE,
        actorUserId: 5,
        repository: repo,
      })
    ).rejects.toThrow("PRECONDIZIONE");
  });

  it("(e) scartaEstrazione registra il motivo e passa a scartata", async () => {
    const commessaId = await nuovaCommessa(SEDE);
    const documentoId = await nuovoDocumento(commessaId, SEDE);
    const { provider } = providerCheConta(() => JSON.stringify(esitoValido()));
    const { estrazione } = await eseguiEstrazioneContratto({
      sedeId: SEDE,
      commessaId,
      documentoId,
      actorUserId: 5,
      repository: repo,
      provider,
    });

    const scartata = await scartaEstrazione({
      sedeId: SEDE,
      estrazioneId: estrazione.id,
      motivo: "non pertinente",
      actorUserId: 5,
      repository: repo,
    });
    expect(scartata.stato).toBe("scartata");
    expect(scartata.scartataMotivo).toBe("non pertinente");

    await expect(
      scartaEstrazione({ sedeId: SEDE, estrazioneId: estrazione.id, motivo: "di nuovo", actorUserId: 5, repository: repo })
    ).rejects.toThrow("PRECONDIZIONE");
  });

  // P3-R18: il riuso si decide prima di leggere il testo. Estrarlo (OCR
  // compreso) è la parte cara: una seconda richiesta non deve pagarla.
  it("(g) la seconda lettura riusa senza estrarre di nuovo il testo", async () => {
    const commessaId = await nuovaCommessa(SEDE);
    const documentoId = await nuovoDocumento(commessaId, SEDE);
    const { provider } = providerCheConta(() => JSON.stringify(esitoValido()));
    const { estraiTesto, conta } = parserCheConta("pdf-testo-nativo");
    const input = { sedeId: SEDE, commessaId, documentoId, actorUserId: 5, repository: repo, provider, estraiTesto };

    const prima = await eseguiEstrazioneContratto(input);
    expect(prima.riusata).toBe(false);
    expect(conta.n).toBe(1);

    const seconda = await eseguiEstrazioneContratto(input);
    expect(seconda.riusata).toBe(true);
    expect(seconda.estrazione.id).toBe(prima.estrazione.id);
    expect(conta.n).toBe(1); // il testo non è stato riletto

    // Con forza il testo si rilegge davvero.
    await eseguiEstrazioneContratto({ ...input, forza: true });
    expect(conta.n).toBe(2);
  });

  it("(h) il testo che arriva dall'OCR resta segnato nell'estrazione e nella versione del prompt", async () => {
    const commessaId = await nuovaCommessa(SEDE);
    const documentoId = await nuovoDocumento(commessaId, SEDE);
    const { provider } = providerCheConta(() => JSON.stringify(esitoValido()));
    const { estraiTesto } = parserCheConta("pdf-ocr");

    const { estrazione } = await eseguiEstrazioneContratto({
      sedeId: SEDE,
      commessaId,
      documentoId,
      actorUserId: 5,
      repository: repo,
      provider,
      estraiTesto,
    });
    expect(estrazione.ocr).toBe(true);
    expect(estrazione.parser).toBe("pdf-ocr");
    expect(estrazione.promptVersione.startsWith(`${PROMPT_ESTRAZIONE_VERSIONE}+ocr:`)).toBe(true);
    // La lettura OCR si riusa con la sua chiave, senza rileggere il testo.
    const { estraiTesto: secondoParser, conta } = parserCheConta("pdf-ocr");
    const seconda = await eseguiEstrazioneContratto({
      sedeId: SEDE,
      commessaId,
      documentoId,
      actorUserId: 5,
      repository: repo,
      provider,
      estraiTesto: secondoParser,
    });
    expect(seconda.riusata).toBe(true);
    expect(conta.n).toBe(0);
  });

  // P3-R19: chi applica la proposta firma anche le milestone che la board
  // porta avanti, invece di lasciarle senza nome.
  it("(i) applicaEstrazione firma la timeline con il nome di chi applica", async () => {
    const commessaId = await nuovaCommessa(SEDE);
    const documentoId = await nuovoDocumento(commessaId, SEDE);
    const { provider } = providerCheConta(() => JSON.stringify(esitoValido()));
    const { estrazione } = await eseguiEstrazioneContratto({
      sedeId: SEDE,
      commessaId,
      documentoId,
      actorUserId: 5,
      repository: repo,
      provider,
    });

    const timeline = timelineRouter.createCaller(ctx(SEDE) as any);
    await timeline.byCommessa(commessaId);
    const commessa = getCommessaById(commessaId) as any;
    commessa.stato = "misure_esecutive";

    await applicaEstrazione({
      sedeId: SEDE,
      commessaId,
      estrazioneId: estrazione.id,
      contratto: CONTRATTO_BASE,
      righe: RIGHE_BASE,
      actorUserId: 5,
      actorNome: "Mario Bianchi",
      repository: repo,
    });

    const steps = await timeline.byCommessa(commessaId);
    expect(steps[0].stato).toBe("completato");
    expect(steps[0].utente).toBe("Mario Bianchi");
  });

  it("(f) disponibilitaEstrazione segnala il flag spento con un motivo", () => {
    process.env.FLAG_CONTRATTO_ESTRAZIONE = "off";
    const esito = disponibilitaEstrazione();
    expect(esito.disponibile).toBe(false);
    expect(esito.motivo).toBeTruthy();
  });
});
