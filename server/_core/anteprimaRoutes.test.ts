// La rotta che serve una pagina resa al browser (anteprime delle evidenze).
// Come per gli allegati di posta, i casi che contano sono quelli che
// rifiutano: sessione mancante, richiesta da un altro sito, interruttore
// spento, documento di un'altra sede, pagina inventata. Il caso felice vuole
// pdftoppm e si salta da solo quando manca.

import express from "express";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import { caricaDocumentoCommessaDaBuffer } from "../routers/preventiviContratti";
import { getUtentiStore } from "../routers/utenti";
import { disponibilitaOcr } from "../documenti/ocr";
import { pdfConTesto } from "../documenti/pdfMinimo";
import { registerAnteprimaRoutes } from "./anteprimaRoutes";

// Storage in memoria: le pagine rese non toccano ./data/files.
const memoriaStorage = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("./fileStorage", async importOriginal => {
  const actual = await importOriginal<typeof import("./fileStorage")>();
  const { createHash } = await import("node:crypto");
  let progressivo = 0;
  return {
    ...actual,
    putFile: vi.fn(async (collection: string, _p: number, _r: number, nome: string, buffer: Buffer) => {
      const storageKey = `${collection}/test/${++progressivo}-${nome}`;
      memoriaStorage.set(storageKey, Buffer.from(buffer));
      return { storageKey, checksum: createHash("sha256").update(buffer).digest("hex") };
    }),
    getFile: vi.fn(async (storageKey: string) => memoriaStorage.get(storageKey) ?? null),
    deleteFileQuiet: vi.fn(() => {}),
  };
});

// La sessione: il test decide chi è l'utente e in quale sede.
const sessione = vi.hoisted(() => ({ corrente: null as null | { userId: number; sedeId: number } }));
vi.mock("./context", () => ({
  createContext: vi.fn(async () =>
    sessione.corrente
      ? {
          user: { id: sessione.corrente.userId, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Dir" },
          sedeId: sessione.corrente.sedeId,
          sediIds: [sessione.corrente.sedeId],
          req: {},
          res: {},
        }
      : { user: null, sedeId: null, sediIds: [], req: {}, res: {} }
  ),
}));

const SEDE = 97_701;
const ALTRA_SEDE = 97_702;
const DIREZIONE_ID = 97_711;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Rotta",
      email: "rotta-anteprime@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE, ALTRA_SEDE],
    });
  }
}

let server: Server;
let base = "";
let documentoId = 0;

beforeAll(async () => {
  const app = express();
  registerAnteprimaRoutes(app);
  await new Promise<void>(risolvi => {
    server = app.listen(0, "127.0.0.1", () => risolvi());
  });
  const address = server.address();
  const porta = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${porta}`;

  const caller = appRouter.createCaller({
    user: { id: DIREZIONE_ID, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Dir" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  });
  const commessa = await caller.commesse.create({ cliente: "Rotta Anteprime" });
  const documento = await caricaDocumentoCommessaDaBuffer({
    commessaId: commessa.id,
    nome: "Conferma.pdf",
    tipo: "altro",
    mimeType: "application/pdf",
    buffer: pdfConTesto(["Conferma d'ordine", "Totale imponibile EUR 100,00"]),
    sedeId: SEDE,
    createdBy: DIREZIONE_ID,
    keepNome: true,
  });
  documentoId = documento.id;
});

afterAll(async () => {
  await new Promise<void>(risolvi => server.close(() => risolvi()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  sessione.corrente = null;
});

const chiedi = (percorso: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${percorso}`, { headers });

const binariPresenti = (await disponibilitaOcr()).disponibile;

describe("GET /api/documenti/:id/pagina/:n", () => {
  it("senza sessione non serve niente, e dichiara la politica di risorsa", async () => {
    const r = await chiedi(`/api/documenti/${documentoId}/pagina/1`);
    expect(r.status).toBe(401);
    expect(r.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("una richiesta da un altro sito è bloccata prima dell'autenticazione", async () => {
    sessione.corrente = { userId: DIREZIONE_ID, sedeId: SEDE };
    const r = await chiedi(`/api/documenti/${documentoId}/pagina/1`, { "sec-fetch-site": "cross-site" });
    expect(r.status).toBe(403);
  });

  it("con l'interruttore spento la rotta non esiste", async () => {
    vi.stubEnv("FLAG_ANTEPRIME_EVIDENZE", "off");
    sessione.corrente = { userId: DIREZIONE_ID, sedeId: SEDE };
    const r = await chiedi(`/api/documenti/${documentoId}/pagina/1`);
    expect(r.status).toBe(404);
  });

  it("un documento di un'altra sede e una pagina non valida sono 404, non informazioni", async () => {
    sessione.corrente = { userId: DIREZIONE_ID, sedeId: ALTRA_SEDE };
    expect((await chiedi(`/api/documenti/${documentoId}/pagina/1`)).status).toBe(404);
    sessione.corrente = { userId: DIREZIONE_ID, sedeId: SEDE };
    expect((await chiedi(`/api/documenti/${documentoId}/pagina/0`)).status).toBe(404);
    expect((await chiedi(`/api/documenti/abc/pagina/1`)).status).toBe(404);
    expect((await chiedi(`/api/documenti/999999999/pagina/1`)).status).toBe(404);
  });

  it.skipIf(!binariPresenti)(
    "nella sede giusta serve il JPEG con cache privata ed ETag, e risponde 304 se il browser ce l'ha già",
    { timeout: 120_000 },
    async () => {
      sessione.corrente = { userId: DIREZIONE_ID, sedeId: SEDE };
      const r = await chiedi(`/api/documenti/${documentoId}/pagina/1`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("image/jpeg");
      expect(r.headers.get("cache-control")).toBe("private, max-age=86400");
      const etag = r.headers.get("etag");
      expect(etag).toBeTruthy();
      const corpo = Buffer.from(await r.arrayBuffer());
      expect([...corpo.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

      const di_nuovo = await chiedi(`/api/documenti/${documentoId}/pagina/1`, { "if-none-match": etag! });
      expect(di_nuovo.status).toBe(304);

      expect((await chiedi(`/api/documenti/${documentoId}/pagina/2`)).status).toBe(404);
    }
  );
});
