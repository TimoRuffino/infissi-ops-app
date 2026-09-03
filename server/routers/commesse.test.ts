// Test del dominio centrale: state machine, doc gate, cleanup di rollback,
// regime del pattuito (FiC vs manuale), registro pagamenti e isolamento sede.
// Sono le invarianti I1-I6 del discovery dossier (28/08/2026): prima di
// questa suite il router non aveva un file di test proprio.

import { describe, expect, it, vi } from "vitest";

// L'upload dei documenti passa dal layer storage: nei test i byte non devono
// finire su disco. Stesso pattern di preventiviContratti.test.ts.
vi.mock("../_core/fileStorage", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/fileStorage")>();
  return {
    ...actual,
    putFile: vi.fn(async () => ({
      storageKey: "preventivi_documenti/test/doc.pdf",
      checksum: "a".repeat(64),
    })),
  };
});

vi.mock("../_core/persistence", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/persistence")>();
  return {
    ...actual,
    conTransazioneStoreAtomica: vi.fn(actual.conTransazioneStoreAtomica),
  };
});

import type { TrpcContext } from "../_core/context";
import { conTransazioneStoreAtomica } from "../_core/persistence";
import { appRouter } from "../routers";
import {
  STATI_COMMESSA,
  applicaPattuitoDaFic,
  dipendenzeTransizioniCommesse,
  getCommessaById,
} from "./commesse";
import { getClienteById } from "./clienti";
import type { DocumentoFicPerPiano } from "../_core/commessaPattuito";
import { setFeatureFlagsForTesting } from "../platform/featureFlags";

const SEDE = 90101;
const ALTRA_SEDE = 90102;

function context(
  userId: number,
  roles: string[] = ["direzione"],
  sedeId = SEDE
): TrpcContext {
  return {
    user: {
      id: userId,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) =>
  appRouter.createCaller(context(90111, ["direzione"], sedeId));

const transazioneAtomica = vi.mocked(conTransazioneStoreAtomica);
const implementazioneTransazione = transazioneAtomica.getMockImplementation();

function differita() {
  let risolvi!: () => void;
  const promessa = new Promise<void>(resolve => {
    risolvi = resolve;
  });
  return { promessa, risolvi };
}

function contesaConPrimoCommitFallito() {
  const rilasciaPrimoCommit = differita();
  const secondaTransazioneTentata = differita();
  let coda = Promise.resolve();
  let chiamate = 0;

  transazioneAtomica.mockImplementation((async (_stores: any, operazione: any) => {
    const numero = ++chiamate;
    const precedente = coda;
    const turno = differita();
    coda = turno.promessa;
    if (numero === 2) secondaTransazioneTentata.risolvi();
    await precedente;
    try {
      return await operazione(async () => {
        if (numero === 1) {
          await rilasciaPrimoCommit.promessa;
          throw new Error("commit transizione fallito");
        }
      });
    } finally {
      turno.risolvi();
    }
  }) as any);

  return {
    rilasciaPrimoCommit: rilasciaPrimoCommit.risolvi,
    secondaTransazioneTentata: secondaTransazioneTentata.promessa,
  };
}

/** Porta una commessa allo stato voluto passo per passo, con force. */
async function portaAllo(
  caller: ReturnType<typeof direzione>,
  id: number,
  targetIdx: number
) {
  for (let step = 1; step <= targetIdx; step++) {
    await caller.commesse.update({
      id,
      stato: STATI_COMMESSA[step],
      force: true,
    });
  }
}

describe("state machine della commessa", () => {
  it("consente esattamente le transizioni adiacenti, nei due versi, anche con force", async () => {
    const caller = direzione();
    for (let from = 0; from < STATI_COMMESSA.length; from++) {
      for (let to = 0; to < STATI_COMMESSA.length; to++) {
        if (from === to) continue;
        const commessa = await caller.commesse.create({
          cliente: `SM ${from}->${to}`,
        });
        await portaAllo(caller, commessa.id, from);

        const tentativo = caller.commesse.update({
          id: commessa.id,
          stato: STATI_COMMESSA[to],
          force: true,
        });
        if (Math.abs(to - from) === 1) {
          await expect(tentativo).resolves.toMatchObject({
            stato: STATI_COMMESSA[to],
          });
        } else {
          // `force` salta solo il doc gate: la forma del workflow resta.
          await expect(tentativo).rejects.toThrow(
            /Transizione non consentita/
          );
        }
      }
    }
  });

  it("entrare in archiviata imposta dataChiusura; tornare indietro la azzera", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Chiusura" });
    await portaAllo(caller, commessa.id, STATI_COMMESSA.length - 1);
    const archiviata = getCommessaById(commessa.id) as any;
    expect(archiviata.stato).toBe("archiviata");
    expect(archiviata.dataChiusura).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const riaperta = await caller.commesse.update({
      id: commessa.id,
      stato: "interventi_regolazioni",
    });
    expect(riaperta.stato).toBe("interventi_regolazioni");
    expect(riaperta.dataChiusura).toBeNull();
  });

  it("uscire all'indietro da produzione azzera la consegna confermata", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Consegna" });
    await portaAllo(caller, commessa.id, STATI_COMMESSA.indexOf("produzione"));
    await caller.commesse.confermaDataConsegna({
      id: commessa.id,
      dataConsegna: "2026-09-15",
    });

    const indietro = await caller.commesse.update({
      id: commessa.id,
      stato: "da_ordinare",
    });
    expect(indietro.dataConsegnaConfermata).toBeNull();

    // In avanti la consegna confermata non viene toccata.
    await caller.commesse.confermaDataConsegna({
      id: commessa.id,
      dataConsegna: "2026-09-20",
    });
    const avanti = await caller.commesse.update({
      id: commessa.id,
      stato: "produzione",
      force: true,
    });
    expect(avanti.dataConsegnaConfermata).toBe("2026-09-20");
  });
});

