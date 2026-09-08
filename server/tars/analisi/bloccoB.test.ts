// Blocco B del piano «Tars più intelligente» (08/09/2026):
//  12. da quale sezione nasce una proposta, e quali sezioni paghi;
//   4. una proposta scartata resta scartata anche domani;
//   3. ogni proposta al suo destinatario, e ognuno vede la sua coda;
//  23. una lettura senza riscontro non ha l'aspetto di una certezza.

import { describe, expect, it } from "vitest";
import { verificaEsito } from "./analisi";
import {
  conDestinatari,
  destinatarioDiProposta,
  esitoVisibileA,
  propostaVisibileA,
} from "./destinatari";
import {
  CAMPIONE_MINIMO_FONTE,
  giornoDiInizio,
  riscontroPerFonte,
  scartateRecenti,
  testoRiscontro,
} from "./riscontro";
import type {
  EsitoAnalisiAzienda,
  FotografiaAzienda,
  PropostaAnalisi,
  RecordAnalisiAzienda,
} from "./types";

// ── il riscontro ─────────────────────────────────────────────────────────

function proposta(patch: Partial<PropostaAnalisi> = {}): PropostaAnalisi {
  return {
    testo: "Solleicita il preventivo di Rossi.",
    richiestaPerTars: "Manda un promemoria a Marco.",
    fonte: "preventivi",
    entita: [],
    link: null,
    azione: null,
    ...patch,
  };
}

function analisi(giorno: string, proposte: PropostaAnalisi[]): RecordAnalisiAzienda {
  return {
    id: Number(giorno.replaceAll("-", "")),
    sedeId: 1,
    giorno,
    versione: "1.2.0",
    stato: "pronta",
    esito: {
      versione: "1.2.0",
      fonte: "modello",
      modello: "finto",
      sintesi: "",
      punti: [],
      proposte,
      domande: [],
      avvertenze: [],
      contatori: {},
      fattiConsiderati: 0,
    },
    errore: null,
    richiestaDa: null,
    tentativi: 1,
    generataAt: new Date(`${giorno}T07:00:00Z`),
  };
}

const scartata = (fonte: string, testo: string) =>
  proposta({
    fonte,
    testo,
    esecuzione: {
      stato: "scartata",
      motivo: null,
      azioneId: null,
      entitaToccate: [],
      quando: "2026-09-05T09:00:00Z",
      daUtente: 1,
    },
  });
const eseguita = (fonte: string) =>
  proposta({
    fonte,
    esecuzione: {
      stato: "eseguito",
      motivo: null,
      azioneId: "a1",
      entitaToccate: [],
      quando: "2026-09-05T09:00:00Z",
      daUtente: 1,
    },
  });

describe("la memoria dura più di un giorno (punto 4)", () => {
  it("raccoglie le scartate di tutti i giorni della finestra, dalla più recente", () => {
    const scartate = scartateRecenti([
      analisi("2026-09-02", [scartata("dormienti", "Archivia le dormienti")]),
      analisi("2026-09-06", [scartata("gate", "Carica il contratto di Rossi"), proposta()]),
    ]);
    expect(scartate.map(s => s.giorno)).toEqual(["2026-09-06", "2026-09-02"]);
    expect(scartate[0].fonte).toBe("gate");
    expect(scartate.map(s => s.testo)).toContain("Archivia le dormienti");
  });

  it("la finestra parte quattordici giorni prima", () => {
    expect(giornoDiInizio("2026-09-08")).toBe("2026-08-25");
    expect(giornoDiInizio("2026-01-05", 10)).toBe("2025-12-26");
  });
});

