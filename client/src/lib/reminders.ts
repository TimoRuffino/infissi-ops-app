export const formatReminderAt = (value: Date | string) =>
  new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function nextDueReminder<
  T extends { id: number; remindAt: Date | string },
>(items: T[]): T | null {
  return (
    [...items].sort(
      (a, b) =>
        new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime() ||
        a.id - b.id,
    )[0] ?? null
  );
}

export function remainingReminderLabel(total: number) {
  const remaining = Math.max(0, Math.trunc(total) - 1);
  if (remaining === 1) return "Un altro promemoria in attesa";
  return `Altri ${remaining} promemoria in attesa`;
}