describe("doc gate", () => {
  it("blocca l'avanzamento senza documento, con marker riconoscibile, e force lo supera", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Gate" });

    await expect(
      caller.commesse.update({ id: commessa.id, stato: "misure_esecutive" })
    ).rejects.toThrow(/DOC_GATE_BLOCKED/);

    await expect(
      caller.commesse.update({
        id: commessa.id,
        stato: "misure_esecutive",
        force: true,
      })
    ).resolves.toMatchObject({ stato: "misure_esecutive" });
  });

  it("un documento del tipo richiesto, caricato nello stato corrente, apre il gate senza force", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Gate Doc" });
    await caller.preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "preventivo.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      size: 4,
      dataBase64: "dGVzdA==",
    });

    await expect(
      caller.commesse.update({ id: commessa.id, stato: "misure_esecutive" })
    ).resolves.toMatchObject({ stato: "misure_esecutive" });

    // Il preventivo caricato in `preventivo` non soddisfa il gate dello
    // stato successivo (`misure_esecutive` richiede `misure`).
    await expect(
      caller.commesse.update({
        id: commessa.id,
        stato: "aggiornamento_contratto",
      })
    ).rejects.toThrow(/DOC_GATE_BLOCKED/);
  });
});

describe("gate computo limiti", () => {
  it("la dipendenza reale segue il flag: spenta non chiede nulla, accesa senza contratto non lascia passare", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Computo" });
    const computoValido = dipendenzeTransizioniCommesse().computoValido!;
    const flagPrima = process.env.FLAG_LIMITI;
    try {
      process.env.FLAG_LIMITI = "off";
      await expect(computoValido(commessa.id)).resolves.toBe(true);
      // Acceso: senza contratto strutturato non esiste alcun computo valido.
      process.env.FLAG_LIMITI = "on";
      await expect(computoValido(commessa.id)).resolves.toBe(false);
      // Una commessa inesistente non è mai «valida» per il gate.
      await expect(computoValido(commessa.id + 900_000)).resolves.toBe(false);
    } finally {
      if (flagPrima === undefined) delete process.env.FLAG_LIMITI;
      else process.env.FLAG_LIMITI = flagPrima;
    }
  });
});

