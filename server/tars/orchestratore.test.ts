// Tars T1 — le prove del runtime read-only: kill switch non aggirabile,
// loop con strumenti e evidenze, cache C0/C1 misurate, degradazione
// onesta col provider rotto, circuito, shaping economico per capability,
// isolamento di sede, profili che escludono gli strumenti non autorizzati.
// Provider SEMPRE finto: nessuna chiamata di rete possibile.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getUtentiStore } from "../routers/utenti";
import {
  azzeraArchivioPerTest,
  conversazioneDiUtente,
  creaConversazione,
  impostaConversazioneArchiviata,
  turniDiConversazione,
} from "./archivio";
import { costruisciContesto } from "./contesto";
import {
  azzeraCacheTarsPerTest,
  eseguiRun,
} from "./orchestratore";
import { creaProviderFinto, chiamataTool, rispostaTesto } from "./openai/fake";
import * as providerGovernato from "./costi/providerGovernato";
import * as esecuzioniR1 from "./azioni/executions";
import {
  creaLedgerMemoriaPerTest,
  impostaLedgerPerTest,
} from "./costi/ledger";
import { azzeraRateLimitTarsPerTest } from "../routers/tars";
import { filtraStrumenti, strumentiPerContesto } from "./profili";
import { STRUMENTI_L0 } from "./strumenti/letture";
import {
  creaLedgerEsecuzioniMemoriaPerTest,
  impostaLedgerEsecuzioniPerTest,
  type LedgerEsecuzioniR1,
} from "./azioni/executions";
import { descrittoreAzione } from "./azioni/registry";
import { azzeraMemoriaPerTest, memorieValide } from "./memoria";
import { getDocumentoRecordById } from "../routers/preventiviContratti";
import { getCommessaById } from "../routers/commesse";

const SEDE = 95001;
const ALTRA_SEDE = 95002;
const DIREZIONE_ID = 95011;
const COMMERCIALE_ID = 95012;

