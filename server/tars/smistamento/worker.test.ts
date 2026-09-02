// Worker dello smistamento end-to-end in memoria: coda (recenti prima,
// niente storia), collegamento certo dal codice, proposta dal modello
// finto con id verificato, errore isolato per comunicazione, idempotenza
// del giro successivo.

import { beforeEach, describe, expect, it } from "vitest";
import { caselle } from "../../comunicazioni/caselle";
import {
  collegaAutomaticoComunicazione,
  getComunicazione,
  insertComunicazione,
  salvaEsitoTarsComunicazione,
  setClassificazioneComunicazione,
  setMatchComunicazione,
  type NuovaComunicazione,
} from "../../comunicazioni/comunicazioni";
import { getClientiStore } from "../../routers/clienti";
import { getCommesseStore } from "../../routers/commesse";
import { getSediStore } from "../../routers/sedi";
import { getUtentiStore } from "../../routers/utenti";
import { creaProviderFinto, rispostaTesto } from "../openai/fake";
import { creaRepositorySmistamentoMemoriaPerTest } from "./repository";
import { eseguiGiroSmistamento, type DipendenzeWorker } from "./worker";

const SEDE = 96_401;
const CLIENTE_ID = 96_410;
const COMMESSA_ID = 96_420;
const CASELLA_ID = 96_430;
let contatore = 1;

beforeEach(() => {
  const sedi = getSediStore() as any[];
  if (!sedi.some(s => s.id === SEDE)) sedi.push({ id: SEDE, nome: "Sede test", attiva: true });
  const clienti = getClientiStore() as any[];
  if (!clienti.some(c => c.id === CLIENTE_ID)) {
    clienti.push({ id: CLIENTE_ID, sedeId: SEDE, nome: "Paolo", cognome: "Gallo", tipo: "privato", email: "paolo.gallo@example.test", telefono: null, commesseIds: [COMMESSA_ID], archivedAt: null });
  }
  const commesse = getCommesseStore() as any[];
  if (!commesse.some(c => c.id === COMMESSA_ID)) {
    commesse.push({ id: COMMESSA_ID, sedeId: SEDE, codice: "COM-2026-777", cliente: "Gallo Paolo", clienteId: CLIENTE_ID, stato: "preventivo", archivedAt: null, pagamenti: [] });
  }
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === 96_440)) {
    utenti.push({ id: 96_440, nome: "Timothy", cognome: "Ruffino", email: "t.ruffino@azienda-test.it", attivo: true, ruoli: ["direzione"], ruolo: "direzione", sediIds: [SEDE] });
  }
  if (!(caselle as any[]).some(c => c.id === CASELLA_ID)) {
    (caselle as any[]).push({ id: CASELLA_ID, sedeId: SEDE, nome: "Info", indirizzo: "info@azienda-test.it", host: "x", porta: 993, tls: true, passwordCifrata: "v1.x", cartella: "INBOX", attiva: true, ultimoUid: null, uidValidity: null });
  }
});

async function inserisci(parziale: Partial<NuovaComunicazione> = {}) {
  const n = contatore++;
  const riga = await insertComunicazione({
    sedeId: SEDE,
    casellaId: CASELLA_ID,
    messageId: `worker-${n}-${Date.now()}`,
    canale: "email",
    direzione: "in",
    mittente: "qualcuno@example.test",
    mittenteNome: null,
    destinatari: ["info@azienda-test.it"],
    oggetto: "Oggetto",
    testo: "Testo",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna",
    matchMotivo: null,
    stato: "nuova",
    receivedAt: new Date(Date.now() - 3_600_000),
    ...parziale,
  });
  if (!riga) throw new Error("inserimento fallito");
  return riga;
}

// Registro condiviso fra i test del file: le comunicazioni in memoria
// restano, e un registro nuovo le rismisterebbe tutte.
const repository = creaRepositorySmistamentoMemoriaPerTest();

function deps(copione: (testo: string) => string | "errore"): DipendenzeWorker & { chiamate: number } {
  const stato = { chiamate: 0 };
  const d: DipendenzeWorker & { chiamate: number } = {
    get chiamate() {
      return stato.chiamate;
    },
    repository,
    modello: "gpt-5.6-terra",
    provider: () =>
      creaProviderFinto(richiesta => {
        stato.chiamate += 1;
        const esito = copione(richiesta.input[0].contenuto);
        if (esito === "errore") return "errore_fatale";
        return rispostaTesto(esito);
      }),
    filo: async () => [],
    leggiRaw: async (c, i) => ({ buffer: Buffer.from("pdf"), nome: c.allegati[i].nome, mimeType: c.allegati[i].mimeType }),
    estraiTesto: async () => ({ esito: "estratto", parser: "finto", versione: "1", pagine: ["Preventivo firmato"], avvertenze: [] }),
    applica: {
      leggiRaw: async (c, i) => ({ buffer: Buffer.from("pdf"), nome: c.allegati[i].nome, mimeType: c.allegati[i].mimeType }),
      archivia: async args => ({ id: 900, commessaId: args.commessaId, tipo: args.tipo, nome: args.nome }) as any,
      documentoEsistente: () => null,
      collegaAutomatico: collegaAutomaticoComunicazione,
      collegaManuale: setMatchComunicazione,
      classifica: setClassificazioneComunicazione,
      salvaEsito: salvaEsitoTarsComunicazione,
    },
    now: () => new Date(),
  };
  return d;
}

function jsonModello(collegamento: unknown, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    categoria: "operativa",
    urgenza: "normale",
    riepilogo: "Riepilogo di prova.",
    richiedeRisposta: false,
    azioneSuggerita: "nessuna",
    istruzione: "Nessuna azione.",
    collegamento,
    allegati: [],
    ...extra,
  });
}

