// Effetti dello smistamento sulle comunicazioni in memoria: collegamento
// certo senza toccare lo stato, archiviazione solo con commessa collegata
// e solo per documenti riconosciuti (D2), proposta aperta senza effetti,
// approvazione umana = collegamento manuale (gestita) + archiviazione.

import { describe, expect, it } from "vitest";
import {
  collegaAutomaticoComunicazione,
  getComunicazione,
  insertComunicazione,
  salvaEsitoTarsComunicazione,
  setClassificazioneComunicazione,
  setMatchComunicazione,
  type Comunicazione,
  type NuovaComunicazione,
} from "../../comunicazioni/comunicazioni";
import type { EsitoAnalisi } from "./analisi";
import {
  applicaPropostaApprovata,
  applicaSmistamento,
  pianificaAllegati,
  type DipendenzeApplica,
} from "./applica";
import type { EsitoCandidati } from "./candidati";

const SEDE = 96_301;
let contatore = 1;

async function inserisci(parziale: Partial<NuovaComunicazione> = {}): Promise<Comunicazione> {
  const n = contatore++;
  const riga = await insertComunicazione({
    sedeId: SEDE,
    casellaId: 7,
    messageId: `applica-${n}-${Date.now()}`,
    canale: "email",
    direzione: "in",
    mittente: "cliente@example.test",
    mittenteNome: null,
    destinatari: ["info@azienda.test"],
    oggetto: "Documenti",
    testo: "In allegato il preventivo firmato.",
    allegati: [{ nome: "preventivo_firmato.pdf", mimeType: "application/pdf", size: 90_000 }],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    receivedAt: new Date(),
    ...parziale,
  });
  if (!riga) throw new Error("inserimento fallito");
  return riga;
}

function depsFinte(): DipendenzeApplica & { archiviazioni: any[] } {
  const archiviazioni: any[] = [];
  let prossimoId = 700;
  return {
    archiviazioni,
    leggiRaw: async (c, i) => ({
      buffer: Buffer.from("pdf"),
      nome: c.allegati[i].nome,
      mimeType: c.allegati[i].mimeType,
    }),
    archivia: async args => {
      archiviazioni.push(args);
      return { id: prossimoId++, commessaId: args.commessaId, tipo: args.tipo, nome: args.nome } as any;
    },
    documentoEsistente: () => null,
    leggiCommessa: id =>
      id === 9999 ? null : { id, clienteId: 77, archivedAt: id === 5555 ? new Date() : null },
    collegaAutomatico: collegaAutomaticoComunicazione,
    collegaManuale: setMatchComunicazione,
    classifica: setClassificazioneComunicazione,
    salvaEsito: salvaEsitoTarsComunicazione,
  };
}

const ALLEGATO_PDF = { indice: 0, nome: "preventivo_firmato.pdf", mimeType: "application/pdf", size: 90_000, testo: "Preventivo n. 12 firmato per accettazione", stato: "testo" as const };

function analisi(parziale: Partial<EsitoAnalisi> = {}): EsitoAnalisi {
  return {
    fonte: "modello",
    modello: "gpt-5.6-terra",
    categoria: "operativa",
    urgenza: "normale",
    riepilogo: "Il cliente manda il preventivo firmato.",
    richiedeRisposta: false,
    azioneSuggerita: "archivia_allegati",
    istruzione: "Verificare la firma e procedere.",
    collegamento: null,
    allegati: [{ indice: 0, tipo: "preventivo", confidenza: "alta", archiviareSecondoModello: true, motivo: "Preventivo firmato." }],
    avvertenze: [],
    ...parziale,
  };
}

function candidati(parziale: Partial<EsitoCandidati> = {}): EsitoCandidati {
  return {
    certo: null,
    candidati: [],
    segnali: { interno: false, inoltro: false, mittenteOriginale: null },
    ...parziale,
  };
}

