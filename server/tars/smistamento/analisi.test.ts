// Analisi dello smistamento: il modello (finto) propone, il server
// verifica — id fuori dai candidati ignorati, allegati inesistenti
// ignorati, importi scrubbati, JSON rotto = errore tipizzato; il
// percorso deterministico produce le stesse forme.

import { describe, expect, it } from "vitest";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import { creaProviderFinto, rispostaTesto } from "../openai/fake";
import type { RichiestaProvider } from "../provider";
import {
  analisiDeterministica,
  analizzaConModello,
  costruisciInputModello,
  senzaImportiEuro,
} from "./analisi";
import type { CandidatoCollegamento } from "./types";

function comunicazione(parziale: Partial<Comunicazione> = {}): Comunicazione {
  return {
    id: 501,
    sedeId: 1,
    casellaId: 1,
    messageId: "m-501",
    uid: null,
    canale: "email",
    direzione: "in",
    mittente: "cliente@example.test",
    mittenteNome: "Paolo Gallo",
    destinatari: ["info@azienda.test"],
    oggetto: "Preventivo finestre",
    testo: "Buongiorno, vorrei ricevere un preventivo per 4 finestre in PVC. Grazie",
    allegati: [{ nome: "planimetria.pdf", mimeType: "application/pdf", size: 120_000 }],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    deletedAt: null,
    tarsAnalizzata: false,
    categoria: "da_classificare",
    classificazioneScore: 0,
    classificazioneMotivo: null,
    classificazioneFonte: "regole",
    tarsRiepilogo: null,
    tarsIstruzione: null,
    tarsUltimaAnalisiAt: null,
    receivedAt: new Date("2026-09-02T08:00:00Z"),
    createdAt: new Date("2026-09-02T08:00:00Z"),
    ...parziale,
  };
}

const CANDIDATI: CandidatoCollegamento[] = [
  { tipo: "commessa", id: 10, etichetta: "COM-2026-101 — Gallo Paolo", punteggio: 80, motivi: ["Mittente di Gallo Paolo."] },
  { tipo: "cliente", id: 1, etichetta: "Gallo Paolo", punteggio: 85, motivi: ["Mittente di Gallo Paolo."] },
];

const SEGNALI = { interno: false, inoltro: false, mittenteOriginale: null };
const ALLEGATI = [
  { indice: 0, nome: "planimetria.pdf", mimeType: "application/pdf", size: 120_000, testo: "Pianta piano terra scala 1:100", stato: "testo" as const },
];

function rispostaModello(sovrascrivi: Record<string, unknown> = {}) {
  return JSON.stringify({
    categoria: "nuovo_lead",
    urgenza: "alta",
    riepilogo: "Il cliente chiede un preventivo per 4 finestre in PVC, budget 3.500 €.",
    richiedeRisposta: true,
    azioneSuggerita: "rispondi",
    istruzione: "Rispondere con una proposta di sopralluogo.",
    collegamento: { tipo: "commessa", id: 10, confidenza: "media", motivo: "Stesso cliente della commessa aperta." },
    allegati: [{ indice: 0, tipo: "planimetria", confidenza: "alta", archiviare: true, motivo: "Pianta dell'immobile." }],
    ...sovrascrivi,
  });
}

const IDENTITA = { runId: "smistamento:1:501", passo: 0, tentativo: 1, conversazioneId: null };

describe("costruisciInputModello", () => {
  it("elenca candidati con id e motivi, allegati con testo fra marcatori, testo della comunicazione", () => {
    const testo = costruisciInputModello({
      comunicazione: comunicazione(),
      candidati: CANDIDATI,
      segnali: SEGNALI,
      allegati: ALLEGATI,
      contestoCandidati: new Map([[10, { stato: "preventivo", cliente: "Gallo Paolo" }]]),
    });
    expect(testo).toContain("commessa id=10");
    expect(testo).toContain("[stato: preventivo]");
    expect(testo).toContain("<<<TESTO ALLEGATO 0>>>");
    expect(testo).toContain("Pianta piano terra");
    expect(testo).toContain("<<<TESTO COMUNICAZIONE>>>");
    expect(testo).toContain("vorrei ricevere un preventivo");
  });
});

