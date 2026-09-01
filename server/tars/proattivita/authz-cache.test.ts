// T9 — cache e authz: le chiavi portano sede e perimetro del principal,
// le viste non si condividono tra utenti/sedi, il fascicolo in cache resta
// al pavimento non economico e si invalida su documenti e cambio giorno.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { fascicoloCommessa } from "../fascicoli";
import { azzeraCachePersistentePerTest, leggiVoceCache } from "../cache/entries";
import {
  creaRepositoryOsservazioniMemoriaPerTest,
  impostaRepositoryOsservazioniPerTest,
  type RepositoryOsservazioni,
} from "./repository";
import { osservaDaReconcile } from "./worker";
import type { ActionCaseDraft } from "../../actionCenter/types";

const SEDE = 95601;
const DIREZIONE_ID = 95611;

function contestoTrpc(roles: string[], sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: DIREZIONE_ID,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: "Utente cache",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) =>
  appRouter.createCaller(contestoTrpc(["direzione"], sedeId));

let repository: RepositoryOsservazioni;

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_READ_TOOLS = "on";
  process.env.FLAG_TARS_PROACTIVE = "on";
  process.env.TARS_OBSERVER_MODE = "active";
  azzeraCachePersistentePerTest();
  repository = creaRepositoryOsservazioniMemoriaPerTest();
  impostaRepositoryOsservazioniPerTest(repository);
});

afterEach(() => {
  impostaRepositoryOsservazioniPerTest(null);
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_PROACTIVE;
  delete process.env.TARS_OBSERVER_MODE;
  vi.restoreAllMocks();
});

describe("fascicolo C3 in cache", () => {
  it("la chiave è per sede+commessa, le versioni includono documenti e giorno locale, il payload resta non economico", async () => {
    const commessa = await direzione().commesse.create({
      cliente: "Cache Fascicolo",
    });
    const fascicolo = await fascicoloCommessa({
      sedeId: SEDE,
      commessaId: commessa.id,
    });
    expect(fascicolo).not.toBeNull();

    const voce = await leggiVoceCache(
      `fascicolo:commessa:${SEDE}:${commessa.id}`,
      SEDE
    );
    expect(voce).not.toBeNull();
    expect(Object.keys(voce!.versioni)).toEqual(
      expect.arrayContaining([
        `commessa:${commessa.id}`,
        `documenti-di-commessa:${commessa.id}`,
        `ordini-di-commessa:${commessa.id}`,
        "giorno-locale",
      ])
    );
    // Pavimento non economico PER COSTRUZIONE: mai importi nel payload.
    const serializzato = JSON.stringify(voce!.payload);
    expect(serializzato).not.toMatch(/importoTotale|importoIncassato|€/);
    // Il derivato binario consentito a tutti resta un booleano.
    expect(typeof (voce!.payload as any).daSaldare).toBe("boolean");
  });

  it("la voce non è leggibile dalla sede sbagliata", async () => {
    const commessa = await direzione().commesse.create({
      cliente: "Cache Sede",
    });
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(
      await leggiVoceCache(
        `fascicolo:commessa:${SEDE}:${commessa.id}`,
        SEDE + 1
      )
    ).toBeNull();
  });
});

describe("osservazioni — nessuna cache di vista condivisa", () => {
  function draft(): ActionCaseDraft {
    return {
      canonicalKey: "commessa:9001:consegna",
      sedeId: SEDE,
      targetType: "commessa",
      targetId: 9001,
      commessaId: 9001,
      clienteId: null,
      title: "Consegna in ritardo",
      priority: "alta",
      priorityScore: 70,
      assigneeUserId: null,
      dueAt: null,
      link: "/commesse/9001",
      signals: [],
      signalFingerprint: "fp-1",
      nextAction: { sourceKind: "consegna_fornitore", label: "Contatta" },
    };
  }

  it("ogni richiesta rilegge e rifiltra dal repository: niente vista memorizzata", async () => {
    await osservaDaReconcile({
      sedeId: SEDE,
      drafts: [draft()],
      now: new Date("2026-09-01T10:00:00.000Z"),
    });
    const spia = vi.spyOn(repository, "lista");
    await direzione().tars.osservazioni();
    await direzione().tars.osservazioni();
    expect(spia).toHaveBeenCalledTimes(2);
    // Il filtro sede è passato a OGNI chiamata, mai derivato da una vista.
    expect(spia.mock.calls.every(call => call[0].sedeId === SEDE)).toBe(true);
  });
});