describe("cosa accetti e cosa scarti (punto 12)", () => {
  it("conta per sezione e calcola il tasso solo su un campione decente", () => {
    const record = [
      analisi("2026-09-06", [eseguita("gate"), eseguita("gate"), scartata("dormienti", "x")]),
      analisi("2026-09-07", [eseguita("gate"), scartata("gate", "y"), scartata("dormienti", "z")]),
    ];
    const righe = riscontroPerFonte(record);
    const gate = righe.find(r => r.fonte === "gate")!;
    expect(gate.proposte).toBe(4);
    expect(gate.eseguite).toBe(3);
    expect(gate.scartate).toBe(1);
    expect(gate.tasso).toBeCloseTo(0.75);
    // Due sole decisioni: sotto il campione minimo non si dichiara un tasso.
    const dormienti = righe.find(r => r.fonte === "dormienti")!;
    expect(dormienti.eseguite + dormienti.scartate).toBeLessThan(CAMPIONE_MINIMO_FONTE);
    expect(dormienti.tasso).toBeNull();
  });

  it("una proposta mai toccata non è un rifiuto", () => {
    const righe = riscontroPerFonte([analisi("2026-09-07", [proposta({ fonte: "gate" })])]);
    expect(righe[0].proposte).toBe(1);
    expect(righe[0].eseguite).toBe(0);
    expect(righe[0].scartate).toBe(0);
  });

  it("il testo dice cosa farne, senza percentuali inventate", () => {
    expect(testoRiscontro({ fonte: "gate", proposte: 5, eseguite: 4, scartate: 1, tasso: 0.8 }))
      .toContain("questa sezione paga");
    expect(
      testoRiscontro({ fonte: "dormienti", proposte: 8, eseguite: 1, scartate: 7, tasso: 0.125 })
    ).toContain("non insistere");
    expect(testoRiscontro({ fonte: "gate", proposte: 2, eseguite: 1, scartate: 1, tasso: null }))
      .toContain("troppo poche");
  });
});

// ── i destinatari ────────────────────────────────────────────────────────

const deps = {
  commessa: (id: number) =>
    id === 12
      ? { assegnatoA: 77, stato: "produzione" }
      : id === 13
        ? { assegnatoA: 77, stato: "fatture_pagamento" }
        : null,
  ticket: (id: number) => (id === 7 ? { assegnatoA: 88 } : null),
};

describe("ogni proposta al suo destinatario (punto 3)", () => {
  it("le fatture vanno all'amministrazione", () => {
    const d = destinatarioDiProposta({ fonte: "fatture", entita: ["fattura:900"] }, deps);
    expect(d.ruolo).toBe("amministrazione");
  });

  it("il gate di una commessa va a chi ce l'ha in carico", () => {
    const d = destinatarioDiProposta({ fonte: "gate", entita: ["commessa:12"] }, deps);
    expect(d.utenteId).toBe(77);
  });

  it("ma se la commessa è in fase amministrativa vince l'amministrazione", () => {
    const d = destinatarioDiProposta({ fonte: "gate", entita: ["commessa:13"] }, deps);
    expect(d.ruolo).toBe("amministrazione");
  });

  it("il ticket va a chi lo ha in carico", () => {
    const d = destinatarioDiProposta({ fonte: "ticket", entita: ["ticket:7"] }, deps);
    expect(d.utenteId).toBe(88);
  });

  it("un'integrazione rotta la ricollega solo la direzione", () => {
    const d = destinatarioDiProposta({ fonte: "guasti", entita: [] }, deps);
    expect(d.ruolo).toBe("direzione");
  });

  it("senza niente a cui appoggiarsi resta della direzione", () => {
    const d = destinatarioDiProposta({ fonte: "commesse", entita: [] }, deps);
    expect(d.ruolo).toBe("direzione");
  });
});

describe("ognuno vede la sua coda (punto 3)", () => {
  const esito = conDestinatari(
    {
      versione: "1.2.0",
      fonte: "modello",
      modello: "finto",
      sintesi: "",
      punti: [],
      proposte: [
        proposta({ fonte: "fatture", testo: "Collega la fattura 128/A." }),
        proposta({ fonte: "gate", entita: ["commessa:12"], testo: "Carica il contratto." }),
        proposta({ fonte: "guasti", testo: "Ricollega Fatture in Cloud." }),
      ],
      domande: [],
      avvertenze: [],
      contatori: {},
      fattiConsiderati: 0,
    } as EsitoAnalisiAzienda,
    deps
  );

  it("la direzione vede tutto", () => {
    const mio = esitoVisibileA(esito, { utenteId: 1, ruoli: ["direzione"], direzione: true });
    expect(mio.proposte).toHaveLength(3);
  });

  it("l'amministrazione vede la fattura e non il resto", () => {
    const mio = esitoVisibileA(esito, {
      utenteId: 5,
      ruoli: ["amministrazione"],
      direzione: false,
    });
    expect(mio.proposte.map(p => p.testo)).toEqual(["Collega la fattura 128/A."]);
  });

  it("chi ha la commessa vede il suo gate, e non le fatture", () => {
    const mio = esitoVisibileA(esito, { utenteId: 77, ruoli: ["commerciale"], direzione: false });
    expect(mio.proposte.map(p => p.testo)).toEqual(["Carica il contratto."]);
  });

  it("una proposta senza destinatario non è di nessuno tranne la direzione", () => {
    expect(
      propostaVisibileA({ destinatario: null }, { utenteId: 5, ruoli: ["posa"], direzione: false })
    ).toBe(false);
    expect(
      propostaVisibileA({ destinatario: null }, { utenteId: 1, ruoli: ["direzione"], direzione: true })
    ).toBe(true);
  });
});

