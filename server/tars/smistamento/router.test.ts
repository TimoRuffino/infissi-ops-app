// Endpoint dello smistamento e sezione del briefing: fail-closed sul
// flag, capability, sede; approvazione = collegamento manuale + registro
// aggiornato; rifiuto = solo registro; doppia decisione = CONFLICT.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import {
  getComunicazione,
  insertComunicazione,
} from "../../comunicazioni/comunicazioni";
import { appRouter } from "../../routers";
import { getUtentiStore } from "../../routers/utenti";
import { azzeraArchivioPerTest } from "../archivio";
import {
  creaRepositorySmistamentoMemoriaPerTest,
  impostaRepositorySmistamentoPerTest,
  type RepositorySmistamento,
} from "./repository";
import type { EsitoSmistamento } from "./types";

const SEDE = 96_501;
const ALTRA_SEDE = 96_502;
const DIREZIONE_ID = 96_511;
const POSA_ID = 96_512;
const COMMERCIALE_A = 96_513;
const COMMERCIALE_B = 96_514;
const AMMINISTRAZIONE_ID = 96_515;

for (const [id, ruoli] of [
  [DIREZIONE_ID, ["direzione"]],
  [POSA_ID, ["squadra_posa"]],
  [COMMERCIALE_A, ["commerciale"]],
  [COMMERCIALE_B, ["commerciale"]],
  [AMMINISTRAZIONE_ID, ["amministrazione"]],
] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Nome${id}`,
      cognome: `Cognome${id}`,
      email: `smist-${id}@example.test`,
      attivo: true,
      ruoli: [...ruoli],
      ruolo: ruoli[0],
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(userId: number, roles: string[], sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: userId,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) =>
  appRouter.createCaller(contestoTrpc(DIREZIONE_ID, ["direzione"], sedeId));
const posa = () => appRouter.createCaller(contestoTrpc(POSA_ID, ["squadra_posa"]));

let repository: RepositorySmistamento;
let contatore = 1;

beforeEach(() => {
  azzeraArchivioPerTest();
  repository = creaRepositorySmistamentoMemoriaPerTest();
  impostaRepositorySmistamentoPerTest(repository);
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_READ_TOOLS = "on";
  process.env.FLAG_TARS_PROACTIVE = "on";
  process.env.FLAG_TARS_COMMUNICATIONS = "on";
  process.env.FLAG_TARS_SMISTAMENTO = "on";
});

afterEach(() => {
  impostaRepositorySmistamentoPerTest(null);
  for (const chiave of [
    "FLAG_TARS",
    "FLAG_TARS_READ_TOOLS",
    "FLAG_TARS_PROACTIVE",
    "FLAG_TARS_COMMUNICATIONS",
    "FLAG_TARS_SMISTAMENTO",
  ]) {
    delete process.env[chiave];
  }
});

async function comunicazioneConProposta(commessaId = 4321) {
  const n = contatore++;
  const c = (await insertComunicazione({
    sedeId: SEDE,
    casellaId: 3,
    messageId: `router-${n}-${Date.now()}`,
    canale: "email",
    direzione: "in",
    mittente: "cliente@example.test",
    mittenteNome: "Paolo Gallo",
    destinatari: ["info@azienda.test"],
    oggetto: "Documenti infissi",
    testo: "In allegato.",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    receivedAt: new Date(),
  }))!;
  const esito: EsitoSmistamento = {
    versione: "1.0.0",
    fonte: "modello",
    modello: "gpt-5.6-terra",
    categoria: "operativa",
    urgenza: "normale",
    riepilogo: "Il cliente manda i documenti.",
    richiedeRisposta: false,
    azioneSuggerita: "collega",
    istruzione: "Confermare il collegamento.",
    collegamento: { esito: "proposto", commessaId, clienteId: 9, confidenza: "media", motivo: "Cognome nel testo." },
    allegati: [],
    archiviati: [],
    candidati: [{ tipo: "commessa", id: commessaId, etichetta: `COM-2026-${commessaId}`, punteggio: 70, motivi: ["Cognome nel testo."] }],
    segnali: { interno: false, inoltro: false, mittenteOriginale: null },
  };
  await repository.registra({
    comunicazioneId: c.id,
    sedeId: SEDE,
    versione: "1.0.0",
    stato: "analizzata",
    esito,
    propostaStato: "aperta",
    ultimoErrore: null,
    now: new Date(),
  });
  return c;
}

describe("tars.smistamento* — kill switch, capability, sede", () => {
  it("con FLAG_TARS_SMISTAMENTO spento ogni endpoint muore con PRECONDITION_FAILED", async () => {
    process.env.FLAG_TARS_SMISTAMENTO = "off";
    await expect(direzione().tars.smistamentoStato()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(direzione().tars.smistamentoProposte()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("lo stato è direzione-only; una comunicazione di un'altra sede è NOT_FOUND", async () => {
    await expect(posa().tars.smistamentoStato()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const c = await comunicazioneConProposta();
    await expect(
      direzione(ALTRA_SEDE).tars.smistamentoPerComunicazione({ comunicazioneId: c.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const stato = await direzione().tars.smistamentoStato();
    expect(stato.attivo).toBe(true);
    expect(stato.proposteAperte).toBe(1);
  });
});

describe("tars.smistamentoProposte — destinatari (T6/D4)", () => {
  const caller = (userId: number, ruolo: string) =>
    appRouter.createCaller(contestoTrpc(userId, [ruolo]));

  it("la coda «di tutti» sparisce: l'assegnatario vede la sua, gli altri no, la direzione tutto; l'amministrativa va all'amministrazione", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Destinatari Test" });
    await direzione().commesse.update({ id: commessa.id, assegnatoA: COMMERCIALE_A });
    const operativa = await comunicazioneConProposta(commessa.id);

    // Una proposta AMMINISTRATIVA sulla stessa commessa assegnata: il tema
    // vince sull'assegnatario (D4).
    const amministrativa = await comunicazioneConProposta(commessa.id);
    const registro = await repository.perComunicazione(SEDE, amministrativa.id);
    await repository.registra({
      comunicazioneId: amministrativa.id,
      sedeId: SEDE,
      versione: "1.0.0",
      stato: "analizzata",
      esito: { ...registro!.esito!, categoria: "amministrativa" },
      propostaStato: "aperta",
      ultimoErrore: null,
      now: new Date(),
    });

    const vistaA = await caller(COMMERCIALE_A, "commerciale").tars.smistamentoProposte();
    expect(vistaA.map(p => p.comunicazioneId)).toContain(operativa.id);
    expect(vistaA.map(p => p.comunicazioneId)).not.toContain(amministrativa.id);
    expect(vistaA.find(p => p.comunicazioneId === operativa.id)?.destinatario).toMatchObject({ perTe: true });

    const vistaB = await caller(COMMERCIALE_B, "commerciale").tars.smistamentoProposte();
    expect(vistaB.map(p => p.comunicazioneId)).not.toContain(operativa.id);

    const vistaAmm = await caller(AMMINISTRAZIONE_ID, "amministrazione").tars.smistamentoProposte();
    expect(vistaAmm.map(p => p.comunicazioneId)).toContain(amministrativa.id);
    expect(vistaAmm.map(p => p.comunicazioneId)).not.toContain(operativa.id);

    const vistaDirezione = await direzione().tars.smistamentoProposte();
    expect(vistaDirezione.map(p => p.comunicazioneId)).toEqual(
      expect.arrayContaining([operativa.id, amministrativa.id])
    );
  });
});

describe("tars.smistamentoDecidi", () => {
  it("approva: collegamento manuale (gestita, motivo col nome), registro approvato, seconda decisione CONFLICT", async () => {
    const c = await comunicazioneConProposta();
    const proposte = await direzione().tars.smistamentoProposte();
    expect(proposte.map(p => p.comunicazioneId)).toContain(c.id);
    expect(proposte[0].link).toBe(`/messaggi/email?messaggio=${c.id}`);

    const esito = await direzione().tars.smistamentoDecidi({ comunicazioneId: c.id, decisione: "approva" });
    expect(esito).toMatchObject({ decisione: "approvata", commessaId: 4321 });
    const dopo = (await getComunicazione(c.id, SEDE))!;
    expect(dopo.commessaId).toBe(4321);
    expect(dopo.stato).toBe("gestita");
    expect(dopo.matchMotivo).toContain("approvato da Utente 96511");
    const record = await repository.perComunicazione(SEDE, c.id);
    expect(record?.propostaStato).toBe("approvata");
    expect(record?.esito?.collegamento.esito).toBe("certo");

    await expect(
      direzione().tars.smistamentoDecidi({ comunicazioneId: c.id, decisione: "approva" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await direzione().tars.smistamentoProposte()).toEqual([]);
  });

  it("rifiuta: nessun effetto sulla comunicazione, registro rifiutato", async () => {
    const c = await comunicazioneConProposta();
    const esito = await direzione().tars.smistamentoDecidi({ comunicazioneId: c.id, decisione: "rifiuta" });
    expect(esito.decisione).toBe("rifiutata");
    expect((await getComunicazione(c.id, SEDE))!.commessaId).toBeNull();
    expect((await repository.perComunicazione(SEDE, c.id))?.propostaStato).toBe("rifiutata");
  });

  it("anche la squadra di posa può decidere (commessa.update_operational è condivisa)", async () => {
    const c = await comunicazioneConProposta(4322);
    const esito = await posa().tars.smistamentoDecidi({ comunicazioneId: c.id, decisione: "approva" });
    expect(esito.decisione).toBe("approvata");
    expect((await getComunicazione(c.id, SEDE))!.commessaId).toBe(4322);
  });
});

describe("tars.briefing — sezione smistamento", () => {
  it("elenca la proposta da decidere con etichetta e motivo; con il flag spento la sezione è null", async () => {
    const c = await comunicazioneConProposta(4323);
    const briefing = await direzione().tars.briefing();
    expect(briefing.smistamento).not.toBeNull();
    const voce = briefing.smistamento!.daDecidere.find(v => v.comunicazioneId === c.id);
    expect(voce).toBeDefined();
    expect(voce!.proposta).toMatchObject({ commessaId: 4323, etichetta: "COM-2026-4323", motivo: "Cognome nel testo." });
    expect(briefing.smistamento!.contatori.proposteAperte).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(briefing)).not.toMatch(/€/);

    process.env.FLAG_TARS_SMISTAMENTO = "off";
    const spento = await direzione().tars.briefing();
    expect(spento.smistamento).toBeNull();
  });
});

// «Da rispondere» è l'unica lista del briefing che, per riempirsi, deve
// chiedere al database una cosa per candidato: se una risposta è già
// partita, quella voce non va mostrata. Le domande ora partono a blocchi
// invece che una alla volta, e questi casi fissano ciò che il blocco non
// deve cambiare: l'ordine, il tetto di otto, e il fatto che uno scartato non
// consumi un posto — nemmeno quando cade dentro il primo blocco.
async function comunicazioneDaRispondere(input: {
  mittente: string;
  ricevutaIl: Date;
}) {
  const n = contatore++;
  const c = (await insertComunicazione({
    sedeId: SEDE,
    casellaId: 3,
    messageId: `risposta-${n}-${Date.now()}`,
    canale: "email",
    direzione: "in",
    mittente: input.mittente,
    mittenteNome: "Cliente",
    destinatari: ["info@azienda.test"],
    oggetto: `Domanda ${input.mittente}`,
    testo: "Mi fate sapere?",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    receivedAt: input.ricevutaIl,
  }))!;
  const esito: EsitoSmistamento = {
    versione: "1.0.0",
    fonte: "modello",
    modello: "gpt-5.6-terra",
    categoria: "operativa",
    urgenza: "normale",
    riepilogo: "Il cliente aspetta una risposta.",
    richiedeRisposta: true,
    azioneSuggerita: "rispondi",
    istruzione: "Rispondere al cliente.",
    collegamento: {
      esito: "nessuno",
      commessaId: null,
      clienteId: null,
      confidenza: "nessuna",
      motivo: "Nessun aggancio.",
    },
    allegati: [],
    archiviati: [],
    candidati: [],
    segnali: { interno: false, inoltro: false, mittenteOriginale: null },
  };
  await repository.registra({
    comunicazioneId: c.id,
    sedeId: SEDE,
    versione: "1.0.0",
    stato: "analizzata",
    esito,
    propostaStato: null,
    ultimoErrore: null,
    now: input.ricevutaIl,
  });
  return c;
}

async function rispostaGiaPartita(mittente: string, quando: Date) {
  await insertComunicazione({
    sedeId: SEDE,
    casellaId: 3,
    messageId: `uscita-${contatore++}-${Date.now()}`,
    canale: "email",
    direzione: "out",
    mittente: "info@azienda.test",
    mittenteNome: "Azienda",
    destinatari: [mittente],
    oggetto: "Re: Domanda",
    testo: "Ecco.",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "gestita",
    receivedAt: quando,
  });
}

describe("tars.briefing — da rispondere", () => {
  const BASE = new Date("2026-09-01T09:00:00.000Z");
  /** i-esima comunicazione: più è alto l'indice, più è recente. */
  const quando = (i: number) => new Date(BASE.getTime() + i * 60_000);

  it("si ferma a otto voci anche con più candidati", async () => {
    for (let i = 0; i < 11; i++) {
      await comunicazioneDaRispondere({
        mittente: `c${i}@example.test`,
        ricevutaIl: quando(i),
      });
    }
    const briefing = await direzione().tars.briefing();
    expect(briefing.smistamento!.daRispondere).toHaveLength(8);
  });

  it("chi ha già ricevuto risposta non compare, e non consuma un posto", async () => {
    for (let i = 0; i < 9; i++) {
      await comunicazioneDaRispondere({
        mittente: `d${i}@example.test`,
        ricevutaIl: quando(i),
      });
    }
    // La più recente è d8: cade nel primo blocco di otto, quindi mette alla
    // prova proprio il confine fra un blocco e il successivo.
    await rispostaGiaPartita("d8@example.test", quando(20));

    const voci = (await direzione().tars.briefing()).smistamento!.daRispondere;
    expect(voci).toHaveLength(8);
    const oggetti = voci.map(v => v.oggetto);
    expect(oggetti).not.toContain("Domanda d8@example.test");
    expect(oggetti).toContain("Domanda d0@example.test");
  });

  it("tiene l'ordine del registro: prima le più recenti", async () => {
    for (let i = 0; i < 3; i++) {
      await comunicazioneDaRispondere({
        mittente: `e${i}@example.test`,
        ricevutaIl: quando(i),
      });
    }
    const voci = (await direzione().tars.briefing()).smistamento!.daRispondere;
    expect(voci.map(v => v.oggetto)).toEqual([
      "Domanda e2@example.test",
      "Domanda e1@example.test",
      "Domanda e0@example.test",
    ]);
  });
});
