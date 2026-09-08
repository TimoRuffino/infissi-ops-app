import TarsBarraContesto, {
  type ContestoOperativoTars,
} from "@/components/tars/TarsBarraContesto";
import TarsThread, { type ChiaveUndoTars } from "@/components/tars/TarsThread";
import { statoBriefing, type TurnoTarsView } from "@/lib/tarsView";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function turnoConUndo(): TurnoTarsView {
  return {
    id: 1,
    conversazioneId: 7,
    ruolo: "tars",
    contenuto: "Azioni completate",
    createdAt: new Date("2026-08-31T10:00:00.000Z"),
    payload: {
      azioni: [
        {
          strumento: "crea_promemoria",
          stato: "creato",
          descrizione: "Promemoria creato",
          motivo: null,
          assunzioni: [],
          undoDisponibile: true,
          undoVia: { procedura: "promemoria.cancel", id: 42 },
          conferma: null,
        },
        {
          strumento: "transizione_commessa",
          stato: "applicato",
          descrizione: "Commessa aggiornata",
          motivo: null,
          assunzioni: [],
          undoDisponibile: true,
          undoVia: { procedura: "commesse.undoTransizione", id: 42 },
          conferma: null,
        },
      ],
    },
  };
}

function renderThread(undoCompletati: readonly ChiaveUndoTars[] = []): string {
  return renderToStaticMarkup(
    createElement(TarsThread, {
      turni: [turnoConUndo()],
      statoAvatar: "disponibile",
      undoCompletati,
      onUndo: () => undefined,
    })
  );
}

const briefingVuoto = {
  promemoriaOggi: [],
  casiMiei: [],
  segnalazioni: [] as readonly unknown[] | null,
};

function renderBarra(contesto: ContestoOperativoTars | null): string {
  return renderToStaticMarkup(createElement(TarsBarraContesto, { contesto }));
}

