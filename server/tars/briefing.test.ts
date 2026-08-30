// Tars T4 — le prove del briefing e della proattività SHADOW: la
// derivazione è deterministica e senza emissioni (nessun caso, notifica
// o promemoria creato), le segnalazioni si agganciano ai casi APERTI del
// Centro Azioni invece di duplicarli, la sezione esiste solo con
// FLAG_TARS_PROACTIVE, niente importi nel payload, cross-sede isolato,
// e il rumore finisce in telemetria (run `proattivita-shadow`).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { getActionCaseRepository } from "../actionCenter/repository";
import {
  createMemoryNotificationRepository,
} from "../notifications/repository";
import { createMemoryReminderRepository } from "../reminders/repository";
import {
  createReminderService,
  setReminderServiceForTesting,
} from "../reminders/service";
import { appRouter } from "../routers";
import { azzeraArchivioPerTest, statisticheRun } from "./archivio";
import { costruisciBriefing } from "./briefing";
import { costruisciContesto } from "./contesto";
import { azzeraCacheTarsPerTest } from "./orchestratore";

const SEDE = 99001;
const ALTRA_SEDE = 99002;
const UTENTE_ID = 99011;

function contestoTrpc(sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: UTENTE_ID,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione T4",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) => appRouter.createCaller(contestoTrpc(sedeId));

let servizioPromemoria: ReturnType<typeof createReminderService>;

beforeEach(() => {
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
  servizioPromemoria = createReminderService({
    reminders: createMemoryReminderRepository(),
    notifications: createMemoryNotificationRepository(),
  });
  setReminderServiceForTesting(servizioPromemoria);
});

afterEach(() => {
  setReminderServiceForTesting(null);
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_PROACTIVE;
});

async function scenario() {
  const commessa = await direzione().commesse.create({
    cliente: "Briefing T4 Srl",
  });
  await direzione().commesse.update({
    id: commessa.id,
    dataConsegnaConfermata: "2026-09-01",
  } as any);
  const fornitore = await direzione().fornitori.create({
    ragioneSociale: "Fornitore Briefing Srl",
    partitaIva: "09876543210",
    categoria: "alluminio",
  });
  // In ritardo E in conflitto con la data confermata.
  const ordine = await direzione().fornitori.ordini.create({
    fornitoreId: fornitore.id,
    commessaId: commessa.id,
    codiceOrdine: `ORD-T4-${commessa.id}`,
    dataConsegnaPrevista: "2026-09-15",
    righe: [{ descrizione: "Profili", quantita: 1, unitaMisura: "pz" }],
  });
  const inRitardo = await direzione().fornitori.ordini.create({
    fornitoreId: fornitore.id,
    commessaId: commessa.id,
    codiceOrdine: `ORD-T4-${commessa.id}-late`,
    dataConsegnaPrevista: "2020-01-01",
    righe: [{ descrizione: "Vetri", quantita: 1, unitaMisura: "pz" }],
  });
  return { commessa, fornitore, ordine, inRitardo };
}

describe("tars T4 — briefing deterministico", () => {
  it("contiene i promemoria di oggi, i casi mine e le segnalazioni shadow", async () => {
    const { commessa } = await scenario();
    await servizioPromemoria.createApproved({
      sedeId: SEDE,
      requestedByUserId: UTENTE_ID,
      sourceProposalId: null,
      actionKey: "t4:oggi",
      text: "Chiamare il cliente del briefing",
      remindAtIso: new Date(Date.now() + 60_000).toISOString(),
      clienteId: null,
      commessaId: null,
    });

    const briefing = await costruisciBriefing(
      await costruisciContesto(contestoTrpc())
    );
    expect(briefing.promemoriaOggi.map(p => p.testo)).toContain(
      "Chiamare il cliente del briefing"
    );
    expect(Array.isArray(briefing.casiMiei)).toBe(true);
    expect(briefing.segnalazioni).not.toBeNull();
    const mie = briefing.segnalazioni!.filter(
      s => s.commessaId === commessa.id
    );
    expect(mie.map(s => s.tipo)).toContain("ordine_in_ritardo");
    expect(mie.map(s => s.tipo)).toContain("conflitto_consegna");
  });

  it("ANTI-LEAK: il briefing non contiene importi", async () => {
    await scenario();
    const briefing = await costruisciBriefing(
      await costruisciContesto(contestoTrpc())
    );
    expect(JSON.stringify(briefing)).not.toMatch(/importo|prezzo|residuo/i);
  });

  it("SHADOW: nessuna emissione — niente casi nuovi, niente promemoria creati", async () => {
    await scenario();
    const repo = getActionCaseRepository();
    const prima = await repo.list({ sedeId: SEDE, limit: 200 });
    await costruisciBriefing(await costruisciContesto(contestoTrpc()));
    const dopo = await repo.list({ sedeId: SEDE, limit: 200 });
    expect(dopo.items.length).toBe(prima.items.length);
    const promemoria = await servizioPromemoria.listPersonal(
      { sedeId: SEDE, recipientUserId: UTENTE_ID },
      { stati: ["scheduled", "due", "completed", "cancelled"] }
    );
    expect(promemoria).toHaveLength(0);
  });

  it("le segnalazioni si AGGANCIANO ai casi aperti invece di duplicarli", async () => {
    const { commessa } = await scenario();
    const adesso = new Date();
    await getActionCaseRepository().upsertDraft(
      {
        canonicalKey: `t4:caso:${commessa.id}`,
        sedeId: SEDE,
        targetType: "commessa",
        targetId: commessa.id,
        commessaId: commessa.id,
        clienteId: null,
        title: "Caso esistente di prova",
        priority: "alta",
        priorityScore: 80,
        assigneeUserId: null,
        dueAt: null,
        link: `/commesse/${commessa.id}`,
        signals: [],
        signalFingerprint: "t4-prova",
        nextAction: { sourceKind: "consegna_fornitore", label: "Verifica" },
      },
      adesso
    );
    const briefing = await costruisciBriefing(
      await costruisciContesto(contestoTrpc())
    );
    const mie = briefing.segnalazioni!.filter(
      s => s.commessaId === commessa.id
    );
    expect(mie.length).toBeGreaterThan(0);
    expect(mie.every(s => s.agganciataACasoAperto)).toBe(true);
  });

  it("con FLAG_TARS_PROACTIVE spento la sezione segnalazioni non esiste", async () => {
    await scenario();
    process.env.FLAG_TARS_PROACTIVE = "off";
    const briefing = await costruisciBriefing(
      await costruisciContesto(contestoTrpc())
    );
    expect(briefing.segnalazioni).toBeNull();
  });

  it("cross-sede: le segnalazioni di un'altra sede non appaiono", async () => {
    await scenario();
    const briefing = await costruisciBriefing(
      await costruisciContesto(contestoTrpc(ALTRA_SEDE))
    );
    expect(briefing.segnalazioni).toEqual([]);
  });

  it("il rumore finisce in telemetria e l'endpoint sta dietro i kill switch", async () => {
    await scenario();
    const prima = await statisticheRun(SEDE);
    const briefing = await direzione().tars.briefing();
    expect(briefing.generatoIl).toBeTruthy();
    const dopo = await statisticheRun(SEDE);
    expect(dopo.totale).toBeGreaterThan(prima.totale);

    process.env.FLAG_TARS = "off";
    await expect(direzione().tars.briefing()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
