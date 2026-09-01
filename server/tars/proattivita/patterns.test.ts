// T7 — pattern aziendali: solo sede, campione minimo di commesse distinte,
// baseline e correlazione dichiarate, permanenza per fase dal registro
// transizioni reale, bypass del gate, zero importi e direzione-only.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { storeTransizioniCommessa } from "../../commesse/transizioni";
import {
  creaRepositoryOsservazioniMemoriaPerTest,
  impostaRepositoryOsservazioniPerTest,
  type RepositoryOsservazioni,
} from "./repository";
import {
  CAMPIONE_MINIMO_COMMESSE,
  calcolaPatternAzienda,
} from "./patterns";
import type { NuovaOsservazione } from "./types";

const SEDE = 95301;
const ALTRA_SEDE = 95302;
const NOW = new Date("2026-09-01T12:00:00.000Z");

let repository: RepositoryOsservazioni;

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

function transizione(input: {
  id: number;
  commessaId: number;
  da: string;
  a: string;
  at: string;
  bypass?: boolean;
  sedeId?: number;
}) {
  storeTransizioniCommessa.items.push({
    id: input.id,
    sedeId: input.sedeId ?? SEDE,
    commessaId: input.commessaId,
    origine: "ui",
    attoreUtenteId: 1,
    prima: { stato: input.da, versione: "v" },
    dopo: { stato: input.a, versione: "v" },
    bypassGateDocumentale: input.bypass ?? false,
    compensaTransizioneId: null,
    compensataDaId: null,
    createdAt: new Date(input.at),
  } as any);
}

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_PROACTIVE = "on";
  repository = creaRepositoryOsservazioniMemoriaPerTest();
  impostaRepositoryOsservazioniPerTest(repository);
  storeTransizioniCommessa.items.length = 0;
});

afterEach(() => {
  impostaRepositoryOsservazioniPerTest(null);
  storeTransizioniCommessa.items.length = 0;
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_PROACTIVE;
});

describe("calcolaPatternAzienda", () => {
  it("sotto il campione minimo il pattern è soppresso e dichiarato, mai inventato", async () => {
    for (let i = 0; i < CAMPIONE_MINIMO_COMMESSE - 1; i += 1) {
      await repository.upsert(osservazione({ commessaId: 100 + i }), NOW);
    }
    const esito = await calcolaPatternAzienda({ sedeId: SEDE, now: NOW });
    expect(esito.pattern.map(p => p.chiave)).not.toContain("ritardi_fornitore");
    const soppresso = esito.soppressi.find(
      s => s.chiave === "ritardi_fornitore"
    );
    expect(soppresso?.motivo).toContain("campione insufficiente");
  });

  it("dal campione minimo produce il pattern con periodo, campione, baseline e correlazione dichiarata", async () => {
    for (let i = 0; i < CAMPIONE_MINIMO_COMMESSE; i += 1) {
      await repository.upsert(osservazione({ commessaId: 200 + i }), NOW);
    }
    // Rumore di un'altra sede: non deve entrare.
    await repository.upsert(
      osservazione({ sedeId: ALTRA_SEDE, commessaId: 999 }),
      NOW
    );
    const esito = await calcolaPatternAzienda({ sedeId: SEDE, now: NOW });
    const pattern = esito.pattern.find(p => p.chiave === "ritardi_fornitore");
    expect(pattern).toBeDefined();
    expect(pattern!.campione).toMatchObject({
      commesse: CAMPIONE_MINIMO_COMMESSE,
      minimoCommesse: CAMPIONE_MINIMO_COMMESSE,
    });
    expect(pattern!.correlazione).toBe(true);
    expect(pattern!.avvertenza).toMatch(/correlazione/i);
    expect(pattern!.baseline.length).toBeGreaterThan(10);
    expect(pattern!.periodo.giorni).toBe(30);
    expect(pattern!.evidenze.length).toBeGreaterThan(0);
    expect(JSON.stringify(pattern)).not.toMatch(/€/);
  });

  it("misura la permanenza per fase dal registro transizioni reale, con baseline complessiva", async () => {
    // Tre commesse: ingresso in misure_esecutive e uscita dopo N giorni.
    let id = 1;
    for (const [commessa, giorni] of [
      [11, 10],
      [12, 20],
      [13, 30],
    ] as const) {
      transizione({
        id: id++,
        commessaId: commessa,
        da: "preventivo",
        a: "misure_esecutive",
        at: "2026-08-01T08:00:00.000Z",
      });
      transizione({
        id: id++,
        commessaId: commessa,
        da: "misure_esecutive",
        a: "aggiornamento_contratto",
        at: new Date(
          new Date("2026-08-01T08:00:00.000Z").getTime() +
            giorni * 86_400_000
        ).toISOString(),
      });
    }
    const esito = await calcolaPatternAzienda({ sedeId: SEDE, now: NOW });
    const permanenza = esito.pattern.find(p => p.chiave === "permanenza_fase");
    expect(permanenza).toBeDefined();
    expect(permanenza!.titolo).toContain("misure_esecutive");
    expect(permanenza!.misura).toContain("20.0 giorni");
    expect(permanenza!.campione.commesse).toBe(3);
    expect(permanenza!.baseline).toContain("permanenza media complessiva");
    expect(
      permanenza!.evidenze.every(e => e.tipo === "transizione")
    ).toBe(true);
  });

  it("conta i bypass del gate solo nella sede e nel periodo", async () => {
    let id = 100;
    for (const commessa of [21, 22, 23]) {
      transizione({
        id: id++,
        commessaId: commessa,
        da: "preventivo",
        a: "misure_esecutive",
        at: "2026-08-20T08:00:00.000Z",
        bypass: true,
      });
    }
    transizione({
      id: id++,
      commessaId: 24,
      da: "preventivo",
      a: "misure_esecutive",
      at: "2026-08-20T08:00:00.000Z",
      bypass: true,
      sedeId: ALTRA_SEDE,
    });
    // Fuori periodo: ignorata.
    transizione({
      id: id++,
      commessaId: 25,
      da: "preventivo",
      a: "misure_esecutive",
      at: "2026-01-01T08:00:00.000Z",
      bypass: true,
    });
    const esito = await calcolaPatternAzienda({ sedeId: SEDE, now: NOW });
    const gate = esito.pattern.find(p => p.chiave === "documenti_gate");
    expect(gate).toBeDefined();
    expect(gate!.campione).toMatchObject({ commesse: 3, eventi: 3 });
  });
});

describe("panorama via router e tool", () => {
  function contestoTrpc(roles: string[]): TrpcContext {
    return {
      user: {
        id: 95311,
        role: roles.includes("direzione") ? "admin" : "user",
        ruolo: roles[0],
        ruoli: roles,
        name: "Utente panorama",
      } as any,
      req: { protocol: "http", headers: {} } as any,
      res: {} as any,
      sedeId: SEDE,
      sediIds: [SEDE],
    };
  }

  it("il router espone il panorama solo alla direzione", async () => {
    await expect(
      appRouter.createCaller(contestoTrpc(["commerciale"])).tars.panorama()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const esito = await appRouter
      .createCaller(contestoTrpc(["direzione"]))
      .tars.panorama({ finestraGiorni: 14 });
    expect(esito!.periodo.giorni).toBe(14);
    expect(Array.isArray(esito!.pattern)).toBe(true);
  });

  it("con il flag proattività spento il panorama non esiste", async () => {
    process.env.FLAG_TARS_PROACTIVE = "off";
    await expect(
      appRouter.createCaller(contestoTrpc(["direzione"])).tars.panorama()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