describe("applicaSmistamento", () => {
  it("una mail vecchia con una CONFERMA D'ORDINE resta una proposta: il fascicolo la aspetta (04/09/2026)", async () => {
    const sessantaGiorniFa = new Date(Date.now() - 60 * 86_400_000);
    const conConferma = await inserisci({
      receivedAt: sessantaGiorniFa,
      mittente: "ordini@fornitore.test",
      allegati: [{ nome: "Conferma_ordine_88.pdf", mimeType: "application/pdf", size: 40_000 }],
    });
    const proposta = await applicaSmistamento({
      comunicazione: conConferma,
      candidati: candidati({
        candidati: [{ tipo: "commessa", id: 4343, etichetta: "COM-2026-333 — Galastri Giada", punteggio: 70, motivi: ["Il testo del file cita cliente galastri."] }],
      }),
      analisi: analisi({
        collegamento: { tipo: "commessa", id: 4343, confidenza: "media", motivo: "La conferma cita la cliente." },
        allegati: [{ indice: 0, tipo: "conferma_ordine", confidenza: "alta", archiviareSecondoModello: true, motivo: "Conferma del fornitore." }],
      }),
      allegati: [{ indice: 0, nome: "Conferma_ordine_88.pdf", mimeType: "application/pdf", size: 40_000, testo: "Conferma d'ordine n. 88 Vs. rif. Galastri", stato: "testo" }],
      deps: depsFinte(),
    });
    expect(proposta.propostaStato).toBe("aperta");
    expect(proposta.esito.allegati[0]).toMatchObject({ tipo: "conferma_ordine", archiviare: true });

    // Senza conferma, la stessa età chiude la porta come prima.
    const senza = await inserisci({ receivedAt: sessantaGiorniFa });
    const niente = await applicaSmistamento({
      comunicazione: senza,
      candidati: candidati({
        candidati: [{ tipo: "commessa", id: 4343, etichetta: "COM-2026-333 — Galastri Giada", punteggio: 70, motivi: [] }],
      }),
      analisi: analisi({
        collegamento: { tipo: "commessa", id: 4343, confidenza: "media", motivo: "Coerente." },
      }),
      allegati: [ALLEGATO_PDF],
      deps: depsFinte(),
    });
    expect(niente.propostaStato).toBe("nessuna");
    expect(niente.esito.collegamento.motivo).toContain("giorni fa");
  });

  it("collegamento CERTO: aggancia senza cambiare lo stato, archivia il documento riconosciuto, scrive il triage", async () => {
    const c = await inserisci();
    const deps = depsFinte();
    const esito = await applicaSmistamento({
      comunicazione: c,
      candidati: candidati({ certo: { commessaId: 4242, clienteId: 77, motivo: "Il codice COM-2026-042 compare nel messaggio." } }),
      analisi: analisi(),
      allegati: [ALLEGATO_PDF],
      deps,
    });
    expect(esito.propostaStato).toBe("nessuna");
    expect(esito.esito.collegamento).toMatchObject({ esito: "certo", commessaId: 4242 });
    expect(esito.esito.archiviati).toHaveLength(1);
    expect(deps.archiviazioni[0]).toMatchObject({ commessaId: 4242, tipo: "preventivo", vietaRiassegnazione: true });
    expect(String(deps.archiviazioni[0].note)).toContain("automaticamente");

    const dopo = (await getComunicazione(c.id, SEDE))!;
    expect(dopo.commessaId).toBe(4242);
    expect(dopo.stato).toBe("nuova"); // nessun umano l'ha gestita
    expect(dopo.matchMotivo).toContain("Smistamento Tars");
    expect(dopo.categoria).toBe("operativa");
    expect(dopo.classificazioneFonte).toBe("tars");
    expect(dopo.tarsRiepilogo).toContain("preventivo firmato");
    expect(dopo.tarsIstruzione).toContain("Archiviati nel fascicolo: 1");
  });

  it("collegamento SICURO dal modello: confidenza alta + unico candidato commessa → aggancia da solo e archivia", async () => {
    const c = await inserisci();
    const deps = depsFinte();
    const esito = await applicaSmistamento({
      comunicazione: c,
      candidati: candidati({
        candidati: [
          { tipo: "commessa", id: 4343, etichetta: "COM-2026-333 — Galastri Giada", punteggio: 45, motivi: ["Unica commessa attiva della cliente."] },
          { tipo: "cliente", id: 77, etichetta: "Galastri Giada", punteggio: 60, motivi: ["Mittente noto."] },
        ],
      }),
      analisi: analisi({
        collegamento: { tipo: "commessa", id: 4343, confidenza: "alta", motivo: "Il riferimento all'articolo Giada è coerente con l'unica commessa della cliente." },
      }),
      allegati: [ALLEGATO_PDF],
      deps,
    });
    expect(esito.propostaStato).toBe("nessuna");
    expect(esito.esito.collegamento).toMatchObject({ esito: "certo", commessaId: 4343, clienteId: 77 });
    expect(esito.esito.collegamento.motivo).toContain("candidato unico verificato");
    expect(esito.esito.archiviati).toHaveLength(1);
    expect((await getComunicazione(c.id, SEDE))!.commessaId).toBe(4343);
  });

  it("modello sicuro ma due commesse vicine, punteggio basso, commessa archiviata o inesistente → resta PROPOSTA", async () => {
    const casi = [
      { nome: "rivale vicina", id: 4444, lista: [{ tipo: "commessa" as const, id: 4444, etichetta: "A", punteggio: 50, motivi: [] }, { tipo: "commessa" as const, id: 4445, etichetta: "B", punteggio: 40, motivi: [] }] },
      { nome: "punteggio basso", id: 4446, lista: [{ tipo: "commessa" as const, id: 4446, etichetta: "C", punteggio: 20, motivi: [] }] },
      { nome: "archiviata", id: 5555, lista: [{ tipo: "commessa" as const, id: 5555, etichetta: "D", punteggio: 70, motivi: [] }] },
      { nome: "inesistente", id: 9999, lista: [{ tipo: "commessa" as const, id: 9999, etichetta: "E", punteggio: 70, motivi: [] }] },
    ];
    for (const caso of casi) {
      const c = await inserisci();
      const esito = await applicaSmistamento({
        comunicazione: c,
        candidati: candidati({ candidati: caso.lista }),
        analisi: analisi({ collegamento: { tipo: "commessa", id: caso.id, confidenza: "alta", motivo: `Caso ${caso.nome}.` } }),
        allegati: [ALLEGATO_PDF],
        deps: depsFinte(),
      });
      expect(esito.propostaStato, caso.nome).toBe("aperta");
      expect(esito.esito.collegamento.esito, caso.nome).toBe("proposto");
      expect((await getComunicazione(c.id, SEDE))!.commessaId, caso.nome).toBeNull();
    }
  });

  it("un candidato SOLO cliente si propone soltanto a confidenza alta; a media non è una proposta", async () => {
    const lista = [{ tipo: "cliente" as const, id: 420, etichetta: "Baldacci Marco", punteggio: 65, motivi: ["Nel messaggio compare «baldacci»."] }];
    const media = await applicaSmistamento({
      comunicazione: await inserisci(),
      candidati: candidati({ candidati: lista }),
      analisi: analisi({ collegamento: { tipo: "cliente", id: 420, confidenza: "media", motivo: "Il riferimento contiene il cognome Baldacci." } }),
      allegati: [],
      deps: depsFinte(),
    });
    expect(media.propostaStato).toBe("nessuna");
    expect(media.esito.collegamento.esito).toBe("nessuno");
    const alta = await applicaSmistamento({
      comunicazione: await inserisci(),
      candidati: candidati({ candidati: lista }),
      analisi: analisi({ collegamento: { tipo: "cliente", id: 420, confidenza: "alta", motivo: "Il preventivo allegato è intestato a Baldacci Marco." } }),
      allegati: [],
      deps: depsFinte(),
    });
    expect(alta.propostaStato).toBe("aperta");
    expect(alta.esito.collegamento).toMatchObject({ esito: "proposto", clienteId: 420, commessaId: null });
  });

  it("collegamento PROPOSTO: nessun effetto sulla comunicazione, proposta aperta, niente archiviazione", async () => {
    const c = await inserisci();
    const deps = depsFinte();
    const esito = await applicaSmistamento({
      comunicazione: c,
      candidati: candidati({
        candidati: [{ tipo: "commessa", id: 4243, etichetta: "COM-2026-043", punteggio: 70, motivi: ["Cognome nel testo."] }],
      }),
      analisi: analisi({ collegamento: { tipo: "commessa", id: 4243, confidenza: "media", motivo: "Stesso cognome e argomento." } }),
      allegati: [ALLEGATO_PDF],
      deps,
    });
    expect(esito.propostaStato).toBe("aperta");
    expect(esito.esito.collegamento).toMatchObject({ esito: "proposto", commessaId: 4243 });
    expect(esito.esito.azioneSuggerita).toBe("collega");
    expect(deps.archiviazioni).toHaveLength(0);
    const dopo = (await getComunicazione(c.id, SEDE))!;
    expect(dopo.commessaId).toBeNull();
    expect(dopo.tarsIstruzione).toContain("Proposta:");
  });

  it("un collegamento certo non sovrascrive una commessa già collegata a mano", async () => {
    const c = await inserisci({ commessaId: 1, clienteId: 1, matchConfidenza: "alta", matchMotivo: "Collegata a mano." });
    const deps = depsFinte();
    const esito = await applicaSmistamento({
      comunicazione: c,
      candidati: candidati({ certo: { commessaId: 4244, clienteId: null, motivo: "codice" } }),
      analisi: analisi({ allegati: [] }),
      allegati: [],
      deps,
    });
    expect(esito.esito.collegamento.commessaId).toBe(1);
    expect((await getComunicazione(c.id, SEDE))!.commessaId).toBe(1);
  });

  it("approvazione umana: collegamento manuale (gestita, motivo con il nome) e archiviazione pianificata", async () => {
    const c = await inserisci();
    const deps = depsFinte();
    const proposta = await applicaSmistamento({
      comunicazione: c,
      candidati: candidati({ candidati: [{ tipo: "commessa", id: 4245, etichetta: "COM-2026-045", punteggio: 70, motivi: ["x"] }] }),
      analisi: analisi({ collegamento: { tipo: "commessa", id: 4245, confidenza: "media", motivo: "m" } }),
      allegati: [ALLEGATO_PDF],
      deps,
    });
    const approvata = await applicaPropostaApprovata({
      comunicazione: (await getComunicazione(c.id, SEDE))!,
      esito: proposta.esito,
      utente: { id: 9, nome: "Timothy" },
      deps,
    });
    expect(approvata.esito.collegamento).toMatchObject({ esito: "certo", commessaId: 4245 });
    expect(approvata.esito.archiviati).toHaveLength(1);
    expect(deps.archiviazioni[0]).toMatchObject({ commessaId: 4245, createdBy: 9 });
    const dopo = (await getComunicazione(c.id, SEDE))!;
    expect(dopo.commessaId).toBe(4245);
    expect(dopo.stato).toBe("gestita");
    expect(dopo.matchMotivo).toContain("approvato da Timothy");
  });
});

