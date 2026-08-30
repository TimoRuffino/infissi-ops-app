// Tars T1 — le prove del runtime read-only: kill switch non aggirabile,
// loop con strumenti e evidenze, cache C0/C1 misurate, degradazione
// onesta col provider rotto, circuito, shaping economico per capability,
// isolamento di sede, profili che escludono gli strumenti non autorizzati.
// Provider SEMPRE finto: nessuna chiamata di rete possibile.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getUtentiStore } from "../routers/utenti";
import { azzeraArchivioPerTest } from "./archivio";
import { costruisciContesto } from "./contesto";
import {
  azzeraCacheTarsPerTest,
  eseguiRun,
} from "./orchestratore";
import { creaProviderFinto, chiamataTool, rispostaTesto } from "./openai/fake";
import { filtraStrumenti, strumentiPerContesto } from "./profili";
import { STRUMENTI_L0 } from "./strumenti/letture";

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
});

afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_REMINDERS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
  delete process.env.FLAG_TARS_PROPOSALS;
});

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

  it("con FLAG_TARS_READ_TOOLS spento nessuno strumento L0 sopravvive", async () => {
    process.env.FLAG_TARS_READ_TOOLS = "off";
    const contesto = await contestoRun(DIREZIONE_ID, ["direzione"]);
    const strumenti = strumentiPerContesto(contesto);
    expect(strumenti.length).toBeGreaterThan(0); // le altre famiglie vivono
    expect(strumenti.every(s => s.livello !== "L0")).toBe(true);
  });

  it("con TUTTE le famiglie spente il profilo strumenti è vuoto", async () => {
    process.env.FLAG_TARS_READ_TOOLS = "off";
    process.env.FLAG_TARS_REMINDERS = "off";
    process.env.FLAG_TARS_L2_ACTIONS = "off";
    process.env.FLAG_TARS_PROPOSALS = "off";
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

describe("tars — run con strumenti, evidenze e cache", () => {
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

describe("tars — degradazione e sicurezza", () => {
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