for (const [id, ruoli] of [[COMMERCIALE_ID, ["commerciale"]]] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Nome${id}`,
      cognome: `Cognome${id}`,
      email: `tars-${id}@example.test`,
      attivo: true,
      ruoli: [...ruoli],
      ruolo: ruoli[0],
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(
  userId: number,
  roles: string[],
  sedeId = SEDE
): TrpcContext {
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

async function contestoRun(userId: number, roles: string[], sedeId = SEDE) {
  return costruisciContesto(contestoTrpc(userId, roles, sedeId));
}

beforeEach(() => {
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
  azzeraMemoriaPerTest();
});

afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_REMINDERS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
  delete process.env.FLAG_TARS_PROPOSALS;
  delete process.env.FLAG_TARS_MEMORY;
  delete process.env.FLAG_TARS_PROACTIVE;
  delete process.env.TARS_RATE_LIMIT_INVII;
  azzeraRateLimitTarsPerTest();
  impostaLedgerEsecuzioniPerTest(null);
  impostaLedgerPerTest(null);
  vi.restoreAllMocks();
});

function chiamateToolMultiple(
  chiamate: Array<{ id: string; nome: string; argomenti: unknown }>
) {
  return {
    tipo: "tool_call" as const,
    chiamate: chiamate.map(c => ({
      id: c.id,
      nome: c.nome,
      argomenti: JSON.stringify(c.argomenti),
    })),
    uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
  };
}

function ledgerConGuasti(opzioni: {
  prenota?: boolean;
  concludiUnaVolta?: boolean;
}): LedgerEsecuzioniR1 {
  const base = creaLedgerEsecuzioniMemoriaPerTest();
  let concludiFallita = false;
  return {
    ...base,
    async prenota(input) {
      if (opzioni.prenota) throw new Error("db prenota non disponibile");
      return base.prenota(input);
    },
    async concludi(input) {
      if (opzioni.concludiUnaVolta && !concludiFallita) {
        concludiFallita = true;
        throw new Error("db settle non disponibile");
      }
      return base.concludi(input);
    },
  };
}

describe("tars — kill switch", () => {
  it("con FLAG_TARS spento ogni endpoint rifiuta, anche per la direzione", async () => {
    process.env.FLAG_TARS = "off";
    const attesa = { code: "PRECONDITION_FAILED" };
    await expect(direzione().tars.stato()).rejects.toMatchObject(attesa);
    await expect(direzione().tars.conversazioni()).rejects.toMatchObject(attesa);
    await expect(
      direzione().tars.invia({ messaggio: "ciao" })
    ).rejects.toMatchObject(attesa);
  });

  it("con FLAG_TARS_READ_TOOLS spento nessuna lettura di quella famiglia sopravvive", async () => {
    process.env.FLAG_TARS_READ_TOOLS = "off";
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const strumenti = strumentiPerContesto(contesto);
    expect(strumenti.length).toBeGreaterThan(0); // le altre famiglie vivono
    const nomiL0 = new Set(STRUMENTI_L0.map(s => s.nome));
    expect(strumenti.some(s => nomiL0.has(s.nome))).toBe(false);
  });

  it("con TUTTE le famiglie spente il profilo strumenti è vuoto", async () => {
    process.env.FLAG_TARS_READ_TOOLS = "off";
    process.env.FLAG_TARS_REMINDERS = "off";
    process.env.FLAG_TARS_L2_ACTIONS = "off";
    process.env.FLAG_TARS_PROPOSALS = "off";
    process.env.FLAG_TARS_MEMORY = "off";
    process.env.FLAG_TARS_PROACTIVE = "off";
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    expect(strumentiPerContesto(contesto)).toEqual([]);
  });
});

describe("tars — profili per contesto", () => {
  it("gli strumenti direzione-only e dietro interruttore DI non esistono per gli altri", async () => {
    const perDirezione = strumentiPerContesto(
      await contestoRun(DIREZIONE_ID, ["direzione"])
    ).map(s => s.nome);
    expect(perDirezione).toContain("leggi_analisi_ordine");

    const perCommerciale = strumentiPerContesto(
      await contestoRun(COMMERCIALE_ID, ["commerciale"])
    ).map(s => s.nome);
    expect(perCommerciale).not.toContain("leggi_analisi_ordine");
    expect(perCommerciale).toContain("cerca_commesse");
    expect(perCommerciale).toContain("leggi_commessa");
  });

  it("il filtro esclude gli strumenti la cui capability manca al principal", async () => {
    const sintetico: any = {
      nome: "strumento_economico_sintetico",
      versione: "1.0.0",
      categoria: "test",
      livello: "L0",
      effetto: "nessuno",
      reversibile: true,
      capability: ["pagamento.read"],
      descrizione: "solo per il test del filtro",
      schemaInput: { parse: (v: unknown) => v },
      esegui: async () => ({}),
    };
    const perDirezione = filtraStrumenti(
      [sintetico],
      await contestoRun(DIREZIONE_ID, ["direzione"])
    );
    expect(perDirezione.map(s => s.nome)).toContain(
      "strumento_economico_sintetico"
    );
    const perCommerciale = filtraStrumenti(
      [sintetico],
      await contestoRun(COMMERCIALE_ID, ["commerciale"])
    );
    expect(perCommerciale).toEqual([]);
  });

  it("il catalogo è ordinato deterministicamente (prefisso stabile per C2)", async () => {
    const nomi = strumentiPerContesto(
      await contestoRun(DIREZIONE_ID, ["direzione"])
    ).map(s => s.nome);
    expect(nomi).toEqual([...nomi].sort());
  });
});

describe("tars — cerca_commesse e archivio", () => {
  it("le commesse archiviate restano fuori dai risultati operativi e dentro solo su richiesta esplicita", async () => {
    process.env.FLAG_TARS = "on";
    process.env.FLAG_TARS_READ_TOOLS = "on";
    const attiva = await direzione().commesse.create({ cliente: "Archivio Attiva Srl" });
    const conclusa = await direzione().commesse.create({ cliente: "Archivio Conclusa Srl" });
    const record: any = getCommessaById(conclusa.id);
    record.stato = "archiviata";
    record.archivedAt = new Date();

    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const cerca = strumentiPerContesto(contesto).find(
      s => s.nome === "cerca_commesse"
    )!;
    const operativo: any = await cerca.esegui(contesto, {
      testo: "archivio",
      limite: 20,
    });
    const id = operativo.dati.commesse.map((c: any) => c.id);
    expect(id).toContain(attiva.id);
    expect(id).not.toContain(conclusa.id);
    expect(operativo.omissioni.join(" ")).toContain("archiviate");

    const esplicito: any = await cerca.esegui(contesto, {
      testo: "archivio",
      stato: "archiviata",
      limite: 20,
    });
    expect(esplicito.dati.commesse.map((c: any) => c.id)).toContain(
      conclusa.id
    );
  });
});

describe("tars — run con strumenti, evidenze e cache", () => {
  it("la chiave prompt-cache inviata al provider resta nel limite OpenAI di 64 caratteri", async () => {
    // In produzione la forma leggibile (71 caratteri) veniva rifiutata con
    // 400 «prompt_cache_key: string too long» su OGNI chiamata reale.
    const chiavi: string[] = [];
    const provider = creaProviderFinto(richiesta => {
      chiavi.push(richiesta.chiaveCachePrompt);
      return rispostaTesto("ok");
    });
    await eseguiRun({
      contesto: await contestoRun(DIREZIONE_ID, ["direzione"]),
      provider,
      messaggio: "Ciao, come funziona il fascicolo?",
    });
    expect(chiavi.length).toBeGreaterThan(0);
    for (const chiave of chiavi) {
      expect(chiave.length).toBeLessThanOrEqual(64);
      expect(chiave).toMatch(/^tars-[a-f0-9]{48}$/);
    }
    // Stessa configurazione ⇒ stessa chiave (il prefisso cache regge).
    const seconde: string[] = [];
    await eseguiRun({
      contesto: await contestoRun(DIREZIONE_ID, ["direzione"]),
      provider: creaProviderFinto(richiesta => {
        seconde.push(richiesta.chiaveCachePrompt);
        return rispostaTesto("ok");
      }),
      messaggio: "Altra domanda generica sul fascicolo",
    });
    expect(seconde[0]).toBe(chiavi[0]);
  });


  it("loop completo: tool call → evidenze → risposta, tutto persistito", async () => {
    const commessa = await direzione().commesse.create({
      cliente: "Tars Prova Uno",
    });
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const provider = creaProviderFinto((_richiesta, passo) =>
      passo === 0
        ? chiamataTool("leggi_commessa", { commessaId: commessa.id })
        : rispostaTesto(
            `La commessa ${commessa.codice} è in stato preventivo.`
          )
    );
    const esito = await eseguiRun({
      contesto,
      provider,
      messaggio: `Com'è messa la commessa ${commessa.codice}?`,
    });
    expect(esito.stato).toBe("ok");
    expect(esito.strumentiUsati).toEqual(["leggi_commessa"]);
    expect(
      esito.evidenze.some(e => e.riferimento === `commessa:${commessa.id}`)
    ).toBe(true);
    expect(esito.uso.input).toBeGreaterThan(0);

    const turni = await direzione().tars.turni({
      conversazioneId: esito.conversazioneId,
    });
    expect(turni.map(t => t.ruolo)).toEqual(["utente", "tars"]);
    expect(turni[1].contenuto).toContain(commessa.codice);
  });

  it("C1: la stessa tool call nello stesso run non riesegue lo strumento", async () => {
    const commessa = await direzione().commesse.create({
      cliente: "Tars Cache C1",
    });
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    let passi = 0;
    const provider = creaProviderFinto((_r, passo) => {
      passi = passo;
      if (passo <= 1) {
        return chiamataTool(
          "leggi_commessa",
          { commessaId: commessa.id },
          `call_${passo}`
        );
      }
      return rispostaTesto("Fatto.");
    });
    const esito = await eseguiRun({
      contesto,
      provider,
      messaggio: "Rileggi due volte la stessa commessa.",
    });
    expect(passi).toBe(2);
    expect(esito.cache.c1Miss).toBe(1);
    expect(esito.cache.c1Hit).toBe(1);
    expect(esito.strumentiUsati).toEqual(["leggi_commessa"]); // eseguito una volta
  });

  it("C0: stessa domanda, stesso perimetro → zero model call la seconda volta", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    let chiamateProvider = 0;
    const provider = creaProviderFinto(() => {
      chiamateProvider += 1;
      return rispostaTesto("Risposta stabile.");
    });
    const primo = await eseguiRun({
      contesto,
      provider,
      messaggio: "Quante commesse in posa?",
    });
    const secondo = await eseguiRun({
      contesto,
      provider,
      messaggio: "  quante   commesse in POSA? ", // normalizzazione
    });
    expect(chiamateProvider).toBe(1);
    expect(primo.cache.c0Hit).toBe(false);
    expect(secondo.cache.c0Hit).toBe(true);
    expect(secondo.testo).toBe("Risposta stabile.");
  });

  it("C0 non scavalca il perimetro: un altro utente non riusa la risposta", async () => {
    let chiamateProvider = 0;
    const provider = creaProviderFinto(() => {
      chiamateProvider += 1;
      return rispostaTesto(`Risposta ${chiamateProvider}.`);
    });
    await eseguiRun({
      contesto: await contestoRun(DIREZIONE_ID, ["direzione"]),
      provider,
      messaggio: "Domanda identica",
    });
    const altro = await eseguiRun({
      contesto: await contestoRun(COMMERCIALE_ID, ["commerciale"]),
      provider,
      messaggio: "Domanda identica",
    });
    expect(chiamateProvider).toBe(2);
    expect(altro.cache.c0Hit).toBe(false);
  });
});

