import { afterEach, describe, expect, it } from "vitest";
import { interruttoreAttivo, statoInterruttori } from "./interruttori";

const NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  delete process.env.FLAG_MULTI_AZIENDA;
  process.env.NODE_ENV = NODE_ENV;
});

describe("FLAG_MULTI_AZIENDA", () => {
  it("in test è acceso per default e compare nello stato", () => {
    expect(interruttoreAttivo("multiAzienda")).toBe(true);
    expect(statoInterruttori().multiAzienda).toBe(true);
  });

  it("in produzione è spento finché l'env non dice on", () => {
    process.env.NODE_ENV = "production";
    expect(interruttoreAttivo("multiAzienda")).toBe(false);
    process.env.FLAG_MULTI_AZIENDA = "on";
    expect(interruttoreAttivo("multiAzienda")).toBe(true);
  });

  it("off vince anche in test", () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(interruttoreAttivo("multiAzienda")).toBe(false);
  });
});
