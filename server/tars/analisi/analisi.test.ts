// Analisi azienda: la fotografia legge solo fatti deterministici della
// sede; la verifica scarta le entità inventate e gli importi; senza
// provider la sintesi è deterministica; il worker genera una analisi per
// sede al giorno e registra gli errori invece di lanciarli.

import { describe, expect, it } from "vitest";
import { creaProviderFinto } from "../openai/fake";
import { analisiDeterministica, analizzaConModello, verificaEsito } from "./analisi";
import { costruisciFotografia, entitaDellaFotografia, testoFotografia, type DipendenzeFotografia } from "./fotografia";
import { creaRepositoryAnalisiMemoria } from "./repository";
import { RITENTO_ERRORE_MS, generaAnalisiAzienda, giroAnalisi, type DipendenzeAnalisi } from "./worker";

const SEDE = 97_001;
const ADESSO = new Date("2026-09-03T07:30:00+02:00");
const giorniFa = (n: number) => new Date(ADESSO.getTime() - n * 86_400_000);

function depsFotografia(parziale: Partial<DipendenzeFotografia> = {}): DipendenzeFotografia {
  return {
    commesse: () => [
      { id: 1, sedeId: SEDE, codice: "COM-2026-001", cliente: "Rossi Anna", stato: "preventivo", priorita: "media", updatedAt: giorniFa(20) },
      { id: 2, sedeId: SEDE, codice: "COM-2026-002", cliente: "Verdi Luca", stato: "produzione", priorita: "urgente", updatedAt: giorniFa(2) },
      { id: 3, sedeId: SEDE, codice: "COM-2026-003", cliente: "Vecchia", stato: "archiviata", archivedAt: giorniFa(1), updatedAt: giorniFa(90) },
      { id: 4, sedeId: SEDE + 1, codice: "COM-2026-004", cliente: "Altra sede", stato: "preventivo", updatedAt: giorniFa(40) },
    ],
    ticket: () => [
      { id: 10, sedeId: SEDE, commessaId: 2, oggetto: "Vetro rotto", priorita: "urgente", stato: "aperto", createdAt: giorniFa(5), assegnatoA: null },
      { id: 11, sedeId: SEDE, commessaId: 1, oggetto: "Chiuso", priorita: "bassa", stato: "chiuso", createdAt: giorniFa(9) },
    ],
    interventi: () => [
      { id: 20, sedeId: SEDE, commessaId: 2, tipo: "posa", data: "2026-09-04", stato: "pianificato", squadraId: null },
      { id: 21, sedeId: SEDE, commessaId: 1, tipo: "rilievo", data: "2026-09-20", stato: "pianificato", squadraId: 1 },
    ],
    casiAperti: async () => [
      { id: 30, title: "Consegna in ritardo", priority: "critica", priorityScore: 90, commessaId: 2, nextAction: { label: "Sollecita il fornitore" }, link: "/commesse/2", assigneeUserId: null },
    ],
    osservazioniAperte: async () => [
      { id: 40, titolo: "Posa senza rilievo", sintesi: "Manca il rilievo.", priorita: "alta", materialita: "alta", commessaId: 2 },
    ],
    pattern: async () => ({ pattern: [{ chiave: "ritardi_fornitore", titolo: "Ritardi fornitore", misura: "3 su 5", baseline: "1 su 5", campione: { commesse: 5 } }] }),
    smistamento: async () => ({
      contatori: { smistateOggi: 12, collegateOggi: 4, archiviatiOggi: 1, proposteAperte: 2 },
      urgenti: [{ comunicazioneId: 50, oggetto: "Sollecito", mittente: "fornitore@x.test", riepilogo: "Sollecita un DDT.", link: "/messaggi/email?messaggio=50" }],
      daRispondere: [],
      daDecidere: [],
    }),
    proposteGateway: () => [{ sedeId: SEDE, stato: "proposta" }, { sedeId: SEDE + 1, stato: "proposta" }],
    ...parziale,
  };
}