describe("analizzaConModello", () => {
  it("manda output strutturato e nessuno strumento; verifica gli id e scrubba gli importi", async () => {
    let richiestaVista: RichiestaProvider | null = null;
    const provider = creaProviderFinto(richiesta => {
      richiestaVista = richiesta;
      return rispostaTesto(rispostaModello());
    });
    const esito = await analizzaConModello({
      comunicazione: comunicazione(),
      candidati: CANDIDATI,
      segnali: SEGNALI,
      allegati: ALLEGATI,
      provider,
      modello: "gpt-5.6-terra",
      identita: IDENTITA,
    });
    expect(richiestaVista!.formatoJson?.nome).toBe("smistamento_comunicazione");
    expect(richiestaVista!.strumenti).toEqual([]);
    expect(richiestaVista!.chiaveCachePrompt.length).toBeLessThanOrEqual(64);
    expect(esito.fonte).toBe("modello");
    expect(esito.categoria).toBe("nuovo_lead");
    expect(esito.collegamento).toMatchObject({ tipo: "commessa", id: 10, confidenza: "media" });
    expect(esito.riepilogo).not.toContain("3.500");
    expect(esito.riepilogo).toContain("un importo");
    expect(esito.allegati[0]).toMatchObject({ indice: 0, tipo: "planimetria", archiviareSecondoModello: true });
  });

  it("un id non fra i candidati viene ignorato con avvertenza; un allegato inesistente pure", async () => {
    const provider = creaProviderFinto(() =>
      rispostaTesto(
        rispostaModello({
          collegamento: { tipo: "commessa", id: 999, confidenza: "alta", motivo: "inventato" },
          allegati: [{ indice: 7, tipo: "fattura", confidenza: "alta", archiviare: true, motivo: "x" }],
        })
      )
    );
    const esito = await analizzaConModello({
      comunicazione: comunicazione(),
      candidati: CANDIDATI,
      segnali: SEGNALI,
      allegati: ALLEGATI,
      provider,
      modello: "gpt-5.6-terra",
      identita: IDENTITA,
    });
    expect(esito.collegamento).toBeNull();
    expect(esito.allegati).toEqual([]);
    expect(esito.avvertenze.join(" ")).toContain("999");
    expect(esito.avvertenze.join(" ")).toContain("Allegato 7");
  });

  it("JSON rotto o fuori schema = errore tipizzato, mai un esito inventato", async () => {
    const rotto = creaProviderFinto(() => rispostaTesto("{non json"));
    await expect(
      analizzaConModello({
        comunicazione: comunicazione(),
        candidati: CANDIDATI,
        segnali: SEGNALI,
        allegati: ALLEGATI,
        provider: rotto,
        modello: "gpt-5.6-terra",
        identita: IDENTITA,
      })
    ).rejects.toThrow(/SMISTAMENTO_RISPOSTA_INVALIDA/);
    const fuoriSchema = creaProviderFinto(() =>
      rispostaTesto(rispostaModello({ categoria: "categoria_inventata" }))
    );
    await expect(
      analizzaConModello({
        comunicazione: comunicazione(),
        candidati: CANDIDATI,
        segnali: SEGNALI,
        allegati: ALLEGATI,
        provider: fuoriSchema,
        modello: "gpt-5.6-terra",
        identita: IDENTITA,
      })
    ).rejects.toThrow(/SMISTAMENTO_RISPOSTA_INVALIDA/);
  });
});

describe("analisiDeterministica", () => {
  it("riconosce un nuovo lead dalle regole, collega il candidato nettamente migliore e classifica gli allegati", () => {
    const esito = analisiDeterministica({
      // Oggetto neutro: il classificatore lessicale pesa l'oggetto quanto
      // il nome file, e «Preventivo…» vincerebbe su «planimetria.pdf».
      comunicazione: comunicazione({ oggetto: "Richiesta informazioni" }),
      candidati: [CANDIDATI[1], { ...CANDIDATI[0], punteggio: 40 }],
      segnali: SEGNALI,
      allegati: ALLEGATI,
    });
    expect(esito.fonte).toBe("deterministico");
    expect(esito.categoria).toBe("nuovo_lead");
    expect(esito.richiedeRisposta).toBe(true);
    expect(esito.collegamento).toMatchObject({ tipo: "cliente", id: 1, confidenza: "alta" });
    expect(esito.allegati[0].tipo).toBe("planimetria");
  });

  it("con due candidati vicini non sceglie", () => {
    const esito = analisiDeterministica({
      comunicazione: comunicazione(),
      candidati: [
        { ...CANDIDATI[0], punteggio: 70 },
        { ...CANDIDATI[1], punteggio: 65 },
      ],
      segnali: SEGNALI,
      allegati: [],
    });
    expect(esito.collegamento).toBeNull();
  });
});

describe("senzaImportiEuro", () => {
  it("oscura euro e cifre con separatori, lascia i numeri corti", () => {
    expect(senzaImportiEuro("costo 3.500 € per 4 finestre e 12,50 euro di spese")).toBe(
      "costo un importo per 4 finestre e un importo di spese"
    );
  });
});
