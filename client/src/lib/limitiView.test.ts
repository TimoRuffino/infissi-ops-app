import { describe, expect, it } from "vitest";
import type { GruppoVoce, VoceComputo } from "@shared/limiti/tipi";
import {
  badgeStato,
  etichettaGruppo,
  etichettaTabLimiti,
  formatCent,
  motivoSintetico,
  raggruppaVoci,
  spiegaVoce,
  titoloGateBloccato,
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

const dei = (codice: string, limiteCent: number, extra: Partial<VoceComputo> = {}) =>
  voce("prodotti", codice, limiteCent, {
    unita: "mq",
    inCheck1: false,
    inCheck2: true,
    dettaglio: { codiceDei: "C25077-c", mq: 5.1, base: 1530.4 },
    ...extra,
  });

describe("limitiView", () => {
  it("separa i prodotti nei due check e ordina prodotti → controtelai → opere → eventuali", () => {
    const gruppi = raggruppaVoci(
      [
        voce("opere", "posa", 131400),
        voce("eventuali", "dime", 190937),
        dei("dei_riga_1", 153040),
        voce("prodotti", "massimale_A", 1603992),
        voce("controtelai", "controtelaio_1", 42000),
      ],
      153040
    );
    expect(gruppi.map(g => g.gruppo)).toEqual([
      "prodotti_check1",
      "prodotti_check2",
      "controtelai",
      "opere",
      "eventuali",
    ]);
    expect(gruppi[0].etichetta).toBe("Prodotti · CHECK 1 (Allegato A)");
    expect(gruppi[0].totaleCent).toBe(1603992);
    expect(gruppi[1].etichetta).toBe("Prodotti · CHECK 2 (DEI per riga)");
    expect(etichettaGruppo("controtelai")).toBe("Controtelai");
  });

  // Il totale del CHECK 2 è quello del motore, non la somma di righe già
  // arrotondate: la card in testa e la sezione devono dire la stessa cifra.
  it("il totale del CHECK 2 è `deiProdottiCent`, non la somma delle righe", () => {
    const voci = [dei("dei_riga_1", 153040), dei("dei_riga_2", 99999, { ordine: 2 })];
    const gruppi = raggruppaVoci(voci, 253038);
    expect(gruppi[0].totaleCent).toBe(253038);
    expect(gruppi[0].incompleto).toBe(false);
  });

  it("senza `deiProdottiCent` il CHECK 2 non ha totale ed è incompleto", () => {
    const gruppi = raggruppaVoci([dei("dei_riga_1", 153040)], null);
    expect(gruppi[0].totaleCent).toBeNull();
    expect(gruppi[0].incompleto).toBe(true);
    expect(formatCent(gruppi[0].totaleCent)).toBe("—");
  });

  it("ordina le voci di un gruppo per `ordine`", () => {
    const gruppi = raggruppaVoci(
      [voce("opere", "posa", 131400, { ordine: 2 }), voce("opere", "rilievo_foro", 10530, { ordine: 1 })],
      null
    );
    expect(gruppi[0].voci.map(v => v.codice)).toEqual(["rilievo_foro", "posa"]);
  });

  it("elenca le voci non incluse ma non le somma nel totale del gruppo", () => {
    const gruppi = raggruppaVoci(
      [
        voce("opere", "posa", 131400),
        voce("opere", "rilievo_pezzo", 900000, { inclusa: false, ordine: 2 }),
      ],
      null
    );
    expect(gruppi[0].voci).toHaveLength(2);
    expect(gruppi[0].totaleCent).toBe(131400);
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

  // Una riga DEI con oscurante o accessori vale più del suo «mq × prezzo»:
  // mostrare quel prodotto accanto a un limite più alto non tornerebbe.
  it("spiega una riga DEI composta con i suoi addendi", () => {
    expect(
      spiegaVoce(
        dei("dei_riga_1", 210000, {
          quantita: 5.1,
          prezzoUnitCent: 30008,
          dettaglio: {
            codiceDei: "C25077-c",
            mq: 5.1,
            base: 1530.4,
            oscurante: "C15078-a",
            oscuranteBase: 420.5,
            "accessorio Cassonetto coibentato": 100,
            "accessorio Zanzariera": 49.1,
          },
        })
      )
    ).toBe("base € 1.530,40 + oscurante € 420,50 + accessori € 149,10");
    // Senza oscurante né accessori resta la forma «quantità × prezzo».
    expect(spiegaVoce(dei("dei_riga_2", 153040, { quantita: 5.1, prezzoUnitCent: 30008 }))).toBe(
      "5,1 mq × € 300,08"
    );
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

  it("il motivo si accorcia solo quando le avvertenze lo ripetono", () => {
    const lungo = "Il computo è incompleto: Riga 1 «Finestra»: nessuna voce DEI.";
    expect(motivoSintetico(lungo, 1)).toBe("Il computo è incompleto.");
    expect(motivoSintetico(lungo, 0)).toBe(lungo);
    expect(motivoSintetico("Le righe del contratto sono cambiate dopo il computo.", 2)).toBe(
      "Le righe del contratto sono cambiate dopo il computo."
    );
    expect(motivoSintetico(null, 3)).toBeNull();
  });

  it("il titolo del dialog «Procedi comunque» segue il gate che ha bloccato", () => {
    expect(
      titoloGateBloccato(
        'Il computo dei limiti manca o non è aggiornato per lo stato "Aggiornamento contratto": compila il contratto e calcola i limiti dalla tab Limiti. Procedere comunque?'
      )
    ).toBe("Computo dei limiti non aggiornato");
    expect(
      titoloGateBloccato(
        'Non è stato caricato il file "Contratto" per lo stato "Aggiornamento contratto". Procedere comunque?'
      )
    ).toBe("File richiesto non caricato");
    expect(titoloGateBloccato(null)).toBe("File richiesto non caricato");
    expect(titoloGateBloccato(undefined)).toBe("File richiesto non caricato");
  });

  it("formatta i centesimi", () => {
    expect(formatCent(1603992)).toBe("€ 16.039,92");
    expect(formatCent(null)).toBe("—");
    expect(formatCent(undefined)).toBe("—");
    expect(formatCent(0)).toBe("€ 0,00");
  });
});
