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

for (const [id, ruoli] of [
  [DIREZIONE_ID, ["direzione"]],
  [POSA_ID, ["squadra_posa"]],
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
