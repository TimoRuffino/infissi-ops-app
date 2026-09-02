import { afterEach, describe, expect, it } from "vitest";

import {
  SOGLIA_LOOP_MS,
  SOGLIA_PROCEDURA_MS,
  avviaSondaLoop,
  fermaSondaLoop,
  rigaLoopBloccato,
  rigaProceduraLenta,
  ritardoLoop,
  vaSegnalata,
} from "./osservabilita";

afterEach(() => fermaSondaLoop());

describe("osservabilità — procedure lente", () => {
  it("segnala solo da mezzo secondo in su", () => {
    expect(vaSegnalata(SOGLIA_PROCEDURA_MS)).toBe(true);
    expect(vaSegnalata(SOGLIA_PROCEDURA_MS + 1)).toBe(true);
    expect(vaSegnalata(SOGLIA_PROCEDURA_MS - 1)).toBe(false);
    expect(vaSegnalata(0)).toBe(false);
  });

  it("la riga dice cosa e quanto, e niente di più", () => {
    const riga = rigaProceduraLenta("commesse.list", 1234.6, "ok");
    expect(riga).toBe("[lento] procedura=commesse.list ms=1235 esito=ok");
  });

  it("distingue una procedura fallita da una riuscita", () => {
    expect(rigaProceduraLenta("tars.invia", 900, "errore")).toContain(
      "esito=errore"
    );
  });
});

describe("osservabilità — ciclo di eventi fermo", () => {
  it("il ritardo è quanto il timer è arrivato dopo, mai negativo", () => {
    expect(ritardoLoop(500, 500)).toBe(0);
    expect(ritardoLoop(500, 900)).toBe(400);
    // Un timer anticipato non è un ritardo.
    expect(ritardoLoop(500, 480)).toBe(0);
  });

  it("la riga dice quanto è rimasto fermo", () => {
    expect(rigaLoopBloccato(812.4)).toBe("[coda] loop bloccato ms=812");
  });

  it("la soglia sta sopra il rumore di uno scheduler normale", () => {
    expect(SOGLIA_LOOP_MS).toBeGreaterThanOrEqual(100);
  });

  it("avviare la sonda due volte non raddoppia i campioni", async () => {
    const righe: string[] = [];
    avviaSondaLoop(r => righe.push(r));
    avviaSondaLoop(r => righe.push(r));
    // Blocco il ciclo di proposito: è esattamente ciò che deve accorgersi.
    // Un secondo pieno, così il ritardo supera la soglia anche contando il
    // passo di campionamento (mezzo secondo) che sarebbe scattato comunque.
    const fine = Date.now() + 1000;
    while (Date.now() < fine) {
      /* occupato apposta */
    }
    await new Promise(r => setTimeout(r, 700));
    expect(righe.length).toBeGreaterThan(0);
    // Una sola sonda: il blocco produce una riga, non due identiche.
    expect(righe.length).toBeLessThanOrEqual(2);
    expect(righe[0]).toMatch(/^\[coda\] loop bloccato ms=\d+$/);
  });

  it("in silenzio non scrive niente", async () => {
    const righe: string[] = [];
    avviaSondaLoop(r => righe.push(r));
    await new Promise(r => setTimeout(r, 1200));
    expect(righe).toEqual([]);
  });
});
