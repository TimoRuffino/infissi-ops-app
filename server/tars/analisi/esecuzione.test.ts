// T3: il bottone Esegui passa dal catalogo e dal ledger R1, salva
// l'esecuzione dentro l'analisi ed è idempotente al doppio click.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { getTicketStore } from "../../routers/ticket";
import { costruisciContesto } from "../contesto";
import { eseguiPropostaAnalisi, PropostaNonEseguibile } from "./esecuzione";
import {
  creaRepositoryAnalisiMemoria,
  impostaRepositoryAnalisiPerTest,
} from "./repository";
import { VERSIONE_ANALISI_AZIENDA, type EsitoAnalisiAzienda } from "./types";

const SEDE = 96_841;
const DIREZIONE_ID = 96_851;
const POSA_ID = 96_852;

function contestoTrpc(userId: number, roles: string[], sedeId = SEDE): TrpcContext {
  return {
    user: { id: userId, role: roles.includes("direzione") ? "admin" : "user", ruolo: roles[0], ruoli: roles, name: `U${userId}` } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = () => appRouter.createCaller(contestoTrpc(DIREZIONE_ID, ["direzione"]));
const contesto = (userId = DIREZIONE_ID, roles = ["direzione"]) =>
  costruisciContesto(contestoTrpc(userId, roles));

function esitoConProposta(
  azione: { strumento: string; input: string } | null
): EsitoAnalisiAzienda {
  return {
    versione: VERSIONE_ANALISI_AZIENDA,
    fonte: "modello",
    modello: "gpt-test",
    sintesi: "x",
    punti: [],
    proposte: [{ testo: "Fai la cosa", richiestaPerTars: "Falla", entita: [], link: null, azione }],
    domande: [],
    avvertenze: [],
    contatori: {},
    fattiConsiderati: 1,
  };
}

let repository = creaRepositoryAnalisiMemoria();

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_L2_ACTIONS = "on";
  repository = creaRepositoryAnalisiMemoria();
  impostaRepositoryAnalisiPerTest(repository);
});
afterEach(() => {
  impostaRepositoryAnalisiPerTest(null);
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
});

describe("eseguiPropostaAnalisi", () => {
  it("esegue l'azione col ledger, salva l'esecuzione e il doppio click non raddoppia", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Proposta Esegui" });
    const record = await repository.salva({
      sedeId: SEDE,
      giorno: "2026-09-03",
      versione: VERSIONE_ANALISI_AZIENDA,
      stato: "pronta",
      esito: esitoConProposta({
        strumento: "crea_ticket",
        input: JSON.stringify({ commessaId: commessa.id, oggetto: "Vetro rotto in cantiere", categoria: "difetto_prodotto" }),
      }),
      errore: null,
      richiestaDa: null,
      now: new Date("2026-09-03T08:00:00Z"),
    });

    const prima = (getTicketStore() as any[]).filter(t => t.commessaId === commessa.id).length;
    const { esecuzione, esito } = await eseguiPropostaAnalisi({ contesto: ctx, record, indice: 0 });
    expect(esecuzione.stato).toBe("creato");
    expect(esecuzione.daUtente).toBe(DIREZIONE_ID);
    const dopo = (getTicketStore() as any[]).filter(t => t.commessaId === commessa.id);
    expect(dopo.length).toBe(prima + 1);
    expect(esito.proposte[0].esecuzione?.stato).toBe("creato");
    expect((await repository.ultima(SEDE))?.esito?.proposte[0]?.esecuzione?.stato).toBe("creato");

    const rieseguita = await eseguiPropostaAnalisi({
      contesto: ctx,
      record: (await repository.ultima(SEDE))!,
      indice: 0,
    });
    expect(rieseguita.esecuzione).toMatchObject({ stato: "creato", azioneId: esecuzione.azioneId });
    expect((getTicketStore() as any[]).filter(t => t.commessaId === commessa.id).length).toBe(prima + 1);
  });

  it("senza azione → PropostaNonEseguibile; senza capability → FORBIDDEN e nessun effetto", async () => {
    const senzaAzione = await repository.salva({
      sedeId: SEDE,
      giorno: "2026-09-01",
      versione: VERSIONE_ANALISI_AZIENDA,
      stato: "pronta",
      esito: esitoConProposta(null),
      errore: null,
      richiestaDa: null,
      now: new Date("2026-09-01T08:00:00Z"),
    });
    await expect(
      eseguiPropostaAnalisi({ contesto: await contesto(), record: senzaAzione, indice: 0 })
    ).rejects.toThrow(PropostaNonEseguibile);

    const conAzione = await repository.salva({
      sedeId: SEDE,
      giorno: "2026-09-02",
      versione: VERSIONE_ANALISI_AZIENDA,
      stato: "pronta",
      esito: esitoConProposta({
        strumento: "collega_fattura_commessa",
        input: JSON.stringify({ ficId: 968_301, commessaId: 1 }),
      }),
      errore: null,
      richiestaDa: null,
      now: new Date("2026-09-02T08:00:00Z"),
    });
    // squadra_posa non ha economia.read: lo strumento non è nel suo catalogo.
    const posa = await contesto(POSA_ID, ["squadra_posa"]);
    await expect(
      eseguiPropostaAnalisi({ contesto: posa, record: conAzione, indice: 0 })
    ).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("scartaPropostaAnalisi", () => {
  it("registra lo scarto senza effetti; dopo lo scarto non si esegue più", async () => {
    const { scartaPropostaAnalisi } = await import("./esecuzione");
    const record = await repository.salva({
      sedeId: SEDE,
      giorno: "2026-09-04",
      versione: VERSIONE_ANALISI_AZIENDA,
      stato: "pronta",
      esito: esitoConProposta({
        strumento: "crea_ticket",
        input: JSON.stringify({ commessaId: 1, oggetto: "Da scartare qui", categoria: "altro" }),
      }),
      errore: null,
      richiestaDa: null,
      now: new Date("2026-09-04T08:00:00Z"),
    });
    const { esecuzione } = await scartaPropostaAnalisi({ record, indice: 0, utenteId: DIREZIONE_ID });
    expect(esecuzione.stato).toBe("scartata");
    const dopo = (await repository.ultima(SEDE))!;
    expect(dopo.esito?.proposte[0]?.esecuzione?.stato).toBe("scartata");
    const prima = (getTicketStore() as any[]).length;
    const riuso = await eseguiPropostaAnalisi({ contesto: await contesto(), record: dopo, indice: 0 });
    expect(riuso.esecuzione.stato).toBe("scartata");
    expect((getTicketStore() as any[]).length).toBe(prima);
  });
});
