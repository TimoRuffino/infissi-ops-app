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
import { getSediStore } from "../routers/sedi";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
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

  // R45: nella finestra fra Fatture in Cloud e SdI il documento può ancora
  // cambiare, quindi nel fascicolo non ci entra. La sonda ora guarda anche
  // le emesse non spedite: deve archiviare XML e PDF e fermarsi lì.
  it("fattura emessa e non ancora spedita: archivia i file ma non tocca il fascicolo", async () => {
    const f = await creaFatturaInviata({
      stato: "emessa",
      eiStatusFic: "not_sent",
      xmlStorageKey: null,
      pdfStorageKey: null,
      xmlSha256: null,
      documentoId: null,
    });
    const registro: ChiamataFic[] = [];
    const client = creaClientFicFinto(
      {
        leggiDocumento: async () => documentoFicDa({ ei_status: "not_sent" }),
        scaricaXml: async () => Buffer.from("<xml/>", "utf-8"),
        scaricaPdf: async () => Buffer.from("%PDF-1.4 finto\n%%EOF\n", "utf-8"),
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

    expect(esito.fattura.stato).toBe("emessa");
    expect(esito.fattura.xmlStorageKey).toContain("fatture_xml/");
    expect(esito.fattura.pdfStorageKey).toContain("fatture_pdf/");
    expect(esito.fattura.documentoId).toBeNull();
    // E nessun errore: il fascicolo saltato di proposito non è un guasto.
    expect(esito.fattura.eiErrore).toBeNull();
  });

  // §5.3: la seconda direzione. Una modifica fatta DENTRO Fatture in Cloud
  // deve arrivare al CRM da sola, senza che nessuno prema niente.
  describe("modifica fatta su Fatture in Cloud", () => {
    const archivioFinto = {
      putFile: async (collection: string, _p: number, _r: number, nome: string) => ({
        storageKey: `${collection}/${nome}-nuovo`,
        checksum: "checksum-finto",
      }),
    } as any;

    async function sonda(f: Fattura, updatedAtDiFic: string | null, over: Record<string, unknown> = {}) {
      const registro: ChiamataFic[] = [];
      const client = creaClientFicFinto(
        {
          leggiDocumento: async () =>
            documentoFicDa({ ei_status: "not_sent", updatedAt: updatedAtDiFic, ...over }),
          scaricaXml: async () => Buffer.from("<xml/>", "utf-8"),
          scaricaPdf: async () => Buffer.from("%PDF-1.4 finto\n%%EOF\n", "utf-8"),
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
        storage: archivioFinto,
      });
      return { esito, registro };
    }

    it("l'orologio di FiC è avanzato: evento, file riscaricati, orologio riallineato", async () => {
      const f = await creaFatturaInviata({
        stato: "emessa",
        eiStatusFic: "not_sent",
        ficUpdatedAt: "2026-09-04 10:00:00",
      } as any);

      const { esito, registro } = await sonda(f, "2026-09-07 18:00:00");

      expect((await repository.eventi(SEDE, f.id)).map(e => e.tipo)).toContain("modificata_fic");
      expect(esito.fattura.ficUpdatedAt).toBe("2026-09-07 18:00:00");
      // L'archivio di prima descriveva un documento che non esiste più.
      expect(registro.map(c => c.metodo)).toEqual(["leggiDocumento", "scaricaXml", "scaricaPdf"]);
      expect(esito.fattura.xmlStorageKey).toContain("-nuovo");
      expect(esito.fattura.pdfStorageKey).toContain("-nuovo");
    });

    it("l'orologio è fermo: niente evento e niente da riscaricare", async () => {
      const f = await creaFatturaInviata({
        stato: "emessa",
        eiStatusFic: "not_sent",
        ficUpdatedAt: "2026-09-04 10:00:00",
      } as any);

      const { esito, registro } = await sonda(f, "2026-09-04 10:00:00");

      expect((await repository.eventi(SEDE, f.id)).map(e => e.tipo)).not.toContain("modificata_fic");
      expect(registro.map(c => c.metodo)).toEqual(["leggiDocumento"]);
      expect(esito.fattura.xmlStorageKey).toBe(f.xmlStorageKey);
    });

    it("i totali cambiati di là si vedono in eiErrore, senza toccare le nostre righe", async () => {
      const f = await creaFatturaInviata({
        stato: "emessa",
        eiStatusFic: "not_sent",
        ficUpdatedAt: "2026-09-04 10:00:00",
      } as any);

      const { esito } = await sonda(f, "2026-09-07 18:00:00", { amount_gross: 15999.99 });

      expect(esito.fattura.eiErrore).toContain("Totali FiC diversi dai nostri");
      expect(esito.fattura.totaleCent).toBe(f.totaleCent);
    });
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
  // R20 (fix wave finale): `conTenantDellaSede` è fail-closed a interruttore
  // acceso — una sede che non esiste lancia invece di ripiegare sul tenant 1.
  // Le sedi vanno quindi dichiarate, come in produzione.
  beforeEach(() => {
    getSediStore().length = 0;
    getSediStore().push(
      { id: SEDE, tenantId: 1, nome: "La Spezia", attiva: true } as any,
      { id: ALTRA_SEDE, tenantId: 1, nome: "Altra", attiva: true } as any
    );
  });

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

// Task 10 (WS2 «porta aperta»): la sonda gira ogni 15 minuti su un timer,
// fuori da qualunque richiesta. Le righe arrivano già raggruppate per sede:
// ogni gruppo va lavorato nel contesto del tenant della sua sede, altrimenti
// con FLAG_MULTI_AZIENDA acceso `contestoFicPerSede` (che legge lo store per
// tenant `fic_config`) fallisce per ogni fattura.
describe("giroSonda per tenant (Task 10)", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(true);
    resetTenantRepositoryForTesting();
    const tenants = getTenantRepository();
    await tenants.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
    await tenants.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push(
      { id: 10, tenantId: 1, nome: "A", attiva: true } as any,
      { id: 20, tenantId: 2, nome: "B", attiva: true } as any
    );
  });
  afterEach(() => modalitaTenantStretta(false));

  it("ogni sede è sondata nel contesto del suo tenant e un errore non ferma le altre", async () => {
    await creaFatturaInviata({ ficDocumentId: 701 }, 10);
    await creaFatturaInviata({ ficDocumentId: 702 }, 20);
    const visti: Array<{ sedeId: number; tenant: number | null }> = [];
    const client = creaClientFicFinto({
      leggiDocumento: async (_ctx, documentId) => {
        visti.push({ sedeId: 10, tenant: tenantCorrente() });
        return documentoFicDa({ id: documentId, ei_status: "delivered" });
      },
    });
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});
    let esito: { controllate: number; cambiate: number; errori: number };
    try {
      esito = await giroSonda({
        repository,
        client,
        now: () => ora,
        contesto: async sedeId => {
          if (sedeId === 20) {
            visti.push({ sedeId, tenant: tenantCorrente() });
            throw new Error("PRECONDIZIONE: Fatture in Cloud non è collegato.");
          }
          return { companyId: 77, token: "token-finto" };
        },
      });
    } finally {
      errore.mockRestore();
    }

    expect(esito).toEqual({ controllate: 2, cambiate: 1, errori: 1 });
    expect(visti.sort((a, b) => a.sedeId - b.sedeId)).toEqual([
      { sedeId: 10, tenant: 1 },
      { sedeId: 20, tenant: 2 },
    ]);
  });
});

