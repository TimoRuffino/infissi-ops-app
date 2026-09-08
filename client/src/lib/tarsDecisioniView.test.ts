import { describe, expect, it } from "vitest";

import {
  decisioneDaComunicazione,
  decisioneDaConsiglio,
  decisioneDaDocumento,
  destinazioneComunicazione,
  fraseAllegati,
  quandoBreve,
  titoloCoda,
  type IngressoComunicazione,
} from "./tarsDecisioniView";

function comunicazione(
  patch: Partial<IngressoComunicazione> = {}
): IngressoComunicazione {
  return {
    comunicazioneId: 1,
    canale: "email",
    mittente: "riparazioni@primed.it",
    oggetto: "PRIMED ticket # 2678C25B58 # RITIRO RIPARAZIONI",
    ricevutaIl: "2026-09-08T19:28:00.000Z",
    riepilogo: "Primed conferma il ritiro delle riparazioni.",
    urgenza: "normale",
    collegamento: {
      commessaId: 333,
      clienteId: 51,
      confidenza: "media",
      motivo: "L'articolo «Giada» combacia con l'unica commessa candidata.",
    },
    candidati: [
      { tipo: "commessa", id: 333, etichetta: "COM-2026-333 — Galastri Giada" },
    ],
    allegatiDaArchiviare: ["DDT_ritiro_2678.pdf"],
    ...patch,
  };
}

describe("una comunicazione diventa una decisione", () => {
  it("mette in titolo l'azione, non l'oggetto grezzo dell'email", () => {
    const d = decisioneDaComunicazione(comunicazione());
    expect(d.azione).toBe("Collega l'email a COM-2026-333 — Galastri Giada");
    // L'oggetto resta, ma come provenienza: è da dove viene, non cosa si fa.
    expect(d.azione).not.toContain("2678C25B58");
    expect(d.provenienza).toContain("«PRIMED ticket # 2678C25B58 # RITIRO RIPARAZIONI»");
    expect(d.provenienza).toContain("riparazioni@primed.it");
  });

  it("il motivo è in chiaro, non da aprire", () => {
    expect(decisioneDaComunicazione(comunicazione()).perche).toBe(
      "L'articolo «Giada» combacia con l'unica commessa candidata."
    );
  });

  it("senza motivo ripiega sul riepilogo del messaggio", () => {
    const d = decisioneDaComunicazione(
      comunicazione({ collegamento: { commessaId: 333, motivo: "  " } })
    );
    expect(d.perche).toBe("Primed conferma il ritiro delle riparazioni.");
  });

  it("dice WhatsApp quando è WhatsApp", () => {
    const d = decisioneDaComunicazione(comunicazione({ canale: "whatsapp" }));
    expect(d.azione).toBe(
      "Collega il messaggio WhatsApp a COM-2026-333 — Galastri Giada"
    );
  });

  it("gli allegati sono un effetto, con i nomi", () => {
    const d = decisioneDaComunicazione(
      comunicazione({ allegatiDaArchiviare: ["a.pdf", "b.pdf"] })
    );
    expect(d.effetti).toContain("2 allegati nel fascicolo: a.pdf, b.pdf");
  });

  it("l'urgenza alta o critica alza la bandiera, «normale» no", () => {
    expect(decisioneDaComunicazione(comunicazione()).urgente).toBe(false);
    expect(decisioneDaComunicazione(comunicazione({ urgenza: "alta" })).urgente).toBe(true);
    expect(decisioneDaComunicazione(comunicazione({ urgenza: "critica" })).urgente).toBe(true);
  });

  it("una confidenza che non conosciamo non diventa un'etichetta inventata", () => {
    const d = decisioneDaComunicazione(
      comunicazione({ collegamento: { commessaId: 333, confidenza: "boh" } })
    );
    expect(d.fiducia).toBeNull();
  });
});

describe("destinazione della comunicazione", () => {
  it("usa l'etichetta del candidato giusto", () => {
    expect(destinazioneComunicazione(comunicazione())).toBe(
      "COM-2026-333 — Galastri Giada"
    );
  });

  it("collega al cliente quando non c'è commessa", () => {
    const voce = comunicazione({
      collegamento: { clienteId: 51 },
      candidati: [{ tipo: "cliente", id: 51, etichetta: "Galastri Giada" }],
    });
    expect(destinazioneComunicazione(voce)).toBe("Galastri Giada");
    expect(decisioneDaComunicazione(voce).effetti[0]).toContain("cliente");
  });

  it("senza etichetta dice il numero, non inventa un nome", () => {
    expect(
      destinazioneComunicazione(comunicazione({ candidati: [] }))
    ).toBe("commessa n. 333");
  });

  it("senza nessuna destinazione lo dichiara", () => {
    expect(
      destinazioneComunicazione(comunicazione({ collegamento: {}, candidati: [] }))
    ).toBe("una commessa da scegliere");
  });
});

