import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { avviaGiriEsterni } from "./giriEsterni";

const qui = path.dirname(fileURLToPath(import.meta.url));
const sorgente = (p: string) => readFileSync(path.join(qui, p), "utf8");

const originale = process.env.AMBIENTE;
afterEach(() => {
  if (originale === undefined) delete process.env.AMBIENTE;
  else process.env.AMBIENTE = originale;
});

describe("giri esterni", () => {
  it("in staging non parte nulla", async () => {
    process.env.AMBIENTE = "staging";
    await expect(avviaGiriEsterni()).resolves.toBe(false);
  });

  // Guardia strutturale: index.ts non deve più avviare i quattro giri
  // direttamente — chi ne aggiungesse un quinto fuori dal gate riaprirebbe
  // il buco (un DB di produzione ripristinato in staging leggerebbe caselle
  // vere entro 60 secondi).
  it("index.ts passa solo da avviaGiriEsterni", () => {
    const index = sorgente("index.ts");
    expect(index).toContain("avviaGiriEsterni");
    for (const diretto of [
      "startBackupScheduler",
      "startFicScheduler",
      "startSondaFattureWorker",
      "avviaPollerMail",
    ]) {
      expect(index).not.toContain(diretto);
    }
  });

  it("giriEsterni.ts contiene tutte e quattro le partenze dietro il gate", () => {
    const src = sorgente("giriEsterni.ts");
    expect(src).toContain("ambienteStaging()");
    for (const nome of [
      "startBackupScheduler",
      "startFicScheduler",
      "startSondaFattureWorker",
      "avviaPollerMail",
    ]) {
      expect(src).toContain(nome);
    }
  });

  it("in staging le risposte portano X-Robots-Tag", () => {
    expect(sorgente("index.ts")).toContain("X-Robots-Tag");
  });
});
