import { TZDate, tzOffset } from "@date-fns/tz";

export const REMINDER_TIMEZONE = "Europe/Rome" as const;

export type SnoozeInput =
  | { kind: "preset"; preset: "15m" | "1h" | "tomorrow_9" }
  | { kind: "custom"; localDateTime: string };

export function parseFutureReminderInstant(value: string, now = new Date()): Date {
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error("REMINDER_TIME_OFFSET_REQUIRED");
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("REMINDER_TIME_INVALID");
  }
  if (parsed.getTime() <= now.getTime()) {
    throw new Error("REMINDER_TIME_NOT_FUTURE");
  }

  return parsed;
}

export function parseRomeLocalDateTime(value: string, now = new Date()): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("REMINDER_LOCAL_TIME_INVALID");
  }

  const [, year, month, day, hour, minute] = match.map(Number);
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([
    tzOffset(REMINDER_TIMEZONE, new Date(nominalUtc - 86_400_000)),
    tzOffset(REMINDER_TIMEZONE, new Date(nominalUtc)),
    tzOffset(REMINDER_TIMEZONE, new Date(nominalUtc + 86_400_000)),
  ]);

  const candidates = Array.from(offsets)
    .map((offset) => new Date(nominalUtc - offset * 60_000))
    .filter((candidate) => {
      const local = new TZDate(candidate, REMINDER_TIMEZONE);
      return (
        local.getFullYear() === year &&
        local.getMonth() === month - 1 &&
        local.getDate() === day &&
        local.getHours() === hour &&
        local.getMinutes() === minute
      );
    });

  if (candidates.length === 0) {
    throw new Error("REMINDER_LOCAL_TIME_INVALID");
  }
  if (candidates.length > 1) {
    throw new Error("REMINDER_LOCAL_TIME_AMBIGUOUS");
  }

  return parseFutureReminderInstant(candidates[0].toISOString(), now);
}

export function resolveSnoozeAt(input: SnoozeInput, now = new Date()): Date {
  if (input.kind === "custom") {
    return parseRomeLocalDateTime(input.localDateTime, now);
  }
  if (input.preset === "15m") {
    return new Date(now.getTime() + 15 * 60_000);
  }
  if (input.preset === "1h") {
    return new Date(now.getTime() + 60 * 60_000);
  }

  const romeNow = new TZDate(now, REMINDER_TIMEZONE);
  const tomorrowAtNine = new TZDate(
    romeNow.getFullYear(),
    romeNow.getMonth(),
    romeNow.getDate() + 1,
    9,
    0,
    0,
    0,
    REMINDER_TIMEZONE,
  );

  return new Date(tomorrowAtNine.getTime());
}