describe("presentazione thread Tars", () => {
  it("distingue Undo con lo stesso id ma procedure diverse", () => {
    const promemoriaAnnullato = renderThread(["promemoria.cancel:42"]);
    expect(promemoriaAnnullato.match(/>Annullata</g)).toHaveLength(1);
    expect(promemoriaAnnullato.match(/>Annulla</g)).toHaveLength(1);

    const commessaAnnullata = renderThread(["commesse.undoTransizione:42"]);
    expect(commessaAnnullata.match(/>Annullata</g)).toHaveLength(1);
    expect(commessaAnnullata.match(/>Annulla</g)).toHaveLength(1);
  });

  it("formatta il Markdown di Tars e lascia grezzo il turno utente", () => {
    const markup = renderToStaticMarkup(
      createElement(TarsThread, {
        turni: [
          {
            id: 1,
            conversazioneId: 7,
            ruolo: "tars",
            contenuto:
              "### 1. Critici\n\n- **Bocciardi Claudia — COM-2026-184**, da valutare",
            payload: null,
            createdAt: new Date("2026-08-31T10:00:00.000Z"),
          },
          {
            id: 2,
            conversazioneId: 7,
            ruolo: "utente",
            contenuto: "### resta testo **grezzo**",
            payload: null,
            createdAt: new Date("2026-08-31T10:01:00.000Z"),
          },
        ],
        statoAvatar: "disponibile",
      })
    );

    expect(markup).toContain("<h5");
    expect(markup).toContain("<ul");
    expect(markup).toContain(
      "<strong class=\"font-semibold text-text-1\">Bocciardi Claudia — COM-2026-184</strong>"
    );
    expect(markup).not.toContain("### 1. Critici");
    // Il turno utente conserva i caratteri Markdown senza interpretarli.
    expect(markup).toContain("### resta testo **grezzo**");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });

  it("dà l'avatar ai turni di Tars e non a quelli dell'utente", () => {
    const markup = renderToStaticMarkup(
      createElement(TarsThread, {
        turni: [
          {
            id: 1,
            conversazioneId: 7,
            ruolo: "tars",
            contenuto: "Risposta",
            payload: null,
            createdAt: new Date("2026-08-31T10:00:00.000Z"),
          },
          {
            id: 2,
            conversazioneId: 7,
            ruolo: "utente",
            contenuto: "Domanda",
            payload: null,
            createdAt: new Date("2026-08-31T10:01:00.000Z"),
          },
        ],
        statoAvatar: "in_lavoro",
      })
    );

    // Testata + il solo turno di Tars: il turno utente lo distingue
    // l'allineamento, non una seconda faccia.
    expect(markup.match(/data-tars-avatar=/g)).toHaveLength(2);
    expect(markup.match(/data-tars-avatar="in_lavoro"/g)).toHaveLength(1);
    expect(markup.match(/data-tars-avatar="identita"/g)).toHaveLength(1);
    // L'avatar non stringe il turno: resta fuori dalla bolla e non si comprime.
    expect(markup).toContain("flex shrink-0");
  });

  it("nomina Tars nella testata, dove il titolo è la conversazione", () => {
    const markup = renderToStaticMarkup(
      createElement(TarsThread, {
        titolo: "Verifica gate COM-2026-184",
        turni: [],
        statoAvatar: "degradato",
      })
    );

    expect(markup).toContain('role="img" aria-label="Tars"');
    // Lo stato resta scritto: il colore dell'anello non è l'unico portatore.
    expect(markup).toContain("Operatività ridotta");
  });

  it("mostra la riga di contesto subito sotto la testata, non dietro un bottone", () => {
    const markup = renderToStaticMarkup(
      createElement(TarsThread, {
        turni: [],
        statoAvatar: "disponibile",
        barraContesto: createElement(TarsBarraContesto, {
          contesto: {
            superficie: "commessa",
            entita: { tipo: "commessa", id: 184, etichetta: "COM-2026-184" },
          },
        }),
      })
    );

    expect(markup).toContain("COM-2026-184");
    // Il pannello laterale e il suo trigger non esistono più (PRD §62).
    expect(markup).not.toContain("Apri contesto operativo");
  });
});

describe("riga di contesto della conversazione", () => {
  it("senza entità attiva non occupa spazio", () => {
    expect(renderBarra(null)).toBe("");
  });

  it("dice su cosa si sta lavorando e i suoi dati brevi", () => {
    const markup = renderBarra({
      superficie: "commessa",
      entita: { tipo: "commessa", id: 184, etichetta: "COM-2026-184 — Rossi" },
      dettagli: [{ etichetta: "Stato", valore: "Produzione" }],
    });

    expect(markup).toContain("Stai lavorando su:");
    expect(markup).toContain("COM-2026-184 — Rossi");
    expect(markup).toContain("Produzione");
  });

  it("senza etichetta ripiega su tipo e id, non su una stringa vuota", () => {
    expect(
      renderBarra({ superficie: null, entita: { tipo: "cliente", id: 51 } })
    ).toContain("cliente #51");
  });
});

describe("stati del briefing", () => {
  it("un briefing mai arrivato non è un briefing vuoto", () => {
    expect(statoBriefing(null)).toBe("non_disponibile");
    expect(statoBriefing(briefingVuoto)).toBe("vuoto");
  });

  it("distingue le segnalazioni omesse da un briefing genuinamente vuoto", () => {
    expect(statoBriefing({ ...briefingVuoto, segnalazioni: null })).toBe(
      "vuoto_segnalazioni_escluse"
    );
  });

  it("basta una voce qualsiasi perché il briefing sia pieno", () => {
    expect(
      statoBriefing({ ...briefingVuoto, casiMiei: [{ id: 1 }] })
    ).toBe("pieno");
    expect(
      statoBriefing({ ...briefingVuoto, segnalazioni: [{ titolo: "x" }] })
    ).toBe("pieno");
  });
});