describe("tars — protocollo write-ahead R1", () => {
  function contaEffettiRicorda() {
    const strumento = descrittoreAzione("ricorda")!.strumento;
    const originale = strumento.esegui.bind(strumento);
    let effetti = 0;
    vi.spyOn(strumento, "esegui").mockImplementation(async (...args: any[]) => {
      effetti += 1;
      return originale(...args);
    });
    return () => effetti;
  }

  async function runRicorda(
    contenuto: string,
    messaggio: string,
    id = "ricorda-1"
  ) {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    return eseguiRun({
      contesto,
      provider: creaProviderFinto((_richiesta, passo) =>
        passo === 0
          ? chiamataTool(
              "ricorda",
              { contenuto, tipo: "preferenza" },
              id
            )
          : rispostaTesto("Gestito.")
      ),
      messaggio,
    });
  }

  it("se la reservation fallisce non chiama il tool", async () => {
    const ledger = ledgerConGuasti({ prenota: true });
    impostaLedgerEsecuzioniPerTest(ledger);
    const effetti = contaEffettiRicorda();

    await runRicorda("Mai senza reservation", "prova reservation fallita");

    expect(effetti()).toBe(0);
    expect(memorieValide(SEDE, DIREZIONE_ID)).toHaveLength(0);
  });

  it("se settle fallisce lascia uncertain e il retry non riesegue", async () => {
    const ledger = ledgerConGuasti({ concludiUnaVolta: true });
    impostaLedgerEsecuzioniPerTest(ledger);
    const effetti = contaEffettiRicorda();

    await runRicorda("Effetto ambiguo", "prima esecuzione");
    expect(effetti()).toBe(1);
    expect((await ledger.lista({ sedeId: SEDE }))[0].stato).toBe("uncertain");

    await runRicorda("Effetto ambiguo", "retry esecuzione", "ricorda-2");
    expect(effetti()).toBe(1);
    expect(memorieValide(SEDE, DIREZIONE_ID)).toHaveLength(1);
  });

  it("due tool call semanticamente identiche eseguono un solo effetto anche senza C1", async () => {
    const ledger = creaLedgerEsecuzioniMemoriaPerTest();
    impostaLedgerEsecuzioniPerTest(ledger);
    const effetti = contaEffettiRicorda();
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const esito = await eseguiRun({
      contesto,
      provider: creaProviderFinto((_richiesta, passo) =>
        passo === 0
          ? chiamateToolMultiple([
              {
                id: "a",
                nome: "ricorda",
                argomenti: { contenuto: "Ordine canonico", tipo: "preferenza" },
              },
              {
                id: "b",
                nome: "ricorda",
                argomenti: { tipo: "preferenza", contenuto: "Ordine canonico" },
              },
            ])
          : rispostaTesto("Una sola volta.")
      ),
      messaggio: "ricorda una sola volta",
    });

    expect(esito.cache.c1Miss).toBe(2);
    expect(effetti()).toBe(1);
    expect(await ledger.lista({ sedeId: SEDE })).toHaveLength(1);
  });

  it("consuma una richiesta direzionale di transizione dopo un solo effetto settled", async () => {
    process.env.FLAG_TARS = "on";
    process.env.FLAG_TARS_READ_TOOLS = "on";
    process.env.FLAG_TARS_L2_ACTIONS = "on";
    const ledger = creaLedgerEsecuzioniMemoriaPerTest();
    impostaLedgerEsecuzioniPerTest(ledger);
    const commessa = await direzione().commesse.create({ cliente: "Tars una sola transizione" });
    await direzione().preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "preventivo.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      size: 4,
      dataBase64: "dGVzdA==",
    });
    const misure = await direzione().preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "misure.pdf",
      tipo: "misure",
      mimeType: "application/pdf",
      size: 4,
      dataBase64: "dGVzdA==",
    });
    // Dato legacy: esisteva prima della registrazione di statoAtUpload.
    (getDocumentoRecordById(misure.id) as any).statoAtUpload = null;
    const esito = await eseguiRun({
      contesto: await contestoRun(DIREZIONE_ID, ["direzione"]),
      provider: creaProviderFinto((_richiesta, passo) =>
        passo === 0
          ? chiamateToolMultiple([
              { id: "prima", nome: "transizione_adiacente_commessa", argomenti: { commessaId: commessa.id, nuovoStato: "misure_esecutive" } },
              { id: "seconda", nome: "transizione_adiacente_commessa", argomenti: { commessaId: commessa.id, nuovoStato: "aggiornamento_contratto" } },
            ])
          : rispostaTesto("Fatto.")
      ),
      messaggio: `Passa la commessa ${commessa.codice} allo stato successivo`,
    });

    // Tars libero: nessuna «autorità consumata» dopo il primo effetto. Ogni
    // chiamata è un comando verificato dal dominio (adiacenza, gate,
    // versione): la seconda passa o viene rifiutata dal dominio, mai da un
    // classificatore del testo.
    const eseguite = esito.azioni.filter(a => a.stato === "transizione_eseguita");
    expect(eseguite.length).toBeGreaterThanOrEqual(1);
    expect(["misure_esecutive", "aggiornamento_contratto"]).toContain(
      (await direzione().commesse.byId(commessa.id)).stato
    );
    for (const azione of esito.azioni) {
      expect(azione.motivo ?? "").not.toMatch(/esplicit|autorizzat/i);
    }
    expect((await ledger.lista({ sedeId: SEDE })).filter(r => r.stato === "settled")).toHaveLength(
      eseguite.length
    );
  });

  it("blocca il retry concorrente della transizione prima di duplicare stato e audit", async () => {
    process.env.FLAG_TARS = "on";
    process.env.FLAG_TARS_READ_TOOLS = "on";
    process.env.FLAG_TARS_L2_ACTIONS = "on";
    const ledger = creaLedgerEsecuzioniMemoriaPerTest();
    impostaLedgerEsecuzioniPerTest(ledger);
    const commessa = await direzione().commesse.create({ cliente: "Tars retry concorrente" });
    await direzione().preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "preventivo.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      size: 4,
      dataBase64: "dGVzdA==",
    });
    const provider = () => creaProviderFinto((_richiesta, passo) =>
      passo === 0
        ? chiamataTool(
            "transizione_adiacente_commessa",
            { commessaId: commessa.id, nuovoStato: "misure_esecutive" },
            "transizione-concorrente"
          )
        : rispostaTesto("Fatto.")
    );

    const risultati = await Promise.all([
      eseguiRun({
        contesto: await contestoRun(DIREZIONE_ID, ["direzione"]),
        provider: provider(),
        messaggio: `Passa la commessa ${commessa.codice} a misure esecutive`,
      }),
      eseguiRun({
        contesto: await contestoRun(DIREZIONE_ID, ["direzione"]),
        provider: provider(),
        messaggio: `Passa la commessa ${commessa.codice} a misure esecutive`,
      }),
    ]);

    expect((await direzione().commesse.byId(commessa.id)).stato).toBe("misure_esecutive");
    expect(risultati.flatMap(r => r.azioni).filter(a => a.stato === "transizione_eseguita")).toHaveLength(1);
    expect((await ledger.lista({ sedeId: SEDE })).filter(r => r.stato === "settled")).toHaveLength(1);
  });

  for (const condizione of [
    "se il documento è coerente",
    "qualora il documento sia coerente",
    "purché il documento sia coerente",
    "a condizione che il documento sia coerente",
  ]) {
  it(`esegue anche con il suffisso «${condizione}»: il testo non è un'autorità, decide il modello e verifica il dominio`, async () => {
    process.env.FLAG_TARS = "on";
    process.env.FLAG_TARS_READ_TOOLS = "on";
    process.env.FLAG_TARS_L2_ACTIONS = "on";
    const ledger = creaLedgerEsecuzioniMemoriaPerTest();
    impostaLedgerEsecuzioniPerTest(ledger);
    const commessa = await direzione().commesse.create({ cliente: "Tars comando condizionale" });
    await direzione().preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "preventivo.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      size: 4,
      dataBase64: "dGVzdA==",
    });

    const esito = await eseguiRun({
      contesto: await contestoRun(DIREZIONE_ID, ["direzione"]),
      provider: creaProviderFinto((_richiesta, passo) =>
        passo === 0
          ? chiamataTool(
              "transizione_adiacente_commessa",
              { commessaId: commessa.id, nuovoStato: "misure_esecutive" },
              "condizionale"
            )
          : rispostaTesto("Nessuna transizione.")
      ),
      messaggio: `Passa la commessa ${commessa.codice} a misure esecutive ${condizione}`,
    });

    expect((await direzione().commesse.byId(commessa.id)).stato).toBe("misure_esecutive");
    expect(esito.azioni).toMatchObject([{ stato: "transizione_eseguita" }]);
    expect((await ledger.lista({ sedeId: SEDE })).filter(r => r.stato === "settled")).toHaveLength(1);
  });
  }

  it("due input legittimi distinti producono due effetti e due audit", async () => {
    const ledger = creaLedgerEsecuzioniMemoriaPerTest();
    impostaLedgerEsecuzioniPerTest(ledger);
    const effetti = contaEffettiRicorda();
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    await eseguiRun({
      contesto,
      provider: creaProviderFinto((_richiesta, passo) =>
        passo === 0
          ? chiamateToolMultiple([
              {
                id: "a",
                nome: "ricorda",
                argomenti: { contenuto: "Prima preferenza", tipo: "preferenza" },
              },
              {
                id: "b",
                nome: "ricorda",
                argomenti: { contenuto: "Seconda preferenza", tipo: "preferenza" },
              },
            ])
          : rispostaTesto("Due effetti.")
      ),
      messaggio: "ricorda due preferenze distinte",
    });

    const righe = await ledger.lista({ sedeId: SEDE });
    expect(effetti()).toBe(2);
    expect(righe).toHaveLength(2);
    expect(new Set(righe.map(r => r.idempotencyKey)).size).toBe(2);
    expect(new Set(righe.map(r => r.audit.auditId)).size).toBe(2);
  });
});

