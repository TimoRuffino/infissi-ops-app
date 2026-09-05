// Router tRPC `estrazioniContratto`: valida, autorizza, delega al servizio
// (server/contratti/estrazione/servizio.ts) e mappa gli errori. Stesso
// pattern di server/routers/fatture.test.ts. `eseguiEstrazioneContratto` e
// `applicaEstrazione` sono mockati: la lettura vera chiama il modello, e i
// test non devono mai raggiungere la rete (server/_core/testSetup.ts).
// `disponibilitaEstrazione`, `ultimaEstrazione` e `scartaEstrazione`
// restano reali: sono lookup deterministici (flag e repository in
// memoria), senza rete, e provano che il router li collega davvero.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT } from "@shared/limiti/tipi";
import type { TrpcContext } from "../_core/context";
import { pdfConTesto } from "../documenti/pdfMinimo";
import { creaProviderFinto, rispostaTesto } from "../tars/openai/fake";
import { creaCommessa } from "./commesse";
import { getClientiStore } from "./clienti";
import { caricaDocumentoCommessaDaBuffer } from "./preventiviContratti";

vi.mock("../contratti/estrazione/servizio", async importOriginal => {
  const actual = await importOriginal<typeof import("../contratti/estrazione/servizio")>();
  return { ...actual, eseguiEstrazioneContratto: vi.fn(), applicaEstrazione: vi.fn() };
});

import { applicaEstrazione, eseguiEstrazioneContratto } from "../contratti/estrazione/servizio";
import { appRouter } from "../routers";

// `scarta` non è mockato: legge e scrive il repository di DEFAULT, quindi
// l'estrazione da scartare deve esistere davvero lì. `importActual` dà
// l'implementazione originale di `eseguiEstrazioneContratto` senza il mock;
// `repository.ts` non è mockato, quindi il singleton è lo stesso modulo che
// vede il router — è questo a rendere il test un test del router e non del
// suo doppio.
const servizioReale =
  await vi.importActual<typeof import("../contratti/estrazione/servizio")>("../contratti/estrazione/servizio");

