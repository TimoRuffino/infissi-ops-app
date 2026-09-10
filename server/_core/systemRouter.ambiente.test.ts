import { afterEach, describe, expect, it } from "vitest";
import { systemRouter } from "./systemRouter";

const originale = process.env.AMBIENTE;
afterEach(() => {
  if (originale === undefined) delete process.env.AMBIENTE;
  else process.env.AMBIENTE = originale;
});

describe("system.ambiente", () => {
  it("risponde staging:false fuori da staging", async () => {
    delete process.env.AMBIENTE;
    const caller = systemRouter.createCaller({} as any);
    await expect(caller.ambiente()).resolves.toEqual({ staging: false });
  });
  it("risponde staging:true in staging", async () => {
    process.env.AMBIENTE = "staging";
    const caller = systemRouter.createCaller({} as any);
    await expect(caller.ambiente()).resolves.toEqual({ staging: true });
  });
});
