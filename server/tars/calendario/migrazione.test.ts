// Migrazione calendario (T4/D2): finestra «ultimi 2 mesi + corrente (e
// futuro)», tipo dal titolo, commessa SOLO su match univoco, dedupe per
// chiave evento.

import { describe, expect, it } from "vitest";
import {
  chiaveEvento,
  commessaPerEvento,
  finestraMigrazione,
  pianoMigrazione,
  tipoDaTitolo,
  type EventoEsterno,
} from "./migrazione";

const evento = (extra: Partial<EventoEsterno>): EventoEsterno => ({
  sourceId: 3,
  sourceNome: "Cantieri",
  uid: "uid-1",
  titolo: "Posa Soare",
  location: null,
  dataPianificata: "2026-09-10",
  oraInizio: "08:00",
  oraFine: "12:00",
  ...extra,
});

describe("finestraMigrazione", () => {
  it("dal 1° del mese-2 a oggi+futuro", () => {
    const f = finestraMigrazione(new Date(2026, 8, 3, 21), 180); // 03/09/2026
    expect(f.da).toBe("2026-07-01");
    expect(f.a > "2026-09-03").toBe(true);
  });
});

describe("tipoDaTitolo", () => {
  it("posa/montaggio, rilievo/sopralluogo/misure, assistenza/riparazione, altro", () => {
    expect(tipoDaTitolo("POSA Rossi via Milano")).toBe("posa");
    expect(tipoDaTitolo("Montaggio zanzariere Bianchi")).toBe("posa");
    expect(tipoDaTitolo("Sopralluogo condominio Aurora")).toBe("rilievo");
    expect(tipoDaTitolo("prendere misure Verdi")).toBe("rilievo");
    expect(tipoDaTitolo("Riparazione tapparella")).toBe("assistenza");
    expect(tipoDaTitolo("Consegna Oknoplast")).toBe("consegna");
    expect(tipoDaTitolo("Ritiro riparazioni Primed")).toBe("consegna");
    expect(tipoDaTitolo("Ferie Marco")).toBe("ferie");
    expect(tipoDaTitolo("Riunione commerciale")).toBe("riunione");
    expect(tipoDaTitolo("Appuntamento showroom Bianchi")).toBe("appuntamento");
    expect(tipoDaTitolo("Compleanno nonna")).toBe("altro");
  });
});

describe("commessaPerEvento", () => {
  const commesse = [
    { id: 1, codice: "COM-2026-061", cliente: "Soare Maria" },
    { id: 2, codice: "COM-2026-062", cliente: "Rossi Anna" },
    { id: 3, codice: "COM-2026-063", cliente: "Rossi Piero" },
    { id: 4, codice: "COM-2026-064", cliente: "Vecchia Archiviata", archivedAt: new Date() },
  ];

  it("codice nel titolo vince; cognome univoco collega; ambiguo o archiviata no", () => {
    expect(commessaPerEvento(evento({ titolo: "Posa COM-2026-062" }), commesse)).toMatchObject({ commessaId: 2 });
    expect(commessaPerEvento(evento({ titolo: "Posa Soare mattina" }), commesse)).toMatchObject({ commessaId: 1 });
    // «Rossi» ha DUE commesse attive: nessun collegamento.
    expect(commessaPerEvento(evento({ titolo: "Rilievo Rossi" }), commesse)).toMatchObject({ commessaId: null });
    expect(commessaPerEvento(evento({ titolo: "Posa Vecchia" }), commesse)).toMatchObject({ commessaId: null });
    // Cognomi corti o assenti non fanno match a caso.
    expect(commessaPerEvento(evento({ titolo: "Consegna materiale" }), commesse)).toMatchObject({ commessaId: null });
  });
});

describe("pianoMigrazione", () => {
  it("salta i già importati, azzera orari degli all-day, porta la nota col calendario", () => {
    const eventi = [
      evento({ uid: "a", titolo: "Posa Soare" }),
      evento({ uid: "b", titolo: "Ferie", allDay: true, oraInizio: "00:00", oraFine: null }),
      evento({ uid: "c", titolo: "Sopralluogo Rossi Anna e Piero" }),
    ];
    const commesse = [{ id: 1, codice: "COM-2026-061", cliente: "Soare Maria" }];
    const esistenti = new Set([chiaveEvento(eventi[2])]);
    const { daCreare, giaImportati } = pianoMigrazione({ eventi, commesse, esistenti });
    expect(giaImportati).toBe(1);
    expect(daCreare).toHaveLength(2);
    expect(daCreare[0]).toMatchObject({ tipo: "posa", commessaId: 1, oraInizio: "08:00" });
    expect(daCreare[0].note).toContain("Cantieri");
    expect(daCreare[1]).toMatchObject({ tipo: "ferie", commessaId: null, oraInizio: null });
    // Chiavi stabili e distinte per occorrenza.
    expect(daCreare[0].chiave).toBe("google:3:a:2026-09-10");
  });
});
