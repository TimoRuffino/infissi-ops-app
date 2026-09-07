// server/tenants/express.test.ts
import { describe, expect, it } from "vitest";
import { MESSAGGI } from "./costanti";
import { tenantCorrente } from "./contestoCorrente";
import { conTenantDelContesto, rifiutaTenant } from "./express";
import type { TenantRecord } from "./tipi";

function resFinto() {
  const res: any = {};
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

describe("rifiutaTenant", () => {
  it("tenant sospeso in scrittura: 412 con il messaggio di sola lettura, e scrive la risposta", () => {
    const res = resFinto();
    const rifiutato = rifiutaTenant(
      res,
      { tenantId: 2, tenant: tenant("sospeso"), sedeId: 5 },
      { scrittura: true }
    );
    expect(rifiutato).toBe(true);
    expect(res.statusCode).toBe(412);
    expect(res.body).toEqual({ error: MESSAGGI.solaLettura });
  });

  it("tenant attivo: nessun rifiuto, nessuna risposta scritta", () => {
    const res = resFinto();
    const rifiutato = rifiutaTenant(
      res,
      { tenantId: 2, tenant: tenant("attivo"), sedeId: 5 },
      { scrittura: true }
    );
    expect(rifiutato).toBe(false);
    expect(res.statusCode).toBeNull();
    expect(res.body).toBeNull();
  });
});

describe("conTenantDelContesto", () => {
  it("esegue fn dentro il tenant del contesto", () => {
    expect(conTenantDelContesto({ tenantId: 9 }, () => tenantCorrente())).toBe(9);
  });

  it("senza tenantId nel contesto ricade sul tenant predefinito (1)", () => {
    expect(conTenantDelContesto({ tenantId: null }, () => tenantCorrente())).toBe(1);
  });
});