describe("fotografia", () => {
  it("legge solo la sede, esclude le archiviate, conta e riferisce le entità", async () => {
    const f = await costruisciFotografia({ sedeId: SEDE, adesso: ADESSO, deps: depsFotografia() });
    expect(f.contatori).toMatchObject({
      commesseAttive: 2, commesseUrgenti: 1, casiAperti: 1, casiCritici: 1, osservazioniAperte: 1,
      pattern: 1, comunicazioniUrgenti: 1, ticketAperti: 1, ticketUrgenti: 1,
      interventiSettimana: 1, interventiSenzaSquadra: 1, proposteDocumentali: 1,
    });
    const entita = entitaDellaFotografia(f);
    expect(entita.has("commessa:1")).toBe(true); // ferma da 20 giorni
    expect(entita.has("commessa:4")).toBe(false); // altra sede
    expect(entita.has("commessa:3")).toBe(false); // archiviata
    expect(entita.get("caso:30")).toBe("/commesse/2");
    const testo = testoFotografia(f);
    expect(testo).toContain("## Commesse");
    expect(testo).toContain("[commessa:1]");
    expect(testo).toContain("Sollecito");
  });

  it("una fonte che fallisce non azzera la fotografia", async () => {
    const f = await costruisciFotografia({
      sedeId: SEDE, adesso: ADESSO,
      deps: depsFotografia({ casiAperti: async () => { throw new Error("db giù"); }, pattern: async () => { throw new Error("no"); } }),
    });
    expect(f.contatori.casiAperti).toBe(0);
    expect(f.contatori.commesseAttive).toBe(2);
  });
});

describe("verifica e sintesi", () => {
  it("scarta entità non in fotografia, scrubba importi, ordina per priorità e limita", async () => {
    const f = await costruisciFotografia({ sedeId: SEDE, adesso: ADESSO, deps: depsFotografia() });
    const esito = verificaEsito(
      {
        sintesi: "Giornata sotto controllo, ma la commessa 2 vale 12.500 € e rischia.",
        punti: [
          { tipo: "andamento", priorita: "bassa", testo: "Pattern ritardi.", entita: ["pattern:ritardi_fornitore"] },
          { tipo: "rischio", priorita: "alta", testo: "Consegna in ritardo.", entita: ["caso:30", "commessa:999"] },
        ],
        proposte: [{ testo: "Sollecita il fornitore", richiestaPerTars: "Sollecita il fornitore della commessa COM-2026-002", entita: ["commessa:2"] }],
        domande: ["Chi segue la posa?", "", "Due?", "Tre?", "Quattro?"],
      },
      f,
      "gpt-test"
    );
    expect(esito.fonte).toBe("modello");
    expect(esito.sintesi).not.toContain("12.500");
    expect(esito.sintesi).toContain("un importo");
    expect(esito.punti[0]).toMatchObject({ tipo: "rischio", entita: ["caso:30"], link: "/commesse/2" });
    expect(esito.proposte[0].link).toBe("/commesse/2");
    expect(esito.domande).toHaveLength(3);
    expect(esito.avvertenze[0]).toContain("1 riferimenti");
  });

  it("col provider finto la sintesi arriva dal JSON; senza provider è deterministica", async () => {
    const f = await costruisciFotografia({ sedeId: SEDE, adesso: ADESSO, deps: depsFotografia() });
    const provider = creaProviderFinto(() => ({
      tipo: "messaggio",
      testo: JSON.stringify({ sintesi: "Tutto sotto controllo.", punti: [], proposte: [], domande: [] }),
      uso: { input: 10, output: 5, cachedInput: 0, cacheWrite: 0 },
    }));
    const conModello = await analizzaConModello({ fotografia: f, provider, modello: "gpt-test", identita: { runId: "r1", passo: 0, tentativo: 1, conversazioneId: null } });
    expect(conModello.sintesi).toBe("Tutto sotto controllo.");
    const senza = analisiDeterministica(f);
    expect(senza.fonte).toBe("deterministica");
    expect(senza.sintesi).toContain("2 commesse attive");
    expect(senza.punti.some(p => p.entita.includes("caso:30"))).toBe(true);
    expect(senza.proposte).toEqual([]);
  });

  it("JSON rotto → errore esplicito", async () => {
    const f = await costruisciFotografia({ sedeId: SEDE, adesso: ADESSO, deps: depsFotografia() });
    const provider = creaProviderFinto(() => ({ tipo: "messaggio", testo: "non json", uso: { input: 1, output: 1, cachedInput: 0, cacheWrite: 0 } }));
    await expect(analizzaConModello({ fotografia: f, provider, modello: "x", identita: { runId: "r2", passo: 0, tentativo: 1, conversazioneId: null } })).rejects.toThrow(/ANALISI_RISPOSTA_INVALIDA/);
  });
});

