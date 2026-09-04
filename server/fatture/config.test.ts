import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetFattureRepositoryForTests } from "./repository";
import { accessTokenFic } from "../routers/fattureInCloud";
import {
  configFatturazione,
  ibanValido,
  salvaConfigFatturazione,
  verificaScopeScrittura,
} from "./config";

vi.mock("../routers/fattureInCloud", async importOriginal => {
  const originale: any = await importOriginal();
  return {
    ...originale,
    getCfg: () => ({
      id: 1,
      sedeId: 1,
      companyId: 77,
      authMode: "oauth",
      accessTokenCifrato: "x",
      refreshTokenCifrato: "y",
    }),
    accessTokenFic: vi.fn(async () => "a/token"),
  };
});

describe("config fatturazione", () => {
  beforeEach(() => _resetFattureRepositoryForTests());
  it("ibanValido riconosce un IBAN italiano", () => {
    expect(ibanValido("IT60X0542811101000000123456")).toBe(true);
    expect(ibanValido("IT60X0542811101000000123457")).toBe(false);
    expect(ibanValido("IT60 X054 2811 1010 0000 0123 456")).toBe(true);
  });
  it("salva la patch e rifiuta un IBAN sbagliato", async () => {
    const c = await salvaConfigFatturazione({
      sedeId: 1,
      patch: { iban: "IT60X0542811101000000123456", banca: "BPM" },
    });
    expect(c.banca).toBe("BPM");
    await expect(
      salvaConfigFatturazione({ sedeId: 1, patch: { iban: "IT00" } })
    ).rejects.toThrow(/^VALIDAZIONE: IBAN/);
    expect((await configFatturazione(1)).iban).toBe(
      "IT60X0542811101000000123456"
    );
  });
  it("salva le spese di documentazione e rifiuta importi non interi o negativi", async () => {
    const c = await salvaConfigFatturazione({ sedeId: 1, patch: { speseDocumentazioneCent: 20000 } });
    expect(c.speseDocumentazioneCent).toBe(20000);
    await expect(
      salvaConfigFatturazione({ sedeId: 1, patch: { speseDocumentazioneCent: -1 } })
    ).rejects.toThrow(/^VALIDAZIONE: spese di documentazione/);
    await expect(
      salvaConfigFatturazione({ sedeId: 1, patch: { speseDocumentazioneCent: 150.5 } })
    ).rejects.toThrow(/^VALIDAZIONE: spese di documentazione/);
    expect((await configFatturazione(1)).speseDocumentazioneCent).toBe(20000);
  });

  it("verificaScopeScrittura mette in cache id IVA, conti e numerazioni", async () => {
    const ficGet = vi.fn(async () => ({
      data: {
        vat_types_list: [
          {
            id: 3,
            value: 22,
            description: "22%",
            e_invoice: true,
            default: true,
          },
          { id: 9, value: 10, description: "10%", e_invoice: true },
          { id: 12, value: 22, description: "22% escl.", e_invoice: false },
        ],
        payment_accounts_list: [{ id: 5, name: "BPM" }],
        numerations: { "": {}, "/A": {} },
        payment_methods_list: [{ id: 1, name: "Bonifico" }],
      },
    }));
    const esito = await verificaScopeScrittura({ sedeId: 1, ficGet });
    expect(esito.ok).toBe(true);
    expect(esito.config.vatIdsFic).toEqual({ 22: 3, 10: 9 });
    expect(esito.config.paymentAccountIdFic).toBe(5);
    expect(esito.config.scopeScritturaOk).toBe(true);
    expect(esito.opzioni?.numerations).toEqual(["", "/A"]);
    expect(ficGet.mock.calls[0][0]).toBe(
      "/c/77/issued_documents/info?type=invoice"
    );
  });
  it("403 → scope non ok con motivo, senza eccezione", async () => {
    const ficGet = vi.fn(async () => {
      throw new Error("Fatture in Cloud: permesso negato (403)");
    });
    const esito = await verificaScopeScrittura({ sedeId: 1, ficGet });
    expect(esito.ok).toBe(false);
    expect(esito.motivo).toMatch(/ri-autorizza/);
    expect((await configFatturazione(1)).scopeScritturaOk).toBe(false);
  });
  it("accessTokenFic che lancia (refresh fallito) non fa esplodere la verifica", async () => {
    vi.mocked(accessTokenFic).mockRejectedValueOnce(
      new Error("Collegamento OAuth incompleto: ricollega Fatture in Cloud")
    );
    const ficGet = vi.fn();
    const esito = await verificaScopeScrittura({ sedeId: 1, ficGet });
    expect(esito.ok).toBe(false);
    expect(esito.motivo).toMatch(/Verifica non riuscita/);
    expect(ficGet).not.toHaveBeenCalled();
    expect((await configFatturazione(1)).scopeScritturaOk).toBe(false);
  });
});
