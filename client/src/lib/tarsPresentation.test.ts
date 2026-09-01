import TarsContextPanel, {
  type BriefingOperativoTars,
} from "@/components/tars/TarsContextPanel";
import TarsThread, { type ChiaveUndoTars } from "@/components/tars/TarsThread";
import type { TurnoTarsView } from "@/lib/tarsView";
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

const briefingVuoto: BriefingOperativoTars = {
  promemoriaOggi: [],
  casiMiei: [],
  segnalazioni: [],
};

function renderContesto(briefing: BriefingOperativoTars | null): string {
  return renderToStaticMarkup(
    createElement(TarsContextPanel, { contesto: null, briefing })
  );
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

  it("mantiene il trigger contesto fino al breakpoint del pannello persistente", () => {
    const markup = renderToStaticMarkup(
      createElement(TarsThread, {
        turni: [],
        statoAvatar: "disponibile",
        onOpenContext: () => undefined,
      })
    );
    const trigger = markup.match(
      /<button[^>]*aria-label="Apri contesto operativo"[^>]*>/
    )?.[0];

    expect(trigger).toBeDefined();
    expect(trigger).toContain("xl:hidden");
    expect(trigger).not.toContain("lg:hidden");
  });
});

describe("stati briefing nel contesto Tars", () => {
  it("presenta briefing null come non disponibile, non come vuoto", () => {
    const markup = renderContesto(null);

    expect(markup).toContain("Briefing non disponibile");
    expect(markup).not.toContain("Nessun promemoria");
  });

  it("distingue segnalazioni omesse da un briefing genuinamente vuoto", () => {
    const omesse = renderContesto({ ...briefingVuoto, segnalazioni: null });
    expect(omesse).toContain("Nessun promemoria o caso assegnato");
    expect(omesse).toContain("Segnalazioni non incluse");
    expect(omesse).not.toContain("o segnale operativo");

    const vuoto = renderContesto(briefingVuoto);
    expect(vuoto).toContain(
      "Nessun promemoria, caso assegnato o segnale operativo"
    );
    expect(vuoto).not.toContain("Segnalazioni non incluse");
  });
});