describe("pianificaAllegati (D2)", () => {
  const base = { id: 1, sedeId: SEDE, canale: "email" as const, oggetto: "Documenti" } as Comunicazione;

  it("una conferma d'ordine si archivia solo se il TESTO cita la commessa: l'oggetto non basta (04/09/2026)", async () => {
    const conferma = { indice: 0, tipo: "conferma_ordine" as const, confidenza: "alta" as const, archiviareSecondoModello: true, motivo: "" };
    const allegato = { ...ALLEGATO_PDF, nome: "Ordini_di_Vendi_1602923(1).pdf", testo: "Conferma Ordine ALIAS" };

    const c = await inserisci();
    const deps = depsFinte();
    let chiamate = 0;
    deps.verificaConferma = async () => {
      chiamate += 1;
      return { ok: false, motivo: "Il documento non cita la commessa: né il codice, né il cliente.", prove: [], testoLetto: true, duplicatoDi: null };
    };
    const esito = await applicaSmistamento({
      comunicazione: c,
      candidati: candidati({ certo: { commessaId: 4242, clienteId: 77, motivo: "Nell'oggetto compare il cognome di Giacomazzi Giulia." } }),
      analisi: analisi({ allegati: [conferma] }),
      allegati: [allegato],
      deps,
    });
    expect(chiamate).toBe(1);
    expect(deps.archiviazioni).toHaveLength(0);
    expect(esito.esito.archiviati).toHaveLength(0);
    expect(esito.esito.allegati[0]).toMatchObject({ archiviare: false });
    expect(esito.esito.allegati[0].motivo).toContain("non cita");

    // Con il riscontro nel testo si archivia, e la nota dice cosa cita.
    deps.verificaConferma = async () => ({ ok: true, motivo: "Il documento cita cliente giacomazzi.", prove: ["cliente giacomazzi"], testoLetto: true, duplicatoDi: null });
    const c2 = await inserisci();
    const esito2 = await applicaSmistamento({
      comunicazione: c2,
      candidati: candidati({ certo: { commessaId: 4242, clienteId: 77, motivo: "Nell'oggetto compare il cognome di Giacomazzi Giulia." } }),
      analisi: analisi({ allegati: [conferma] }),
      allegati: [allegato],
      deps,
    });
    expect(esito2.esito.archiviati).toHaveLength(1);
    expect(deps.archiviazioni).toHaveLength(1);
    expect(deps.archiviazioni[0]).toMatchObject({ tipo: "conferma_ordine", origine: "smistamento" });
    expect(String(deps.archiviazioni[0].note)).toContain("cita cliente giacomazzi");
  });

  it("un documento «altro» non si archivia; modello e regole discordi su un tipo forte nemmeno", () => {
    const piano = pianificaAllegati({
      comunicazione: base,
      allegati: [
        { indice: 0, nome: "allegato.pdf", mimeType: "application/pdf", size: 5_000, testo: null, stato: "non_letto" },
        { indice: 1, nome: "qualcosa.pdf", mimeType: "application/pdf", size: 5_000, testo: null, stato: "non_letto" },
      ],
      analisi: analisi({
        allegati: [
          { indice: 0, tipo: "altro", confidenza: "alta", archiviareSecondoModello: true, motivo: "" },
          { indice: 1, tipo: "fattura", confidenza: "media", archiviareSecondoModello: true, motivo: "" },
        ],
      }),
    });
    expect(piano[0].archiviare).toBe(false);
    expect(piano[1].archiviare).toBe(false);
    expect(piano[1].motivo).toContain("non concordano");
  });

  it("immagini: firme piccole mai; foto grandi solo da WhatsApp", () => {
    const analisiFoto = analisi({
      allegati: [
        { indice: 0, tipo: "foto", confidenza: "alta", archiviareSecondoModello: true, motivo: "cantiere" },
        { indice: 1, tipo: "altro", confidenza: "alta", archiviareSecondoModello: false, motivo: "logo" },
      ],
    });
    const allegati = [
      { indice: 0, nome: "IMG_1.jpg", mimeType: "image/jpeg", size: 400_000, testo: null, stato: "immagine" as const },
      { indice: 1, nome: "logo.png", mimeType: "image/png", size: 4_000, testo: null, stato: "immagine" as const },
    ];
    const daEmail = pianificaAllegati({ comunicazione: base, allegati, analisi: analisiFoto });
    expect(daEmail.map(p => p.archiviare)).toEqual([false, false]);
    const daWhatsApp = pianificaAllegati({
      comunicazione: { ...base, canale: "whatsapp" },
      allegati,
      analisi: analisiFoto,
    });
    expect(daWhatsApp.map(p => p.archiviare)).toEqual([true, false]);
  });
});

