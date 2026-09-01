// T6 — osservatore persistente: dedup, cooldown, materialità, riapertura a
// fingerprint nuovo, floor non economico, isolamento sede e shadow/active.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import type { ActionCaseDraft } from "../../actionCenter/types";
import { derivaOsservazione, senzaImporti } from "./rules";
import {
  creaRepositoryOsservazioniMemoriaPerTest,
  impostaRepositoryOsservazioniPerTest,
  type RepositoryOsservazioni,
} from "./repository";
import { COOLDOWN_AUTO_RISOLUZIONE_MS } from "./types";
import { osservaDaReconcile, osservatoreEspone } from "./worker";

const SEDE = 94201;
const ALTRA_SEDE = 94202;

function draft(overrides: Partial<ActionCaseDraft> = {}): ActionCaseDraft {
  return {
    canonicalKey: "commessa:701:consegna",
    sedeId: SEDE,
    targetType: "commessa",
    targetId: 701,
    commessaId: 701,
    clienteId: null,
    title: "Consegna vetri in ritardo sulla commessa C-701",
    priority: "alta",
    priorityScore: 70,
    assigneeUserId: null,
    dueAt: null,
    link: "/commesse/701",
    signals: [
      {
        sourceKey: "consegna:701",
        kind: "consegna_fornitore",
        sedeId: SEDE,
        targetType: "commessa",
        targetId: 701,
        commessaId: 701,
        clienteId: null,
        title: "Consegna in ritardo",
        summary: "Ordine ORD-10 senza conferma",
        actionLabel: "Contatta il fornitore",
        priority: "alta",
        priorityScore: 70,
        assigneeUserId: null,
        targetRole: null,
        dueAt: null,
        occurredAt: new Date("2026-09-01T08:00:00.000Z"),
        link: "/commesse/701",
        fingerprint: "fp-1",
      },
    ],
    signalFingerprint: "fp-1",
    nextAction: { sourceKind: "consegna_fornitore", label: "Contatta il fornitore" },
    ...overrides,
  };
}

let repository: RepositoryOsservazioni;
const T0 = new Date("2026-09-01T09:00:00.000Z");

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_PROACTIVE = "on";
  delete process.env.TARS_OBSERVER_MODE;
  repository = creaRepositoryOsservazioniMemoriaPerTest();
  impostaRepositoryOsservazioniPerTest(repository);
});

afterEach(() => {
  impostaRepositoryOsservazioniPerTest(null);
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_PROACTIVE;
  delete process.env.TARS_OBSERVER_MODE;
});

describe("regole deterministiche", () => {
  it("filtra il rumore per materialità e classifica priorità/confidenza", () => {
    expect(
      derivaOsservazione(draft({ priority: "normale", priorityScore: 10 }))
    ).toBeNull();
    const materiale = derivaOsservazione(
      draft({ priority: "critica", priorityScore: 95 })
    );
    expect(materiale).toMatchObject({
      materialita: "alta",
      detector: "consegna_fornitore",
    });
  });

  it("nessun importo sopravvive nelle sintesi, qualunque sia la fonte", () => {
    expect(senzaImporti("Saldo residuo € 12.500,00 da incassare")).not.toContain(
      "12.500"
    );
    const osservazione = derivaOsservazione(
      draft({
        title: "Saldo residuo 1.250,00 € sulla commessa",
        nextAction: { sourceKind: "saldo", label: "Richiedi il saldo di 1.250,00 €" },
      })
    );
    expect(osservazione!.titolo).not.toMatch(/1\.250/);
    expect(osservazione!.sintesi).not.toMatch(/1\.250/);
    expect(osservazione!.sintesi).toContain("[importo riservato]");
  });
});

