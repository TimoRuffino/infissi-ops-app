import { kvSql } from "../_core/persistence";
import { capabilitiesForRoles, type Capability } from "./capabilities";
import type { CapabilityOverride } from "./policy";

export type StoredCapabilityOverride = {
  id: number;
  sedeId: number;
  userId: number;
  capability: Capability;
  effect: "allow" | "deny";
  reason: string;
  createdBy: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: number | null;
  revokeReason: string | null;
  createdAt: Date;
};

export type StoredCapabilityDelegation = {
  id: number;
  sedeId: number;
  delegatorUserId: number;
  delegateUserId: number;
  capability: Capability;
  reason: string;
  startsAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: number | null;
  revokeReason: string | null;
  createdAt: Date;
};

export type PolicyAuditDiff = {
  id: number;
  sedeId: number;
  endpoint: string;
  capability: Capability;
  legacyAllowed: boolean;
  proposedAllowed: boolean;
  proposedEffect: "allow" | "deny" | "not_found";
  proposedCode: string;
  userId: number;
  resourceType: string;
  createdAt: Date;
};

export type PolicyChangeEvent = {
  id: number;
  sedeId: number;
  actorUserId: number;
  targetUserId: number;
  action: "override_created" | "override_revoked" | "delegation_created" | "delegation_revoked";
  capability: Capability;
  reason: string;
  createdAt: Date;
};

type OverrideDraft = Omit<
  StoredCapabilityOverride,
  "id" | "revokedAt" | "revokedBy" | "revokeReason"
>;
type DelegationDraft = Omit<
  StoredCapabilityDelegation,
  "id" | "revokedAt" | "revokedBy" | "revokeReason"
>;
type AuditDiffDraft = Omit<PolicyAuditDiff, "id">;
type ChangeEventDraft = Omit<PolicyChangeEvent, "id">;

