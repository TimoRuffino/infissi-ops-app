import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { verificaConCache, __svuotaCachePerTest } from "./cache";

beforeEach(() => {
  __svuotaCachePerTest();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("cache di verifica", () => {
  it("due chiamate ravvicinate interrogano il fornitore una volta sola", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache("fic", 1, sonda);
    await verificaConCache("fic", 1, sonda);
    expect(sonda).toHaveBeenCalledTimes(1);
  });

  it("sedi diverse non si scambiano l'esito", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache("fic", 1, sonda);
    await verificaConCache("fic", 2, sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  it("dopo 60 secondi si torna a chiedere", async () => {
    const sonda = vi.fn().mockResolvedValue(null);
    await verificaConCache("fic", 1, sonda);
    vi.advanceTimersByTime(61_000);
    await verificaConCache("fic", 1, sonda);
    expect(sonda).toHaveBeenCalledTimes(2);
  });

  it("un errore non si mette in cache: il guasto va riprovato subito", async () => {
    const sonda = vi.fn().mockRejectedValue(new Error("rete giù"));
    await expect(verificaConCache("fic", 1, sonda)).rejects.toThrow();
    await expect(verificaConCache("fic", 1, sonda)).rejects.toThrow();
    expect(sonda).toHaveBeenCalledTimes(2);
  });
});
