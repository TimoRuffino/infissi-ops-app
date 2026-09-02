// Le intestazioni davvero emesse, non la regola sulla carta: monta
// `serveStatic` su una cartella finta e legge le risposte da un server in
// ascolto su localhost (la guardia di rete della suite lo consente
// espressamente per i server in-process).
//
// Serve perché il difetto che ha motivato la correzione stava proprio nel
// cablaggio, non nella regola: `express.static` senza opzioni dichiarava
// `max-age=0` su ogni file, e in produzione era quello che si misurava.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

import { serveStatic } from "./vite";

let server: Server;
let base = "";
let radice = "";

beforeAll(async () => {
  radice = fs.mkdtempSync(path.join(os.tmpdir(), "cache-statica-"));
  fs.mkdirSync(path.join(radice, "assets"));
  fs.mkdirSync(path.join(radice, "mascotte"));
  fs.writeFileSync(path.join(radice, "index.html"), "<!doctype html><title>x</title>");
  fs.writeFileSync(path.join(radice, "notification-sw.js"), "// sw");
  fs.writeFileSync(path.join(radice, "assets", "index-CVhQHOW9.js"), "console.log(1)");
  fs.writeFileSync(path.join(radice, "mascotte", "idle.webm"), "finto");

  const app = express();
  serveStatic(app, radice);
  await new Promise<void>(risolvi => {
    server = app.listen(0, "127.0.0.1", () => risolvi());
  });
  const indirizzo = server.address();
  if (!indirizzo || typeof indirizzo === "string") throw new Error("porta ignota");
  base = `http://127.0.0.1:${indirizzo.port}`;
});

afterAll(async () => {
  await new Promise<void>(risolvi => server.close(() => risolvi()));
  fs.rmSync(radice, { recursive: true, force: true });
});

const cacheDi = async (percorso: string) => {
  const r = await fetch(`${base}${percorso}`);
  expect(r.status).toBe(200);
  return r.headers.get("cache-control");
};

describe("intestazioni di cache servite davvero", () => {
  it("il bundle firmato dall'hash si tiene per un anno, dichiarato immutabile", async () => {
    const cache = await cacheDi("/assets/index-CVhQHOW9.js");
    expect(cache).toContain("max-age=31536000");
    expect(cache).toContain("immutable");
  });

  it("la mascotte si rivalida: il nome è fisso, il contenuto può cambiare", async () => {
    const cache = await cacheDi("/mascotte/idle.webm");
    expect(cache).toContain("max-age=3600");
    expect(cache).not.toContain("immutable");
  });

  it("l'indice non va in cache, né chiesto direttamente né dal fallback", async () => {
    expect(await cacheDi("/index.html")).toBe("no-cache");
    // Una rotta dell'applicazione: non è un file, la serve il fallback.
    expect(await cacheDi("/commesse/42")).toBe("no-cache");
  });

  it("il service worker non va in cache", async () => {
    expect(await cacheDi("/notification-sw.js")).toBe("no-cache");
  });

  it("nessun file statico resta sul max-age=0 di partenza di Express", async () => {
    for (const p of [
      "/assets/index-CVhQHOW9.js",
      "/mascotte/idle.webm",
    ]) {
      expect(await cacheDi(p)).not.toBe("public, max-age=0");
    }
  });
});
