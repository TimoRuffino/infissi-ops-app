// Il backup notturno del 10/08/2026 è morto su un solo 503 "Transient
// failure" alla creazione della prima cartella. Drive quei 503 li fa, e la
// risposta giusta è riprovare: questi test tengono in piedi la differenza fra
// un errore che passa da solo e uno che non passerà mai.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attesaMs,
  driveFetch,
  erroreTransitorio,
} from "./driveBackup";

const TRANSIENTE_503 = JSON.stringify({
  error: {
    code: 503,
    message: "Transient failure.",
    errors: [{ message: "Transient failure.", domain: "global", reason: "transientError" }],
  },
});

const PERMESSI_403 = JSON.stringify({
  error: { code: 403, errors: [{ reason: "insufficientFilePermissions" }] },
});

const QUOTA_403 = JSON.stringify({
  error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] },
});

function risposta(status: number, corpo: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => corpo,
    json: async () => JSON.parse(corpo || "{}"),
  } as any;
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.useRealTimers();
});

describe("erroreTransitorio", () => {
  it("503, 500 e 429 passano da soli", () => {
    expect(erroreTransitorio(503, TRANSIENTE_503)).toBe(true);
    expect(erroreTransitorio(500, "")).toBe(true);
    expect(erroreTransitorio(429, "")).toBe(true);
  });

  it("un 403 di quota si riprova, uno di permessi no", () => {
    expect(erroreTransitorio(403, QUOTA_403)).toBe(true);
    expect(erroreTransitorio(403, PERMESSI_403)).toBe(false);
  });

  it("404 e 401 non si riprovano: riprovare non li cambia", () => {
    expect(erroreTransitorio(404, "")).toBe(false);
    expect(erroreTransitorio(401, "")).toBe(false);
  });
});

describe("attesaMs", () => {
  it("cresce a ogni tentativo", () => {
    expect(attesaMs(0, null)).toBeGreaterThanOrEqual(1000);
    expect(attesaMs(0, null)).toBeLessThan(2000);
    expect(attesaMs(3, null)).toBeGreaterThanOrEqual(8000);
    expect(attesaMs(10, null)).toBeLessThanOrEqual(30_500);
  });

  it("Retry-After di Google vince sul calcolo nostro", () => {
    expect(attesaMs(0, "5")).toBe(5000);
    // Ma non si aspetta un'ora perché l'header lo chiede.
    expect(attesaMs(0, "9999")).toBe(60_000);
    expect(attesaMs(1, "non-un-numero")).toBeGreaterThanOrEqual(2000);
  });
});

describe("driveFetch", () => {
  it("due 503 e poi passa: il backup non si accorge di niente", async () => {
    vi.useFakeTimers();
    const chiamate: number[] = [];
    global.fetch = vi.fn(async () => {
      chiamate.push(Date.now());
      return chiamate.length <= 2
        ? risposta(503, TRANSIENTE_503)
        : risposta(200, '{"id":"cartella-1"}');
    }) as any;

    const p = driveFetch("https://drive/test", {}, "Creazione della cartella");
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await p;

    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ id: "cartella-1" });
    expect(chiamate).toHaveLength(3);
  });

  it("un errore di permessi non si ritenta: una sola chiamata", async () => {
    const fetchMock = vi.fn(async () => risposta(403, PERMESSI_403));
    global.fetch = fetchMock as any;

    await expect(
      driveFetch("https://drive/test", {}, "Caricamento di \"x.pdf\"")
    ).rejects.toThrow(/Caricamento di "x\.pdf" fallita \(HTTP 403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("503 a oltranza: 5 tentativi, poi un messaggio che dice cosa fare", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => risposta(503, TRANSIENTE_503));
    global.fetch = fetchMock as any;

    const p = driveFetch("https://drive/test", {}, "Creazione della cartella");
    const atteso = expect(p).rejects.toThrow(
      /dopo 5 tentativi.*guasto momentaneo di Drive/s
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await atteso;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("rispetta Retry-After invece di insistere subito", async () => {
    vi.useFakeTimers();
    let prima = true;
    const fetchMock = vi.fn(async () => {
      if (prima) {
        prima = false;
        return risposta(429, "", { "retry-after": "30" });
      }
      return risposta(200, "{}");
    });
    global.fetch = fetchMock as any;

    const p = driveFetch("https://drive/test", {}, "Ricerca della cartella");
    // A 10 secondi non ha ancora riprovato: l'header chiedeva 30.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    await p;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
