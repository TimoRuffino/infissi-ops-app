// Render statico della Situazione dello smistamento: le tre liste, i
// contatori, i bottoni di decisione (con aria-label) e il fatto che una
// voce già in «da decidere» non venga ripetuta fra le urgenti.

import { describe, expect, it } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// tsconfig ha `jsx: preserve`: nei test il JSX compila al runtime classico
// e serve React globale (stessa convenzione di tarsPresentation.test.ts).
(globalThis as typeof globalThis & { React: typeof React }).React = React;
import {
  SmistamentoSituazioneView,
  smistamentoVuoto,
  type SmistamentoSezione,
} from "../components/tars/TarsSmistamento";

const voce = (id: number, extra: Partial<SmistamentoSezione["daDecidere"][number]> = {}) => ({
  comunicazioneId: id,
  canale: "email" as const,
  mittente: "Paolo Gallo",
  oggetto: `Oggetto ${id}`,
  riepilogo: `Riepilogo ${id}`,
  urgenza: "alta",
  categoria: "operativa",
  link: `/messaggi/email?messaggio=${id}`,
  proposta: null,
  ...extra,
});

const sezione: SmistamentoSezione = {
  daDecidere: [
    voce(1, {
      proposta: {
        commessaId: 10,
        clienteId: 2,
        etichetta: "COM-2026-010 — Gallo Paolo",
        motivo: "Inoltro dal cliente.",
        allegatiDaArchiviare: 1,
      },
    }),
  ],
  daRispondere: [voce(2)],
  urgenti: [voce(1), voce(3)],
  contatori: { smistateOggi: 12, proposteAperte: 1, collegateOggi: 4, archiviatiOggi: 3 },
};

describe("SmistamentoSituazioneView", () => {
  it("mostra contatori, proposta con bottoni accessibili, da rispondere e urgenti senza doppioni", () => {
    const html = renderToStaticMarkup(
      createElement(SmistamentoSituazioneView, {
        smistamento: sezione,
        onDecidi: () => undefined,
        inCorsoId: null,
      })
    );
    expect(html).toContain("12 smistate");
    expect(html).toContain("4 collegate");
    expect(html).toContain("3 allegati archiviati");
    expect(html).toContain("Da decidere");
    expect(html).toContain("COM-2026-010 — Gallo Paolo");
    expect(html).toContain('aria-label="Collega come propone Tars"');
    expect(html).toContain('aria-label="Rifiuta la proposta"');
    expect(html).toContain("Da rispondere");
    expect(html).toContain("Riepilogo 2");
    expect(html).toContain("Urgenti");
    expect(html).toContain("Riepilogo 3");
    // La #1 è già fra le proposte: non torna fra le urgenti.
    expect(html.split("Oggetto 1").length - 1).toBe(1);
    expect(html).not.toMatch(/€/);
  });

  it("smistamentoVuoto riconosce l'assenza di voci", () => {
    expect(smistamentoVuoto(null)).toBe(true);
    expect(smistamentoVuoto({ ...sezione, daDecidere: [], daRispondere: [], urgenti: [] })).toBe(true);
    expect(smistamentoVuoto(sezione)).toBe(false);
  });
});
