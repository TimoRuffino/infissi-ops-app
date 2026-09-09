import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  verificaConCache,
  invalidaVerifica,
  __svuotaCachePerTest,
} from "./cache";

beforeEach(() => {
  __svuotaCachePerTest();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("cache di verifica", () => {
  it("due chiamate ravvicinate interrogano il fornitore una volta sola", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache(1, "fic", 1, sonda);
    await verificaConCache(1, "fic", 1, sonda);
    expect(sonda).toHaveBeenCalledTimes(1);
  });

  it("sedi diverse non si scambiano l'esito", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache(1, "fic", 1, sonda);
    await verificaConCache(1, "fic", 2, sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  // C1 della revisione: gli adattatori ad ambito AZIENDA (backup, agente) non
  // hanno una sede che distingua la chiave. Senza l'azienda nella chiave,
  // `backup:azienda` era uno solo per tutta l'installazione: l'esito
  // dell'azienda A veniva servito a B — il collegamento Drive di un cliente
  // raccontato a un altro.
  it("aziende diverse non si scambiano l'esito, nemmeno sugli adattatori d'azienda", async () => {
    const diA = vi.fn().mockResolvedValue(null);
    const diB = vi.fn().mockResolvedValue({
      causa: "x",
      rimedio: "y",
      azione: "ricollega" as const,
    });

    const a = await verificaConCache(1, "backup", null, diA);
    const b = await verificaConCache(2, "backup", null, diB);

    expect(diA).toHaveBeenCalledTimes(1);
    expect(diB).toHaveBeenCalledTimes(1);
    expect(a).toBeNull();
    expect(b?.azione).toBe("ricollega");
  });

  it("dopo 60 secondi si torna a chiedere", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache(1, "fic", 1, sonda);
    vi.advanceTimersByTime(61_000);
    await verificaConCache(1, "fic", 1, sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  it("un errore non si mette in cache: il guasto va riprovato subito", async () => {
    const sonda = vi.fn().mockRejectedValue(new Error("rete giù"));
    await expect(verificaConCache(1, "fic", 1, sonda)).rejects.toThrow();
    await expect(verificaConCache(1, "fic", 1, sonda)).rejects.toThrow();
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  // Collegare, completare o scollegare cambia la verità: tenersi l'esito di
  // un minuto fa vorrebbe dire dire «ancora rotto» a chi ha appena rimediato.
  it("l'invalidazione butta via l'esito di quella chiave, e solo di quella", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    const altra = vi.fn().mockResolvedValue(null);
    await verificaConCache(1, "fic", 1, sonda);
    await verificaConCache(1, "email", 1, altra);

    invalidaVerifica(1, "fic", 1);

    await verificaConCache(1, "fic", 1, sonda);
    await verificaConCache(1, "email", 1, altra);
    expect(sonda).toHaveBeenCalledTimes(2);
    expect(altra).toHaveBeenCalledTimes(1);
  });

  it("l'invalidazione di un'azienda non tocca la cache dell'altra", async () => {
    const diA = vi.fn().mockResolvedValue(null);
    const diB = vi.fn().mockResolvedValue(null);
    await verificaConCache(1, "backup", null, diA);
    await verificaConCache(2, "backup", null, diB);

    invalidaVerifica(1, "backup", null);

    await verificaConCache(1, "backup", null, diA);
    await verificaConCache(2, "backup", null, diB);
    expect(diA).toHaveBeenCalledTimes(2);
    expect(diB).toHaveBeenCalledTimes(1);
  });
});
