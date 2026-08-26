import { describe, expect, it } from "vitest";
import {
  formatReminderAt,
  nextDueReminder,
  remainingReminderLabel,
} from "./reminders";

describe("reminder UI helpers", () => {
  it("formatta sempre nel fuso di Roma", () => {
    expect(formatReminderAt(new Date("2026-08-27T07:00:00Z"))).toContain(
      "09:00",
    );
  });

  it("sceglie la scadenza più vecchia con tie-break id", () => {
    expect(
      nextDueReminder([
        { id: 9, remindAt: new Date("2026-08-27T07:00:00Z") },
        { id: 8, remindAt: new Date("2026-08-27T07:00:00Z") },
      ])?.id,
    ).toBe(8);
    expect(remainingReminderLabel(3)).toBe("Altri 2 promemoria in attesa");
  });
});
