import { bootstrapAll, flushAll } from "../server/_core/persistence";
import { getNotificationRepository } from "../server/notifications/repository";
import type { NotificationPriority } from "../server/notifications/types";
import { buildNotifichePerUtente } from "../server/routers/notifiche";
import { getUtentiStore } from "../server/routers/utenti";

function positiveIntegerArg(name: string, fallback?: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Argomento --${name} non valido`);
  return value;
}

function priority(severity: "info" | "warning" | "urgent"): NotificationPriority {
  return severity === "urgent" ? "critical" : severity === "warning" ? "high" : "normal";
}

const sedeId = positiveIntegerArg("sede");
if (!sedeId) throw new Error("Specificare --sede=<id>");
const limit = Math.min(positiveIntegerArg("limit", 5_000) ?? 5_000, 20_000);
const dryRun = process.argv.includes("--dry-run") || !process.argv.includes("--apply");

await bootstrapAll();
const repository = getNotificationRepository();
await repository.ensureSchema();
const users = getUtentiStore().filter(
  user =>
    user.attivo !== false &&
    Array.isArray(user.sediIds) &&
    user.sediIds.includes(sedeId)
);
let scanned = 0;
let created = 0;
let existing = 0;

for (const user of users) {
  const roles = Array.isArray(user.ruoli) ? user.ruoli : user.ruolo ? [user.ruolo] : [];
  const openResponsibilities = buildNotifichePerUtente(user.id, roles, sedeId);
  for (const item of openResponsibilities) {
    if (scanned >= limit) break;
    scanned += 1;
    if (dryRun) continue;
    const result = await repository.upsert({
      sedeId,
      recipientUserId: user.id,
      canonicalKey: `legacy:${item.id}`,
      type: item.type,
      priority: priority(item.severity),
      title: item.commessaCodice ? `${item.commessaCodice} - ${item.cliente}` : item.cliente,
      body: item.message,
      link: item.link,
      groupKey: item.commessaId == null ? null : `commessa:${item.commessaId}`,
      sourceEventId: null,
      entityRefs: item.commessaId == null
        ? []
        : [{ type: "commessa", id: String(item.commessaId) }],
      createdAt: item.createdAt,
      expiresAt: null,
    });
    if (result.created) created += 1;
    else existing += 1;
  }
  if (scanned >= limit) break;
}

if (!dryRun) await flushAll();
console.log(JSON.stringify({ sedeId, dryRun, users: users.length, scanned, created, existing }, null, 2));
