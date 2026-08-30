import type { REMINDER_TIMEZONE } from "./time";

export type ReminderStatus = "scheduled" | "due" | "completed" | "cancelled";

export type Reminder = {
  id: number;
  sedeId: number;
  recipientUserId: number;
  createdByUserId: number;
  sourceProposalId: number | null;
  canonicalKey: string;
  text: string;
  remindAt: Date;
  timezone: typeof REMINDER_TIMEZONE;
  status: ReminderStatus;
  revision: number;
  clienteId: number | null;
  commessaId: number | null;
  popupDismissedAt: Date | null;
  firedAt: Date | null;
  notificationRevision: number;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReminderEventType =
  | "created"
  | "fired"
  | "popup_dismissed"
  | "completed"
  | "snoozed"
  | "cancelled";

export type ReminderEvent = {
  id: number;
  reminderId: number;
  sedeId: number;
  actorUserId: number | null;
  eventType: ReminderEventType;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type ReminderScope = {
  sedeId: number;
  recipientUserId: number;
};

export type CreateReminderInput = ReminderScope & {
  createdByUserId: number;
  sourceProposalId: number | null;
  canonicalKey: string;
  text: string;
  remindAt: Date;
  timezone: typeof REMINDER_TIMEZONE;
  clienteId: number | null;
  commessaId: number | null;
  now: Date;
};

export type ReminderMutationInput = ReminderScope & {
  id: number;
  actorUserId: number;
  now: Date;
};

export type ReminderListInput = ReminderScope & {
  stati: ReminderStatus[];
  daRemindAt?: Date;
  aRemindAt?: Date;
  ordina: "remindAt" | "creazioneDesc";
  limit: number;
};