describe("eseguiGiroSmistamento", () => {
  it("codice nel testo → collegata certa senza modello che decida; proposta dal modello per l'altra; storia esclusa; giro successivo vuoto", async () => {
    const certa = await inserisci({ testo: "Vi mando i documenti della COM-2026-777", oggetto: "Documenti" });
    const daProporre = await inserisci({
      mittente: "amministrazione@azienda-test.it",
      oggetto: "I: Fattura e documenti x infissi Gallo",
      testo: "---------- Messaggio inoltrato ----------\nDa: Paolo Gallo <paolo.gallo@example.test>\n\nIn allegato i documenti.",
      allegati: [{ nome: "preventivo_firmato.pdf", mimeType: "application/pdf", size: 50_000 }],
    });
    const storica = await inserisci({ receivedAt: new Date(Date.now() - 400 * 86_400_000), testo: "vecchia" });

    const d = deps(input => {
      // Il modello sceglie la commessa candidata (id dal testo del prompt).
      const m = /commessa id=(\d+)/.exec(input);
      return jsonModello(
        m ? { tipo: "commessa", id: Number(m[1]), confidenza: "media", motivo: "Inoltro dal cliente." } : { tipo: "nessuno", id: 0, confidenza: "bassa", motivo: "" },
        { allegati: [{ indice: 0, tipo: "preventivo", confidenza: "alta", archiviare: true, motivo: "firmato" }] }
      );
    });

    const giro = await eseguiGiroSmistamento({ sedeId: SEDE, deps: d, limite: 10 });
    expect(giro.esaminate).toBe(2); // la storica resta fuori
    expect(giro.errori).toBe(0);
    expect(giro.collegateCerte).toBe(1);
    expect(giro.proposte).toBe(1);

    const c1 = (await getComunicazione(certa.id, SEDE))!;
    expect(c1.commessaId).toBe(COMMESSA_ID);
    expect(c1.stato).toBe("nuova");
    expect(c1.categoria).toBe("operativa");

    const c2 = (await getComunicazione(daProporre.id, SEDE))!;
    expect(c2.commessaId).toBeNull();
    const record = await d.repository.perComunicazione(SEDE, daProporre.id);
    expect(record?.propostaStato).toBe("aperta");
    expect(record?.esito?.collegamento).toMatchObject({ esito: "proposto", commessaId: COMMESSA_ID });
    expect(record?.esito?.segnali.mittenteOriginale).toBe("paolo.gallo@example.test");
    expect(record?.esito?.allegati[0]).toMatchObject({ tipo: "preventivo", archiviare: true });
    expect(record?.esito?.archiviati).toEqual([]); // non collegata: niente fascicolo

    expect(await d.repository.perComunicazione(SEDE, storica.id)).toBeNull();

    const secondo = await eseguiGiroSmistamento({ sedeId: SEDE, deps: d, limite: 10 });
    expect(secondo.esaminate).toBe(0);
  });

  it("una proposta aperta di una versione precedente viene ri-esaminata prima delle nuove", async () => {
    const vecchia = await inserisci({ oggetto: "Report traffico - RUFFINO GROUP", testo: "report" });
    await repository.registra({
      comunicazioneId: vecchia.id,
      sedeId: SEDE,
      versione: "0.9.0",
      stato: "analizzata",
      esito: {
        versione: "0.9.0",
        fonte: "modello",
        modello: "gpt-5.6-terra",
        categoria: "amministrativa",
        urgenza: "normale",
        riepilogo: "Report.",
        richiedeRisposta: false,
        azioneSuggerita: "collega",
        istruzione: "",
        collegamento: { esito: "proposto", commessaId: null, clienteId: 99, confidenza: "media", motivo: "sbagliata" },
        allegati: [],
        archiviati: [],
        candidati: [{ tipo: "cliente", id: 99, etichetta: "Ruffino Group", punteggio: 40, motivi: [] }],
        segnali: { interno: false, inoltro: false, mittenteOriginale: null },
      },
      propostaStato: "aperta",
      ultimoErrore: null,
      now: new Date(),
    });
    const d = deps(() => jsonModello({ tipo: "nessuno", id: 0, confidenza: "bassa", motivo: "" }));
    const giro = await eseguiGiroSmistamento({ sedeId: SEDE, deps: d, limite: 10 });
    expect(giro.esaminate).toBeGreaterThanOrEqual(1);
    const record = await repository.perComunicazione(SEDE, vecchia.id);
    expect(record?.versione).not.toBe("0.9.0");
    expect(record?.propostaStato).toBe("nessuna");
    expect(record?.esito?.collegamento.esito).toBe("nessuno");
  });

  it("un errore del modello su una comunicazione viene registrato e non ferma le altre", async () => {
    const rotta = await inserisci({ oggetto: "ROTTA", testo: "x" });
    const buona = await inserisci({ oggetto: "BUONA", testo: "y" });
    const d = deps(input => (input.includes("OGGETTO: ROTTA") ? "errore" : jsonModello({ tipo: "nessuno", id: 0, confidenza: "bassa", motivo: "" })));
    const giro = await eseguiGiroSmistamento({ sedeId: SEDE, deps: d, limite: 10 });
    expect(giro.errori).toBe(1);
    expect(giro.analizzate).toBe(1);
    expect((await d.repository.perComunicazione(SEDE, rotta.id))?.stato).toBe("errore");
    expect((await d.repository.perComunicazione(SEDE, buona.id))?.stato).toBe("analizzata");
    expect((await getComunicazione(buona.id, SEDE))!.classificazioneFonte).toBe("tars");
  });
});
