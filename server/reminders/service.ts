import {
  getNotificationRepository,
  type NotificationRepository,
} from "../notifications/repository";
import {
  getReminderRepository,
  type ReminderRepository,
} from "./repository";
import {
  parseFutureReminderInstant,
  REMINDER_TIMEZONE,
  resolveSnoozeAt,
  type SnoozeInput,
} from "./time";
import type { ReminderScope } from "./types";

export class ReminderNotFoundError extends Error {
  constructor() {
    super("REMINDER_NOT_FOUND");
    this.name = "ReminderNotFoundError";
  }
}

export type CreateApprovedReminderInput = {
  sedeId: number;
  requestedByUserId: number;
  sourceProposalId: number | null;
  actionKey: string;
  text: string;
  remindAtIso: string;
  clienteId: number | null;
  commessaId: number | null;
};

type PersonalReminderInput = ReminderScope & { id: number };
export type SnoozeReminderInput = PersonalReminderInput & SnoozeInput;

export function createReminderService(deps: {
  reminders: ReminderRepository;
  notifications: NotificationRepository;
  now?: () => Date;
}) {
  const currentTime = () => deps.now?.() ?? new Date();

  async function resolveNotificationGroup(
    scope: ReminderScope,
    id: number,
    now: Date,
  ) {
    await deps.notifications.resolveGroup({
      sedeId: scope.sedeId,
      recipientUserId: scope.recipientUserId,
      groupKey: `reminder:${id}`,
      now,
    });
  }

  return {
    async createApproved(input: CreateApprovedReminderInput) {
      const now = currentTime();
      const remindAt = parseFutureReminderInstant(input.remindAtIso, now);
      return deps.reminders.create({
        sedeId: input.sedeId,
        recipientUserId: input.requestedByUserId,
        createdByUserId: input.requestedByUserId,
        sourceProposalId: input.sourceProposalId,
        canonicalKey: input.actionKey,
        text: input.text.trim(),
        remindAt,
        timezone: REMINDER_TIMEZONE,
        clienteId: input.clienteId,
        commessaId: input.commessaId,
        now,
      });
    },

    async listPopupDue(scope: ReminderScope) {
      return deps.reminders.listPopupDue({ ...scope, limit: 20 });
    },

    async dismissPopup(input: PersonalReminderInput) {
      const record = await deps.reminders.dismissPopup({
        ...input,
        actorUserId: input.recipientUserId,
        now: currentTime(),
      });
      if (!record) throw new ReminderNotFoundError();
      return record;
    },

    async complete(input: PersonalReminderInput) {
      const now = currentTime();
      const record = await deps.reminders.complete({
        ...input,
        actorUserId: input.recipientUserId,
        now,
      });
      if (!record) throw new ReminderNotFoundError();
      await resolveNotificationGroup(input, record.id, now);
      return record;
    },

    async snooze(input: SnoozeReminderInput) {
      const now = currentTime();
      const snoozeInput: SnoozeInput =
        input.kind === "custom"
          ? { kind: "custom", localDateTime: input.localDateTime }
          : { kind: "preset", preset: input.preset };
      const remindAt = resolveSnoozeAt(snoozeInput, now);
      if (remindAt.getTime() <= now.getTime()) {
        throw new Error("REMINDER_TIME_NOT_FUTURE");
      }
      const record = await deps.reminders.snooze({
        sedeId: input.sedeId,
        recipientUserId: input.recipientUserId,
        id: input.id,
        actorUserId: input.recipientUserId,
        remindAt,
        now,
      });
      if (!record) throw new ReminderNotFoundError();
      await resolveNotificationGroup(input, record.id, now);
      return record;
    },

    async cancel(input: PersonalReminderInput) {
      const now = currentTime();
      const record = await deps.reminders.cancel({
        ...input,
        actorUserId: input.recipientUserId,
        now,
      });
      if (!record) throw new ReminderNotFoundError();
      await resolveNotificationGroup(input, record.id, now);
      return record;
    },
  };
}

export type ReminderService = ReturnType<typeof createReminderService>;

let serviceSingleton: ReminderService | null = null;
let serviceOverride: ReminderService | null = null;

export function getReminderService(): ReminderService {
  if (serviceOverride) return serviceOverride;
  serviceSingleton ??= createReminderService({
    reminders: getReminderRepository(),
    notifications: getNotificationRepository(),
  });
  return serviceSingleton;
}

export function setReminderServiceForTesting(value: ReminderService | null) {
  serviceOverride = value;
}
