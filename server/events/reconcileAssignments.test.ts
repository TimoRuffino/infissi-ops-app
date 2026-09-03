import { describe, expect, it } from "vitest";
import { setFeatureFlags } from "../platform/featureFlags";
import { createMemoryBusinessEventRepository } from "./repository";
import {
  collectAssignmentSnapshots,
  createArrayAssignmentSnapshotStore,
  createMemoryAssignmentSnapshotStore,
  reconcileAssignmentSnapshots,
} from "./reconcileAssignments";

describe("assignment event reconciler", () => {
  it("crea una baseline senza rumore e recupera solo cambi successivi", async () => {
    const sedeId = 950101;
    const eventRepository = createMemoryBusinessEventRepository();
    const snapshotStore = createMemoryAssignmentSnapshotStore();
    setFeatureFlags(
      sedeId,
      { eventBusMode: "shadow" },
      { actorUserId: 1, reason: "Test reconciler assegnazioni" }
    );
    const base = {
      sedeId,
      entityType: "commessa" as const,
      entityId: 42,
      assigneeId: 7,
      updatedAt: new Date("2026-08-25T10:00:00.000Z"),
      link: "/commesse/42",
    };

    expect(
      await reconcileAssignmentSnapshots({
        entities: [base],
        snapshotStore,
        eventRepository,
        dryRun: false,
      })
    ).toMatchObject({ baselined: 1, changes: 0, published: 0 });

    const changed = {
      ...base,
      assigneeId: 8,
      updatedAt: new Date("2026-08-25T11:00:00.000Z"),
    };
    expect(
      await reconcileAssignmentSnapshots({
        entities: [changed],
        snapshotStore,
        eventRepository,
        dryRun: false,
      })
    ).toMatchObject({ baselined: 0, changes: 1, published: 1 });
    expect(
      await reconcileAssignmentSnapshots({
        entities: [changed],
        snapshotStore,
        eventRepository,
        dryRun: false,
      })
    ).toMatchObject({ baselined: 0, changes: 0, published: 0 });
  });

  it("in dry-run non modifica snapshot o registro eventi", async () => {
    const snapshotStore = createMemoryAssignmentSnapshotStore();
    const eventRepository = createMemoryBusinessEventRepository();
    const entity = {
      sedeId: 950102,
      entityType: "cliente" as const,
      entityId: 1,
      assigneeId: 7,
      updatedAt: new Date(),
      link: "/clienti/1",
    };

    const first = await reconcileAssignmentSnapshots({
      entities: [entity],
      snapshotStore,
      eventRepository,
      dryRun: true,
    });
    const second = await reconcileAssignmentSnapshots({
      entities: [entity],
      snapshotStore,
      eventRepository,
      dryRun: true,
    });

    expect(first.baselined).toBe(1);
    expect(second.baselined).toBe(1);
  });

  it("raccoglie solo record della sede richiesta entro il limite", () => {
    const snapshots = collectAssignmentSnapshots({
      sedeId: 11,
      limit: 2,
      clienti: [
        { id: 1, sedeId: 11, assegnatoA: 4, updatedAt: new Date("2026-08-25T09:00:00Z") },
        { id: 2, sedeId: 12, assegnatoA: 5, updatedAt: new Date("2026-08-25T09:00:00Z") },
      ],
      commesse: [
        { id: 7, sedeId: 11, assegnatoA: null, updatedAt: new Date("2026-08-25T10:00:00Z") },
      ],
      tickets: [
        { id: 8, sedeId: 11, assegnatoA: 6, updatedAt: new Date("2026-08-25T11:00:00Z") },
      ],
    });

    expect(snapshots).toEqual([
      expect.objectContaining({ entityType: "cliente", entityId: 1, assigneeId: 4 }),
      expect.objectContaining({ entityType: "commessa", entityId: 7, assigneeId: null }),
    ]);
  });

  it("mantiene una sola fotografia persistibile per entita", () => {
    const records: any[] = [];
    let saves = 0;
    const store = createArrayAssignmentSnapshotStore(records, () => {
      saves += 1;
    });
    const first = {
      sedeId: 11,
      entityType: "ticket" as const,
      entityId: 8,
      assigneeId: 6,
      updatedAt: new Date("2026-08-25T11:00:00Z"),
      link: "/ticket?ticket=8",
    };
    store.put(first);
    store.put({ ...first, assigneeId: 9 });
    store.save();

    expect(records).toHaveLength(1);
    expect(store.get(first)?.assigneeId).toBe(9);
    expect(saves).toBe(1);
  });
});
