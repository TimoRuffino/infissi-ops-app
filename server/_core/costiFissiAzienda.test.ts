import { describe, expect, it } from "vitest";
import {
  calcolaCostiFissiAzienda,
  type CostoFicPerFissi,
  type VoceDichiarata,
} from "./costiFissiAzienda";

function costo(over: Partial<CostoFicPerFissi> = {}): CostoFicPerFissi {
  return {
    id: 1,
    sedeId: 1,
    tipo: "expense",
    data: "2026-01-15",
    fornitoreNome: "TIM S.p.A.",
    descrizione: "Canone",
    categoriaFic: "Telefonia",
    importoNetto: 100,
    classificazione: "fisso",
    fonteClassificazione: "utente",
    presenteInFic: true,
    ...over,
  };
}

function voce(over: Partial<VoceDichiarata> = {}): VoceDichiarata {
  return {
    id: 1,
    descrizione: "Stipendi",
    fornitore: null,
    importo: 12_000,
    mensile: 12_000,
    cadenza: "mensile",
    categoria: "personale",
    dal: "2026-01",
    al: null,
    note: null,
    ...over,
  };
}

const PERIODO = { periodoDa: "2026-01-01", periodoA: "2026-03-31", sedeId: 1 };

describe("costi fissi dell'azienda", () => {
  it("mensilizza i documenti FiC classificati fisso sui mesi coperti", () => {
    // Tre mesi di dati, €300 in tutto: €100 al mese.
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        costo({ id: 1, data: "2026-01-10" }),
        costo({ id: 2, data: "2026-02-10" }),
        costo({ id: 3, data: "2026-03-10" }),
      ],
      dichiarati: [],
      ...PERIODO,
    });
    expect(r.mesiCoperti).toBe(3);
    expect(r.totaleFic).toBe(100);
    expect(r.totaleMensile).toBe(100);
    expect(r.righe).toHaveLength(1);
    expect(r.righe[0]).toMatchObject({
      fonte: "fic",
      fornitore: "TIM S.p.A.",
      documenti: 3,
      totalePeriodo: 300,
    });
  });

  it("è QUESTO il numero che la classificazione in Acquisti produce", () => {
    // La regressione: classificare un fornitore come `fisso` non alzava
    // nessun totale, e sembrava che la classificazione non si salvasse.
    const mensili = (classificazione: string) =>
      ["2026-01-10", "2026-02-10", "2026-03-10"].map((data, i) =>
        costo({ id: i + 1, data, classificazione, fonteClassificazione: null })
      );

    const dubbio = calcolaCostiFissiAzienda({
      costiFic: mensili("dubbio"),
      dichiarati: [],
      ...PERIODO,
    });
    expect(dubbio.totaleMensile).toBe(0);
    expect(dubbio.documentiDaClassificare).toBe(3);

    const classificato = calcolaCostiFissiAzienda({
      costiFic: mensili("fisso"),
      dichiarati: [],
      ...PERIODO,
    });
    expect(classificato.totaleMensile).toBe(100);
    expect(classificato.documentiDaClassificare).toBe(0);
  });

  it("somma le voci dichiarate a quelle FiC", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: ["2026-01-10", "2026-02-10", "2026-03-10"].map((data, i) =>
        costo({ id: i + 1, data })
      ),
      dichiarati: [voce({ mensile: 12_000 })],
      ...PERIODO,
    });
    expect(r.totaleFic).toBe(100);
    expect(r.totaleDichiarato).toBe(12_000);
    expect(r.totaleMensile).toBe(12_100);
  });

  it("una voce dichiarata sullo stesso fornitore rimpiazza l'aggregato FiC", () => {
    // Contarli entrambi sarebbe contare due volte lo stesso affitto.
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        costo({ id: 1, fornitoreNome: "Immobiliare Rossi S.r.l.", data: "2026-01-05" }),
        costo({ id: 2, fornitoreNome: "IMMOBILIARE ROSSI SRL", data: "2026-02-05" }),
      ],
      dichiarati: [
        voce({ descrizione: "Affitto capannone", fornitore: "Immobiliare Rossi srl", mensile: 900 }),
      ],
      ...PERIODO,
    });
    expect(r.righe).toHaveLength(1);
    expect(r.righe[0].fonte).toBe("dichiarato");
    expect(r.righe[0].sostituisceFic).toBe(100); // 200 / 2 mesi coperti
    expect(r.totaleMensile).toBe(900);
  });

  it("ignora le voci dichiarate non più valide alla fine del periodo", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: [],
      dichiarati: [
        voce({ id: 1, descrizione: "Chiuso", dal: "2025-01", al: "2026-01", mensile: 500 }),
        voce({ id: 2, descrizione: "In corso", dal: "2026-03", al: null, mensile: 700 }),
        voce({ id: 3, descrizione: "Futuro", dal: "2026-06", al: null, mensile: 900 }),
      ],
      ...PERIODO,
    });
    expect(r.righe.map(r => r.descrizione)).toEqual(["In corso"]);
    expect(r.totaleMensile).toBe(700);
  });

  it("le note di credito abbattono il totale ma non contano come occorrenze", () => {
    // Una rettifica non è una scadenza in più: contarla come tale avrebbe
    // accorciato il ritmo del fornitore e dimezzato il suo peso mensile.
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        costo({ id: 1, importoNetto: 300, data: "2026-01-10" }),
        costo({ id: 2, importoNetto: 300, data: "2026-02-10" }),
        costo({ id: 3, importoNetto: 300, data: "2026-03-10" }),
        costo({
          id: 4,
          tipo: "passive_credit_note",
          importoNetto: 150,
          data: "2026-03-20",
        }),
      ],
      dichiarati: [],
      ...PERIODO,
    });
    expect(r.righe[0].totalePeriodo).toBe(750);
    expect(r.righe[0].mesi).toBe(3);
    expect(r.righe[0].intervalloMesi).toBe(1);
    expect(r.totaleMensile).toBe(250); // 750 / (3 occorrenze × 1 mese)
  });

  it("resta fuori chi non è della sede, chi è sparito da FiC e chi è fuori periodo", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        costo({ id: 1, sedeId: 2, fornitoreNome: "Altra sede" }),
        costo({ id: 2, presenteInFic: false, fornitoreNome: "Cancellato" }),
        costo({ id: 3, data: "2025-11-01", fornitoreNome: "Vecchio" }),
        costo({ id: 4, data: "2026-01-01", fornitoreNome: "Buono" }),
        costo({ id: 5, data: "2026-02-01", fornitoreNome: "Buono" }),
        costo({ id: 6, data: "2026-03-01", fornitoreNome: "Buono" }),
      ],
      dichiarati: [],
      ...PERIODO,
    });
    expect(r.righe.map(r => r.fornitore)).toEqual(["Buono"]);
    expect(r.fuoriTotale).toEqual([]);
  });

  it("non divide mai per zero quando non c'è un solo mese classificato", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: [costo({ classificazione: "dubbio" })],
      dichiarati: [],
      ...PERIODO,
    });
    expect(r.mesiCoperti).toBe(1);
    expect(Number.isFinite(r.totaleMensile)).toBe(true);
  });
});