export type PolicyRepository = {
  ensureSchema(): Promise<void>;
  createOverride(input: OverrideDraft): Promise<StoredCapabilityOverride>;
  revokeOverride(input: {
    id: number;
    sedeId: number;
    revokedBy: number;
    reason: string;
    revokedAt: Date;
  }): Promise<boolean>;
  listOverrides(input: { sedeId: number; userId: number }): Promise<StoredCapabilityOverride[]>;
  createDelegation(input: DelegationDraft): Promise<StoredCapabilityDelegation>;
  revokeDelegation(input: {
    id: number;
    sedeId: number;
    revokedBy: number;
    reason: string;
    revokedAt: Date;
  }): Promise<boolean>;
  listDelegations(input: { sedeId: number; userId: number }): Promise<StoredCapabilityDelegation[]>;
  listEffectiveOverrides(input: {
    sedeId: number;
    userId: number;
    now: Date;
  }): Promise<CapabilityOverride[]>;
  recordAuditDiff(input: AuditDiffDraft): Promise<number>;
  listAuditDiffs(input: { sedeId: number; days: number }): Promise<PolicyAuditDiff[]>;
  recordPolicyChange(input: ChangeEventDraft): Promise<number>;
  listPolicyChanges(input: { sedeId: number; userId?: number }): Promise<PolicyChangeEvent[]>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isEffective(
  item: { startsAt: Date | null; expiresAt: Date | null; revokedAt: Date | null },
  now: Date
): boolean {
  return (
    item.revokedAt == null &&
    (item.startsAt == null || item.startsAt <= now) &&
    (item.expiresAt == null || item.expiresAt > now)
  );
}

async function delegatorRoleAllows(input: {
  sedeId: number;
  userId: number;
  capability: Capability;
}): Promise<boolean> {
  const { getUtentiStore } = await import("../routers/utenti");
  const user: any = getUtentiStore().find(item => item.id === input.userId);
  if (
    !user?.attivo ||
    !Array.isArray(user.sediIds) ||
    !user.sediIds.includes(input.sedeId)
  ) {
    return false;
  }
  const roles = Array.isArray(user.ruoli)
    ? user.ruoli
    : user.ruolo
      ? [user.ruolo]
      : [];
  return capabilitiesForRoles(roles).has(input.capability);
}

export function createMemoryPolicyRepository(): PolicyRepository {
  const overrides: StoredCapabilityOverride[] = [];
  const delegations: StoredCapabilityDelegation[] = [];
  const auditDiffs: PolicyAuditDiff[] = [];
  const changes: PolicyChangeEvent[] = [];
  let nextOverrideId = 1;
  let nextDelegationId = 1;
  let nextAuditId = 1;
  let nextChangeId = 1;

  return {
    async ensureSchema() {},
    async createOverride(input) {
      const record: StoredCapabilityOverride = {
        ...clone(input),
        id: nextOverrideId++,
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
      };
      overrides.push(record);
      return clone(record);
    },
    async revokeOverride(input) {
      const record = overrides.find(
        item => item.id === input.id && item.sedeId === input.sedeId && item.revokedAt == null
      );
      if (!record) return false;
      record.revokedAt = new Date(input.revokedAt);
      record.revokedBy = input.revokedBy;
      record.revokeReason = input.reason;
      return true;
    },
    async listOverrides(input) {
      return overrides
        .filter(item => item.sedeId === input.sedeId && item.userId === input.userId)
        .map(clone);
    },
    async createDelegation(input) {
      const record: StoredCapabilityDelegation = {
        ...clone(input),
        id: nextDelegationId++,
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
      };
      delegations.push(record);
      return clone(record);
    },
    async revokeDelegation(input) {
      const record = delegations.find(
        item => item.id === input.id && item.sedeId === input.sedeId && item.revokedAt == null
      );
      if (!record) return false;
      record.revokedAt = new Date(input.revokedAt);
      record.revokedBy = input.revokedBy;
      record.revokeReason = input.reason;
      return true;
    },
    async listDelegations(input) {
      return delegations
        .filter(
          item => item.sedeId === input.sedeId && item.delegateUserId === input.userId
        )
        .map(clone);
    },
    async listEffectiveOverrides(input) {
      const direct: CapabilityOverride[] = overrides
        .filter(
          item =>
            item.sedeId === input.sedeId &&
            item.userId === input.userId &&
            isEffective(item, input.now)
        )
        .map(item => ({
          capability: item.capability,
          effect: item.effect,
          sedeId: item.sedeId,
          source: "override",
          startsAt: item.startsAt,
          expiresAt: item.expiresAt,
        }));
      const delegated: CapabilityOverride[] = [];
      for (const item of delegations) {
        if (
          item.sedeId !== input.sedeId ||
          item.delegateUserId !== input.userId ||
          !isEffective(item, input.now) ||
          !(await delegatorRoleAllows({
            sedeId: item.sedeId,
            userId: item.delegatorUserId,
            capability: item.capability,
          }))
        ) {
          continue;
        }
        delegated.push({
          capability: item.capability,
          effect: "allow",
          sedeId: item.sedeId,
          source: "delegation",
          startsAt: item.startsAt,
          expiresAt: item.expiresAt,
        });
      }
      return [...direct, ...delegated].map(clone);
    },
    async recordAuditDiff(input) {
      const record = { ...clone(input), id: nextAuditId++ };
      auditDiffs.push(record);
      return record.id;
    },
    async listAuditDiffs(input) {
      const cutoff = new Date(Date.now() - Math.max(input.days, 1) * 86_400_000);
      return auditDiffs
        .filter(item => item.sedeId === input.sedeId && item.createdAt >= cutoff)
        .map(clone);
    },
    async recordPolicyChange(input) {
      const record = { ...clone(input), id: nextChangeId++ };
      changes.push(record);
      return record.id;
    },
    async listPolicyChanges(input) {
      return changes
        .filter(
          item =>
            item.sedeId === input.sedeId &&
            (input.userId == null || item.targetUserId === input.userId)
        )
        .map(clone);
    },
  };
}

function rowToOverride(row: any): StoredCapabilityOverride {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    userId: Number(row.user_id),
    capability: row.capability,
    effect: row.effect,
    reason: row.reason,
    createdBy: Number(row.created_by),
    startsAt: row.starts_at ? new Date(row.starts_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revokedBy: row.revoked_by == null ? null : Number(row.revoked_by),
    revokeReason: row.revoke_reason ?? null,
    createdAt: new Date(row.created_at),
  };
}

function rowToDelegation(row: any): StoredCapabilityDelegation {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    delegatorUserId: Number(row.delegator_user_id),
    delegateUserId: Number(row.delegate_user_id),
    capability: row.capability,
    reason: row.reason,
    startsAt: new Date(row.starts_at),
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revokedBy: row.revoked_by == null ? null : Number(row.revoked_by),
    revokeReason: row.revoke_reason ?? null,
    createdAt: new Date(row.created_at),
  };
}

