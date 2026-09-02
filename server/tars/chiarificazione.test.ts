// Tars libero (02/09/2026): con un riferimento ambiguo il modello riceve i
// candidati come hint nel contesto verificato e decide lui (chiede o
// cerca); la risposta breve dell'utente («096», «la commessa 096») viene
// riconosciuta contro i candidati e la commessa diventa attiva; il ticket
// si crea con lo strumento vero.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getTicketStore } from "../routers/ticket";
import { azzeraArchivioPerTest } from "./archivio";
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

describe("chiarificazione — hint al modello e risposta breve riconosciuta", () => {
  it("«crea un ticket per bertoli»: il modello riceve i candidati e chiede; «096» → commessa attiva e ticket creato", async () => {
    const { a, b } = await duePerCognome("Bertoli");
    const contesto = await costruisciContesto(contestoTrpc());
    const hintVisti: string[] = [];
    // Primo giro: il modello vede i candidati nel contesto e chiede lui.
    const providerDomanda = creaProviderFinto(richiesta => {
      hintVisti.push(richiesta.input.map(m => m.contenuto).join("\n"));
      return rispostaTesto(`Quale intendi: ${a.codice} oppure ${b.codice}?`);
    });
    // Secondo giro: la commessa è attiva, il modello crea il ticket.
    const provider = creaProviderFinto((_richiesta, passo) =>
      passo === 0
        ? chiamataTool("crea_ticket", {
            oggetto: "Messaggio PEC per danni e misure sbagliate",
            categoria: "altro",
            priorita: "alta",
          })
        : rispostaTesto("Ticket creato.")
    );

    const primo = await eseguiRun({
      contesto,
      provider: providerDomanda,
      messaggio: "crea un ticket per bertoli",
    });
    expect(primo.stato).toBe("ok");
    expect(primo.testo).toContain("Quale intendi");
    expect(hintVisti[0]).toContain(a.codice);
    expect(hintVisti[0]).toContain(b.codice);
    const dopoPrimo = await caricaContestoConversazione({
      conversazioneId: primo.conversazioneId,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
    });
    expect(dopoPrimo?.chiarificazionePendente?.candidati).toHaveLength(2);

    const secondo = await eseguiRun({
      contesto,
      provider,
      messaggio: progressivo(a.codice),
      conversazioneId: primo.conversazioneId,
    });
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
    expect(secondo.azioni.some(az => az.strumento === "crea_ticket" && az.stato === "creato")).toBe(true);
  });

  it("«la commessa 096» scioglie la domanda; una risposta non riconosciuta lascia l'hint al modello", async () => {
    const { b } = await duePerCognome("Cataldi");
    const contesto = await costruisciContesto(contestoTrpc());
    let chiamate = 0;
    const provider = creaProviderFinto(() => {
      chiamate += 1;
      return rispostaTesto("ok");
    });
    const primo = await eseguiRun({ contesto, provider, messaggio: "parliamo della commessa cataldi" });
    expect(chiamate).toBe(1); // il modello viene chiamato, non bloccato dal resolver
    const boh = await eseguiRun({
      contesto,
      provider,
      messaggio: "boh",
      conversazioneId: primo.conversazioneId,
    });
    expect(boh.stato).toBe("ok");
    expect(chiamate).toBe(2);
    const ancoraPendente = await caricaContestoConversazione({
      conversazioneId: primo.conversazioneId,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
    });
    expect(ancoraPendente?.chiarificazionePendente?.candidati).toHaveLength(2);
    expect(ancoraPendente?.commessaId).toBeNull();

    await eseguiRun({
      contesto,
      provider,
      messaggio: `la commessa ${progressivo(b.codice)}`,
      conversazioneId: primo.conversazioneId,
    });
    const ctx = await caricaContestoConversazione({
      conversazioneId: primo.conversazioneId,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
    });
    expect(ctx?.commessaId).toBe(b.id);
    expect(ctx?.chiarificazionePendente).toBeNull();
  });
});
