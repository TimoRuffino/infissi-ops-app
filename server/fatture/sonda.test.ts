// server/fatture/sonda.test.ts
// La sonda degli stati SdI: mappa pura, aggiornamento di una fattura sola
// (con ripresa dell'archivio mancante) e il giro su tutte le sedi. Nessuna
// rete: client FiC finto a copione (server/fic/fake.ts), repository in
// memoria. Le fatture nascono direttamente da `repository.crea` — come in
// repository.test.ts — non dalla pipeline di emissione: la sonda parte
// sempre da una fattura già «inviata», non serve costruirla da zero.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Fattura } from "@shared/fatturazione/tipi";
import { sha256Hex } from "../_core/fileStorage";
import type { DocumentoFicCreato } from "../fic/emissione";
import { creaClientFicFinto, type ChiamataFic } from "../fic/fake";
import {
  createMemoryFattureRepository,
  type FattureRepository,
} from "./repository";
import {
  aggiornaStatoFattura,
  giroSonda,
  mappaEiStatus,
  startSondaFattureWorker,
  stopSondaFattureWorker,
} from "./sonda";

const ora = new Date("2026-09-04T10:00:00Z");
const ATTORE = 7701;
const SEDE = 1;
const ALTRA_SEDE = 2;
const AVVISO_ERRORE =
  "FiC segnala un errore di gestione: riprova l'invio o contatta il supporto";

const contestoFinto = async () => ({ companyId: 77, token: "token-finto" });

let repository: FattureRepository;

/** Tutti i campi di `FatturaPersist`: una fattura già «inviata», con
 * documento FiC e archivio già completi di default — i test sull'archivio
 * mancante li azzerano esplicitamente con `over`. */
const baseFattura = (sedeId = SEDE) =>
  ({
    sedeId,
    commessaId: 990001,
    computoId: null,
    hashRighe: null,
    tipo: "fattura" as const,
    notaCreditoDi: null,
    stato: "inviata" as const,
    ficDocumentId: 88123,
    numero: "127/2026",
    data: "2026-09-04",
    clienteSnapshot: null,
    pattuitoTipo: "lordo" as const,
    pattuitoCent: 1549652,
    imponibileCent: 1267090,
    ivaCent: 282562,
    totaleCent: 1549652,
    deltaPattuitoCent: 0,
    markupCent: 0,
    stornoCent: 0,
    diciture: [] as string[],
    note: null,
    intestazioneCantiere: null,
    detrazioneTipo: "nessuna" as const,
    pdfStorageKey: "fatture_pdf/990001/1-finto",
    xmlStorageKey: "fatture_xml/990001/1-finto",
    xmlSha256: "sha-finto",
    documentoId: 5001,
    eiStatusFic: "sent",
    eiErrore: null,
    inviataDryRun: false,
    scavalcoLimiti: false,
    scavalcoMotivo: null,
    createdBy: ATTORE,
    emessaDa: ATTORE,
    emessaAt: ora,
  }) satisfies Parameters<FattureRepository["crea"]>[0]["fattura"];

async function creaFatturaInviata(
  over: Partial<ReturnType<typeof baseFattura>> = {},
  sedeId = SEDE
): Promise<Fattura> {
  return repository.crea({
    fattura: { ...baseFattura(sedeId), ...over },
    righe: [],
    riepilogo: [],
    scadenze: [],
    now: ora,
  });
}

const documentoFicDa = (
  over: Partial<DocumentoFicCreato> = {}
): DocumentoFicCreato => ({
  id: 88123,
  number: 127,
  numeration: "/2026",
  date: "2026-09-04",
  amount_net: 12670.9,
  amount_vat: 2825.62,
  amount_gross: 15496.52,
  url: "https://fatture.example.test/127.pdf",
  ei_status: null,
  payments_list: [],
  ...over,
});

beforeEach(() => {
  repository = createMemoryFattureRepository();
});