describe("serializzazione update commessa", () => {
  it("ripristina il record se fallisce il commit di una patch non-state", async () => {
    const caller = direzione();
    const creata = await caller.commesse.create({ cliente: "Rollback patch" });
    const precedente = getCommessaById(creata.id);
    transazioneAtomica.mockImplementation((async (_stores: any, operazione: any) =>
      operazione(async () => {
        throw new Error("commit patch fallito");
      })) as any);

    try {
      await expect(
        caller.commesse.update({ id: creata.id, note: "non persistita" })
      ).rejects.toThrow("commit patch fallito");

      expect(getCommessaById(creata.id)).toBe(precedente);
      expect(getCommessaById(creata.id)).toMatchObject({ note: null });
    } finally {
      transazioneAtomica.mockImplementation(implementazioneTransazione!);
    }
  });

  it("non lascia una patch non-state copiare uno stato il cui commit fallisce", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Lock update" });
    const contesa = contesaConPrimoCommitFallito();

    try {
      const transizione = caller.commesse.update({
        id: commessa.id,
        stato: "misure_esecutive",
        force: true,
      });
      await vi.waitFor(() => {
        expect(getCommessaById(commessa.id)).toMatchObject({
          stato: "misure_esecutive",
        });
      });

      const patch = caller.commesse.update({ id: commessa.id, note: "valida" });
      await contesa.secondaTransazioneTentata;
      expect(getCommessaById(commessa.id)).toMatchObject({
        stato: "misure_esecutive",
        note: null,
      });

      contesa.rilasciaPrimoCommit();
      await expect(transizione).rejects.toThrow("commit transizione fallito");
      await expect(patch).resolves.toMatchObject({
        stato: "preventivo",
        note: "valida",
      });
      expect(getCommessaById(commessa.id)).toMatchObject({
        stato: "preventivo",
        note: "valida",
      });
    } finally {
      transazioneAtomica.mockImplementation(implementazioneTransazione!);
    }
  });

  it("non lascia un update accodato introdurre stato senza capability dopo un rollback", async () => {
    const posa = appRouter.createCaller(context(90112, ["squadra_posa"]));
    const direzioneCaller = direzione();
    const commessa = await posa.commesse.create({ cliente: "Race stato" });
    setFeatureFlagsForTesting(
      SEDE,
      { policyMode: "enforce" },
      { actorUserId: 90111, reason: "Test race capability stato" }
    );
    const contesa = contesaConPrimoCommitFallito();

    try {
      const transizione = direzioneCaller.commesse.update({
        id: commessa.id,
        stato: "misure_esecutive",
        force: true,
      });
      await vi.waitFor(() => {
        expect(getCommessaById(commessa.id)).toMatchObject({
          stato: "misure_esecutive",
        });
      });

      // Il posatore non ha commessa.change_state. Mentre il primo commit è
      // sospeso, il target coincide con lo stato live provvisorio e tenta il
      // ramo non-state: la barriera prova che la chiamata è davvero accodata.
      const patch = posa.commesse.update({
        id: commessa.id,
        stato: "misure_esecutive",
        note: "non deve passare",
      });
      await contesa.secondaTransazioneTentata;

      contesa.rilasciaPrimoCommit();
      await expect(transizione).rejects.toThrow("commit transizione fallito");
      await expect(patch).rejects.toThrow(/STATO_COMMESSA_CAMBIATO/);
      expect(getCommessaById(commessa.id)).toMatchObject({
        stato: "preventivo",
        note: null,
      });
    } finally {
      setFeatureFlagsForTesting(
        SEDE,
        { policyMode: "legacy" },
        { actorUserId: 90111, reason: "Ripristino test race capability stato" }
      );
      transazioneAtomica.mockImplementation(implementazioneTransazione!);
    }
  });
});

