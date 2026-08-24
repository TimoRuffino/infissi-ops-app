import { describe, expect, it } from "vitest";
import { collectActionSignals, groupSignals } from "./signals";

const NOW = new Date("2026-08-24T10:00:00.000Z");

function commessa(overrides: Record<string, unknown> = {}) {
  return {
    id: 60,
    sedeId: 1,
    codice: "COM-2026-060",
    clienteId: 12,
    cliente: "Maioglio Alessia",
    stato: "preventivo",
    priorita: "media",
    assegnatoA: 7,
    createdBy: 4,
    updatedAt: new Date("2026-08-24T08:00:00.000Z"),
    archivedAt: null,
    dataConsegnaConfermata: null,
    importoTotale: 12_000,
    importoIncassato: 12_000,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    sedeId: 1,
    now: NOW,
    commesse: [],
    tickets: [],
    garanzie: [],
    interventi: [],
    ...overrides,
  };
}

describe("Action Center signal engine", () => {
  it("raggruppa aging, promemoria e routing della stessa commessa in un solo caso", () => {
    const signals = collectActionSignals({
      sedeId: 1,
      now: NOW,
      commesse: [
        {
          id: 60,
          sedeId: 1,
          codice: "COM-2026-060",
          clienteId: 12,
          cliente: "Maioglio Alessia",
          stato: "da_ordinare",
          priorita: "media",
          assegnatoA: 7,
          createdBy: 4,
          updatedAt: new Date("2026-08-11T08:00:00.000Z"),
          archivedAt: null,
          dataConsegnaConfermata: null,
          importoTotale: 12_000,
          importoIncassato: 6_000,
        },
      ],
      tickets: [],
      garanzie: [],
      interventi: [],
    });

    expect(signals.map(signal => signal.kind).sort()).toEqual([
      "priority_aging",
      "stato_daily",
      "stato_role",
    ]);

    const cases = groupSignals(signals, NOW);

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      canonicalKey: "commessa:60",
      sedeId: 1,
      commessaId: 60,
      clienteId: 12,
      priority: "critica",
      assigneeUserId: 7,
      nextAction: {
        sourceKind: "stato_daily",
        label: "Completa l'ordine della commessa",
      },
    });
    expect(cases[0].signals).toHaveLength(3);
    expect(new Set(cases[0].signals.map(signal => signal.sourceKey)).size).toBe(3);
  });

  it("unisce ticket e criticita operative alla commessa collegata", () => {
    const signals = collectActionSignals(input({
      commesse: [commessa({
        stato: "produzione",
        updatedAt: new Date("2026-08-17T08:00:00.000Z"),
      })],
      tickets: [{
        id: 91,
        sedeId: 1,
        commessaId: 60,
        clienteId: 12,
        contatto: null,
        oggetto: "Vetro danneggiato",
        stato: "aperto",
        priorita: "urgente",
        assegnatoA: null,
        apertoBy: 9,
        createdAt: new Date("2026-08-24T07:00:00.000Z"),
        updatedAt: new Date("2026-08-24T07:30:00.000Z"),
      }],
    }));

    const cases = groupSignals(signals, NOW);

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      canonicalKey: "commessa:60",
      priority: "critica",
      assigneeUserId: 7,
      nextAction: {
        sourceKind: "ticket",
        label: "Gestisci il ticket urgente",
      },
    });
    expect(cases[0].signals.map(signal => signal.kind).sort()).toEqual([
      "consegna",
      "priority_aging",
      "ticket",
    ]);
  });

  it("produce i segnali specifici e li rimuove quando la condizione e risolta", () => {
    const active = collectActionSignals(input({
      commesse: [
        commessa({
          id: 61,
          codice: "COM-2026-061",
          stato: "finiture_saldo",
          importoIncassato: 9_000,
        }),
        commessa({ id: 62, codice: "COM-2026-062" }),
      ],
      garanzie: [{
        id: 20,
        sedeId: 1,
        commessaId: 62,
        descrizione: "Motorizzazione",
        stato: "attiva",
        dataScadenza: "2026-08-23",
        updatedAt: new Date("2026-08-01T08:00:00.000Z"),
      }],
      interventi: [{
        id: 44,
        sedeId: 1,
        commessaId: 62,
        tipo: "posa",
        stato: "pianificato",
        squadraId: null,
        dataPianificata: "2026-08-24",
        oraInizio: "08:30",
        indirizzo: "Via Roma 1",
        createdAt: new Date("2026-08-20T08:00:00.000Z"),
        updatedAt: new Date("2026-08-20T08:00:00.000Z"),
      }],
    }));

    expect(active.map(signal => signal.kind).sort()).toEqual([
      "garanzia",
      "intervento",
      "saldo",
      "stato_role",
    ]);

    const resolved = collectActionSignals(input({
      commesse: [
        commessa({
          id: 61,
          codice: "COM-2026-061",
          stato: "finiture_saldo",
          importoIncassato: 12_000,
        }),
        commessa({ id: 62, codice: "COM-2026-062" }),
      ],
      garanzie: [{
        id: 20,
        sedeId: 1,
        commessaId: 62,
        descrizione: "Motorizzazione",
        stato: "sospesa",
        dataScadenza: "2026-08-23",
        updatedAt: new Date("2026-08-24T08:00:00.000Z"),
      }],
      interventi: [{
        id: 44,
        sedeId: 1,
        commessaId: 62,
        tipo: "posa",
        stato: "pianificato",
        squadraId: 3,
        dataPianificata: "2026-08-24",
        oraInizio: "08:30",
        indirizzo: "Via Roma 1",
        createdAt: new Date("2026-08-20T08:00:00.000Z"),
        updatedAt: new Date("2026-08-24T08:00:00.000Z"),
      }],
    }));

    expect(resolved.map(signal => signal.kind)).toEqual(["stato_role"]);
  });

  it("mantiene separati i ticket senza commessa e usa un assegnatario esplicito", () => {
    const cases = groupSignals(collectActionSignals(input({
      tickets: [{
        id: 92,
        sedeId: 1,
        commessaId: null,
        clienteId: 33,
        contatto: "Mario Rossi",
        oggetto: "Richiesta assistenza",
        stato: "assegnato",
        priorita: "alta",
        assegnatoA: 11,
        apertoBy: 9,
        createdAt: new Date("2026-08-24T07:00:00.000Z"),
        updatedAt: new Date("2026-08-24T07:30:00.000Z"),
      }],
    })), NOW);

    expect(cases).toMatchObject([{
      canonicalKey: "ticket:92",
      targetType: "ticket",
      targetId: 92,
      commessaId: null,
      clienteId: 33,
      assigneeUserId: 11,
      title: "Ticket #92 - Mario Rossi",
    }]);
  });

  it("ignora altre sedi e record archiviati e genera fingerprint stabili", () => {
    const valid = commessa({
      id: 63,
      codice: "COM-2026-063",
      stato: "da_ordinare",
      updatedAt: new Date("2026-08-18T08:00:00.000Z"),
    });
    const signals = collectActionSignals(input({
      commesse: [
        commessa({ id: 64, sedeId: 2 }),
        commessa({ id: 65, archivedAt: "2026-08-20T10:00:00.000Z" }),
        valid,
      ],
    }));
    const first = groupSignals(signals, NOW)[0];
    const second = groupSignals([...signals].reverse(), NOW)[0];

    expect(first.canonicalKey).toBe("commessa:63");
    expect(first.signalFingerprint).toBe(second.signalFingerprint);
    expect(first.signals.map(signal => signal.sourceKey)).toEqual(
      second.signals.map(signal => signal.sourceKey)
    );
  });
});
