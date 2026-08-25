import { persistedStore } from "../_core/persistence";
import type { BusinessEventRepository } from "./repository";
import { getBusinessEventRepository } from "./repository";
import { buildAssignmentEvent, publishDomainEvent, type AssignmentEntityType } from "./publish";

export type AssignmentSnapshot = {
  sedeId: number;
  entityType: AssignmentEntityType;
  entityId: number;
  assigneeId: number | null;
  updatedAt: Date;
  link: string;
};

type AssignmentSourceRecord = {
  id: number;
  sedeId: number;
  assegnatoA?: number | null;
  updatedAt?: Date | string | null;
};

type AssignmentSnapshotStore = {
  get(input: Pick<AssignmentSnapshot, "sedeId" | "entityType" | "entityId">):
    | AssignmentSnapshot
    | null;
  put(snapshot: AssignmentSnapshot): void;
  save(): void;
};

const persistedSnapshots = persistedStore<AssignmentSnapshot>(
  "business_event_assignment_fingerprints",
  items => {
    for (const item of items) item.updatedAt = new Date(item.updatedAt);
  }
);

function snapshotKey(
  input: Pick<AssignmentSnapshot, "sedeId" | "entityType" | "entityId">
) {
  return `${input.sedeId}:${input.entityType}:${input.entityId}`;
}

function cloneSnapshot(snapshot: AssignmentSnapshot): AssignmentSnapshot {
  return {
    ...snapshot,
    updatedAt: new Date(snapshot.updatedAt),
  };
}

export function createMemoryAssignmentSnapshotStore(): AssignmentSnapshotStore {
  return createArrayAssignmentSnapshotStore([], () => {});
}

export function createArrayAssignmentSnapshotStore(
  snapshots: AssignmentSnapshot[],
  save: () => void
): AssignmentSnapshotStore {
  return {
    get(input) {
      const key = snapshotKey(input);
      const snapshot = snapshots.find(item => snapshotKey(item) === key);
      return snapshot ? cloneSnapshot(snapshot) : null;
    },
    put(snapshot) {
      const key = snapshotKey(snapshot);
      const index = snapshots.findIndex(item => snapshotKey(item) === key);
      if (index === -1) snapshots.push(cloneSnapshot(snapshot));
      else snapshots[index] = cloneSnapshot(snapshot);
    },
    save,
  };
}

export function getPersistedAssignmentSnapshotStore(): AssignmentSnapshotStore {
  return createArrayAssignmentSnapshotStore(
    persistedSnapshots.items,
    persistedSnapshots.save
  );
}

export function collectAssignmentSnapshots(input: {
  sedeId: number;
  limit: number;
  clienti: AssignmentSourceRecord[];
  commesse: AssignmentSourceRecord[];
  tickets: AssignmentSourceRecord[];
}): AssignmentSnapshot[] {
  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 20_000);
  const sources: Array<{
    entityType: "cliente" | "commessa" | "ticket";
    records: AssignmentSourceRecord[];
    link: (id: number) => string;
  }> = [
    { entityType: "cliente", records: input.clienti, link: id => `/clienti/${id}` },
    { entityType: "commessa", records: input.commesse, link: id => `/commesse/${id}` },
    { entityType: "ticket", records: input.tickets, link: id => `/post-vendita/${id}` },
  ];
  const snapshots: AssignmentSnapshot[] = [];
  for (const source of sources) {
    for (const record of source.records) {
      if (snapshots.length >= limit) return snapshots;
      if (record.sedeId !== input.sedeId) continue;
      const updatedAt = new Date(record.updatedAt ?? 0);
      snapshots.push({
        sedeId: input.sedeId,
        entityType: source.entityType,
        entityId: record.id,
        assigneeId: record.assegnatoA ?? null,
        updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date(0) : updatedAt,
        link: source.link(record.id),
      });
    }
  }
  return snapshots;
}

export async function reconcileAssignmentSnapshots(input: {
  entities: AssignmentSnapshot[];
  snapshotStore: AssignmentSnapshotStore;
  eventRepository: BusinessEventRepository;
  dryRun: boolean;
}): Promise<{
  scanned: number;
  baselined: number;
  changes: number;
  published: number;
  duplicates: number;
  failed: number;
}> {
  const result = {
    scanned: 0,
    baselined: 0,
    changes: 0,
    published: 0,
    duplicates: 0,
    failed: 0,
  };

  for (const entity of input.entities) {
    result.scanned += 1;
    const previous = input.snapshotStore.get(entity);
    if (!previous) {
      result.baselined += 1;
      if (!input.dryRun) input.snapshotStore.put(entity);
      continue;
    }
    if (previous.assigneeId === entity.assigneeId) continue;

    result.changes += 1;
    if (input.dryRun) continue;

    const event = buildAssignmentEvent({
      sedeId: entity.sedeId,
      entityType: entity.entityType,
      entityId: entity.entityId,
      previousAssigneeId: previous.assigneeId,
      assigneeId: entity.assigneeId,
      actorUserId: null,
      updatedAt: entity.updatedAt,
      link: entity.link,
      reason: "Cambio assegnatario recuperato dal reconciler",
    });
    if (!event) continue;
    const published = await publishDomainEvent(event, {
      repository: input.eventRepository,
    });
    if (published.status === "inserted") result.published += 1;
    if (published.status === "duplicate") result.duplicates += 1;
    if (published.status === "failed") result.failed += 1;
    if (published.status !== "failed") input.snapshotStore.put(entity);
  }

  if (!input.dryRun) input.snapshotStore.save();
  return result;
}

export async function reconcileAssignmentEvents(input: {
  sedeId: number;
  limit?: number;
  dryRun?: boolean;
}) {
  const [{ getClientiStore }, { getCommesseStore }, { getTicketStore }] =
    await Promise.all([
      import("../routers/clienti"),
      import("../routers/commesse"),
      import("../routers/ticket"),
    ]);
  const entities = collectAssignmentSnapshots({
    sedeId: input.sedeId,
    limit: input.limit ?? 10_000,
    clienti: getClientiStore(),
    commesse: getCommesseStore(),
    tickets: getTicketStore(),
  });
  return reconcileAssignmentSnapshots({
    entities,
    snapshotStore: getPersistedAssignmentSnapshotStore(),
    eventRepository: getBusinessEventRepository(),
    dryRun: input.dryRun ?? true,
  });
}
