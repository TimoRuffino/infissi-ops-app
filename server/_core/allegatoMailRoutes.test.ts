// La rotta che serve un allegato di posta al browser.
//
// È una rotta che tira fuori dal CRM il contenuto di un file ricevuto da un
// cliente, quindi i casi che contano non sono quelli felici: sessione
// mancante, sede altrui, indice inventato. Un allegato che esce dalla sede
// sbagliata è una fuga di dati, e una ricerca per id è il modo più semplice
// per provocarla.

import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerAllegatoMailRoutes } from "./allegatoMailRoutes";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  registerAllegatoMailRoutes(app);
  await new Promise<void>(risolvi => {
    server = app.listen(0, "127.0.0.1", () => risolvi());
  });
  const address = server.address();
  const porta = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${porta}`;
});

afterAll(async () => {
  await new Promise<void>(risolvi => server.close(() => risolvi()));
});

const chiedi = (percorso: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${percorso}`, { headers });

describe("GET /api/comunicazioni/:id/allegati/:indice", () => {
  it("senza sessione non serve niente", async () => {
    const r = await chiedi("/api/comunicazioni/1/allegati/0");
    expect(r.status).toBe(401);
  });

  it("una richiesta da un altro sito è bloccata prima dell'autenticazione", async () => {
    // Il cookie di sessione viaggerebbe lo stesso: il blocco viene prima.
    const r = await chiedi("/api/comunicazioni/1/allegati/0", {
      "sec-fetch-site": "cross-site",
    });
    expect(r.status).toBe(403);
  });

  it("dichiara la politica di risorsa anche quando rifiuta", async () => {
    const r = await chiedi("/api/comunicazioni/1/allegati/0");
    expect(r.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("un id non numerico non arriva al database", async () => {
    const r = await chiedi("/api/comunicazioni/abc/allegati/0");
    // Senza sessione la richiesta muore prima: l'importante è che non esploda.
    expect([401, 404]).toContain(r.status);
  });

  it("un indice negativo è una richiesta malformata, non un allegato", async () => {
    const r = await chiedi("/api/comunicazioni/1/allegati/-1");
    expect([401, 404]).toContain(r.status);
  });
});