describe("worker", () => {
  function depsWorker(parziale: Partial<DipendenzeAnalisi> = {}): DipendenzeAnalisi {
    return {
      repository: creaRepositoryAnalisiMemoria(),
      provider: () => null,
      modello: "gpt-test",
      fotografia: depsFotografia(),
      sedi: () => [SEDE, SEDE + 1],
      now: () => ADESSO,
      ...parziale,
    };
  }

  it("una analisi per sede al giorno; il secondo giro salta; la rigenerazione sostituisce", async () => {
    const deps = depsWorker();
    const primo = await giroAnalisi(deps);
    expect(primo.generate).toEqual([SEDE, SEDE + 1]);
    const secondo = await giroAnalisi(deps);
    expect(secondo.generate).toEqual([]);
    expect(secondo.saltate).toEqual([SEDE, SEDE + 1]);
    const salvata = await deps.repository.ultima(SEDE);
    expect(salvata).toMatchObject({ giorno: "2026-09-03", stato: "pronta", richiestaDa: null });
    expect(salvata?.esito?.fonte).toBe("deterministica");
    const rigenerata = await generaAnalisiAzienda({ sedeId: SEDE, richiestaDa: 7, deps });
    expect(rigenerata.id).toBe(salvata!.id);
    expect(rigenerata.richiestaDa).toBe(7);
  });

  it("prima delle 06:00 locali non genera nulla", async () => {
    const deps = depsWorker({ now: () => new Date("2026-09-03T04:00:00+02:00") });
    const giro = await giroAnalisi(deps);
    expect(giro.generate).toEqual([]);
    expect(await deps.repository.ultima(SEDE)).toBeNull();
  });

  it("un provider che esplode produce un record in errore, non un'eccezione", async () => {
    const deps = depsWorker({
      provider: () => creaProviderFinto(() => { throw new Error("OpenAI 500"); }),
    });
    const record = await generaAnalisiAzienda({ sedeId: SEDE, richiestaDa: null, deps });
    expect(record.stato).toBe("errore");
    expect(record.errore).toContain("OpenAI 500");
    expect(record.esito).toBeNull();
    expect(record.tentativi).toBe(1);
  });

  it("un errore si ritenta da solo dopo mezz'ora, al massimo tre volte al giorno", async () => {
    let orologio = ADESSO.getTime();
    let chiamate = 0;
    const deps = depsWorker({
      sedi: () => [SEDE],
      now: () => new Date(orologio),
      provider: () =>
        creaProviderFinto(() => {
          chiamate += 1;
          throw new Error("JSON troncato");
        }),
    });
    await giroAnalisi(deps); // tentativo 1
    expect((await giroAnalisi(deps)).generate).toEqual([]); // subito dopo: no
    orologio += RITENTO_ERRORE_MS;
    expect((await giroAnalisi(deps)).generate).toEqual([SEDE]); // tentativo 2
    orologio += RITENTO_ERRORE_MS;
    expect((await giroAnalisi(deps)).generate).toEqual([SEDE]); // tentativo 3
    orologio += RITENTO_ERRORE_MS;
    expect((await giroAnalisi(deps)).generate).toEqual([]); // basta
    expect(chiamate).toBe(3);
    expect((await deps.repository.ultima(SEDE))?.tentativi).toBe(3);
  });
});