describe("niente proposte su lavoro morto (02/09 notte)", () => {
  it("una comunicazione di 45 giorni fa non diventa una proposta; una già gestita nemmeno; i collegamenti certi restano", async () => {
    const lista = [{ tipo: "commessa" as const, id: 4747, etichetta: "COM-2026-047 — Vecchia Mail", punteggio: 50, motivi: [] }];
    const proposta = { tipo: "commessa" as const, id: 4747, confidenza: "media" as const, motivo: "Riferimento plausibile." };
    const vecchia = await applicaSmistamento({
      comunicazione: await inserisci({ receivedAt: new Date(Date.now() - 45 * 86_400_000) }),
      candidati: candidati({ candidati: lista }),
      analisi: analisi({ collegamento: proposta }),
      allegati: [],
      deps: depsFinte(),
    });
    expect(vecchia.propostaStato).toBe("nessuna");
    expect(vecchia.esito.collegamento.esito).toBe("nessuno");
    expect(vecchia.esito.collegamento.motivo).toMatch(/45 giorni fa/);

    const gestita = await applicaSmistamento({
      comunicazione: await inserisci({ stato: "gestita" }),
      candidati: candidati({ candidati: lista }),
      analisi: analisi({ collegamento: proposta }),
      allegati: [],
      deps: depsFinte(),
    });
    expect(gestita.propostaStato).toBe("nessuna");
    expect(gestita.esito.collegamento.motivo).toMatch(/già gestita/);

    const recente = await applicaSmistamento({
      comunicazione: await inserisci(),
      candidati: candidati({ candidati: lista }),
      analisi: analisi({ collegamento: proposta }),
      allegati: [],
      deps: depsFinte(),
    });
    expect(recente.propostaStato).toBe("aperta");

    // Un verdetto certo su una mail vecchia si applica lo stesso: è un fatto, non una proposta.
    const certaVecchia = await applicaSmistamento({
      comunicazione: await inserisci({ receivedAt: new Date(Date.now() - 45 * 86_400_000) }),
      candidati: candidati({ certo: { commessaId: 4848, clienteId: 77, motivo: "Codice nel testo." } }),
      analisi: analisi(),
      allegati: [],
      deps: depsFinte(),
    });
    expect(certaVecchia.esito.collegamento.esito).toBe("certo");
  });
});
