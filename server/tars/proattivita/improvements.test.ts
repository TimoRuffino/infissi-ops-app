// T8 — proposte di miglioramento: nascono solo da pattern sopra soglia,
// sono inerti e complete, il feedback muove cooldown/ranking e mai policy,
// «accetta» registra una decisione senza toccare il CRM.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { REGISTRO_AZIONI, VERSIONE_REGISTRO_AZIONI } from "../azioni/registry";
import { statoInterruttori } from "../../platform/interruttori";
import {
  creaRepositoryOsservazioniMemoriaPerTest,
  impostaRepositoryOsservazioniPerTest,
  type RepositoryOsservazioni,
} from "./repository";
import {
  COOLDOWN_FEEDBACK_MS,
  accettaMiglioramento,
  creaRepositoryMiglioramentiMemoriaPerTest,
  derivaMiglioramenti,
  impostaRepositoryMiglioramentiPerTest,
  registraFeedbackMiglioramento,
  type RepositoryMiglioramenti,
} from "./improvements";
import { CAMPIONE_MINIMO_COMMESSE } from "./patterns";
import type { NuovaOsservazione } from "./types";

const SEDE = 95401;
const NOW = new Date("2026-09-01T12:00:00.000Z");

let osservazioni: RepositoryOsservazioni;
let miglioramenti: RepositoryMiglioramenti;

function osservazione(
  overrides: Partial<NuovaOsservazione> = {}
): NuovaOsservazione {
  return {
    sedeId: SEDE,
    casoKey: `caso-${Math.random().toString(36).slice(2, 10)}`,
    detector: "consegna_fornitore",
    detectorVersione: "1.0.0",
    fingerprint: "fp",
    commessaId: 1,
    targetType: "commessa",
    targetId: 1,
    titolo: "Consegna in ritardo",
    sintesi: "Consegna in ritardo — prossima azione: contatta il fornitore",
    priorita: "alta",
    materialita: "media",
    confidenza: "media",
    ...overrides,
  };
}

async function alimentaPatternFornitore(commesse = CAMPIONE_MINIMO_COMMESSE) {
  for (let i = 0; i < commesse; i += 1) {
    await osservazioni.upsert(osservazione({ commessaId: 300 + i }), NOW);
  }
}

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_PROACTIVE = "on";
  osservazioni = creaRepositoryOsservazioniMemoriaPerTest();
  impostaRepositoryOsservazioniPerTest(osservazioni);
  miglioramenti = creaRepositoryMiglioramentiMemoriaPerTest();
  impostaRepositoryMiglioramentiPerTest(miglioramenti);
});

afterEach(() => {
  impostaRepositoryOsservazioniPerTest(null);
  impostaRepositoryMiglioramentiPerTest(null);
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_PROACTIVE;
});

