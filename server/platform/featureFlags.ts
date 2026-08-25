import { persistedStore } from "../_core/persistence";

export type FeatureFlags = {
  eventBusMode: "off" | "shadow" | "active";
  notificationMode: "legacy" | "shadow" | "active";
  realtimeNotifications: boolean;
  webPushEnabled: boolean;
  policyMode: "legacy" | "audit" | "enforce";
  contextEngineMode: "off" | "shadow" | "active";
  plannerMode: "off" | "shadow" | "active";
  semanticSearchMode: "off" | "shadow" | "active";
  autonomyCapabilities: string[];
};

type FeatureFlagRecord = FeatureFlags & {
  sedeId: number;
  updatedAt: Date;
};

export type FeatureFlagAudit = {
  id: number;
  sedeId: number;
  actorUserId: number | null;
  reason: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  createdAt: Date;
};

const DEFAULT_FLAGS: FeatureFlags = {
  eventBusMode: "off",
  notificationMode: "legacy",
  realtimeNotifications: false,
  webPushEnabled: false,
  policyMode: "legacy",
  contextEngineMode: "off",
  plannerMode: "off",
  semanticSearchMode: "off",
  autonomyCapabilities: [],
};

const _flagsStore = persistedStore<FeatureFlagRecord>("platform_feature_flags", items => {
  for (const item of items) {
    for (const [key, value] of Object.entries(DEFAULT_FLAGS)) {
      if ((item as any)[key] === undefined) {
        (item as any)[key] = structuredClone(value);
      }
    }
  }
});

let nextAuditId = 1;
const _auditStore = persistedStore<FeatureFlagAudit>(
  "platform_feature_flag_audit",
  items => {
    nextAuditId = items.length ? Math.max(...items.map(item => item.id)) + 1 : 1;
  }
);

function recordFor(sedeId: number): FeatureFlagRecord {
  let record = _flagsStore.items.find(item => item.sedeId === sedeId);
  if (!record) {
    record = {
      ...structuredClone(DEFAULT_FLAGS),
      sedeId,
      updatedAt: new Date(),
    };
    _flagsStore.items.push(record);
    _flagsStore.save();
  }
  return record;
}

export function getFeatureFlags(sedeId: number): FeatureFlags {
  const { sedeId: _sedeId, updatedAt: _updatedAt, ...flags } = recordFor(sedeId);
  return structuredClone(flags);
}

export function setFeatureFlags(
  sedeId: number,
  patch: Partial<FeatureFlags>,
  audit: { actorUserId: number | null; reason: string }
): FeatureFlags {
  const record = recordFor(sedeId);
  const changes: FeatureFlagAudit["changes"] = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_FLAGS) || value === undefined) continue;
    const previous = (record as any)[key];
    if (JSON.stringify(previous) === JSON.stringify(value)) continue;
    changes[key] = {
      from: structuredClone(previous),
      to: structuredClone(value),
    };
    (record as any)[key] = structuredClone(value);
  }
  if (Object.keys(changes).length > 0) {
    record.updatedAt = new Date();
    _flagsStore.save();
    _auditStore.items.push({
      id: nextAuditId++,
      sedeId,
      actorUserId: audit.actorUserId,
      reason: audit.reason.trim(),
      changes,
      createdAt: new Date(),
    });
    _auditStore.save();
  }
  return getFeatureFlags(sedeId);
}

export function listFeatureFlagAudit(sedeId: number): FeatureFlagAudit[] {
  return _auditStore.items
    .filter(item => item.sedeId === sedeId)
    .sort((a, b) => a.id - b.id)
    .map(item => structuredClone(item));
}
