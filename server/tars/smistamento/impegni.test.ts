// Punto 28 del piano «Tars più intelligente»: le promesse dette a parole.
// Un impegno senza una data non è un impegno, e uno vecchio di due mesi non
// serve più a nessuno.

import { describe, expect, it } from "vitest";
import {
  GIORNI_IN_SCADENZA,
  impegniDiSede,
  testoImpegno,
  type DipendenzeImpegni,
} from "./impegni";
import type { RecordSmistamento } from "./types";

const SEDE = 96_901;
const ADESSO = new Date("2026-09-08T09:00:00Z");
const fra = (giorni: number) =>
  new Date(ADESSO.getTime() + giorni * 86_400_000).toISOString().slice(0, 10);

function record(impegni: any[], patch: Record<string, unknown> = {}): RecordSmistamento {
  return {
    comunicazioneId: 500,
    sedeId: SEDE,
    versione: "1.4.0",
    stato: "analizzata",
    propostaStato: "nessuna",
    esito: {
      versione: "1.4.0",
      fonte: "modello",
      modello: "finto",
      categoria: "operativa",
      urgenza: "normale",
      riepilogo: "",
      richiedeRisposta: false,
      azioneSuggerita: "nessuna",
      istruzione: "",
      collegamento: {
        esito: "certo",
        commessaId: 12,
        clienteId: null,
        confidenza: "alta",
        motivo: "",
      },
      allegati: [],
      archiviati: [],
      candidati: [],
      segnali: {} as any,
      impegni,
    },
    ...patch,
  } as any;
}

const deps = (record: RecordSmistamento[]): DipendenzeImpegni => ({
  recenti: async () => record,
});

const impegno = (patch: Record<string, unknown> = {}) => ({
  chi: "noi",
  cosa: "mandare le misure",
  entro: fra(3),
  frase: "Ti mando le misure lunedì.",
  ...patch,
});

describe("le promesse vive", () => {
  it("porta chi, cosa, quando e la frase originale", async () => {
    const [i] = await impegniDiSede({ sedeId: SEDE, adesso: ADESSO, deps: deps([record([impegno()])]) });
    expect(i.chi).toBe("noi");
    expect(i.commessaId).toBe(12);
    expect(i.giorniAllaScadenza).toBe(3);
    expect(i.scaduto).toBe(false);
    expect(testoImpegno(i)).toContain("Abbiamo promesso di mandare le misure");
    expect(testoImpegno(i)).toContain("Ti mando le misure lunedì.");
  });

  it("una promessa scaduta lo dice, e viene per prima", async () => {
    const righe = await impegniDiSede({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: deps([record([impegno(), impegno({ entro: fra(-4), cosa: "consegnare i serramenti", chi: "loro" })])]),
    });
    expect(righe[0].scaduto).toBe(true);
    expect(testoImpegno(righe[0])).toContain("Ci hanno promesso");
    expect(testoImpegno(righe[0])).toContain("4 giorni fa");
  });

  it("oltre la finestra in avanti non è ancora affar nostro", async () => {
    const righe = await impegniDiSede({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: deps([record([impegno({ entro: fra(GIORNI_IN_SCADENZA + 5) })])]),
    });
    expect(righe).toEqual([]);
  });

  it("e una promessa di due mesi fa non serve più", async () => {
    const righe = await impegniDiSede({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: deps([record([impegno({ entro: fra(-60) })])]),
    });
    expect(righe).toEqual([]);
  });

  it("un esito senza impegni (analisi vecchia) non rompe niente", async () => {
    const vecchio = record([]);
    delete (vecchio.esito as any).impegni;
    expect(
      await impegniDiSede({ sedeId: SEDE, adesso: ADESSO, deps: deps([vecchio]) })
    ).toEqual([]);
  });

  it("la promessa per oggi si dice al presente", async () => {
    const [i] = await impegniDiSede({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: deps([record([impegno({ entro: fra(0) })])]),
    });
    expect(testoImpegno(i)).toContain("è per oggi");
  });
});
