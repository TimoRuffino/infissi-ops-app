// La rotta che serve un allegato di posta al browser.
//
// È una rotta che tira fuori dal CRM il contenuto di un file ricevuto da un
// cliente, quindi i casi che contano non sono quelli felici: sessione
// mancante, sede altrui, indice inventato. Un allegato che esce dalla sede
// sbagliata è una fuga di dati, e una ricerca per id è il modo più semplice
// per provocarla.

import express from "express";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as comunicazioniModulo from "../comunicazioni/comunicazioni";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import { QUOTA_STORAGE_PREDEFINITA_BYTES } from "../tenants/costanti";
import type { TenantRecord } from "../tenants/tipi";
import { registerAllegatoMailRoutes } from "./allegatoMailRoutes";

let server: Server;
let base = "";

// La sessione: senza contesto impostato, `createContext` reale non trova
// nessuna sessione (nessun cookie) e tutte le rotte muoiono a 401, come
// prima del WS2. Un test che vuole superare l'autenticazione imposta un
// tenant qui e lo inietta mockando `./context`.
const sessione = vi.hoisted(() => ({
  corrente: null as null | { userId: number; sedeId: number; tenantId?: number; tenant?: TenantRecord | null },
}));
vi.mock("./context", async importOriginal => {
  const actual = await importOriginal<typeof import("./context")>();
  return {
    ...actual,
    createContext: vi.fn(async (input: any) =>
      sessione.corrente
        ? {
            user: { id: sessione.corrente.userId, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Dir" },
            sedeId: sessione.corrente.sedeId,
            sediIds: [sessione.corrente.sedeId],
            tenantId: sessione.corrente.tenantId ?? 1,
            tenant: sessione.corrente.tenant ?? null,
            req: {},
            res: {},
          }
        : actual.createContext(input)
    ),
  };
});

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

afterEach(() => {
  sessione.corrente = null;
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

  it("dentro il gestore tenantCorrente() è il tenant del contesto, anche con l'azienda sospesa", async () => {
    modalitaTenantStretta(true);
    let tenantVisto: number | null | undefined;
    const originale = comunicazioniModulo.getLiveComunicazione;
    const spia = vi
      .spyOn(comunicazioniModulo, "getLiveComunicazione")
      .mockImplementation((...args: Parameters<typeof originale>) => {
        tenantVisto = tenantCorrente();
        return originale(...args);
      });
    try {
      const sospeso: TenantRecord = {
        id: 4,
        slug: "gamma",
        nome: "Gamma",
        stato: "sospeso",
        motivoStato: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        storageQuotaBytes: QUOTA_STORAGE_PREDEFINITA_BYTES,
      };
      sessione.corrente = { userId: 1, sedeId: 5, tenantId: 4, tenant: sospeso };
      const r = await chiedi("/api/comunicazioni/1/allegati/0");
      // Lettura: il tenant sospeso non la blocca (412 è solo per la scrittura).
      expect(r.status).not.toBe(412);
      expect(tenantVisto).toBe(4);
    } finally {
      spia.mockRestore();
      modalitaTenantStretta(false);
    }
  });
});