describe("mappaEiStatus", () => {
  it("mappa ogni ei_status di FiC allo stato del CRM (spec §7.5.8)", () => {
    const casi: Array<[string, Fattura["stato"]]> = [
      ["attempt", "inviata"],
      ["pending", "inviata"],
      ["sent", "inviata"],
      ["processing", "inviata"],
      ["delivered", "consegnata"],
      ["accepted", "consegnata"],
      ["manual_accepted", "consegnata"],
      ["discarded", "scartata"],
      ["rejected", "rifiutata"],
      ["manual_rejected", "rifiutata"],
      ["not_delivered", "mancata_consegna"],
      ["no_response", "mancata_consegna"],
    ];
    for (const [ei, statoAtteso] of casi) {
      expect(mappaEiStatus(ei)).toEqual({ stato: statoAtteso, avviso: null });
    }
    expect(mappaEiStatus("error")).toEqual({
      stato: "inviata",
      avviso: AVVISO_ERRORE,
    });
  });

  it("not_sent, missing, null e un valore sconosciuto non cambiano nulla", () => {
    for (const ei of ["not_sent", "missing", null, "qualcosa_di_strano"]) {
      expect(mappaEiStatus(ei)).toEqual({ stato: null, avviso: null });
    }
  });
});

describe("aggiornaStatoFattura", () => {
  it("delivered → consegnata, un evento stato_sdi, archivio già completo non si ritocca", async () => {
    const f = await creaFatturaInviata();
    const registro: ChiamataFic[] = [];
    const client = creaClientFicFinto(
      {
        leggiDocumento: async () => documentoFicDa({ ei_status: "delivered" }),
      },
      registro
    );

    const esito = await aggiornaStatoFattura({
      sedeId: SEDE,
      id: f.id,
      actorUserId: ATTORE,
      repository,
      now: () => ora,
      client,
      contesto: contestoFinto,
    });

    expect(esito.cambiato).toBe(true);
    expect(esito.fattura.stato).toBe("consegnata");
    expect(esito.fattura.eiStatusFic).toBe("delivered");
    expect(esito.fattura.eiErrore).toBeNull();
    // Nessuna scaricaXml/scaricaPdf: xmlStorageKey/pdfStorageKey erano già
    // valorizzate da baseFattura(), l'archivio non va ritentato.
    expect(registro.map(c => c.metodo)).toEqual(["leggiDocumento"]);

    const eventi = await repository.eventi(SEDE, f.id);
    expect(eventi).toHaveLength(1);
    expect(eventi[0].tipo).toBe("stato_sdi");
    expect(eventi[0].payload).toEqual({
      da: "inviata",
      a: "consegnata",
      eiStatus: "delivered",
    });
    expect(eventi[0].actorUserId).toBe(ATTORE);
  });

  it("discarded → scartata con il motivo di motivoScarto, evento scarto", async () => {
    const f = await creaFatturaInviata();
    const client = creaClientFicFinto({
      leggiDocumento: async () => documentoFicDa({ ei_status: "discarded" }),
      motivoScarto: async () => "Codice destinatario non valido",
    });

    const esito = await aggiornaStatoFattura({
      sedeId: SEDE,
      id: f.id,
      actorUserId: ATTORE,
      repository,
      now: () => ora,
      client,
      contesto: contestoFinto,
    });

    expect(esito.cambiato).toBe(true);
    expect(esito.fattura.stato).toBe("scartata");
    expect(esito.fattura.eiStatusFic).toBe("discarded");
    expect(esito.fattura.eiErrore).toBe("Codice destinatario non valido");

    const eventi = await repository.eventi(SEDE, f.id);
    expect(eventi.map(e => e.tipo)).toEqual(["scarto"]);
    expect(eventi[0].payload).toEqual({
      da: "inviata",
      a: "scartata",
      eiStatus: "discarded",
    });
  });

  it("error → stato invariato, avviso in eiErrore, nessun evento", async () => {
    const f = await creaFatturaInviata();
    const client = creaClientFicFinto({
      leggiDocumento: async () => documentoFicDa({ ei_status: "error" }),
    });

    const esito = await aggiornaStatoFattura({
      sedeId: SEDE,
      id: f.id,
      actorUserId: ATTORE,
      repository,
      now: () => ora,
      client,
      contesto: contestoFinto,
    });

    expect(esito.cambiato).toBe(false);
    expect(esito.fattura.stato).toBe("inviata");
    expect(esito.fattura.eiStatusFic).toBe("error");
    expect(esito.fattura.eiErrore).toBe(AVVISO_ERRORE);
    expect(await repository.eventi(SEDE, f.id)).toEqual([]);
  });

  it("not_sent → nessun cambio, eiStatusFic comunque aggiornato, un eiErrore vecchio si ripulisce", async () => {
    const f = await creaFatturaInviata({ eiErrore: "vecchio errore" });
    const client = creaClientFicFinto({
      leggiDocumento: async () => documentoFicDa({ ei_status: "not_sent" }),
    });

    const esito = await aggiornaStatoFattura({
      sedeId: SEDE,
      id: f.id,
      actorUserId: ATTORE,
      repository,
      now: () => ora,
      client,
      contesto: contestoFinto,
    });

    expect(esito.cambiato).toBe(false);
    expect(esito.fattura.stato).toBe("inviata");
    expect(esito.fattura.eiStatusFic).toBe("not_sent");
    expect(esito.fattura.eiErrore).toBeNull();
    expect(await repository.eventi(SEDE, f.id)).toEqual([]);
  });

  it("fattura di un'altra sede: NOT_FOUND prima di ogni chiamata FiC o scrittura", async () => {
    const f = await creaFatturaInviata({}, SEDE);
    const registro: ChiamataFic[] = [];
    const client = creaClientFicFinto({}, registro);

    await expect(
      aggiornaStatoFattura({
        sedeId: ALTRA_SEDE,
        id: f.id,
        actorUserId: ATTORE,
        repository,
        now: () => ora,
        client,
        contesto: contestoFinto,
      })
    ).rejects.toThrow(/^NOT_FOUND/);

    expect(registro).toEqual([]);
    expect(await repository.eventi(SEDE, f.id)).toEqual([]);
    // Lo stato originale non si è mosso.
    expect((await repository.perId(SEDE, f.id))?.stato).toBe("inviata");
  });

  it("fattura senza documento FiC: PRECONDIZIONE", async () => {
    const f = await creaFatturaInviata({ ficDocumentId: null });

    await expect(
      aggiornaStatoFattura({
        sedeId: SEDE,
        id: f.id,
        actorUserId: ATTORE,
        repository,
        now: () => ora,
      })
    ).rejects.toThrow(/^PRECONDIZIONE/);
  });

  it("archivio mancante: lo ritenta riusando i passi di Task 9, e un problema d'archivio finisce in eiErrore", async () => {
    // commessaId volutamente inesistente: qui si verifica solo che
    // l'archivio venga RITENTATO (scaricaXml/scaricaPdf chiamati,
    // storageKey scritte, xmlSha256 corretto) e che il problema di
    // `archiviaFattura` (documento non registrabile nel fascicolo) finisca
    // in eiErrore — non la correttezza del fascicolo in sé, già provata in
    // emissione.test.ts.
    const XML_FINTO = Buffer.from("<xml/>", "utf-8");
    const PDF_FINTO = Buffer.from("%PDF-1.4 finto\n%%EOF\n", "utf-8");
    const f = await creaFatturaInviata({
      xmlStorageKey: null,
      pdfStorageKey: null,
      xmlSha256: null,
      documentoId: null,
      commessaId: 999999,
    });
    const registro: ChiamataFic[] = [];
    const client = creaClientFicFinto(
      {
        leggiDocumento: async () => documentoFicDa({ ei_status: "sent" }),
        scaricaXml: async () => XML_FINTO,
        scaricaPdf: async () => PDF_FINTO,
      },
      registro
    );
    const filesScritti: string[] = [];

    const esito = await aggiornaStatoFattura({
      sedeId: SEDE,
      id: f.id,
      actorUserId: ATTORE,
      repository,
      now: () => ora,
      client,
      contesto: contestoFinto,
      storage: {
        putFile: async (collection, _parentId, _recordId, nome) => {
          filesScritti.push(`${collection}/${nome}`);
          return {
            storageKey: `${collection}/${nome}-finto`,
            checksum: "checksum-finto",
          };
        },
      },
    });

    // "sent" → "inviata": è già lo stato attuale, nessun cambio.
    expect(esito.cambiato).toBe(false);
    expect(esito.fattura.xmlStorageKey).toBe("fatture_xml/127-2026.xml-finto");
    expect(esito.fattura.xmlSha256).toBe(sha256Hex(XML_FINTO));
    expect(esito.fattura.pdfStorageKey).toBe("fatture_pdf/127-2026.pdf-finto");
    expect(esito.fattura.documentoId).toBeNull();
    expect(esito.fattura.eiErrore).toBe(
      "Documento non archiviato nel fascicolo: Commessa non trovata"
    );
    expect(filesScritti).toEqual([
      "fatture_xml/127-2026.xml",
      "fatture_pdf/127-2026.pdf",
    ]);
    expect(registro.map(c => c.metodo)).toEqual([
      "leggiDocumento",
      "scaricaXml",
      "scaricaPdf",
    ]);
  });

  it("solo l'XML manca: basta che uno dei due sia null per ritentare l'archivio", async () => {
    const XML_FINTO = Buffer.from("<xml/>", "utf-8");
    // pdfStorageKey e documentoId restano quelli (già presenti) di
    // baseFattura(): prova che la condizione è un OR, non un AND — con un
    // AND questo caso non ritenterebbe nulla.
    const f = await creaFatturaInviata({
      xmlStorageKey: null,
      xmlSha256: null,
    });
    const registro: ChiamataFic[] = [];
    const client = creaClientFicFinto(
      {
        leggiDocumento: async () => documentoFicDa({ ei_status: "sent" }),
        scaricaXml: async () => XML_FINTO,
      },
      registro
    );

    const esito = await aggiornaStatoFattura({
      sedeId: SEDE,
      id: f.id,
      actorUserId: ATTORE,
      repository,
      now: () => ora,
      client,
      contesto: contestoFinto,
      storage: {
        putFile: async (collection, _parentId, _recordId, nome) => ({
          storageKey: `${collection}/${nome}-finto`,
          checksum: "checksum-finto",
        }),
      },
    });

    expect(esito.fattura.xmlStorageKey).toBe("fatture_xml/127-2026.xml-finto");
    expect(esito.fattura.pdfStorageKey).toBe(f.pdfStorageKey);
    // pdfStorageKey e documentoId erano già a posto: nessun problema, nessuna scaricaPdf.
    expect(esito.fattura.eiErrore).toBeNull();
    expect(registro.map(c => c.metodo)).toEqual([
      "leggiDocumento",
      "scaricaXml",
    ]);
  });
});

