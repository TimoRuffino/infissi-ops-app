// server/_core/commessaFileRoutes.tenant.test.ts
// Guardia del tenant sul middleware di upload dei documenti di commessa
// (WS2, Task 8): un req/res/next finti bastano, perché il middleware non fa
// altro che leggere il contesto, rifiutare con 412 o entrare nel tenant
// dell'ALS prima di chiamare `next()`. Non esisteva ancora un test su questo
// file: qui restiamo sul solo middleware di upload, come da piano.
import type { NextFunction } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGGI } from "../tenants/costanti";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import type { TenantRecord } from "../tenants/tipi";
import { contestoUploadCommessa } from "./commessaFileRoutes";

const sessione = vi.hoisted(() => ({
  corrente: null as null | { tenantId: number; tenant: TenantRecord | null; sedeId: number },
}));

vi.mock("./context", () => ({
  createContext: vi.fn(async () => ({
    user: { id: 1 },
    sedeId: sessione.corrente?.sedeId ?? null,
    sediIds: sessione.corrente ? [sessione.corrente.sedeId] : [],
    tenantId: sessione.corrente?.tenantId ?? null,
    tenant: sessione.corrente?.tenant ?? null,
    req: {},
    res: {},
  })),
}));

function resFinto() {
  const res: any = { locals: {} };
  res.statusCode = null;
  res.body = null;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

const tenant = (stato: "attivo" | "sospeso"): TenantRecord => ({
  id: 2,
  slug: "acme",
  nome: "Acme",
  stato,
  motivoStato: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

afterEach(() => {
  sessione.corrente = null;
  modalitaTenantStretta(false);
});

describe("contestoUploadCommessa (middleware di upload)", () => {
  it("tenant sospeso: 412 con il messaggio di sola lettura, next non chiamato", async () => {
    sessione.corrente = { tenantId: 2, tenant: tenant("sospeso"), sedeId: 5 };
    const req: any = { headers: {} };
    const res = resFinto();
    let chiamateNext = 0;
    const next = (() => {
      chiamateNext += 1;
    }) as NextFunction;

    await contestoUploadCommessa(req, res, next);

    expect(res.statusCode).toBe(412);
    expect(res.body).toEqual({ error: MESSAGGI.solaLettura });
    expect(chiamateNext).toBe(0);
  });

  it("tenant attivo: next chiamato dentro il tenant del contesto", async () => {
    sessione.corrente = { tenantId: 7, tenant: tenant("attivo"), sedeId: 5 };
    modalitaTenantStretta(true);
    const req: any = { headers: {} };
    const res = resFinto();
    let chiamateNext = 0;
    let tenantVisto: number | null = null;
    const next = (() => {
      chiamateNext += 1;
      tenantVisto = tenantCorrente();
    }) as NextFunction;

    await contestoUploadCommessa(req, res, next);

    expect(chiamateNext).toBe(1);
    expect(tenantVisto).toBe(7);
    expect(res.statusCode).toBeNull();
  });
});
