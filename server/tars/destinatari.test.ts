// T6/D4: il destinatario è derivato, mai «tutti». La direzione vede
// tutto più ciò che non ha padrone; gli altri solo il proprio.

import { describe, expect, it } from "vitest";
import { destinatarioPerTema, puoVedere } from "./destinatari";

const COMMERCIALE = 501;
const POSTVENDITA = 502;

describe("destinatarioPerTema", () => {
  it("commerciale con commessa assegnata → solo quell'utente", () => {
    expect(
      destinatarioPerTema({ tema: "commerciale", commessa: { assegnatoA: COMMERCIALE, stato: "preventivo" } })
    ).toMatchObject({ utenteId: COMMERCIALE, ruolo: null });
  });

  it("tema amministrativo o commessa in fatture/ordini → amministrazione, anche se assegnata", () => {
    expect(destinatarioPerTema({ tema: "amministrativo" })).toMatchObject({ ruolo: "amministrazione" });
    expect(
      destinatarioPerTema({ tema: "commerciale", commessa: { assegnatoA: COMMERCIALE, stato: "fatture_pagamento" } })
    ).toMatchObject({ ruolo: "amministrazione", utenteId: null });
    expect(
      destinatarioPerTema({ tema: "comunicazione", categoriaComunicazione: "amministrativa", commessa: { assegnatoA: COMMERCIALE, stato: "preventivo" } })
    ).toMatchObject({ ruolo: "amministrazione" });
  });

  it("post-vendita → chi ha il ticket, poi chi ha la commessa, poi direzione", () => {
    expect(
      destinatarioPerTema({ tema: "post_vendita", ticket: { assegnatoA: POSTVENDITA }, commessa: { assegnatoA: COMMERCIALE } })
    ).toMatchObject({ utenteId: POSTVENDITA });
    expect(
      destinatarioPerTema({ tema: "post_vendita", ticket: { assegnatoA: null }, commessa: { assegnatoA: COMMERCIALE } })
    ).toMatchObject({ utenteId: COMMERCIALE });
    expect(destinatarioPerTema({ tema: "post_vendita" })).toMatchObject({ ruolo: "direzione" });
  });

  it("senza assegnatario → direzione", () => {
    expect(destinatarioPerTema({ tema: "comunicazione", commessa: { assegnatoA: null, stato: "preventivo" } })).toMatchObject({ ruolo: "direzione" });
    expect(destinatarioPerTema({ tema: "commerciale" })).toMatchObject({ ruolo: "direzione" });
  });
});

describe("puoVedere", () => {
  const direzione = { utenteId: 1, ruoli: ["direzione"], direzione: true };
  const commerciale = { utenteId: COMMERCIALE, ruoli: ["commerciale"], direzione: false };
  const amministrazione = { utenteId: 700, ruoli: ["amministrazione"], direzione: false };

  it("la direzione vede tutto; l'utente vede il suo; il ruolo vede il ruolo", () => {
    const mia = destinatarioPerTema({ tema: "commerciale", commessa: { assegnatoA: COMMERCIALE, stato: "preventivo" } });
    const admin = destinatarioPerTema({ tema: "amministrativo" });
    const orfana = destinatarioPerTema({ tema: "commerciale" });

    expect(puoVedere(direzione, mia)).toBe(true);
    expect(puoVedere(direzione, admin)).toBe(true);
    expect(puoVedere(direzione, orfana)).toBe(true);

    expect(puoVedere(commerciale, mia)).toBe(true);
    expect(puoVedere(commerciale, admin)).toBe(false);
    expect(puoVedere(commerciale, orfana)).toBe(false);

    expect(puoVedere(amministrazione, admin)).toBe(true);
    expect(puoVedere(amministrazione, mia)).toBe(false);
  });
});
