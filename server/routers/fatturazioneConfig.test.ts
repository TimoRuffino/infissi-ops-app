// Router tRPC `fatturazioneConfig`: IBAN/banca/numerazione FiC per sede e
// verifica dello scope di scrittura. Stesso pattern di
// server/routers/contratti.test.ts e server/routers/fatture.test.ts.
// `verificaScopeScrittura` non tocca la rete quando la sede non ha un
// collegamento FiC configurato (v. server/fatture/config.ts): niente da
// mockare per i test qui sotto.
import { beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { _resetFattureRepositoryForTests } from "../fatture/repository";
import { appRouter } from "../routers";

function context(sedeId: number, userId: number, ruoli: string[]): TrpcContext {
  return {
    user: { id: userId, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "T" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

beforeEach(() => {
  _resetFattureRepositoryForTests();
});

describe("router fatturazioneConfig", () => {
  it("FLAG_FATTURAZIONE spento blocca anche la direzione (PRECONDITION_FAILED)", async () => {
    const prima = process.env.FLAG_FATTURAZIONE;
    try {
      process.env.FLAG_FATTURAZIONE = "off";
      const direzione = appRouter.createCaller(context(1, 1, ["direzione"]));
      await expect(direzione.fatturazioneConfig.get()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      if (prima === undefined) delete process.env.FLAG_FATTURAZIONE;
      else process.env.FLAG_FATTURAZIONE = prima;
    }
  });

  it("FLAG_LIMITI spento blocca la configurazione anche col flag fatturazione acceso (PRECONDITION_FAILED)", async () => {
    const prima = process.env.FLAG_LIMITI;
    try {
      process.env.FLAG_LIMITI = "off";
      const direzione = appRouter.createCaller(context(1, 1, ["direzione"]));
      await expect(direzione.fatturazioneConfig.get()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      if (prima === undefined) delete process.env.FLAG_LIMITI;
      else process.env.FLAG_LIMITI = prima;
    }
  });

  it("get restituisce i default per una sede senza configurazione, con dryRun e i due flag di scope distinti", async () => {
    const direzione = appRouter.createCaller(context(1, 1, ["direzione"]));
    const esito = await direzione.fatturazioneConfig.get();
    expect(esito.config.sedeId).toBe(1);
    expect(esito.config.metodoPagamento).toBe("MP05");
    expect(esito).toHaveProperty("dryRun");
    // scopeScrittura (FicConfig, l'OAuth chiesto) e scopeScritturaOk
    // (FatturazioneConfig, l'ultima verifica riuscita) sono due flag
    // distinti: una sede nuova non ha né l'uno né l'altro.
    expect(esito.scopeScrittura).toBe(false);
    expect(esito.scopeScritturaOk).toBe(false);
  });

  it("il commerciale legge ma non può salvare la configurazione (FORBIDDEN)", async () => {
    const commerciale = appRouter.createCaller(context(1, 10, ["commerciale"]));
    await expect(commerciale.fatturazioneConfig.get()).resolves.toBeDefined();
    await expect(commerciale.fatturazioneConfig.salva({ iban: "IT60X0542811101000000123456" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("un IBAN non valido dà BAD_REQUEST", async () => {
    const amministrazione = appRouter.createCaller(context(1, 11, ["amministrazione"]));
    await expect(amministrazione.fatturazioneConfig.salva({ iban: "IT00INVALIDO" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("l'amministrazione salva IBAN, banca e spese di documentazione", async () => {
    const amministrazione = appRouter.createCaller(context(1, 12, ["amministrazione"]));
    const salvata = await amministrazione.fatturazioneConfig.salva({
      iban: "IT60X0542811101000000123456",
      banca: "BPM",
      speseDocumentazioneCent: 20000,
    });
    expect(salvata.iban).toBe("IT60X0542811101000000123456");
    expect(salvata.banca).toBe("BPM");
    expect(salvata.speseDocumentazioneCent).toBe(20000);

    const riletta = await amministrazione.fatturazioneConfig.get();
    expect(riletta.config.iban).toBe("IT60X0542811101000000123456");
  });

  it("un metodo di pagamento fuori formato dà BAD_REQUEST", async () => {
    const amministrazione = appRouter.createCaller(context(1, 13, ["amministrazione"]));
    await expect(amministrazione.fatturazioneConfig.salva({ metodoPagamento: "BONIFICO" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("verificaScope dice che FiC non è collegato per una sede senza token, senza toccare la rete", async () => {
    const amministrazione = appRouter.createCaller(context(1, 14, ["amministrazione"]));
    const esito = await amministrazione.fatturazioneConfig.verificaScope();
    expect(esito.ok).toBe(false);
    expect(esito.opzioni).toBeNull();
  });

  it("un'altra sede non vede la configurazione salvata altrove", async () => {
    const amministrazione = appRouter.createCaller(context(1, 15, ["amministrazione"]));
    await amministrazione.fatturazioneConfig.salva({ iban: "IT60X0542811101000000123456" });
    const altraSede = appRouter.createCaller(context(2, 16, ["amministrazione"]));
    const esito = await altraSede.fatturazioneConfig.get();
    expect(esito.config.iban).toBeNull();
  });
});
