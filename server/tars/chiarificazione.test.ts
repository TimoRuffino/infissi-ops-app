// La chat del 02/09: «crea un ticket per bertoli» → «Quale intendi…» →
// «096» ripetuto cinque volte senza uscita. Ora la risposta breve viene
// riconosciuta, il ticket si crea con lo strumento vero, e dopo due
// risposte non riconosciute la domanda decade invece di ripetersi.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getTicketStore } from "../routers/ticket";
import { azzeraArchivioPerTest, turniDiConversazione } from "./archivio";
import { costruisciContesto } from "./contesto";
import { caricaContestoConversazione } from "./conversazione/context";
import { creaLedgerMemoriaPerTest, impostaLedgerPerTest } from "./costi/ledger";
import { azzeraCacheTarsPerTest, eseguiRun } from "./orchestratore";
import { chiamataTool, creaProviderFinto, rispostaTesto } from "./openai/fake";

const SEDE = 96_601;
const DIREZIONE_ID = 96_611;

function contestoTrpc(sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: DIREZIONE_ID,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = () => appRouter.createCaller(contestoTrpc());

beforeEach(() => {
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
  impostaLedgerPerTest(creaLedgerMemoriaPerTest());
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_READ_TOOLS = "on";
  process.env.FLAG_TARS_L2_ACTIONS = "on";
});

afterEach(() => {
  impostaLedgerPerTest(null);
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
});

// Un cognome per test: le commesse in memoria restano fra un test e
// l'altro, e più di quattro candidati cambierebbero la domanda.
async function duePerCognome(cognome: string) {
  const maiuscolo = cognome.toUpperCase();
  const cliente = await direzione().clienti.create({ nome: "Duilio", cognome });
  const a = await direzione().commesse.create({
    cliente: `${cognome} Duilio`,
    clienteId: cliente.id,
  });
  const immobiliare = await direzione().clienti.create({
    cognome: `IMMOBILIARE ${maiuscolo}`,
    nome: `di ${cognome} Duilio`,
    tipo: "azienda",
  });
  const b = await direzione().commesse.create({
    cliente: `IMMOBILIARE ${maiuscolo} di ${cognome} Duilio`,
    clienteId: immobiliare.id,
  });
  return { a, b };
}

const progressivo = (codice: string) => codice.slice(-3);

describe("chiarificazione — la risposta breve viene riconosciuta", () => {
  it("«crea un ticket per bertoli» → domanda; «096» → commessa scelta e ticket creato con lo strumento", async () => {
    const { a } = await duePerCognome("Bertoli");
    const contesto = await costruisciContesto(contestoTrpc());
    let chiamateModello = 0;
    const provider = creaProviderFinto((richiesta, passo) => {
      chiamateModello += 1;
      if (passo === 0) {
        return chiamataTool("crea_ticket", {
          oggetto: "Messaggio PEC per danni e misure sbagliate",
          categoria: "altro",
          priorita: "alta",
        });
      }
      void richiesta;
      return rispostaTesto("Ticket creato.");
    });

    const primo = await eseguiRun({
      contesto,
      provider,
      messaggio: "crea un ticket per bertoli",
    });
    expect(primo.testo).toContain("Quale intendi");
    expect(primo.statoOperativo.stato).toBe("Da confermare");
    expect(chiamateModello).toBe(0);

    const secondo = await eseguiRun({
      contesto,
      provider,
      messaggio: progressivo(a.codice),
      conversazioneId: primo.conversazioneId,
    });
    expect(secondo.testo).not.toContain("Quale intendi");
    expect(secondo.stato).toBe("ok");
    const contestoConv = await caricaContestoConversazione({
      conversazioneId: primo.conversazioneId,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
    });
    expect(contestoConv?.commessaId).toBe(a.id);
    expect(contestoConv?.chiarificazionePendente).toBeNull();

    const ticket = (getTicketStore() as any[]).find(
      t => t.commessaId === a.id && t.oggetto.includes("Messaggio PEC")
    );
    expect(ticket).toBeDefined();
    expect(ticket.stato).toBe("aperto");
    expect(ticket.priorita).toBe("alta");
    expect(secondo.azioni.some(az => az.strumento === "crea_ticket" && az.stato === "creato")).toBe(true);
  });

  it("anche «la commessa 096» e il nome del cliente sciolgono la domanda", async () => {
    const { a, b } = await duePerCognome("Cataldi");
    const contesto = await costruisciContesto(contestoTrpc());
    const provider = creaProviderFinto(() => rispostaTesto("ok"));
    const primo = await eseguiRun({ contesto, provider, messaggio: "parliamo della commessa cataldi" });
    expect(primo.testo).toContain("Quale intendi");
    const secondo = await eseguiRun({
      contesto,
      provider,
      messaggio: `la commessa ${progressivo(b.codice)}`,
      conversazioneId: primo.conversazioneId,
    });
    expect(secondo.testo).not.toContain("Quale intendi");
    const ctx = await caricaContestoConversazione({
      conversazioneId: primo.conversazioneId,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
    });
    expect(ctx?.commessaId).toBe(b.id);
    void a;
  });

  it("dopo due risposte non riconosciute la domanda decade: il messaggio arriva al modello", async () => {
    await duePerCognome("Zannini");
    const contesto = await costruisciContesto(contestoTrpc());
    let chiamateModello = 0;
    const provider = creaProviderFinto(() => {
      chiamateModello += 1;
      return rispostaTesto("Dimmi pure di quale lavoro parli.");
    });
    const primo = await eseguiRun({ contesto, provider, messaggio: "verifica la commessa zannini" });
    expect(primo.testo).toContain("Quale intendi");
    const secondo = await eseguiRun({
      contesto,
      provider,
      messaggio: "boh",
      conversazioneId: primo.conversazioneId,
    });
    expect(secondo.testo).toContain("Non ho riconosciuto la risposta");
    expect(chiamateModello).toBe(0);
    const terzo = await eseguiRun({
      contesto,
      provider,
      messaggio: "mah",
      conversazioneId: primo.conversazioneId,
    });
    expect(terzo.testo).not.toContain("Quale intendi");
    expect(chiamateModello).toBe(1);
    const turni = await turniDiConversazione({
      conversazioneId: primo.conversazioneId,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
    });
    expect(turni.filter(t => t.contenuto.includes("Quale intendi")).length).toBeLessThanOrEqual(2);
  });
});
