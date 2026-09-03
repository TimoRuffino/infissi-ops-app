import { describe, expect, it } from "vitest";
import { gruppoPerCategoria, gruppoPerOscurante } from "@shared/limiti/tipi";
import {
  accessoriPer,
  accessorio,
  massimaleEuroMq,
  percentualeDetrazione,
  prodottiPer,
  prodotto,
  tariffeAttive,
  voceControtelaio,
  voceOpera,
} from "./tariffe";

describe("tariffe limiti", () => {
  const t = tariffeAttive(new Date("2026-09-03"));

  it("carica i massimali Allegato A per gruppo e zona", () => {
    expect(t.massimali).toHaveLength(18);
    expect(massimaleEuroMq(t, "A", "E")).toBe(780);
    expect(massimaleEuroMq(t, "A", "B")).toBe(660);
    expect(massimaleEuroMq(t, "B", "D")).toBe(900);
    expect(massimaleEuroMq(t, "C", "F")).toBe(276);
    expect(() => tariffeAttive(new Date("2021-01-01"))).toThrow("TARIFFE_NON_DISPONIBILI");
  });

  it("espone i prodotti DEI con i prezzi dei fogli «Calcolo Automatici»", () => {
    expect(prodotto(t, "C25077-c")).toMatchObject({ gruppo: "serramento", famiglia: "pvc", prezzo: 589.57, unita: "mq", nAnte: 2, portafinestra: false, minimoMq: 1 });
    expect(prodotto(t, "C25077-e")).toMatchObject({ prezzo: 680.41, portafinestra: true });
    expect(prodotto(t, "C15078-a")).toMatchObject({ gruppo: "persiana", famiglia: "alluminio", prezzo: 575.99 });
    expect(prodotto(t, "C25089-a")).toMatchObject({ gruppo: "avvolgibile", minimoMq: 1.8 });
    expect(prodotto(t, "C25095-a")).toMatchObject({ gruppo: "cassonetto", unita: "cad", mqPezzoMin: 0, mqPezzoMax: 0.51 });
    expect(prodotto(t, "C25053-a")).toMatchObject({ famiglia: "legno", zone: ["D"], minimoMq: null });
    expect(prodotto(t, "inesistente")).toBeNull();
    expect(prodottiPer(t, "serramento", "pvc").length).toBeGreaterThanOrEqual(8);
    // alluminio per zona: solo le voci della zona D (o senza zona)
    const alluD = prodottiPer(t, "serramento", "alluminio", "D");
    expect(alluD.length).toBeGreaterThan(0);
    expect(alluD.every(p => !p.zone || p.zone.includes("D"))).toBe(true);
  });

  it("espone gli accessori con la regola del foglio", () => {
    expect(accessorio(t, "serramento.C25088-a")).toMatchObject({ regola: "pct_mq", valore: 15 });
    expect(accessorio(t, "serramento.C25088-b")).toMatchObject({ regola: "cad_anta", valore: 120 });
    expect(accessorio(t, "serramento.C25088-h")).toMatchObject({ regola: "m_perimetro", valore: 1.65 });
    expect(accessorio(t, "serramento.C25126")).toMatchObject({ regola: "cad_pezzo", valore: 70 });
    expect(accessorio(t, "persiana.C25084-c")).toMatchObject({ regola: "cad_pezzo", valore: 6, moltiplicatore: 2 });
    expect(accessorio(t, "persiana.C15154-b")).toMatchObject({ regola: "pct_pezzo", valore: 4, famiglie: ["alluminio"] });
    const pf = accessoriPer(t, "serramento", "pvc", true).map(a => a.codice);
    expect(pf).toContain("serramento.C25088-c");
    expect(accessoriPer(t, "serramento", "pvc", false).map(a => a.codice)).not.toContain("serramento.C25088-c");
    expect(accessoriPer(t, "persiana", "alluminio", false)).toHaveLength(6);
  });

  it("espone controtelai, opere e coefficienti", () => {
    expect(voceControtelaio(t, "C15145-a")?.prezzo).toBe(55.52);
    expect(voceOpera(t, "posa")).toMatchObject({ prezzo: 36.5, esclusaDaCheck2: true, inclusaDefault: true });
    expect(voceOpera(t, "rilievo_pezzo").inclusaDefault).toBe(false);
    expect(voceOpera(t, "piattaforma")).toMatchObject({ prezzo: 517.92, gruppo: "eventuali", inclusaDefault: false });
    expect(() => voceOpera(t, "non_esiste" as any)).toThrow("OPERA_SCONOSCIUTA");
    expect(t.coefficienti.smaltimentoMcSerramento).toBe(0.1);
    expect(t.coefficienti.avvolgibileExtraL).toBe(0.05);
    expect(t.coefficienti.ivaAgevolata).toBe(0.1);
    expect(voceControtelaio(t, "C15145-a")).toMatchObject({ unita: "mq", minimoMq: 1.2 });
  });

  it("dà la percentuale di detrazione per tipo, immobile e anno", () => {
    expect(percentualeDetrazione(t, "ristrutturazione", "prima_casa", 2026)).toBe(50);
    expect(percentualeDetrazione(t, "ecobonus", "altro", 2026)).toBe(36);
    expect(percentualeDetrazione(t, "nessuna", "altro", 2026)).toBeNull();
    // 2025: stesse aliquote del 2026. Senza queste righe una firma del 2025
    // non aveva percentuale e il detraibile restava «—».
    expect(percentualeDetrazione(t, "ristrutturazione", "prima_casa", 2025)).toBe(50);
    expect(percentualeDetrazione(t, "ristrutturazione", "altro", 2025)).toBe(36);
    expect(percentualeDetrazione(t, "ecobonus", "prima_casa", 2025)).toBe(50);
    expect(percentualeDetrazione(t, "ecobonus", "altro", 2025)).toBe(36);
    // 2027: legge di bilancio 2025 — 36 % prima casa, 30 % altri immobili.
    expect(percentualeDetrazione(t, "ristrutturazione", "prima_casa", 2027)).toBe(36);
    expect(percentualeDetrazione(t, "ristrutturazione", "altro", 2027)).toBe(30);
    expect(percentualeDetrazione(t, "ecobonus", "prima_casa", 2027)).toBe(36);
    expect(percentualeDetrazione(t, "ecobonus", "altro", 2027)).toBe(30);
    // Oltre l'ultimo anno noto resta valida l'ultima riga: non si inventa.
    expect(percentualeDetrazione(t, "ristrutturazione", "prima_casa", 2030)).toBe(36);
    // Prima del 2025 le tariffe non hanno aliquote: null, non uno zero.
    expect(percentualeDetrazione(t, "ristrutturazione", "prima_casa", 2024)).toBeNull();
    // `immobile` non indicato vale come «altro».
    expect(percentualeDetrazione(t, "ristrutturazione", null, 2027)).toBe(30);
    expect(t.detrazioni).toHaveLength(12);
  });

  it("mappa le categorie del contratto sui gruppi DEI", () => {
    expect(gruppoPerCategoria("serramento_pvc")).toEqual({ gruppo: "serramento", famiglia: "pvc" });
    expect(gruppoPerCategoria("tapparella")).toEqual({ gruppo: "avvolgibile", famiglia: null });
    expect(gruppoPerCategoria("controtelaio")).toEqual({ gruppo: null, famiglia: null });
    expect(gruppoPerOscurante("persiana")).toBe("persiana");
    expect(gruppoPerOscurante("tapparella")).toBe("avvolgibile");
  });
});