function context(sedeId: number, userId: number, ruoli: string[]): TrpcContext {
  return {
    user: { id: userId, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "Collaudo" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

// Cliente sintetico e anonimo: nessun nome reale, stesso principio del
// fixture "Prova"/"Cliente" di server/contratti/estrazione/servizio.test.ts.
let prossimoClienteId = 986_000;

async function nuovaCommessa(sedeId = 1): Promise<number> {
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
  const creata = await creaCommessa(context(sedeId, 1, ["direzione"]), { clienteId: cliente.id } as any);
  return (creata as any).commessa?.id ?? (creata as any).id;
}

// Documento e risposta del modello sintetici (nessun contratto reale):
// stessa coppia di server/contratti/estrazione/servizio.test.ts, ridotta a
// una riga — al router serve solo un'estrazione in stato "proposta".
const RIGHE_DOCUMENTO = [
  "CONTRATTO DI FORNITURA E POSA",
  "Finestra 2 ante PVC",
  "Larghezza 1200 mm Altezza 1400 mm - quantita 1 - 1.000,00 EUR",
  "Totale IVA Inclusa 1.000,00 EUR",
];

const ESITO_MODELLO = {
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

/** Estrazione vera nel repository di default: commessa, documento PDF, provider finto. */
async function estrazioneReale(sedeId: number): Promise<{ commessaId: number; estrazioneId: number }> {
  const commessaId = await nuovaCommessa(sedeId);
  const documento = await caricaDocumentoCommessaDaBuffer({
    commessaId,
    nome: "Contratto.pdf",
    tipo: "contratto",
    mimeType: "application/pdf",
    buffer: pdfConTesto(RIGHE_DOCUMENTO),
    sedeId,
    createdBy: 1,
    keepNome: true,
  });
  const { estrazione } = await servizioReale.eseguiEstrazioneContratto({
    sedeId,
    commessaId,
    documentoId: documento.id,
    actorUserId: 1,
    provider: creaProviderFinto(() => rispostaTesto(JSON.stringify(ESITO_MODELLO))),
  });
  return { commessaId, estrazioneId: estrazione.id };
}

// Stessa forma di server/routers/contratti.test.ts: valori di
// configurazione del contratto, non dati di un cliente reale.
const contrattoValido = {
  pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, notePosa: null,
  comuneCantiere: "Sarzana", zonaManuale: false, piano: 2, distanzaKm: 18,
  detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
  detrazionePct: null, dataFirma: "2026-08-20", rate: [], origine: "estrazione" as const, documentoId: null,
  opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
};
const rigaValida = {
  categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null,
  oscuranteTipologia: null,
  descrizione: "Finestra", quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null,
  prezzoUnitCent: null, prezzoTotCent: 300000, beneSignificativo: true, accessori: [], note: null,
  origine: "estrazione" as const, evidenza: null,
};

beforeEach(() => {
  vi.mocked(eseguiEstrazioneContratto).mockReset();
  vi.mocked(applicaEstrazione).mockReset();
});

describe("router estrazioniContratto — interruttori", () => {
  it("FLAG_CONTRATTO_ESTRAZIONE spento blocca anche la direzione (l'errore del kill switch, non NOT_FOUND)", async () => {
    const prima = process.env.FLAG_CONTRATTO_ESTRAZIONE;
    try {
      process.env.FLAG_CONTRATTO_ESTRAZIONE = "off";
      const direzione = appRouter.createCaller(context(1, 1, ["direzione"]));
      // Ruling P3-R23: con l'interruttore spento la convenzione del
      // repository è quella di `assicuraInterruttore` (PRECONDITION_FAILED),
      // non il NOT_FOUND del brief del Task 7 — il test segue il codice.
      await expect(direzione.estrazioniContratto.stato({ commessaId: 1, documentoId: 1 })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    } finally {
      if (prima === undefined) delete process.env.FLAG_CONTRATTO_ESTRAZIONE;
      else process.env.FLAG_CONTRATTO_ESTRAZIONE = prima;
    }
  });

  it("FLAG_LIMITI spento blocca la lettura anche col flag contrattoEstrazione acceso (PRECONDITION_FAILED)", async () => {
    const prima = process.env.FLAG_LIMITI;
    try {
      process.env.FLAG_LIMITI = "off";
      const direzione = appRouter.createCaller(context(1, 1, ["direzione"]));
      await expect(direzione.estrazioniContratto.stato({ commessaId: 1, documentoId: 1 })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    } finally {
      if (prima === undefined) delete process.env.FLAG_LIMITI;
      else process.env.FLAG_LIMITI = prima;
    }
  });
});

describe("router estrazioniContratto — autorizzazione", () => {
  it("tecnico_rilievi legge lo stato ma non può eseguire, applicare o scartare (FORBIDDEN)", async () => {
    const commessaId = await nuovaCommessa(1);
    const tecnico = appRouter.createCaller(context(1, 33, ["tecnico_rilievi"]));

    const stato = await tecnico.estrazioniContratto.stato({ commessaId, documentoId: 501 });
    expect(stato.puoApplicare).toBe(false);
    expect(stato).toHaveProperty("disponibile");
    expect(stato).toHaveProperty("ultima");

    await expect(tecnico.estrazioniContratto.esegui({ commessaId, documentoId: 501 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      tecnico.estrazioniContratto.applica({ commessaId, estrazioneId: 1, contratto: contrattoValido, righe: [] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(tecnico.estrazioniContratto.scarta({ estrazioneId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Nessuna delle tre chiamate respinte deve aver raggiunto il servizio.
    expect(eseguiEstrazioneContratto).not.toHaveBeenCalled();
    expect(applicaEstrazione).not.toHaveBeenCalled();
  });
});

describe("router estrazioniContratto — sede", () => {
  it("una commessa di un'altra sede riceve NOT_FOUND, non FORBIDDEN", async () => {
    const commessaId = await nuovaCommessa(1);
    const altra = appRouter.createCaller(context(2, 40, ["direzione"]));
    await expect(altra.estrazioniContratto.stato({ commessaId, documentoId: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(altra.estrazioniContratto.esegui({ commessaId, documentoId: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(eseguiEstrazioneContratto).not.toHaveBeenCalled();
  });

  it("applica su una commessa di un'altra sede è NOT_FOUND e non raggiunge il servizio", async () => {
    const commessaId = await nuovaCommessa(1);
    const altra = appRouter.createCaller(context(2, 40, ["direzione"]));
    await expect(
      altra.estrazioniContratto.applica({ commessaId, estrazioneId: 1, contratto: contrattoValido, righe: [rigaValida] })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Commessa non trovata." });
    expect(applicaEstrazione).not.toHaveBeenCalled();
  });

  it("scarta un'estrazione di un'altra sede è NOT_FOUND (il repository scopa per sede)", async () => {
    // Niente commessaId in input: la garanzia di sede sta tutta nel
    // `perId(sedeId, id)` del repository. L'id esiste davvero — è solo
    // invisibile alla sede 2 — e il messaggio non dice altro.
    const { estrazioneId } = await estrazioneReale(1);
    const altra = appRouter.createCaller(context(2, 40, ["direzione"]));
    await expect(altra.estrazioniContratto.scarta({ estrazioneId })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Estrazione non trovata.",
    });
  });
});

describe("router estrazioniContratto — scarta", () => {
  it("scarta la proposta e registra il motivo", async () => {
    const { estrazioneId } = await estrazioneReale(1);
    const direzione = appRouter.createCaller(context(1, 91, ["direzione"]));

    const scartata = await direzione.estrazioniContratto.scarta({ estrazioneId, motivo: "doppione" });

    expect(scartata.stato).toBe("scartata");
    expect(scartata.scartataMotivo).toBe("doppione");

    // La proposta si prende una volta sola: la seconda chiamata trova uno
    // stato che non è più "proposta" (PRECONDIZIONE → PRECONDITION_FAILED).
    await expect(direzione.estrazioniContratto.scarta({ estrazioneId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("il motivo si ferma a 300 caratteri, come in fatture.ts", async () => {
    const direzione = appRouter.createCaller(context(1, 91, ["direzione"]));
    await expect(
      direzione.estrazioniContratto.scarta({ estrazioneId: 1, motivo: "x".repeat(301) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("router estrazioniContratto — esegui", () => {
  it("passa sedeId e actorUserId al servizio mockato", async () => {
    const commessaId = await nuovaCommessa(1);
    vi.mocked(eseguiEstrazioneContratto).mockResolvedValueOnce({
      estrazione: { id: 42, stato: "proposta" } as any,
      riusata: false,
    });
    const direzione = appRouter.createCaller(context(1, 77, ["direzione"]));

    const esito = await direzione.estrazioniContratto.esegui({ commessaId, documentoId: 501, forza: true });

    expect(esito.estrazione).toMatchObject({ id: 42 });
    expect(esito.riusata).toBe(false);
    expect(eseguiEstrazioneContratto).toHaveBeenCalledTimes(1);
    expect(eseguiEstrazioneContratto).toHaveBeenCalledWith(
      expect.objectContaining({
        sedeId: 1,
        commessaId,
        documentoId: 501,
        actorUserId: 77,
        forza: true,
      })
    );
  });
});

describe("router estrazioniContratto — applica", () => {
  it("valida il contratto con lo zod del servizio (BAD_REQUEST), senza raggiungerlo", async () => {
    const direzione = appRouter.createCaller(context(1, 1, ["direzione"]));
    await expect(
      direzione.estrazioniContratto.applica({
        commessaId: 1,
        estrazioneId: 1,
        // pattuitoCent deve essere un intero non negativo: la forma non
        // rispetta contrattoInputSchema, l'input muore prima del router.
        contratto: { ...contrattoValido, pattuitoCent: "non-un-numero" } as any,
        righe: [],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(applicaEstrazione).not.toHaveBeenCalled();
  });

  it("passa actorNome (chi applica firma la milestone, P3-R19) al servizio mockato", async () => {
    const commessaId = await nuovaCommessa(1);
    vi.mocked(applicaEstrazione).mockResolvedValueOnce({
      contratto: { id: 9 } as any,
      righe: [],
      avvertenze: [],
    });
    const direzione = appRouter.createCaller(context(1, 88, ["direzione"]));

    await direzione.estrazioniContratto.applica({
      commessaId,
      estrazioneId: 5,
      contratto: contrattoValido,
      righe: [rigaValida],
    });

    expect(applicaEstrazione).toHaveBeenCalledTimes(1);
    expect(applicaEstrazione).toHaveBeenCalledWith(
      expect.objectContaining({
        sedeId: 1,
        commessaId,
        estrazioneId: 5,
        actorUserId: 88,
        actorNome: "Collaudo",
      })
    );
  });
});