describe("collegamento cliente della commessa", () => {
  it("rifiuta un cliente inesistente nell'aggiornamento semplice senza rompere il collegamento", async () => {
    const caller = direzione();
    const cliente = await caller.clienti.create({ nome: "Cliente", cognome: "Semplice" });
    const commessa = await caller.commesse.create({ clienteId: cliente.id });

    await expect(
      caller.commesse.update({ id: commessa.id, clienteId: 9_999_990 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(getCommessaById(commessa.id)).toMatchObject({ clienteId: cliente.id });
    expect((getClienteById(cliente.id) as any).commesseIds).toContain(commessa.id);
  });

  it("rifiuta un cliente inesistente senza rompere il collegamento precedente, anche con transizione", async () => {
    const caller = direzione();
    const cliente = await caller.clienti.create({ nome: "Cliente", cognome: "Originario" });
    const commessa = await caller.commesse.create({ clienteId: cliente.id });

    await expect(
      caller.commesse.update({
        id: commessa.id,
        clienteId: 9_999_991,
        stato: "misure_esecutive",
        force: true,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(getCommessaById(commessa.id)).toMatchObject({
      clienteId: cliente.id,
      stato: "preventivo",
    });
    expect((getClienteById(cliente.id) as any).commesseIds).toContain(commessa.id);
  });
});

describe("pattuito: fonte FiC contro manuale", () => {
  const documentoFic: DocumentoFicPerPiano = {
    id: 990001,
    tipo: "invoice",
    numero: "TEST 1/2026",
    data: "2026-01-10",
    importoLordo: 1000,
    rate: [
      {
        id: 1,
        sourceKey: "fic:test:990001:1",
        importo: 1000,
        scadenza: "2026-02-01",
        stato: "not_paid",
        dataPagamento: null,
      },
    ],
  };

  it("con una fattura collegata pattuito e rate non sono scrivibili, nemmeno dalla direzione", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Fonte FiC" });
    applicaPattuitoDaFic(commessa.id, [documentoFic]);

    const pattuito = await caller.commesse.pattuito(commessa.id);
    expect(pattuito.fonte).toBe("fic");
    expect(pattuito.modificabile).toBe(false);
    expect(pattuito.importoTotale).toBe(1000);

    await expect(
      caller.commesse.update({ id: commessa.id, importoTotale: 99999 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      caller.commesse.addRata({ commessaId: commessa.id, importo: 500 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("senza fatture collegate la commessa torna manuale e scrivibile", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Fonte manuale" });
    applicaPattuitoDaFic(commessa.id, [documentoFic]);
    applicaPattuitoDaFic(commessa.id, []);

    const pattuito = await caller.commesse.pattuito(commessa.id);
    expect(pattuito.fonte).toBe("manuale");
    expect(pattuito.modificabile).toBe(true);
    // Le rate derivate da FiC spariscono; l'importo mostrato resta.
    expect(pattuito.rate.filter(r => r.origine === "fic")).toHaveLength(0);

    await expect(
      caller.commesse.update({ id: commessa.id, importoTotale: 2000 })
    ).resolves.toMatchObject({ importoTotale: 2000 });
    const rate = await caller.commesse.addRata({
      commessaId: commessa.id,
      importo: 800,
      scadenza: "2026-03-01",
    });
    expect(rate).toHaveLength(1);
    expect(rate[0].origine).toBe("manuale");
  });
});

describe("registro pagamenti", () => {
  it("importoIncassato è la somma dei soli movimenti attivi", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Incassi" });
    await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 300,
      data: "2026-08-01",
    });
    const dopo = await caller.commesse.addPagamento({
      commessaId: commessa.id,
      importo: 200,
      data: "2026-08-10",
    });
    expect(dopo.importoIncassato).toBe(500);
  });

  it("i movimenti origine=fic sono immutabili dalle mutation manuali", async () => {
    const caller = direzione();
    const commessa = await caller.commesse.create({ cliente: "Movimenti FiC" });
    const record = getCommessaById(commessa.id) as any;
    record.pagamenti.push({
      id: 501,
      importo: 400,
      data: "2026-08-05",
      metodo: null,
      note: null,
      origine: "fic",
      stato: "attivo",
      ficDocumentoId: 990002,
      ficRataId: 1,
      ficSourceKey: "fic:test:990002:1",
      ficStato: "paid",
      ficUltimoSyncAt: new Date(),
      stornatoAt: null,
      createdAt: new Date(),
      updatedAt: null,
    });

    await expect(
      caller.commesse.updatePagamento({
        commessaId: commessa.id,
        pagamentoId: 501,
        importo: 1,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      caller.commesse.removePagamento({
        commessaId: commessa.id,
        pagamentoId: 501,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("isolamento sede", () => {
  it("una commessa di un'altra sede non esiste: null in lettura, NOT_FOUND in scrittura", async () => {
    const locale = direzione(SEDE);
    const remoto = direzione(ALTRA_SEDE);
    const commessa = await locale.commesse.create({ cliente: "Solo sede A" });

    await expect(remoto.commesse.byId(commessa.id)).resolves.toBeNull();
    await expect(
      remoto.commesse.update({ id: commessa.id, note: "intrusione" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      remoto.commesse.addPagamento({ commessaId: commessa.id, importo: 10 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(remoto.commesse.archive(commessa.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // La lista dell'altra sede non lo contiene.
    const lista = await remoto.commesse.list({});
    expect(lista.some(c => c.id === commessa.id)).toBe(false);
  });
});