describe("derivaMiglioramenti", () => {
  it("senza pattern sopra soglia non nasce nessuna proposta", async () => {
    await alimentaPatternFornitore(CAMPIONE_MINIMO_COMMESSE - 1);
    const esito = await derivaMiglioramenti({ sedeId: SEDE, now: NOW });
    expect(esito.proposte).toEqual([]);
  });

  it("dal pattern sopra soglia nasce una proposta completa e inerte", async () => {
    await alimentaPatternFornitore();
    const esito = await derivaMiglioramenti({ sedeId: SEDE, now: NOW });
    expect(esito.proposte).toHaveLength(1);
    const proposta = esito.proposte[0];
    expect(proposta.chiavePattern).toBe("ritardi_fornitore");
    for (const campo of [
      "problema",
      "baseline",
      "impatto",
      "soluzione",
      "metrica",
      "esperimento",
      "rollout",
      "rollback",
    ] as const) {
      expect(String(proposta[campo]).length).toBeGreaterThan(10);
    }
    expect(proposta.responsabileSuggerito.length).toBeGreaterThan(0);
    expect(proposta.alternative.length).toBeGreaterThan(0);
    expect(proposta.rischi.length).toBeGreaterThan(0);
    expect(proposta.test.length).toBeGreaterThan(0);
    expect(proposta.evidenze.length).toBeGreaterThan(0);
    expect(proposta.stato).toBe("proposta");
  });

  it("è deduplicata per chiave: la stessa situazione non genera doppioni", async () => {
    await alimentaPatternFornitore();
    const prima = await derivaMiglioramenti({ sedeId: SEDE, now: NOW });
    const seconda = await derivaMiglioramenti({
      sedeId: SEDE,
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(prima.proposte[0].id).toBe(seconda.proposte[0].id);
    expect(await miglioramenti.lista(SEDE)).toHaveLength(1);
  });
});

describe("feedback e accettazione", () => {
  it("troppo_rumore scarta con cooldown: la proposta non rinasce nel periodo", async () => {
    await alimentaPatternFornitore();
    const [proposta] = (
      await derivaMiglioramenti({ sedeId: SEDE, now: NOW })
    ).proposte;
    const dopoFeedback = await registraFeedbackMiglioramento({
      sedeId: SEDE,
      id: proposta.id,
      feedback: "troppo_rumore",
      utenteId: 9,
      now: NOW,
    });
    expect(dopoFeedback.stato).toBe("scartata");
    expect(dopoFeedback.cooldownFinoA!.getTime()).toBe(
      NOW.getTime() + COOLDOWN_FEEDBACK_MS
    );
    const rigenerata = await derivaMiglioramenti({
      sedeId: SEDE,
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(rigenerata.proposte).toEqual([]);
    expect(rigenerata.soppresse.join(" ")).toContain("ritardi_fornitore");
  });

  it("il feedback muove solo ranking/cooldown: registro azioni e flag restano identici", async () => {
    await alimentaPatternFornitore();
    const [proposta] = (
      await derivaMiglioramenti({ sedeId: SEDE, now: NOW })
    ).proposte;
    const registroPrima = REGISTRO_AZIONI.map(a => a.nome).join(",");
    const versionePrima = VERSIONE_REGISTRO_AZIONI;
    const flagPrima = JSON.stringify(statoInterruttori());
    const dopo = await registraFeedbackMiglioramento({
      sedeId: SEDE,
      id: proposta.id,
      feedback: "non_utile",
      utenteId: 9,
      now: NOW,
    });
    expect(dopo.ranking).toBe(proposta.ranking - 30);
    expect(dopo.stato).toBe("proposta");
    expect(REGISTRO_AZIONI.map(a => a.nome).join(",")).toBe(registroPrima);
    expect(VERSIONE_REGISTRO_AZIONI).toBe(versionePrima);
    expect(JSON.stringify(statoInterruttori())).toBe(flagPrima);
  });

  it("accetta registra la decisione e non esegue nulla", async () => {
    await alimentaPatternFornitore();
    const [proposta] = (
      await derivaMiglioramenti({ sedeId: SEDE, now: NOW })
    ).proposte;
    const accettata = await accettaMiglioramento({
      sedeId: SEDE,
      id: proposta.id,
      utenteId: 9,
      nota: "da pianificare nel Q4",
      now: NOW,
    });
    expect(accettata.stato).toBe("accettata");
    expect(accettata.decisione).toMatchObject({ utenteId: 9, nota: "da pianificare nel Q4" });
    // Idempotente al doppio click.
    const seconda = await accettaMiglioramento({
      sedeId: SEDE,
      id: proposta.id,
      utenteId: 10,
      now: new Date(NOW.getTime() + 1000),
    });
    expect(seconda.decisione!.utenteId).toBe(9);
  });
});

describe("esposizione direzione-only", () => {
  function contestoTrpc(roles: string[]): TrpcContext {
    return {
      user: {
        id: 95411,
        role: roles.includes("direzione") ? "admin" : "user",
        ruolo: roles[0],
        ruoli: roles,
        name: "Utente miglioramenti",
      } as any,
      req: { protocol: "http", headers: {} } as any,
      res: {} as any,
      sedeId: SEDE,
      sediIds: [SEDE],
    };
  }

  it("lista, feedback e accettazione passano dal router solo per la direzione", async () => {
    await alimentaPatternFornitore();
    await expect(
      appRouter.createCaller(contestoTrpc(["commerciale"])).tars.miglioramenti()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const direzione = appRouter.createCaller(contestoTrpc(["direzione"]));
    const lista = await direzione.tars.miglioramenti();
    expect(lista!.proposte).toHaveLength(1);
    const id = lista!.proposte[0].id;
    const dopoFeedback = await direzione.tars.miglioramentoFeedback({
      id,
      feedback: "utile",
    });
    expect(dopoFeedback!.feedback).toBe("utile");
    const accettata = await direzione.tars.miglioramentoAccetta({ id });
    expect(accettata!.stato).toBe("accettata");
  });
});