describe("un costo fisso finito non è un costo di oggi", () => {
  const ANNO = { periodoDa: "2025-08-01", periodoA: "2026-07-31", sedeId: 1 };

  const serie = (
    mesi: string[],
    over: Partial<CostoFicPerFissi> = {}
  ): CostoFicPerFissi[] =>
    mesi.map((mese, i) =>
      costo({ id: 1_000 + i, data: `${mese}-10`, ...over })
    );

  it("esclude dal totale il fornitore che ha smesso di fatturare", () => {
    // La segnalazione: nel costo fisso mensile pesavano ancora canoni del
    // 2025. I loro documenti cadono dentro il periodo base, quindi la media
    // li contava — ma un canone chiuso a ottobre non è un costo di luglio.
    const r = calcolaCostiFissiAzienda({
      costiFic: [
        ...serie(["2025-08", "2025-09", "2025-10"], {
          fornitoreNome: "Canone Chiuso SRL",
          importoNetto: 600,
        }),
        ...serie(["2026-05", "2026-06", "2026-07"], {
          fornitoreNome: "Canone Vivo SRL",
          importoNetto: 500,
        }).map((c, i) => ({ ...c, id: 2_000 + i })),
      ],
      dichiarati: [],
      ...ANNO,
    });

    expect(r.righe.map(x => x.fornitore)).toEqual(["Canone Vivo SRL"]);
    expect(r.totaleMensile).toBe(500);

    // Non sparisce: si vede, col motivo e con l'ultima data.
    expect(r.fuoriTotale).toHaveLength(1);
    expect(r.fuoriTotale[0]).toMatchObject({
      fornitore: "Canone Chiuso SRL",
      inForza: false,
      mensile: 0,
      ultimoMese: "2025-10",
      totalePeriodo: 1_800,
    });
    expect(r.fuoriTotale[0].motivoFuori).toContain("9 mesi fa");
  });

  it("un canone acceso a metà periodo pesa per intero, non per un dodicesimo", () => {
    // La formula precedente divideva per i mesi del periodo: €1.500 spesi in
    // tre mesi diventavano €125 al mese invece di €500.
    const r = calcolaCostiFissiAzienda({
      costiFic: serie(["2026-05", "2026-06", "2026-07"], {
        fornitoreNome: "Nuovo Affitto SRL",
        importoNetto: 500,
      }),
      dichiarati: [],
      ...ANNO,
    });
    expect(r.righe[0]).toMatchObject({
      inForza: true,
      intervalloMesi: 1,
      mesi: 3,
      mensile: 500,
    });
  });

  it("riconosce la cadenza trimestrale invece di spalmarla su dodici mesi", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: serie(["2026-01", "2026-04", "2026-07"], {
        fornitoreNome: "Assicurazione Trimestrale SRL",
        importoNetto: 900,
      }),
      dichiarati: [],
      ...ANNO,
    });
    expect(r.righe[0]).toMatchObject({ intervalloMesi: 3, mensile: 300 });
  });

  it("tollera un mese di ritardo prima di dichiarare finito un canone", () => {
    // Una fattura in ritardo non è un contratto chiuso.
    const r = calcolaCostiFissiAzienda({
      costiFic: serie(["2026-04", "2026-05", "2026-06"], {
        fornitoreNome: "Canone In Ritardo SRL",
        importoNetto: 400,
      }),
      dichiarati: [],
      ...ANNO,
    });
    expect(r.righe[0]).toMatchObject({ inForza: true, mensile: 400 });
  });

  it("mette da parte chi ha un documento solo, senza indovinarne il ritmo", () => {
    // Indovinare è pericoloso in entrambe le direzioni: un premio annuo da
    // €12.000 letto come mensile gonfierebbe l'obiettivo di dodici volte.
    const r = calcolaCostiFissiAzienda({
      costiFic: serie(["2026-07"], {
        fornitoreNome: "Premio Annuo SRL",
        importoNetto: 12_000,
      }),
      dichiarati: [],
      ...ANNO,
    });
    expect(r.righe).toEqual([]);
    expect(r.totaleMensile).toBe(0);
    expect(r.fuoriTotale[0].motivoFuori).toContain("Un solo documento");
  });

  it("una voce dichiarata non rimpiazza un fornitore già fuori dal totale", () => {
    const r = calcolaCostiFissiAzienda({
      costiFic: serie(["2025-08", "2025-09", "2025-10"], {
        fornitoreNome: "Affitto Vecchio SRL",
        importoNetto: 600,
      }),
      dichiarati: [
        voce({
          descrizione: "Affitto nuovo capannone",
          fornitore: "AFFITTO VECCHIO SRL",
          mensile: 800,
          dal: "2025-01",
        }),
      ],
      ...ANNO,
    });
    expect(r.righe).toHaveLength(1);
    expect(r.righe[0]).toMatchObject({
      fonte: "dichiarato",
      sostituisceFic: null,
    });
    expect(r.totaleMensile).toBe(800);
  });
});
