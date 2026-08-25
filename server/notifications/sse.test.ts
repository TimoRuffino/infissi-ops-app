import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createMemoryNotificationRepository } from "./repository";
import { createNotificationHub, createNotificationSseHandler } from "./sse";

function response() {
  const res = new EventEmitter() as any;
  res.statusCode = 200;
  res.headers = {};
  res.chunks = [];
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (name: string, value: string) => {
    res.headers[name] = value;
  };
  res.flushHeaders = () => {};
  res.write = (chunk: string) => {
    res.chunks.push(chunk);
    return true;
  };
  res.end = () => {
    res.ended = true;
  };
  return res;
}

function request(headers: Record<string, string> = {}) {
  const req = new EventEmitter() as any;
  req.headers = headers;
  req.get = (name: string) => headers[name.toLowerCase()];
  return req;
}

const notification = {
  sedeId: 1,
  recipientUserId: 7,
  canonicalKey: "sse:1",
  type: "assignment",
  priority: "high" as const,
  title: "Nuova assegnazione",
  body: "Corpo non trasmesso via SSE",
  link: "/commesse/42",
  groupKey: "commessa:42",
  sourceEventId: null,
  entityRefs: [{ type: "commessa", id: "42" }],
  createdAt: new Date("2026-08-25T12:00:00Z"),
  expiresAt: null,
};

describe("notification SSE", () => {
  it("rifiuta richieste anonime", async () => {
    const handler = createNotificationSseHandler({
      repository: createMemoryNotificationRepository(),
      hub: createNotificationHub(),
      createContext: async () => ({ user: null, sedeId: null }),
    });
    const req = request();
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.ended).toBe(true);
  });

  it("replay e live stream restano isolati per utente e sede", async () => {
    const repository = createMemoryNotificationRepository();
    const own = await repository.upsert(notification);
    const other = await repository.upsert({
      ...notification,
      recipientUserId: 8,
      canonicalKey: "sse:other",
    });
    const hub = createNotificationHub();
    const handler = createNotificationSseHandler({
      repository,
      hub,
      createContext: async () => ({ user: { id: 7 }, sedeId: 1 }),
      heartbeatMs: 60_000,
    });
    const req = request({ "last-event-id": "0" });
    const res = response();
    await handler(req, res);

    hub.publish({ notificationId: other.id, recipientUserId: 8, sedeId: 1 });
    hub.publish({ notificationId: own.id, recipientUserId: 7, sedeId: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    res.emit("close");

    const output = res.chunks.join("");
    expect(output).toContain(`id: ${own.id}`);
    expect(output).not.toContain(`id: ${other.id}`);
    expect(output).not.toContain(notification.body);
  });

  it("non perde segnali arrivati durante il replay e li mantiene ordinati", async () => {
    const base = createMemoryNotificationRepository();
    const first = await base.upsert(notification);
    let releaseReplay!: () => void;
    const replayGate = new Promise<void>(resolve => {
      releaseReplay = resolve;
    });
    const repository = {
      ...base,
      async listAfterId(input: Parameters<typeof base.listAfterId>[0]) {
        await replayGate;
        return base.listAfterId(input);
      },
    };
    const hub = createNotificationHub();
    const handler = createNotificationSseHandler({
      repository,
      hub,
      createContext: async () => ({ user: { id: 7 }, sedeId: 1 }),
      heartbeatMs: 60_000,
    });
    const req = request({ "last-event-id": "0" });
    const res = response();
    const connected = handler(req, res);
    await Promise.resolve();
    const second = await base.upsert({
      ...notification,
      canonicalKey: "sse:2",
      createdAt: new Date("2026-08-25T12:01:00Z"),
    });
    hub.publish({ notificationId: second.id, recipientUserId: 7, sedeId: 1 });
    releaseReplay();
    await connected;
    await new Promise(resolve => setTimeout(resolve, 0));
    res.emit("close");

    const ids = res.chunks
      .join("")
      .match(/^id: (\d+)$/gm)
      ?.map((line: string) => Number(line.slice(4)));
    expect(ids).toEqual([first.id, second.id]);
  });
});
