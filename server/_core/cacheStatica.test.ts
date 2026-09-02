// Per quanto resta in cache ogni file statico. La regola vale solo se
// distingue i tre casi: un indirizzo che non può mentire, uno che può, e i
// due file che non vanno mai in cache.
import { describe, expect, it } from "vitest";

import {
  CACHE_IMMUTABILE,
  CACHE_MAI,
  CACHE_RIVALIDA,
  cacheStatica,
} from "./vite";

describe("cache dei file statici", () => {
  it("tiene per sempre quello che ha il contenuto nel nome", () => {
    // Vite firma questi con l'hash: cambia il contenuto, cambia il nome.
    for (const p of [
      "/app/dist/public/assets/index-CVhQHOW9.js",
      "/app/dist/public/assets/vendor-runtime-DaelwiAH.js",
      "/app/dist/public/assets/index-fCdq---n.css",
      "C:\\app\\dist\\public\\assets\\index-CVhQHOW9.js",
    ]) {
      expect(cacheStatica(p)).toBe(CACHE_IMMUTABILE);
    }
  });

  it("continua a rivalidare quello che ha un nome fisso", () => {
    // La mascotte si può rigenerare senza che cambi l'indirizzo.
    for (const p of [
      "/app/dist/public/mascotte/idle.webm",
      "/app/dist/public/avatars/timothy.png",
      "/app/dist/public/logo.svg",
      "/app/dist/public/favicon.svg",
    ]) {
      expect(cacheStatica(p)).toBe(CACHE_RIVALIDA);
    }
  });

  it("non mette mai in cache l'indice: è l'unico che nomina gli asset nuovi", () => {
    expect(cacheStatica("/app/dist/public/index.html")).toBe(CACHE_MAI);
  });

  it("non mette mai in cache il service worker", () => {
    expect(cacheStatica("/app/dist/public/notification-sw.js")).toBe(CACHE_MAI);
  });

  it("l'immutabile è dichiarato tale, e per un anno", () => {
    expect(CACHE_IMMUTABILE).toContain("immutable");
    expect(CACHE_IMMUTABILE).toContain("max-age=31536000");
  });

  it("un file dentro assets resta immutabile anche se si chiama come l'indice", () => {
    // Difesa dell'ordine dei controlli: il nome vince sul percorso.
    expect(cacheStatica("/app/dist/public/assets/index.html")).toBe(CACHE_MAI);
  });
});
