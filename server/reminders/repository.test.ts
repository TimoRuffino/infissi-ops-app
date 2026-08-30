import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryReminderRepository } from "./repository";

const now = new Date("2026-08-26T10:00:00.000Z");

describe("reminder repository", () => {
  let repo: ReturnType<typeof createMemoryReminderRepository>;

  beforeEach(() => {
    repo = createMemoryReminderRepository();
  });

  it("deduplica la stessa proposta e isola sede e destinatario", async () => {
    const input = {
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: 91,
      canonicalKey: "reminder:1:7:test",
      text: "Invia preventivo",
      remindAt: new Date("2026-08-27T07:00:00Z"),
      timezone: "Europe/Rome" as const,
      clienteId: null,
      commessaId: null,
      now,
    };

    const first = await repo.create(input);
    const retry = await repo.create(input);

    expect(retry).toEqual({ record: first.record, created: false });
    expect(await repo.findById(1, 8, first.record.id)).toBeNull();
    expect(await repo.findById(2, 7, first.record.id)).toBeNull();
  });

  it("reclama una scadenza una sola volta e conserva l'audit", async () => {
    const created = await repo.create({
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: 92,
      canonicalKey: "reminder:1:7:due",
      text: "Chiama Rossi",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });

    const [claimed, duplicate] = await Promise.all([
      repo.claimDue({ now, limit: 20 }),
      repo.claimDue({ now, limit: 20 }),
    ]);

    expect([...claimed, ...duplicate]).toHaveLength(1);
    expect(
      (await repo.listEvents(1, created.record.id)).map((event) => event.eventType),
    ).toEqual(["created", "fired"]);
  });

  it("posticipa incrementando la revisione e azzerando la consegna", async () => {
    const created = await repo.create({
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: 93,
      canonicalKey: "reminder:1:7:snooze",
      text: "Richiama il cliente",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });
    await repo.claimDue({ now, limit: 20 });
    expect(
      await repo.markNotificationProjected({
        id: created.record.id,
        revision: 1,
        now,
      }),
    ).toBe(true);

    const snoozedAt = new Date("2026-08-26T11:00:00Z");
    const snoozed = await repo.snooze({
      sedeId: 1,
      recipientUserId: 7,
      id: created.record.id,
      actorUserId: 7,
      remindAt: snoozedAt,
      now,
    });

    expect(snoozed).toMatchObject({
      revision: 2,
      status: "scheduled",
      notificationRevision: 0,
      popupDismissedAt: null,
      firedAt: null,
    });
    expect(snoozed?.remindAt).toEqual(snoozedAt);
    expect(
      (await repo.listEvents(1, created.record.id)).map((event) => event.eventType),
    ).toEqual(["created", "fired", "snoozed"]);
  });

  it("rende idempotenti chiusura popup, completamento e annullamento", async () => {
    const created = await repo.create({
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: 94,
      canonicalKey: "reminder:1:7:lifecycle",
      text: "Invia i documenti",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: 41,
      now,
    });
    await repo.claimDue({ now, limit: 20 });

    const mutation = {
      sedeId: 1,
      recipientUserId: 7,
      id: created.record.id,
      actorUserId: 7,
      now,
    };
    const dismissed = await repo.dismissPopup(mutation);
    expect(dismissed?.popupDismissedAt).toEqual(now);
    expect(await repo.dismissPopup(mutation)).toEqual(dismissed);

    const completed = await repo.complete(mutation);
    expect(completed).toMatchObject({ status: "completed", completedAt: now });
    expect(await repo.complete(mutation)).toEqual(completed);
    expect(await repo.cancel(mutation)).toBeNull();
    expect(
      (await repo.listEvents(1, created.record.id)).map((event) => event.eventType),
    ).toEqual(["created", "fired", "popup_dismissed", "completed"]);
  });

  it("non modifica né rivela promemoria fuori scope", async () => {
    const created = await repo.create({
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: 95,
      canonicalKey: "reminder:1:7:scoped",
      text: "Controlla misure",
      remindAt: new Date("2026-08-27T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });
    const outsideScope = {
      sedeId: 2,
      recipientUserId: 8,
      id: created.record.id,
      actorUserId: 8,
      now,
    };

    expect(await repo.dismissPopup(outsideScope)).toBeNull();
    expect(await repo.complete(outsideScope)).toBeNull();
    expect(
      await repo.snooze({
        ...outsideScope,
        remindAt: new Date("2026-08-28T09:00:00Z"),
      }),
    ).toBeNull();
    expect(await repo.cancel(outsideScope)).toBeNull();
    expect(
      (await repo.listEvents(1, created.record.id)).map((event) => event.eventType),
    ).toEqual(["created"]);
  });

  it("listPersonal filtra per scope, stato e intervallo e ordina come chiesto", async () => {
    const base = {
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: null,
      timezone: "Europe/Rome" as const,
      clienteId: null,
      commessaId: null,
    };
    const lunedi = await repo.create({
      ...base,
      canonicalKey: "list:lunedi",
      text: "Lunedì",
      remindAt: new Date("2026-08-31T07:00:00Z"),
      now,
    });
    const mercoledi = await repo.create({
      ...base,
      canonicalKey: "list:mercoledi",
      text: "Mercoledì",
      remindAt: new Date("2026-09-02T07:00:00Z"),
      now: new Date(now.getTime() + 60_000),
    });
    await repo.create({
      ...base,
      canonicalKey: "list:altrove",
      recipientUserId: 8,
      text: "Di un altro",
      remindAt: new Date("2026-08-31T08:00:00Z"),
      now,
    });
    await repo.cancel({
      sedeId: 1,
      recipientUserId: 7,
      id: mercoledi.record.id,
      actorUserId: 7,
      now,
    });
    // Un promemoria ATTIVO dell'utente fuori dall'intervallo: se i
    // confronti da/a sparissero, questo comparirebbe e il test morde.
    const fuoriIntervallo = await repo.create({
      ...base,
      canonicalKey: "list:fuori",
      text: "Fuori intervallo",
      remindAt: new Date("2026-09-20T07:00:00Z"),
      now,
    });

    const attivi = await repo.listPersonal({
      sedeId: 1,
      recipientUserId: 7,
      stati: ["scheduled", "due"],
      daRemindAt: new Date("2026-08-30T00:00:00Z"),
      aRemindAt: new Date("2026-09-06T00:00:00Z"),
      ordina: "remindAt",
      limit: 10,
    });
    expect(attivi.map((r) => r.id)).toEqual([lunedi.record.id]);

    const recenti = await repo.listPersonal({
      sedeId: 1,
      recipientUserId: 7,
      stati: ["scheduled", "due", "completed", "cancelled"],
      ordina: "creazioneDesc",
      limit: 10,
    });
    expect(recenti.map((r) => r.id)).toEqual([
      mercoledi.record.id,
      fuoriIntervallo.record.id,
      lunedi.record.id,
    ]);
  });
});
