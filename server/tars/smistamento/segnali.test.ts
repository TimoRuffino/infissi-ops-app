// Segnali dello smistamento per il Centro Azioni: una proposta aperta →
// caso «decisione» sulla comunicazione (mai fuso col caso della commessa
// proposta); una richiesta con risposta attesa e nessuna uscita dopo
// 24 h → caso «risposta»; spam, gestite e già risposte non producono nulla.

import { describe, expect, it } from "vitest";
import type { Comunicazione } from "../../comunicazioni/comunicazioni";
import { creaRepositorySmistamentoMemoriaPerTest } from "./repository";
import { segnaliSmistamento } from "./segnali";
import type { EsitoSmistamento } from "./types";

const SEDE = 5;
const ORA = new Date("2026-09-02T12:00:00Z");

function comunicazione(parziale: Partial<Comunicazione>): Comunicazione {
  return {
    id: 1,
    sedeId: SEDE,
    casellaId: 1,
    messageId: "m",
    uid: null,
    canale: "email",
    direzione: "in",
    mittente: "cliente@example.test",
    mittenteNome: "Paolo Gallo",
    destinatari: ["info@azienda.test"],
    oggetto: "Preventivo finestre",
    testo: "",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "vista",
    deletedAt: null,
    tarsAnalizzata: true,
    categoria: "nuovo_lead",
    classificazioneScore: 90,
    classificazioneMotivo: null,
    classificazioneFonte: "tars",
    tarsRiepilogo: null,
    tarsIstruzione: null,
    tarsUltimaAnalisiAt: null,
    receivedAt: new Date("2026-08-31T09:00:00Z"),
    createdAt: new Date("2026-08-31T09:00:00Z"),
    ...parziale,
  };
}

function esito(parziale: Partial<EsitoSmistamento> = {}): EsitoSmistamento {
  return {
    versione: "1.0.0",
    fonte: "modello",
    modello: "gpt-5.6-terra",
    categoria: "nuovo_lead",
    urgenza: "alta",
    riepilogo: "Chiede un preventivo.",
    richiedeRisposta: true,
    azioneSuggerita: "rispondi",
    istruzione: "Rispondere.",
    collegamento: { esito: "nessuno", commessaId: null, clienteId: null, confidenza: "bassa", motivo: "" },
    allegati: [],
    archiviati: [],
    candidati: [],
    segnali: { interno: false, inoltro: false, mittenteOriginale: null },
    ...parziale,
  };
}

describe("segnaliSmistamento", () => {
  it("proposta aperta → caso decisione sulla comunicazione, per la direzione; senza commessaId", async () => {
    const repository = creaRepositorySmistamentoMemoriaPerTest();
    await repository.registra({
      comunicazioneId: 1,
      sedeId: SEDE,
      versione: "1.0.0",
      stato: "analizzata",
      esito: esito({
        richiedeRisposta: false,
        collegamento: { esito: "proposto", commessaId: 77, clienteId: 9, confidenza: "media", motivo: "Inoltro dal cliente." },
        candidati: [{ tipo: "commessa", id: 77, etichetta: "COM-2026-077 — Gallo Paolo", punteggio: 80, motivi: [] }],
      }),
      propostaStato: "aperta",
      ultimoErrore: null,
      now: ORA,
    });
    const segnali = await segnaliSmistamento(SEDE, ORA, {
      repository,
      comunicazione: async () => comunicazione({ id: 1 }),
      rispostaEsiste: async () => false,
    });
    expect(segnali).toHaveLength(1);
    expect(segnali[0]).toMatchObject({
      kind: "comunicazione_decisione",
      targetType: "comunicazione",
      targetId: 1,
      commessaId: null,
      targetRole: "direzione",
    });
    expect(segnali[0].title).toContain("COM-2026-077");
    expect(segnali[0].link).toBe("/messaggi/email?messaggio=1");
  });

  it("richiesta con risposta attesa e nessuna uscita dopo 24h → caso risposta; già risposta o gestita → niente", async () => {
    const repository = creaRepositorySmistamentoMemoriaPerTest();
    for (const id of [1, 2, 3, 4]) {
      await repository.registra({
        comunicazioneId: id,
        sedeId: SEDE,
        versione: "1.0.0",
        stato: "analizzata",
        esito: esito(id === 4 ? { categoria: "spam", richiedeRisposta: true } : {}),
        propostaStato: "nessuna",
        ultimoErrore: null,
        now: ORA,
      });
    }
    const segnali = await segnaliSmistamento(SEDE, ORA, {
      repository,
      comunicazione: async id =>
        comunicazione({
          id,
          stato: id === 3 ? "gestita" : "vista",
          receivedAt: id === 2 ? new Date("2026-09-02T11:30:00Z") : new Date("2026-08-30T09:00:00Z"),
        }),
      // Solo la #1 è davvero senza risposta; la #2 è troppo recente; la #3
      // è gestita; la #4 è spam.
      rispostaEsiste: async () => false,
    });
    expect(segnali.map(s => s.targetId)).toEqual([1]);
    expect(segnali[0]).toMatchObject({ kind: "comunicazione_risposta", targetRole: "commerciale", priority: "alta" });
    expect(segnali[0].title).toContain("Senza risposta da 3 giorni");

    const conRisposta = await segnaliSmistamento(SEDE, ORA, {
      repository,
      comunicazione: async id => comunicazione({ id, receivedAt: new Date("2026-08-30T09:00:00Z") }),
      rispostaEsiste: async () => true,
    });
    expect(conRisposta).toEqual([]);
  });
});
