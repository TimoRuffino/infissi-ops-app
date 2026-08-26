import { describe, expect, it } from "vitest";

import {
  parseFutureReminderInstant,
  parseRomeLocalDateTime,
  resolveSnoozeAt,
} from "./time";

const now = new Date("2026-08-26T10:00:00.000Z");

describe("reminder time", () => {
  it("accepts only future ISO timestamps with an explicit offset", () => {
    expect(parseFutureReminderInstant("2026-08-27T09:00:00+02:00", now))
      .toEqual(new Date("2026-08-27T07:00:00.000Z"));
    expect(() => parseFutureReminderInstant("2026-08-26T09:00:00Z", now))
      .toThrow("REMINDER_TIME_NOT_FUTURE");
    expect(() => parseFutureReminderInstant("2026-08-27T09:00:00", now))
      .toThrow("REMINDER_TIME_OFFSET_REQUIRED");
  });

  it("interprets a local date-time in Europe/Rome", () => {
    expect(parseRomeLocalDateTime("2026-08-27T09:00", now).toISOString())
      .toBe("2026-08-27T07:00:00.000Z");
  });

  it("rejects missing and duplicated local times at DST changes", () => {
    const beforeDst = new Date("2026-01-01T00:00:00.000Z");
    expect(() => parseRomeLocalDateTime("2026-03-29T02:30", beforeDst))
      .toThrow("REMINDER_LOCAL_TIME_INVALID");
    expect(() => parseRomeLocalDateTime("2026-10-25T02:30", beforeDst))
      .toThrow("REMINDER_LOCAL_TIME_AMBIGUOUS");
  });

  it("calculates tomorrow at 09:00 across the daylight-saving boundary", () => {
    expect(resolveSnoozeAt(
      { kind: "preset", preset: "tomorrow_9" },
      new Date("2026-10-24T10:00:00.000Z")
    ).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("calculates the short presets from the server clock", () => {
    expect(resolveSnoozeAt({ kind: "preset", preset: "15m" }, now))
      .toEqual(new Date("2026-08-26T10:15:00.000Z"));
    expect(resolveSnoozeAt({ kind: "preset", preset: "1h" }, now))
      .toEqual(new Date("2026-08-26T11:00:00.000Z"));
  });
});