// ── la fiducia ───────────────────────────────────────────────────────────

function fotografiaConConferma(fiducia: "letta" | "da_verificare"): FotografiaAzienda {
  return {
    sedeId: 1,
    generataIl: "2026-09-08T07:00:00Z",
    contatori: {},
    sezioni: [
      {
        chiave: "conferme_ordine",
        titolo: "Conferme d'ordine",
        fatti: [
          {
            chiave: "commessa:12:conferma_ordine",
            testo: "COM-2026-012 — Rossi: conferma arrivata per mail.",
            entita: ["commessa:12"],
            link: "/commesse/12",
            fiducia,
          },
        ],
      },
    ],
  };
}

describe("una lettura non riscontrata non sembra una certezza (punto 23)", () => {
  const grezzo = (fonte: string) => ({
    sintesi: "Giornata normale.",
    punti: [],
    proposte: [
      {
        testo: "Archivia la conferma di Rossi nel fascicolo.",
        richiestaPerTars: "Archivia la conferma in COM-2026-012.",
        fonte,
        entita: ["commessa:12"],
        azione: null,
      },
    ],
    domande: [],
  });

  it("la proposta su una lettura senza riscontro si annuncia da sé", () => {
    const esito = verificaEsito(grezzo("conferme_ordine"), fotografiaConConferma("da_verificare"), "finto");
    expect(esito.proposte[0].fiducia).toBe("da_verificare");
    expect(esito.proposte[0].testo).toMatch(/^Da verificare: /);
  });

  it("una lettura riscontrata non porta l'avviso", () => {
    const esito = verificaEsito(grezzo("conferme_ordine"), fotografiaConConferma("letta"), "finto");
    expect(esito.proposte[0].fiducia).toBe("letta");
    expect(esito.proposte[0].testo).not.toMatch(/^Da verificare/);
  });

  it("una fonte inventata dal modello non entra nella misura", () => {
    const esito = verificaEsito(grezzo("sezione_che_non_esiste"), fotografiaConConferma("letta"), "finto");
    expect(esito.proposte[0].fonte).toBeNull();
  });
});

// ── blocco C: l'ordine lo decide quanto costa ignorare ───────────────────

describe("le proposte si ordinano per posta in gioco (punto 22)", () => {
  const fotografia: FotografiaAzienda = {
    sedeId: 1,
    generataIl: "2026-09-08T07:00:00Z",
    contatori: {},
    sezioni: [
      {
        chiave: "gate",
        titolo: "Gate",
        fatti: [
          { chiave: "a", testo: "grossa", entita: ["commessa:1"], link: null },
          { chiave: "b", testo: "piccola", entita: ["commessa:2"], link: null },
        ],
      },
    ],
    postaInGioco: {
      "commessa:1": { residuo: 40_000, marginePerc: 0.12 },
      "commessa:2": { residuo: 800, marginePerc: 0.5 },
    },
  };
  const grezzo = {
    sintesi: "",
    punti: [],
    proposte: [
      {
        testo: "Carica il documento della piccola.",
        richiestaPerTars: "Carica il documento.",
        fonte: "gate",
        entita: ["commessa:2"],
        azione: null,
      },
      {
        testo: "Carica il documento della grossa.",
        richiestaPerTars: "Carica il documento.",
        fonte: "gate",
        entita: ["commessa:1"],
        azione: null,
      },
    ],
    domande: [],
  };

  it("il lavoro da quarantamila passa davanti a quello da ottocento", () => {
    const esito = verificaEsito(grezzo, fotografia, "finto");
    expect(esito.proposte.map(p => p.testo)).toEqual([
      "Carica il documento della grossa.",
      "Carica il documento della piccola.",
    ]);
  });

  it("le cifre viaggiano con la proposta, e solo la direzione le vede", () => {
    const esito = verificaEsito(grezzo, fotografia, "finto");
    expect(esito.proposte[0].economia).toEqual({ residuo: 40_000, marginePerc: 0.12 });
    const altrui = esitoVisibileA(
      { ...esito, proposte: esito.proposte.map(p => ({ ...p, destinatario: { utenteId: 9, ruolo: null, motivo: "sua" } })) },
      { utenteId: 9, ruoli: ["commerciale"], direzione: false }
    );
    expect(altrui.proposte).toHaveLength(2);
    expect(altrui.proposte[0].economia).toBeUndefined();
  });
});