describe("startSondaFattureWorker", () => {
  afterEach(() => {
    stopSondaFattureWorker();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // §7.1: lo stesso tick che sonda gli stati va anche a cercare
  // l'operatore per le fatture in scadenza. Un avviso che fallisce non
  // deve portarsi via il giro della sonda.
  it("ogni tick sonda gli stati e poi manda gli avvisi di scadenza", async () => {
    vi.useFakeTimers();
    const flagOriginale = process.env.FLAG_FATTURAZIONE;
    try {
      process.env.FLAG_FATTURAZIONE = "on";
      const ordine: string[] = [];
      const giro = vi.fn(async () => {
        ordine.push("giro");
        return { controllate: 0, cambiate: 0, errori: 0 };
      });
      const avvisi = vi.fn(async () => {
        ordine.push("avvisi");
        return { avvisate: [] };
      });
      startSondaFattureWorker({ giro, avvisi });

      await vi.advanceTimersByTimeAsync(40_000);
      expect(ordine).toEqual(["giro", "avvisi"]);
      stopSondaFattureWorker();
    } finally {
      if (flagOriginale === undefined) delete process.env.FLAG_FATTURAZIONE;
      else process.env.FLAG_FATTURAZIONE = flagOriginale;
    }
  });

  it("un avviso che fallisce non porta via il giro della sonda", async () => {
    vi.useFakeTimers();
    const flagOriginale = process.env.FLAG_FATTURAZIONE;
    try {
      process.env.FLAG_FATTURAZIONE = "on";
      const giro = vi.fn(async () => ({ controllate: 3, cambiate: 0, errori: 0 }));
      const avvisi = vi.fn(async () => {
        throw new Error("notifiche non disponibili");
      });
      startSondaFattureWorker({ giro, avvisi });

      await vi.advanceTimersByTimeAsync(40_000);
      expect(giro).toHaveBeenCalledTimes(1);
      // Il tick successivo riparte lo stesso: `inCorso` non è rimasto su.
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(giro).toHaveBeenCalledTimes(2);
      stopSondaFattureWorker();
    } finally {
      if (flagOriginale === undefined) delete process.env.FLAG_FATTURAZIONE;
      else process.env.FLAG_FATTURAZIONE = flagOriginale;
    }
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

  it("stopSondaFattureWorker azzera anche il setTimeout del primo giro, non solo l'intervallo", async () => {
    vi.useFakeTimers();
    const giro = vi.fn(async () => ({
      controllate: 0,
      cambiate: 0,
      errori: 0,
    }));

    startSondaFattureWorker({ giro });
    stopSondaFattureWorker();
    await vi.advanceTimersByTimeAsync(40_000);

    // Se stopSondaFattureWorker non azzerasse anche il setTimeout del
    // primo giro (solo l'intervallo), questo scatterebbe comunque.
    expect(giro).not.toHaveBeenCalled();
  });

  it("il flag spento non fa scattare il giro; acceso lo fa scattare una volta, e un tick concorrente si salta mentre inCorso", async () => {
    vi.useFakeTimers();
    const flagOriginale = process.env.FLAG_FATTURAZIONE;
    try {
      process.env.FLAG_FATTURAZIONE = "off";
      const giroSpento = vi.fn(async () => ({
        controllate: 0,
        cambiate: 0,
        errori: 0,
      }));
      startSondaFattureWorker({ giro: giroSpento });
      await vi.advanceTimersByTimeAsync(40_000);
      expect(giroSpento).not.toHaveBeenCalled();
      stopSondaFattureWorker();

      process.env.FLAG_FATTURAZIONE = "on";
      let sblocca: (() => void) | undefined;
      const attesa = new Promise<void>(resolve => {
        sblocca = resolve;
      });
      const giroAcceso = vi.fn(async () => {
        await attesa;
        return { controllate: 1, cambiate: 1, errori: 0 };
      });
      startSondaFattureWorker({ giro: giroAcceso });

      await vi.advanceTimersByTimeAsync(40_000);
      expect(giroAcceso).toHaveBeenCalledTimes(1);

      // Il primo giro non si è ancora risolto (inCorso resta true): il
      // tick dell'intervallo successivo (15 minuti dopo) deve saltarlo,
      // non richiamare giro una seconda volta in parallelo.
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(giroAcceso).toHaveBeenCalledTimes(1);

      // Sbloccato il primo giro, inCorso torna libero: il giro successivo
      // richiama di nuovo giro (non è rimasto incastrato per sempre).
      sblocca!();
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(giroAcceso).toHaveBeenCalledTimes(2);
    } finally {
      if (flagOriginale === undefined) delete process.env.FLAG_FATTURAZIONE;
      else process.env.FLAG_FATTURAZIONE = flagOriginale;
    }
  });
});
