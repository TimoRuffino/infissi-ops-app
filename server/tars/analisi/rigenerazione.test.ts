// L'analisi di oggi si rifà quando è vecchia o quando ogni proposta è già
// stata gestita: una lista di scartate non è lavoro (direzione 04/09/2026:
// «se le rifiuto rimangono lì e non ne ho più ricevute di nuove»).

import { describe, expect, it } from "vitest";
import {
  analisiDaRifare,
  RIGENERA_DOPO_MS,
  RIGENERA_SE_GESTITE_DOPO_MS,
} from "./worker";
import type { RecordAnalisiAzienda } from "./types";

const ADESSO = new Date("2026-09-04T10:00:00Z");

function record(parziale: Partial<RecordAnalisiAzienda> & { etaMs: number }): RecordAnalisiAzienda {
  const { etaMs, ...resto } = parziale;
  return {
    id: 1,
    sedeId: 1,
    giorno: "2026-09-04",
    versione: "test",
    stato: "pronta",
    esito: { sintesi: "", punti: [], proposte: [], domande: [], contatori: {} } as any,
    errore: null,
    tentativi: 1,
    richiestaDa: null,
    generataAt: new Date(ADESSO.getTime() - etaMs),
    ...resto,
  } as RecordAnalisiAzienda;
}

const proposta = (esecuzione: any) =>
  ({ testo: "x", richiestaPerTars: "x", entita: [], link: null, azione: null, esecuzione }) as any;

describe("analisiDaRifare", () => {
  it("fresca e con proposte aperte: si tiene", () => {
    const r = record({ etaMs: 60_000, esito: { proposte: [proposta(null), proposta(null)] } as any });
    expect(analisiDaRifare(r, ADESSO)).toBe(false);
  });

  it("dopo quattro ore si rifà comunque", () => {
    const r = record({ etaMs: RIGENERA_DOPO_MS + 1, esito: { proposte: [proposta(null)] } as any });
    expect(analisiDaRifare(r, ADESSO)).toBe(true);
  });

  it("tutte le proposte gestite (scartate o eseguite) da più di mezz'ora: se ne fa una nuova", () => {
    const gestite = [proposta({ stato: "scartata" }), proposta({ stato: "creato" })];
    expect(analisiDaRifare(record({ etaMs: RIGENERA_SE_GESTITE_DOPO_MS + 1, esito: { proposte: gestite } as any }), ADESSO)).toBe(true);
    // Appena gestite: non ancora, per non rigenerare a ogni click.
    expect(analisiDaRifare(record({ etaMs: 5 * 60_000, esito: { proposte: gestite } as any }), ADESSO)).toBe(false);
    // Nessuna proposta: non è «tutte gestite».
    expect(analisiDaRifare(record({ etaMs: RIGENERA_SE_GESTITE_DOPO_MS + 1, esito: { proposte: [] } as any }), ADESSO)).toBe(false);
  });

  it("in errore: si ritenta dopo mezz'ora, al massimo tre volte", () => {
    expect(analisiDaRifare(record({ etaMs: 31 * 60_000, stato: "errore", tentativi: 1 }), ADESSO)).toBe(true);
    expect(analisiDaRifare(record({ etaMs: 5 * 60_000, stato: "errore", tentativi: 1 }), ADESSO)).toBe(false);
    expect(analisiDaRifare(record({ etaMs: 31 * 60_000, stato: "errore", tentativi: 3 }), ADESSO)).toBe(false);
  });
});
