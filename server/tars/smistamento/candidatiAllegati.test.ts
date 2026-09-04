// I candidati che nascono DENTRO gli allegati «da conferma» (04/09/2026):
// la mail del fornitore non dice di chi è, il PDF sì. Un riscontro unico è
// un verdetto certo; più riscontri sono candidati con punteggio; un
// allegato che non è una conferma non si legge; una mail già collegata o
// già certa non si tocca.

import { describe, expect, it } from "vitest";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import type { EsitoRicercaCommessa } from "../documenti/ricercaCommessaNelDocumento";
import type { EsitoCandidati } from "./candidati";
import { candidatiDagliAllegati } from "./worker";

const SEDE = 96_501;

function comunicazione(parziale: Partial<Comunicazione>): Comunicazione {
  return {
    id: 500,
    sedeId: SEDE,
    casellaId: 1,
    messageId: "m-500",
    uid: null,
    canale: "email",
    direzione: "in",
    mittente: "ordini@pailporte.test",
    mittenteNome: "Pail",
    destinatari: ["info@azienda.test"],
    oggetto: "PAIL_2634169 RUFFINO",
    testo: "In allegato l'ordine.",
    allegati: [{ nome: "PAIL_2634169_ORDINE.PDF", mimeType: "application/pdf", size: 10 }],
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
    receivedAt: new Date("2026-09-03T08:00:00Z"),
    createdAt: new Date("2026-09-03T08:00:00Z"),
    ...parziale,
  } as Comunicazione;
}

const COMMESSE = [
  { id: 1, codice: "COM-2026-001", cliente: "Pistone Angelo", clienteId: 11, stato: "produzione" },
  { id: 2, codice: "COM-2026-002", cliente: "Giacomazzi Giulia", clienteId: 12, stato: "da_ordinare" },
  { id: 3, codice: "COM-2026-003", cliente: "Vecchia Tizia", clienteId: 13, stato: "produzione", archivedAt: new Date() },
];

const nessuno: EsitoCandidati = {
  certo: null,
  candidati: [],
  segnali: { interno: false, inoltro: false, mittenteOriginale: null },
};

const leggiRaw = async () => ({ buffer: Buffer.from("pdf"), nome: "x.pdf", mimeType: "application/pdf" });

function ricerca(parziale: Partial<EsitoRicercaCommessa>): EsitoRicercaCommessa {
  return {
    esito: "nessuna",
    commessaId: null,
    candidati: [],
    fonteTesto: "testo_pdf",
    pagine: ["Vs. rif. PISTONE ANGELO"],
    fornitore: "Pail",
    riferimentoOrdine: "2634169",
    motivo: "",
    ...parziale,
  };
}

describe("candidatiDagliAllegati", () => {
  it("riscontro unico nel testo: verdetto certo, un solo candidato a 100, pagine conservate", async () => {
    const letti: string[] = [];
    const esito = await candidatiDagliAllegati({
      comunicazione: comunicazione({}),
      candidati: nessuno,
      commesse: COMMESSE,
      leggiRaw,
      cerca: async sorgente => {
        letti.push(`${sorgente.comunicazioneId}:${sorgente.allegatoIndex}`);
        return ricerca({
          esito: "unica",
          commessaId: 1,
          candidati: [{ commessaId: 1, prove: ["cliente pistone"], forza: "forte", attesaConferma: true }],
        });
      },
    });
    expect(letti).toEqual(["500:0"]);
    expect(esito.candidati.certo).toMatchObject({ commessaId: 1, clienteId: 11 });
    expect(esito.candidati.certo?.motivo).toContain("cita cliente pistone");
    expect(esito.candidati.candidati).toEqual([
      expect.objectContaining({ tipo: "commessa", id: 1, punteggio: 100 }),
    ]);
    expect(esito.letture.get(0)).toEqual(["Vs. rif. PISTONE ANGELO"]);
  });

  it("riscontro ambiguo: candidati con punteggio (forte 70, debole 45) sommati a quelli della mail; archiviate escluse", async () => {
    const esito = await candidatiDagliAllegati({
      comunicazione: comunicazione({}),
      candidati: {
        ...nessuno,
        candidati: [{ tipo: "commessa", id: 2, etichetta: "COM-2026-002 — Giacomazzi Giulia", punteggio: 40, motivi: ["Nel messaggio compare «giacomazzi»."] }],
      },
      commesse: COMMESSE,
      leggiRaw,
      cerca: async () =>
        ricerca({
          esito: "ambigua",
          candidati: [
            { commessaId: 1, prove: ["cliente pistone"], forza: "forte", attesaConferma: true },
            { commessaId: 2, prove: ["cliente ~giacomazi"], forza: "debole", attesaConferma: true },
            { commessaId: 3, prove: ["cliente vecchia"], forza: "forte", attesaConferma: true },
          ],
        }),
    });
    expect(esito.candidati.certo).toBeNull();
    expect(esito.candidati.candidati.map(c => [c.id, c.punteggio])).toEqual([
      [2, 85],
      [1, 70],
    ]);
    expect(esito.candidati.candidati[0].motivi).toHaveLength(2);
    expect(esito.candidati.candidati[1].motivi[0]).toContain("cita cliente pistone");
  });

  it("nessuna lettura se l'allegato non è una conferma, se la mail è già collegata o se c'è già un verdetto certo", async () => {
    let letture = 0;
    const cerca = async () => {
      letture += 1;
      return ricerca({ esito: "unica", commessaId: 1, candidati: [{ commessaId: 1, prove: ["cliente pistone"], forza: "forte", attesaConferma: true }] });
    };
    await candidatiDagliAllegati({
      comunicazione: comunicazione({ allegati: [{ nome: "fattura_123.pdf", mimeType: "application/pdf", size: 10 }] }),
      candidati: nessuno,
      commesse: COMMESSE,
      leggiRaw,
      cerca,
    });
    await candidatiDagliAllegati({
      comunicazione: comunicazione({ commessaId: 2 }),
      candidati: nessuno,
      commesse: COMMESSE,
      leggiRaw,
      cerca,
    });
    const giaCerta = await candidatiDagliAllegati({
      comunicazione: comunicazione({}),
      candidati: { ...nessuno, certo: { commessaId: 2, clienteId: 12, motivo: "Il codice compare nel messaggio." } },
      commesse: COMMESSE,
      leggiRaw,
      cerca,
    });
    expect(letture).toBe(0);
    expect(giaCerta.candidati.certo?.commessaId).toBe(2);
  });

  it("un lettore che fallisce non ferma lo smistamento: candidati della mail intatti", async () => {
    const esito = await candidatiDagliAllegati({
      comunicazione: comunicazione({}),
      candidati: nessuno,
      commesse: COMMESSE,
      leggiRaw,
      cerca: async () => {
        throw new Error("storage non raggiungibile");
      },
    });
    expect(esito.candidati).toEqual(nessuno);
    expect(esito.letture.size).toBe(0);
  });
});