describe("giroSonda", () => {
  it("nessuna fattura da sondare", async () => {
    expect(await giroSonda({ repository })).toEqual({
      controllate: 0,
      cambiate: 0,
      errori: 0,
    });
  });

  it("due fatture su sedi diverse: la sede senza token isola l'errore, l'altra procede", async () => {
    const fA = await creaFatturaInviata({ ficDocumentId: 501 }, SEDE);
    const fB = await creaFatturaInviata({ ficDocumentId: 502 }, ALTRA_SEDE);

    const client = creaClientFicFinto({
      leggiDocumento: async (_ctx, documentId) => {
        expect(documentId).toBe(501);
        return documentoFicDa({ id: 501, ei_status: "delivered" });
      },
    });

    const esito = await giroSonda({
      repository,
      client,
      now: () => ora,
      contesto: async sedeId => {
        if (sedeId === ALTRA_SEDE) {
          throw new Error(
            "PRECONDIZIONE: Fatture in Cloud non è collegato per questa sede: collega l'account e seleziona l'azienda."
          );
        }
        return { companyId: 77, token: "token-finto" };
      },
    });

    expect(esito).toEqual({ controllate: 2, cambiate: 1, errori: 1 });
    expect((await repository.perId(SEDE, fA.id))?.stato).toBe("consegnata");
    // fB non è mai stata sondata: la sua sede non ha risolto il contesto.
    expect((await repository.perId(ALTRA_SEDE, fB.id))?.stato).toBe("inviata");
    expect((await repository.perId(ALTRA_SEDE, fB.id))?.eiStatusFic).toBe(
      "sent"
    );
  });

  it("isola gli errori per singola fattura, anche sulla stessa sede, risolvendo il contesto una volta sola", async () => {
    const fOk = await creaFatturaInviata({ ficDocumentId: 601 });
    const fRotta = await creaFatturaInviata({ ficDocumentId: 602 });

    const client = creaClientFicFinto({
      leggiDocumento: async (_ctx, documentId) => {
        if (documentId === 602) throw new Error("FiC non risponde");
        return documentoFicDa({ id: 601, ei_status: "delivered" });
      },
    });
    const contesto = vi.fn(contestoFinto);

    const esito = await giroSonda({
      repository,
      client,
      now: () => ora,
      contesto,
    });

    expect(esito).toEqual({ controllate: 2, cambiate: 1, errori: 1 });
    expect((await repository.perId(SEDE, fOk.id))?.stato).toBe("consegnata");
    expect((await repository.perId(SEDE, fRotta.id))?.stato).toBe("inviata");
    // Due fatture, stessa sede: il token si risolve una volta, non due.
    expect(contesto).toHaveBeenCalledTimes(1);
  });
});

describe("startSondaFattureWorker", () => {
  afterEach(() => {
    stopSondaFattureWorker();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("una seconda chiamata non registra un secondo intervallo", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    startSondaFattureWorker();
    startSondaFattureWorker();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      15 * 60 * 1000
    );
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 40_000);
  });
});