describe("un dato letto da un documento diventa una decisione", () => {
  const base = {
    id: 9,
    etichetta: "Aggiorna la data di consegna dell'ordine",
    effetto: "Consegna prevista dell'ordine 41 da 12/09 a 19/09.",
    motivazione: "La conferma d'ordine Oknoplast riporta il 19/09.",
    valoreCorrente: "12/09/2026",
    valoreProposto: "19/09/2026",
    documentoNome: "Conferma_ordine_41.pdf",
    creataIl: "2026-09-08T19:28:00.000Z",
  };

  it("il valore che cambia è strutturato, non una frase", () => {
    const d = decisioneDaDocumento(base);
    expect(d.cambio).toEqual({ da: "12/09/2026", a: "19/09/2026" });
    // Con il «prima → dopo» in evidenza, l'effetto a parole sarebbe la
    // stessa cosa scritta due volte.
    expect(d.effetti).toEqual([]);
    expect(d.verbo).toBe("Applica");
  });

  it("senza un valore che cambia resta l'effetto a parole", () => {
    const d = decisioneDaDocumento({ ...base, valoreCorrente: null, valoreProposto: null });
    expect(d.cambio).toBeNull();
    expect(d.effetti).toEqual([base.effetto]);
  });

  it("un valore proposto uguale a quello corrente non è un cambio", () => {
    const d = decisioneDaDocumento({ ...base, valoreProposto: "12/09/2026" });
    expect(d.cambio).toBeNull();
  });
});

describe("un consiglio dell'analisi diventa una decisione", () => {
  const consiglio = {
    testo: "Aprire il ticket post-vendita per il reclamo WnD fermo da 183 giorni.",
    richiestaPerTars: "Crea un ticket urgente per la commessa 190: reclamo WnD",
    entita: [
      { riferimento: "commessa:190", etichetta: "COM-2026-190", link: "/commesse/190" },
    ],
    azione: { strumento: "crea_ticket" },
  };

  it("il titolo è cosa succede, il consiglio diventa il motivo", () => {
    const d = decisioneDaConsiglio(consiglio, 1);
    expect(d.azione).toBe("Crea un ticket urgente per la commessa 190: reclamo WnD");
    expect(d.perche).toBe(consiglio.testo);
    expect(d.verbo).toBe("Esegui");
    expect(d.effetti[0]).toContain("crea ticket");
    expect(d.effetti[0]).toContain("Registro");
  });

  it("senza strumento il gesto è aprire la chat, e lo dice", () => {
    const d = decisioneDaConsiglio({ ...consiglio, azione: null }, 0);
    expect(d.verbo).toBe("Apri in chat");
    expect(d.effetti[0]).toContain("niente cambia");
  });

  it("porta con sé le entità con i loro link", () => {
    expect(decisioneDaConsiglio(consiglio, 0).riguarda).toEqual([
      { etichetta: "COM-2026-190", link: "/commesse/190" },
    ]);
  });

  it("la chiave distingue due consigli identici in posizioni diverse", () => {
    expect(decisioneDaConsiglio(consiglio, 0).chiave).not.toBe(
      decisioneDaConsiglio(consiglio, 1).chiave
    );
  });
});

describe("dettagli di forma", () => {
  it("l'ora è quella di Roma, non quella della macchina", () => {
    expect(quandoBreve("2026-09-08T19:28:00.000Z")).toBe("08/09, 21:28");
  });

  it("una data impossibile non stampa «Invalid Date»", () => {
    expect(quandoBreve("non una data")).toBeNull();
    expect(quandoBreve(null)).toBeNull();
  });

  it("oltre due allegati si contano invece di elencarli tutti", () => {
    expect(fraseAllegati(["a.pdf", "b.pdf", "c.pdf", "d.pdf"])).toBe(
      "4 allegati nel fascicolo: a.pdf, b.pdf e altri 2"
    );
    expect(fraseAllegati([])).toBeNull();
  });

  it("il titolo della coda conta le righe che si vedono", () => {
    expect(titoloCoda(0)).toBe("Nessuna decisione in attesa");
    expect(titoloCoda(1)).toBe("1 decisione in attesa");
    expect(titoloCoda(5)).toBe("5 decisioni in attesa");
  });
});
