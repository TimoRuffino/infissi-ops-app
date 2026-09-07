// server/tenants/tabelle.test.ts
// Guardia STRUTTURALE dell'inventario (Task 12), stesso stile di
// confine.test.ts: `TABELLE_PER_SEDE` non è una lista scritta a mano che
// invecchia da sola, è la fotografia delle tabelle relazionali con `sede_id`
// che vivono nei sorgenti. Chi ne aggiunge una senza mettere il nome nella
// costante lascia quelle righe senza `tenant_id`: qui il test fallisce e lo
// dice.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileSorgente, RADICE, relativo } from "../_core/sorgentiDiProva";
import { TABELLE_PER_SEDE } from "./tabelle";

// Il control plane del tenant (`tenants`, `tenant_eventi`, `tenant_comandi`,
// `tenant_sedi`) NON è materiale per sede, anche se lo specchio `tenant_sedi`
// ha una colonna `sede_id`: quelle tabelle nascono già per tenant e non
// prendono la colonna `tenant_id` con il trigger.
const CONTROL_PLANE = join(RADICE, "server", "tenants", "repository.ts");

const inventario = new Set<string>();
for (const f of fileSorgente(["server"]).filter(f => !/\.test\.ts$/.test(f) && f !== CONTROL_PLANE)) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)\s*\(([\s\S]*?)\)\s*`/g)) {
    if (/\bsede_id\b/.test(m[2])) inventario.add(m[1]);
  }
}

describe("inventario delle tabelle per sede", () => {
  it("TABELLE_PER_SEDE coincide con le tabelle che hanno sede_id nei sorgenti", () => {
    expect([...TABELLE_PER_SEDE].sort()).toEqual([...inventario].sort());
  });

  it("sono 33 il 07/09/2026: chi ne aggiunge una aggiorna la costante e la spec", () => {
    expect(TABELLE_PER_SEDE).toHaveLength(33);
  });

  it("il control plane del tenant resta fuori dall'inventario", () => {
    expect(relativo(CONTROL_PLANE)).toBe(join("server", "tenants", "repository.ts"));
    expect([...TABELLE_PER_SEDE]).not.toContain("tenant_sedi");
  });

  it("nessun nome duplicato e nessun carattere fuori da [a-z_]", () => {
    expect(new Set(TABELLE_PER_SEDE).size).toBe(TABELLE_PER_SEDE.length);
    expect(TABELLE_PER_SEDE.filter(t => !/^[a-z_]+$/.test(t))).toEqual([]);
  });
});
