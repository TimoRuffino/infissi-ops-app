import { describe, expect, it } from "vitest";
import type { GruppoVoce, VoceComputo } from "@shared/limiti/tipi";
import {
  badgeStato,
  etichettaGruppo,
  etichettaTabLimiti,
  formatCent,
  raggruppaVoci,
  spiegaVoce,
} from "./limitiView";

const voce = (
  gruppo: GruppoVoce,
  codice: string,
  limiteCent: number,
  extra: Partial<VoceComputo> = {}
): VoceComputo => ({
  gruppo,
  codice,
  descrizione: codice,
  codiceDei: null,
  unita: "h",
  prezzoUnitCent: 6017,
  quantita: 1.75,
  limiteCent,
  dettaglio: { ore: 1.75 },
  ordine: 1,
  inclusa: true,
  inCheck1: true,
  inCheck2: true,
  ...extra,
});

describe("limitiView", () => {
  it("raggruppa le voci nell'ordine prodotti → controtelai → opere → eventuali con i totali", () => {
    const gruppi = raggruppaVoci([
      voce("opere", "posa", 131400),
      voce("prodotti", "massimale_A", 1603992),
      voce("eventuali", "dime", 190937),
    ]);
    expect(gruppi.map(g => g.gruppo)).toEqual(["prodotti", "opere", "eventuali"]);
    expect(gruppi[0].totaleCent).toBe(1603992);
    expect(gruppi[0].etichetta).toBe("Prodotti (Allegato A e DEI)");
    expect(etichettaGruppo("controtelai")).toBe("Controtelai");
  });

  it("ordina le voci di un gruppo per `ordine`", () => {
    const gruppi = raggruppaVoci([
      voce("opere", "posa", 131400, { ordine: 2 }),
      voce("opere", "rilievo_foro", 10530, { ordine: 1 }),
    ]);
    expect(gruppi[0].voci.map(v => v.codice)).toEqual(["rilievo_foro", "posa"]);
  });

  it("elenca le voci non incluse ma non le somma nel totale del gruppo", () => {
    const gruppi = raggruppaVoci([
      voce("prodotti", "massimale_A", 1603992),
      voce("prodotti", "dei_riga_1", 900000, { inclusa: false, ordine: 2 }),
    ]);
    expect(gruppi[0].voci).toHaveLength(2);
    expect(gruppi[0].totaleCent).toBe(1603992);
  });

  it("spiega una voce con i suoi input", () => {
    expect(spiegaVoce(voce("opere", "rilievo_pezzo", 10530))).toBe("1,75 h × € 60,17");
    expect(
      spiegaVoce(
        voce("prodotti", "massimale_A", 1603992, {
          unita: "€/mq",
          prezzoUnitCent: 78000,
          quantita: 20.564,
          dettaglio: { zona: "D", mq: 20.564, euroMq: 780 },
        })
      )
    ).toBe("20,564 mq × € 780,00 (zona D)");
  });

  it("badge ed etichetta della tab seguono la validità", () => {
    expect(badgeStato({ computo: null, valido: false, motivo: "Nessun computo eseguito." })).toEqual({
      testo: "Non eseguito",
      tono: "muted",
    });
    expect(badgeStato({ computo: {} as any, valido: true, motivo: null })).toEqual({
      testo: "Aggiornato",
      tono: "success",
    });
    expect(
      badgeStato({
        computo: {} as any,
        valido: false,
        motivo: "Le righe del contratto sono cambiate dopo il computo.",
      })
    ).toEqual({ testo: "Da rifare", tono: "warning" });
    expect(etichettaTabLimiti(undefined)).toBe("Limiti");
    expect(etichettaTabLimiti({ computo: {} as any, valido: true, motivo: null })).toBe("Limiti ✓");
    expect(etichettaTabLimiti({ computo: {} as any, valido: false, motivo: "x" })).toBe(
      "Limiti · da rifare"
    );
  });

  it("formatta i centesimi", () => {
    expect(formatCent(1603992)).toBe("€ 16.039,92");
    expect(formatCent(null)).toBe("—");
    expect(formatCent(undefined)).toBe("—");
    expect(formatCent(0)).toBe("€ 0,00");
  });
});
