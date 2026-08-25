import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { getTarsConfig, proposte } from "./stores";
import { getTarsPlanRepository } from "./planner/repository";

function context(sedeId: number): TrpcContext {
  return {
    user: {
      id: 1,
      role: "admin",
      ruoli: ["direzione"],
      name: "Direzione",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

function userContext(sedeId: number, userId: number, ruolo = "commerciale") {
  const ctx = context(sedeId);
  ctx.user = {
    id: userId,
    role: ruolo,
    ruolo,
    ruoli: [ruolo],
    name: `U${userId}`,
  } as any;
  return ctx;
}

async function createPlan(input: {
  sedeId: number;
  operationKey: string;
  createdBy: number;
  assigneeId?: number;
}) {
  return (
    await getTarsPlanRepository().create({
      sedeId: input.sedeId,
      operationKey: input.operationKey,
      workflowId: "manage-lead-v1",
      workflowVersion: 1,
      intent: "create_customer_job",
      riskClass: "medium",
      requiredCapabilities: ["cliente.create", "commessa.create"],
      entityRefs: [],
      input: input.assigneeId ? { assigneeId: input.assigneeId } : {},
      createdBy: input.createdBy,
      createdAt: new Date(),
      steps: [
        { key: "read", type: "read", dependencies: [], input: {} },
        {
          key: "ask",
          type: "ask",
          dependencies: ["read"],
          input: { question: "A chi assegno?" },
        },
      ],
    })
  ).plan;
}

describe("tars.commandCenter", () => {
  const ids = [991_001, 991_002];

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    getTarsConfig(1).attivo = true;
    getTarsConfig(2).attivo = true;
    proposte.push(
      {
        id: ids[0],
        sedeId: 1,
        tipo: "collega_comunicazione",
        titolo: "Collega la richiesta alla commessa",
        motivazione: "Il codice commessa è presente nella comunicazione",
        confidenza: "alta",
        payload: { comunicazioneId: 71, canale: "email" },
        commessaId: 12,
        clienteId: 8,
        opzioni: null,
        risposta: null,
        stato: "pendente",
        esito: null,
        motivoRifiuto: null,
        esecuzioneId: null,
        trigger: "smistamento",
        createdAt: new Date(),
        decisaAt: null,
        decisaDa: null,
        decisaDaNome: null,
        seguitoAt: null,
        seguitoEsecuzioneId: null,
        origineId: null,
        chiaveAzione: "collega:email:71:commessa:12",
      },
      {
        id: ids[1],
        sedeId: 2,
        tipo: "ticket",
        titolo: "Dato di un'altra sede",
        motivazione: "Non deve essere visibile",
        confidenza: "alta",
        payload: {},
        commessaId: 99,
        clienteId: null,
        opzioni: null,
        risposta: null,
        stato: "pendente",
        esito: null,
        motivoRifiuto: null,
        esecuzioneId: null,
        trigger: "test",
        createdAt: new Date(),
        decisaAt: null,
        decisaDa: null,
        decisaDaNome: null,
        seguitoAt: null,
        seguitoEsecuzioneId: null,
        origineId: null,
        chiaveAzione: "ticket:altra-sede",
      }
    );
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    for (const id of ids) {
      const index = proposte.findIndex(item => item.id === id);
      if (index >= 0) proposte.splice(index, 1);
    }
  });

  it("restituisce solo priorità della sede attiva con fonti", async () => {
    const result = await appRouter
      .createCaller(context(1))
      .tars.commandCenter.get({ limit: 8 });

    expect(result.priorities.some(item => item.proposalId === ids[0])).toBe(
      true
    );
    expect(result.priorities.some(item => item.proposalId === ids[1])).toBe(
      false
    );
    expect(
      result.priorities.find(item => item.proposalId === ids[0])?.evidence
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "email", id: "71" }),
      ])
    );
  });

  it("mostra piani propri e assegnati, mentre direzione vede tutta la sede", async () => {
    const sedeId = 991;
    getTarsConfig(sedeId).attivo = true;
    const own = await createPlan({
      sedeId,
      operationKey: "cc:own",
      createdBy: 21,
    });
    const assigned = await createPlan({
      sedeId,
      operationKey: "cc:assigned",
      createdBy: 99,
      assigneeId: 21,
    });
    const hidden = await createPlan({
      sedeId,
      operationKey: "cc:hidden",
      createdBy: 99,
      assigneeId: 22,
    });

    const user = await appRouter
      .createCaller(userContext(sedeId, 21))
      .tars.commandCenter.get({ limit: 20 });
    const visible = user.activePlans.map(item => item.id);
    expect(visible).toEqual(expect.arrayContaining([own.id, assigned.id]));
    expect(visible).not.toContain(hidden.id);

    const direction = await appRouter
      .createCaller(context(sedeId))
      .tars.commandCenter.get({ limit: 20 });
    expect(direction.activePlans.map(item => item.id)).toEqual(
      expect.arrayContaining([own.id, assigned.id, hidden.id])
    );
  });

  it("filtra le evidenze economiche e riapre una domanda una sola volta", async () => {
    const sedeId = 992;
    getTarsConfig(sedeId).attivo = true;
    const repository = getTarsPlanRepository();
    let plan = await createPlan({
      sedeId,
      operationKey: "cc:question",
      createdBy: 31,
    });
    plan = await repository.updateStep({
      sedeId,
      planId: plan.id,
      stepKey: "read",
      expectedVersion: plan.version,
      status: "completed",
      evidenceRefs: [
        {
          sourceType: "fattura_fic",
          sourceId: "88",
          label: "Fattura 88",
          version: "v1",
        },
        {
          sourceType: "commessa",
          sourceId: "9",
          label: "Commessa 9",
          version: "v1",
        },
      ],
      now: new Date(),
    });
    plan = await repository.updateStep({
      sedeId,
      planId: plan.id,
      stepKey: "ask",
      expectedVersion: plan.version,
      status: "waiting_user",
      output: { question: "A chi assegno?" },
      now: new Date(),
    });
    const caller = appRouter.createCaller(userContext(sedeId, 31));
    const snapshot = await caller.tars.commandCenter.get({ limit: 20 });
    const question = snapshot.waitingQuestions.find(
      item => item.id === plan.id
    )!;
    expect(question.evidence.map(item => item.sourceType)).toEqual([
      "commessa",
    ]);

    const resumed = await caller.tars.plans.respond({
      planId: plan.id,
      stepKey: "ask",
      expectedVersion: plan.version,
      response: "Utente 7",
    });
    expect(resumed.status).toBe("running");
    await expect(
      caller.tars.plans.respond({
        planId: plan.id,
        stepKey: "ask",
        expectedVersion: resumed.version,
        response: "Utente 7",
      })
    ).rejects.toThrow("PLAN_STEP_NOT_WAITING_USER");
  });
});