describe("tars — cronologia, contesto C0, C1 ed errori (revisione)", () => {
  it("la finestra di cronologia tiene gli ULTIMI turni: la domanda corrente arriva sempre al provider", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    let ultimaRichiesta: any = null;
    const provider = () =>
      creaProviderFinto(richiesta => {
        ultimaRichiesta = richiesta;
        return rispostaTesto("Ok.");
      });
    const primo = await eseguiRun({
      contesto,
      provider: provider(),
      messaggio: "Primo scambio",
      configurazione: { cronologiaMassima: 4 },
    });
    for (const testo of ["Secondo scambio", "Terzo scambio"]) {
      await eseguiRun({
        contesto,
        provider: provider(),
        messaggio: testo,
        conversazioneId: primo.conversazioneId,
        configurazione: { cronologiaMassima: 4 },
      });
    }
    await eseguiRun({
      contesto,
      provider: provider(),
      messaggio: "DOMANDA CORRENTE",
      conversazioneId: primo.conversazioneId,
      configurazione: { cronologiaMassima: 4 },
    });
    const ultimo = ultimaRichiesta.input[ultimaRichiesta.input.length - 1];
    expect(ultimo.contenuto).toBe("DOMANDA CORRENTE");
    expect(ultimaRichiesta.input.length).toBeLessThanOrEqual(5);
  });

  it("la stessa frase con cronologia diversa NON riusa C0 (domande deittiche)", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    let chiamate = 0;
    const provider = () =>
      creaProviderFinto(() => {
        chiamate += 1;
        return rispostaTesto(`Risposta ${chiamate}.`);
      });
    const prima = await eseguiRun({
      contesto,
      provider: provider(),
      messaggio: "E il gate è soddisfatto?",
    });
    await eseguiRun({
      contesto,
      provider: provider(),
      messaggio: "Parliamo di un'altra commessa",
      conversazioneId: prima.conversazioneId,
    });
    const terza = await eseguiRun({
      contesto,
      provider: provider(),
      messaggio: "E il gate è soddisfatto?",
      conversazioneId: prima.conversazioneId,
    });
    expect(terza.cache.c0Hit).toBe(false); // referente diverso: niente riuso
    expect(chiamate).toBe(3);
  });

  it("C1 non cachea gli errori: una chiamata identica dopo un errore viene rieseguita", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const doppiaFallita: any = {
      tipo: "tool_call",
      chiamate: [
        {
          id: "e1",
          nome: "leggi_commessa",
          argomenti: JSON.stringify({ commessaId: 99_999_999 }),
        },
        {
          id: "e2",
          nome: "leggi_commessa",
          argomenti: JSON.stringify({ commessaId: 99_999_999 }),
        },
      ],
      uso: { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 },
    };
    const esito = await eseguiRun({
      contesto,
      provider: creaProviderFinto((_richiesta, passo) =>
        passo === 0 ? doppiaFallita : rispostaTesto("Non trovata.")
      ),
      messaggio: "Commessa inesistente due volte",
    });
    expect(esito.cache.c1Hit).toBe(0); // l'errore non è stato riusato
    expect(esito.cache.c1Miss).toBe(2);
  });

  it("tars.invia ha un rate limit per principal", async () => {
    process.env.TARS_RATE_LIMIT_INVII = "3";
    azzeraRateLimitTarsPerTest();
    const caller = direzione();
    for (let i = 0; i < 3; i++) {
      await caller.tars.invia({ messaggio: `Messaggio ${i}` });
    }
    await expect(
      caller.tars.invia({ messaggio: "Uno di troppo" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("tars — budget e retry del provider", () => {
  it("un copione che chiama strumenti all'infinito esaurisce il budget e degrada onestamente", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const esito = await eseguiRun({
      contesto,
      provider: creaProviderFinto(() =>
        chiamataTool("leggi_promemoria_in_scadenza", {})
      ),
      messaggio: "Loop senza fine",
    });
    expect(esito.stato).toBe("degradato");
    expect(esito.testo).toContain("limite di passaggi");
  });

  it("un errore transitorio al PRIMO passo viene ritentato una volta sola e il run riesce", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    let chiamate = 0;
    const esito = await eseguiRun({
      contesto,
      provider: creaProviderFinto(() => {
        chiamate += 1;
        return chiamate === 1 ? "errore_transitorio" : rispostaTesto("Ripreso.");
      }),
      messaggio: "Riprova una volta",
    });
    expect(esito.stato).toBe("ok");
    expect(esito.testo).toBe("Ripreso.");
    expect(chiamate).toBe(2);
  });

  it("un errore transitorio DOPO il primo passo non viene ritentato: degradazione", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    let chiamate = 0;
    const esito = await eseguiRun({
      contesto,
      provider: creaProviderFinto((_richiesta, passo) => {
        chiamate += 1;
        return passo === 0
          ? chiamataTool("leggi_promemoria_in_scadenza", {})
          : "errore_transitorio";
      }),
      messaggio: "Transitorio tardivo",
    });
    expect(esito.stato).toBe("degradato");
    expect(chiamate).toBe(2); // nessun retry oltre il primo passo
  });

  it("tars.invia con la conversazione di un ALTRO utente → NOT_FOUND", async () => {
    const mia = await eseguiRun({
      contesto: await contestoRun(DIREZIONE_ID, ["direzione"]),
      provider: creaProviderFinto(() => rispostaTesto("Mia.")),
      messaggio: "Conversazione privata",
    });
    const altro = appRouter.createCaller(
      contestoTrpc(COMMERCIALE_ID, ["commerciale"])
    );
    await expect(
      altro.tars.invia({
        messaggio: "Mi intrometto",
        conversazioneId: mia.conversazioneId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tars — degradazione e sicurezza", () => {
  it("tars.invia rifiuta un archivio prima di provider, costi e reservation", async () => {
    const conversazione = await creaConversazione({
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
      titolo: "Sola lettura",
    });
    await impostaConversazioneArchiviata({
      conversazioneId: conversazione.id,
      sedeId: SEDE,
      utenteId: DIREZIONE_ID,
      archiviata: true,
    });
    const updatedAtPrima = (await conversazioneDiUtente(
      conversazione.id,
      SEDE,
      DIREZIONE_ID
    ))!.updatedAt.getTime();
    const ledgerR1 = creaLedgerEsecuzioniMemoriaPerTest();
    impostaLedgerEsecuzioniPerTest(ledgerR1);
    const ledgerCosti = creaLedgerMemoriaPerTest();
    impostaLedgerPerTest(ledgerCosti);
    const providerSpy = vi.spyOn(providerGovernato, "creaProviderPerRun");
    const reservationSpy = vi.spyOn(esecuzioniR1, "prenotaEsecuzioneR1");
    const costoSpy = vi.spyOn(ledgerCosti, "prenota");

    await expect(
      direzione().tars.invia({
        messaggio: "Prendi in carico il caso 1",
        conversazioneId: conversazione.id,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(providerSpy).not.toHaveBeenCalled();
    expect(reservationSpy).not.toHaveBeenCalled();
    expect(costoSpy).not.toHaveBeenCalled();
    await expect(ledgerR1.lista({ sedeId: SEDE })).resolves.toEqual([]);
    expect(ledgerCosti.righe()).toEqual([]);
    await expect(turniDiConversazione(conversazione.id, SEDE)).resolves.toEqual([]);
    expect((await conversazioneDiUtente(
      conversazione.id,
      SEDE,
      DIREZIONE_ID
    ))!.updatedAt.getTime()).toBe(updatedAtPrima);
  });

  it("provider rotto → risposta degradata onesta, mai un 500", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const provider = creaProviderFinto(() => "errore_fatale");
    const esito = await eseguiRun({
      contesto,
      provider,
      messaggio: "Qualsiasi cosa",
    });
    expect(esito.stato).toBe("degradato");
    expect(esito.testo).toContain("CRM funziona normalmente");
  });

  it("circuito: dopo errori ripetuti il provider non viene più chiamato per un po'", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    let chiamate = 0;
    const rotto = creaProviderFinto(() => {
      chiamate += 1;
      return "errore_fatale";
    });
    for (let i = 0; i < 3; i++) {
      await eseguiRun({
        contesto,
        provider: rotto,
        messaggio: `errore ${i}`,
      });
    }
    const chiamatePrima = chiamate;
    const esito = await eseguiRun({
      contesto,
      provider: rotto,
      messaggio: "ancora",
    });
    expect(esito.stato).toBe("degradato");
    expect(chiamate).toBe(chiamatePrima); // circuito aperto: zero chiamate
  });

  it("uno strumento fuori profilo invocato dal modello produce un errore-dato, non un'esecuzione", async () => {
    const contesto = await contestoRun(COMMERCIALE_ID, ["commerciale"]);
    let rispostaTool: string | null = null;
    const provider = creaProviderFinto((richiesta, passo) => {
      if (passo === 0) {
        return chiamataTool("leggi_analisi_ordine", { ordineId: 1 });
      }
      const ultimo = richiesta.input[richiesta.input.length - 1];
      rispostaTool = ultimo.contenuto;
      return rispostaTesto("ok");
    });
    await eseguiRun({ contesto, provider, messaggio: "prova" });
    expect(rispostaTool).toContain("non presente nel profilo autorizzato");
  });

  it("argomenti invalidi → errore tipizzato allo strumento, il run continua", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    let rispostaTool: string | null = null;
    const provider = creaProviderFinto((richiesta, passo) => {
      if (passo === 0) {
        return chiamataTool("leggi_commessa", { commessaId: "non-un-numero" });
      }
      rispostaTool = richiesta.input[richiesta.input.length - 1].contenuto;
      return rispostaTesto("gestito");
    });
    const esito = await eseguiRun({ contesto, provider, messaggio: "x" });
    expect(esito.stato).toBe("ok");
    expect(rispostaTool).toContain("ERRORE");
  });
});

describe("tars — strumenti: shaping e isolamento", () => {
  it("leggi_commessa: senza capability economiche gli importi NON partono e l'omissione è dichiarata", async () => {
    const commessa = await direzione().commesse.create({
      cliente: "Tars Shaping",
    });
    const strumento = STRUMENTI_L0.find(s => s.nome === "leggi_commessa")!;

    const perCommerciale = await strumento.esegui(
      await contestoRun(COMMERCIALE_ID, ["commerciale"]),
      { commessaId: commessa.id }
    );
    expect(perCommerciale.dati.economia).toBeNull();
    expect(perCommerciale.omissioni.join(" ")).toContain("economia");
    expect(JSON.stringify(perCommerciale)).not.toContain("importoTotale");

    const perDirezione = await strumento.esegui(
      await contestoRun(DIREZIONE_ID, ["direzione"]),
      { commessaId: commessa.id }
    );
    expect(perDirezione.dati.economia).not.toBeNull();
    expect(perDirezione.omissioni).toEqual([]);
  });

  it("cross-sede: una commessa di un'altra sede è NOT_FOUND, mai dati", async () => {
    const commessa = await direzione().commesse.create({
      cliente: "Tars Cross Sede",
    });
    const strumento = STRUMENTI_L0.find(s => s.nome === "leggi_commessa")!;
    await expect(
      strumento.esegui(
        await contestoRun(DIREZIONE_ID, ["direzione"], ALTRA_SEDE),
        { commessaId: commessa.id }
      )
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it("leggi_centro_azioni: lo scope di sede è negato ai non-direzione", async () => {
    const strumento = STRUMENTI_L0.find(
      s => s.nome === "leggi_centro_azioni"
    )!;
    await expect(
      strumento.esegui(await contestoRun(COMMERCIALE_ID, ["commerciale"]), {
        scope: "site",
        limite: 5,
      })
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("conversazioni: quelle di un altro utente o sede non si leggono", async () => {
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const provider = creaProviderFinto(() => rispostaTesto("ok"));
    const esito = await eseguiRun({
      contesto,
      provider,
      messaggio: "conversazione privata",
    });
    const callerCommerciale = appRouter.createCaller(
      contestoTrpc(COMMERCIALE_ID, ["commerciale"])
    );
    await expect(
      callerCommerciale.tars.turni({ conversazioneId: esito.conversazioneId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const callerAltraSede = appRouter.createCaller(
      contestoTrpc(DIREZIONE_ID, ["direzione"], ALTRA_SEDE)
    );
    await expect(
      callerAltraSede.tars.turni({ conversazioneId: esito.conversazioneId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