describe("worker — dedup, cooldown e auto-risoluzione", () => {
  it("stesso caso e stessa evidenza: una sola osservazione, poi invariata", async () => {
    const primo = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft()],
      now: T0,
    });
    expect(primo).toMatchObject({ aperte: 1 });
    const secondo = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft()],
      now: new Date(T0.getTime() + 60_000),
    });
    expect(secondo).toMatchObject({ aperte: 0, invariate: 1 });
    const lista = await repository.lista({ sedeId: SEDE });
    expect(lista).toHaveLength(1);
    expect(lista[0].storico.map(evento => evento.tipo)).toEqual(["aperta"]);
  });

  it("evidenze nuove aggiornano l'osservazione con storico append-only", async () => {
    await osservaDaReconcile({ sedeId: SEDE, drafts: [draft()], now: T0 });
    await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft({ signalFingerprint: "fp-2" })],
      now: new Date(T0.getTime() + 60_000),
    });
    const [osservazione] = await repository.lista({ sedeId: SEDE });
    expect(osservazione.fingerprint).toBe("fp-2");
    expect(osservazione.storico.map(evento => evento.tipo)).toEqual([
      "aperta",
      "aggiornata",
    ]);
  });

  it("caso sparito → auto-risolta con cooldown; la stessa evidenza non riapre subito, una nuova sì", async () => {
    await osservaDaReconcile({ sedeId: SEDE, drafts: [draft()], now: T0 });
    const secondo = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [],
      now: new Date(T0.getTime() + 60_000),
    });
    expect(secondo).toMatchObject({ autoRisolte: 1 });
    let [osservazione] = await repository.lista({ sedeId: SEDE });
    expect(osservazione.stato).toBe("auto_risolta");
    expect(osservazione.cooldownFinoA).not.toBeNull();

    // Stessa evidenza dentro il cooldown: resta risolta.
    const dentroCooldown = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft()],
      now: new Date(T0.getTime() + 120_000),
    });
    expect(dentroCooldown).toMatchObject({ riaperte: 0 });
    [osservazione] = await repository.lista({ sedeId: SEDE });
    expect(osservazione.stato).toBe("auto_risolta");

    // Evidenza NUOVA dentro il cooldown: riapre subito.
    const evidenzaNuova = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft({ signalFingerprint: "fp-3" })],
      now: new Date(T0.getTime() + 180_000),
    });
    expect(evidenzaNuova).toMatchObject({ riaperte: 1 });
    [osservazione] = await repository.lista({ sedeId: SEDE });
    expect(osservazione.stato).toBe("aperta");
    expect(osservazione.storico.map(evento => evento.tipo)).toEqual([
      "aperta",
      "auto_risolta",
      "riaperta",
    ]);
  });

  it("stessa evidenza DOPO il cooldown: la condizione è tornata e riapre", async () => {
    await osservaDaReconcile({ sedeId: SEDE, drafts: [draft()], now: T0 });
    await osservaDaReconcile({ sedeId: SEDE, drafts: [], now: new Date(T0.getTime() + 1000) });
    const dopoCooldown = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft()],
      now: new Date(T0.getTime() + COOLDOWN_AUTO_RISOLUZIONE_MS + 2000),
    });
    expect(dopoCooldown).toMatchObject({ riaperte: 1 });
  });

  it("un caso vivo sceso sotto materialità NON auto-risolve; un detector dismesso sì", async () => {
    await osservaDaReconcile({ sedeId: SEDE, drafts: [draft()], now: T0 });
    // Il caso esiste ancora ma scende sotto soglia: resta aperta.
    const sottoSoglia = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft({ priority: "normale", priorityScore: 10 })],
      now: new Date(T0.getTime() + 60_000),
    });
    expect(sottoSoglia).toMatchObject({ autoRisolte: 0 });
    let [osservazione] = await repository.lista({ sedeId: SEDE });
    expect(osservazione.stato).toBe("aperta");

    // Il caso cambia detector: la riga del detector vecchio si chiude.
    const cambioDetector = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [
        draft({
          nextAction: { sourceKind: "saldo", label: "Richiedi saldo" },
          signalFingerprint: "fp-saldo",
        }),
      ],
      now: new Date(T0.getTime() + 120_000),
    });
    expect(cambioDetector).toMatchObject({ autoRisolte: 1 });
    const perDetector = await repository.lista({ sedeId: SEDE });
    expect(
      perDetector.find(o => o.detector === "consegna_fornitore")?.stato
    ).toBe("auto_risolta");
    expect(perDetector.find(o => o.detector === "saldo")?.stato).toBe(
      "aperta"
    );
  });

  it("isola le sedi in scrittura e in lettura", async () => {
    await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft(), draft({ sedeId: ALTRA_SEDE, canonicalKey: "x" })],
      now: T0,
    });
    expect(await repository.lista({ sedeId: SEDE })).toHaveLength(1);
    expect(await repository.lista({ sedeId: ALTRA_SEDE })).toHaveLength(0);
  });

  it("con il flag spento non scrive nulla (fail-closed)", async () => {
    process.env.FLAG_TARS_PROACTIVE = "off";
    const esito = await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft()],
      now: T0,
    });
    expect(esito).toBeNull();
    expect(await repository.lista({ sedeId: SEDE })).toHaveLength(0);
  });
});

describe("shadow vs active", () => {
  function contestoTrpc(roles: string[], sedeId = SEDE): TrpcContext {
    return {
      user: {
        id: 94211,
        role: roles.includes("direzione") ? "admin" : "user",
        ruolo: roles[0],
        ruoli: roles,
        name: "Utente osservatore",
      } as any,
      req: { protocol: "http", headers: {} } as any,
      res: {} as any,
      sedeId,
      sediIds: [sedeId],
    };
  }

  it("in shadow calcola e persiste ma il router non espone", async () => {
    await osservaDaReconcile({ sedeId: SEDE, drafts: [draft()], now: T0 });
    expect(osservatoreEspone()).toBe(false);
    await expect(
      appRouter.createCaller(contestoTrpc(["direzione"])).tars.osservazioni()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("in active espone alla sede giusta, senza importi e senza payload interni", async () => {
    process.env.TARS_OBSERVER_MODE = "active";
    await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [
        draft({
          title: "Saldo in ritardo 2.400,00 €",
          nextAction: { sourceKind: "saldo", label: "Richiedi saldo" },
        }),
      ],
      now: T0,
    });
    const lista = await appRouter
      .createCaller(contestoTrpc(["direzione"]))
      .tars.osservazioni();
    expect(lista).toHaveLength(1);
    expect(lista![0].titolo).not.toContain("2.400");
    expect(lista![0]).not.toHaveProperty("casoKey");
    expect(lista![0]).not.toHaveProperty("storico");

    const altraSede = await appRouter
      .createCaller(contestoTrpc(["direzione"], ALTRA_SEDE))
      .tars.osservazioni();
    expect(altraSede).toHaveLength(0);
  });
});