export function createPostgresPolicyRepository(
  sql: NonNullable<typeof kvSql>
): PolicyRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql.begin(async tx => {
      await tx`CREATE TABLE IF NOT EXISTS capability_overrides (
        id BIGSERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        capability TEXT NOT NULL,
        effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),
        reason TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        starts_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        revoked_by INTEGER,
        revoke_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (sede_id, user_id, capability, created_at)
      )`;
      await tx`CREATE INDEX IF NOT EXISTS capability_overrides_effective_idx
        ON capability_overrides (sede_id, user_id, capability, expires_at)`;
      await tx`CREATE TABLE IF NOT EXISTS capability_delegations (
        id BIGSERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        delegator_user_id INTEGER NOT NULL,
        delegate_user_id INTEGER NOT NULL,
        capability TEXT NOT NULL,
        reason TEXT NOT NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoked_by INTEGER,
        revoke_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (sede_id, delegator_user_id, delegate_user_id, capability, starts_at)
      )`;
      await tx`CREATE INDEX IF NOT EXISTS capability_delegations_effective_idx
        ON capability_delegations (sede_id, delegate_user_id, capability, expires_at)`;
      await tx`CREATE TABLE IF NOT EXISTS policy_audit_diffs (
        id BIGSERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL,
        capability TEXT NOT NULL,
        legacy_allowed BOOLEAN NOT NULL,
        proposed_allowed BOOLEAN NOT NULL,
        proposed_effect TEXT NOT NULL,
        proposed_code TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        resource_type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`;
      await tx`CREATE INDEX IF NOT EXISTS policy_audit_diffs_report_idx
        ON policy_audit_diffs (sede_id, created_at DESC, endpoint)`;
      await tx`CREATE TABLE IF NOT EXISTS policy_change_events (
        id BIGSERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        actor_user_id INTEGER NOT NULL,
        target_user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        capability TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )`;
      await tx`CREATE INDEX IF NOT EXISTS policy_change_events_user_idx
        ON policy_change_events (sede_id, target_user_id, created_at DESC)`;
    }).then(() => undefined);
    return schemaPromise;
  };

  return {
    ensureSchema,
    async createOverride(input) {
      await ensureSchema();
      const rows = await sql`INSERT INTO capability_overrides (
        sede_id, user_id, capability, effect, reason, created_by, starts_at, expires_at, created_at
      ) VALUES (
        ${input.sedeId}, ${input.userId}, ${input.capability}, ${input.effect}, ${input.reason},
        ${input.createdBy}, ${input.startsAt}, ${input.expiresAt}, ${input.createdAt}
      ) RETURNING *`;
      return rowToOverride(rows[0]);
    },
    async revokeOverride(input) {
      await ensureSchema();
      const rows = await sql`UPDATE capability_overrides SET
        revoked_at = ${input.revokedAt}, revoked_by = ${input.revokedBy}, revoke_reason = ${input.reason}
        WHERE id = ${input.id} AND sede_id = ${input.sedeId} AND revoked_at IS NULL
        RETURNING id`;
      return rows.length > 0;
    },
    async listOverrides(input) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM capability_overrides
        WHERE sede_id = ${input.sedeId} AND user_id = ${input.userId}
        ORDER BY created_at DESC, id DESC`;
      return rows.map(rowToOverride);
    },
    async createDelegation(input) {
      await ensureSchema();
      const rows = await sql`INSERT INTO capability_delegations (
        sede_id, delegator_user_id, delegate_user_id, capability, reason, starts_at, expires_at, created_at
      ) VALUES (
        ${input.sedeId}, ${input.delegatorUserId}, ${input.delegateUserId}, ${input.capability},
        ${input.reason}, ${input.startsAt}, ${input.expiresAt}, ${input.createdAt}
      ) RETURNING *`;
      return rowToDelegation(rows[0]);
    },
    async revokeDelegation(input) {
      await ensureSchema();
      const rows = await sql`UPDATE capability_delegations SET
        revoked_at = ${input.revokedAt}, revoked_by = ${input.revokedBy}, revoke_reason = ${input.reason}
        WHERE id = ${input.id} AND sede_id = ${input.sedeId} AND revoked_at IS NULL
        RETURNING id`;
      return rows.length > 0;
    },
    async listDelegations(input) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM capability_delegations
        WHERE sede_id = ${input.sedeId} AND delegate_user_id = ${input.userId}
        ORDER BY created_at DESC, id DESC`;
      return rows.map(rowToDelegation);
    },
    async listEffectiveOverrides(input) {
      await ensureSchema();
      const direct = await sql`SELECT capability, effect, sede_id, starts_at, expires_at
        FROM capability_overrides WHERE sede_id = ${input.sedeId} AND user_id = ${input.userId}
          AND revoked_at IS NULL AND (starts_at IS NULL OR starts_at <= ${input.now})
          AND (expires_at IS NULL OR expires_at > ${input.now})`;
      const delegatedRows = await sql`SELECT capability, sede_id, delegator_user_id, starts_at, expires_at
        FROM capability_delegations WHERE sede_id = ${input.sedeId} AND delegate_user_id = ${input.userId}
          AND revoked_at IS NULL AND starts_at <= ${input.now} AND expires_at > ${input.now}`;
      const delegated = [];
      for (const row of delegatedRows) {
        if (
          await delegatorRoleAllows({
            sedeId: Number(row.sede_id),
            userId: Number(row.delegator_user_id),
            capability: row.capability as Capability,
          })
        ) {
          delegated.push(row);
        }
      }
      return [
        ...direct.map(row => ({
          capability: row.capability as Capability,
          effect: row.effect as "allow" | "deny",
          sedeId: Number(row.sede_id),
          source: "override" as const,
          startsAt: row.starts_at ? new Date(row.starts_at) : null,
          expiresAt: row.expires_at ? new Date(row.expires_at) : null,
        })),
        ...delegated.map(row => ({
          capability: row.capability as Capability,
          effect: "allow" as const,
          sedeId: Number(row.sede_id),
          source: "delegation" as const,
          startsAt: new Date(row.starts_at),
          expiresAt: new Date(row.expires_at),
        })),
      ];
    },
    async recordAuditDiff(input) {
      await ensureSchema();
      const rows = await sql`INSERT INTO policy_audit_diffs (
        sede_id, endpoint, capability, legacy_allowed, proposed_allowed, proposed_effect,
        proposed_code, user_id, resource_type, created_at
      ) VALUES (
        ${input.sedeId}, ${input.endpoint}, ${input.capability}, ${input.legacyAllowed},
        ${input.proposedAllowed}, ${input.proposedEffect}, ${input.proposedCode},
        ${input.userId}, ${input.resourceType}, ${input.createdAt}
      ) RETURNING id`;
      return Number(rows[0].id);
    },
    async listAuditDiffs(input) {
      await ensureSchema();
      const cutoff = new Date(Date.now() - Math.max(input.days, 1) * 86_400_000);
      const rows = await sql`SELECT * FROM policy_audit_diffs
        WHERE sede_id = ${input.sedeId} AND created_at >= ${cutoff}
        ORDER BY created_at DESC, id DESC`;
      return rows.map(row => ({
        id: Number(row.id),
        sedeId: Number(row.sede_id),
        endpoint: row.endpoint,
        capability: row.capability as Capability,
        legacyAllowed: Boolean(row.legacy_allowed),
        proposedAllowed: Boolean(row.proposed_allowed),
        proposedEffect: row.proposed_effect,
        proposedCode: row.proposed_code,
        userId: Number(row.user_id),
        resourceType: row.resource_type,
        createdAt: new Date(row.created_at),
      }));
    },
    async recordPolicyChange(input) {
      await ensureSchema();
      const rows = await sql`INSERT INTO policy_change_events (
        sede_id, actor_user_id, target_user_id, action, capability, reason, created_at
      ) VALUES (
        ${input.sedeId}, ${input.actorUserId}, ${input.targetUserId}, ${input.action},
        ${input.capability}, ${input.reason}, ${input.createdAt}
      ) RETURNING id`;
      return Number(rows[0].id);
    },
    async listPolicyChanges(input) {
      await ensureSchema();
      const rows = input.userId == null
        ? await sql`SELECT * FROM policy_change_events WHERE sede_id = ${input.sedeId} ORDER BY created_at DESC, id DESC`
        : await sql`SELECT * FROM policy_change_events WHERE sede_id = ${input.sedeId} AND target_user_id = ${input.userId} ORDER BY created_at DESC, id DESC`;
      return rows.map(row => ({
        id: Number(row.id),
        sedeId: Number(row.sede_id),
        actorUserId: Number(row.actor_user_id),
        targetUserId: Number(row.target_user_id),
        action: row.action,
        capability: row.capability as Capability,
        reason: row.reason,
        createdAt: new Date(row.created_at),
      }));
    },
  };
}

let repository: PolicyRepository | null = null;

export function getPolicyRepository(): PolicyRepository {
  repository ??= kvSql
    ? createPostgresPolicyRepository(kvSql)
    : createMemoryPolicyRepository();
  return repository;
}

type AdministrativeUser = {
  id: number;
  attivo: boolean;
  ruoli: string[];
  sediIds: number[];
};

export function assertAdministrativeContinuity(input: {
  sedeId: number;
  users: AdministrativeUser[];
  targetUserId: number;
  capability: Capability;
  effect: "allow" | "deny";
}): void {
  if (input.capability !== "tars.manage_policy" || input.effect !== "deny") return;
  const administrators = input.users.filter(
    user =>
      user.attivo &&
      user.sediIds.includes(input.sedeId) &&
      capabilitiesForRoles(user.ruoli).has("tars.manage_policy")
  );
  if (administrators.length === 1 && administrators[0].id === input.targetUserId) {
    throw new Error(
      "Impossibile rimuovere l'ultima capacita amministrativa attiva della sede."
    );
  }
}
