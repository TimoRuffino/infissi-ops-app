import { describe, expect, it, vi } from "vitest";
import {
  executeCreateCustomerJobSaga,
  type CreateCustomerJobOperation,
  type CreateCustomerJobServices,
} from "./createCustomerJob";

const input = {
  customer: {
    nome: "Giulia",
    cognome: "Ferri",
    telefono: "333 1234567",
    email: "giulia@example.test",
  },
  job: {
    assegnatoA: 7,
    priorita: "media" as const,
    note: "Quattro finestre a Sarzana",
    prodotti: [{ nome: "Finestra", quantita: 4 }],
  },
  communicationId: 19,
};

function harness(
  options: {
    existingCustomer?: { id: number; sedeId: number } | null;
    existingJob?: { id: number; clienteId: number; sedeId: number } | null;
    assigneeValid?: boolean;
    failJobOnce?: boolean;
  } = {}
) {
  let operation: CreateCustomerJobOperation | null = null;
  let nextCustomerId = 101;
  let nextJobId = 201;
  let failJob = options.failJobOnce ?? false;
  const createCustomer = vi.fn(async () => ({
    id: nextCustomerId++,
    sedeId: 1,
  }));
  const createJob = vi.fn(async (customerId: number) => {
    if (failJob) {
      failJob = false;
      throw Object.assign(new Error("temporary"), {
        code: "JOB_CREATE_FAILED",
      });
    }
    return { id: nextJobId++, clienteId: customerId, sedeId: 1 };
  });
  const linkCommunication = vi.fn(async () => true);
  const services: CreateCustomerJobServices = {
    loadOperation: async () => operation,
    saveOperation: async value => {
      operation = structuredClone(value);
    },
    findEquivalentCustomer: async () => options.existingCustomer ?? null,
    findEquivalentJob: async () => options.existingJob ?? null,
    validateAssignee: async assigneeId =>
      options.assigneeValid === false
        ? null
        : { id: assigneeId, sedeId: 1, active: true },
    createCustomer,
    createJob,
    linkCommunication,
    verify: async ({ customerId, jobId }) => ({
      customer: { id: customerId, sedeId: 1 },
      job: { id: jobId, clienteId: customerId, sedeId: 1 },
    }),
  };
  return {
    services,
    createCustomer,
    createJob,
    linkCommunication,
    operation: () => operation,
  };
}

describe("create customer + job saga", () => {
  it("crea cliente e commessa con dati completi e collega la comunicazione", async () => {
    const h = harness();
    const result = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "lead:19",
      input,
      services: h.services,
    });

    expect(result).toMatchObject({
      status: "completed",
      customerId: 101,
      jobId: 201,
    });
    expect(h.createCustomer).toHaveBeenCalledTimes(1);
    expect(h.createJob).toHaveBeenCalledWith(
      101,
      expect.anything(),
      "lead:19:create-job"
    );
    expect(h.linkCommunication).toHaveBeenCalledWith(
      19,
      101,
      201,
      "lead:19:link-communication"
    );
  });

  it("riusa un cliente equivalente della stessa sede", async () => {
    const h = harness({ existingCustomer: { id: 44, sedeId: 1 } });
    const result = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:2",
      input,
      services: h.services,
    });
    expect(result.customerId).toBe(44);
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(h.createJob).toHaveBeenCalledWith(
      44,
      expect.anything(),
      "op:2:create-job"
    );
  });

  it("non duplica una commessa equivalente", async () => {
    const h = harness({
      existingCustomer: { id: 44, sedeId: 1 },
      existingJob: { id: 55, clienteId: 44, sedeId: 1 },
    });
    const result = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:3",
      input,
      services: h.services,
    });
    expect(result).toMatchObject({
      status: "completed",
      customerId: 44,
      jobId: 55,
    });
    expect(h.createJob).not.toHaveBeenCalled();
  });

  it("chiede l'assegnatario prima di scrivere dati", async () => {
    const h = harness();
    const incomplete = structuredClone(input) as any;
    delete incomplete.job.assegnatoA;
    const result = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:4",
      input: incomplete,
      services: h.services,
    });
    expect(result).toMatchObject({
      status: "waiting_user",
      missing: ["job.assegnatoA"],
    });
    expect(h.createCustomer).not.toHaveBeenCalled();
  });

  it("rifiuta un assegnatario non attivo nella sede", async () => {
    const h = harness({ assigneeValid: false });
    const result = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:5",
      input,
      services: h.services,
    });
    expect(result).toMatchObject({
      status: "waiting_user",
      errorCode: "ASSIGNEE_NOT_AVAILABLE",
    });
    expect(h.createCustomer).not.toHaveBeenCalled();
  });

  it("conserva il cliente se la creazione commessa fallisce", async () => {
    const h = harness({ failJobOnce: true });
    const result = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:6",
      input,
      services: h.services,
    });
    expect(result).toMatchObject({
      status: "partially_completed",
      customerId: 101,
      jobId: null,
      errorCode: "JOB_CREATE_FAILED",
    });
    expect(h.operation()).toMatchObject({
      status: "partially_completed",
      customerId: 101,
      jobId: null,
    });
  });

  it("al retry riparte dalla commessa senza ricreare il cliente", async () => {
    const h = harness({ failJobOnce: true });
    await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:7",
      input,
      services: h.services,
    });
    const result = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:7",
      input,
      services: h.services,
    });
    expect(result.status).toBe("completed");
    expect(h.createCustomer).toHaveBeenCalledTimes(1);
    expect(h.createJob).toHaveBeenCalledTimes(2);
  });

  it("una seconda approvazione restituisce lo stesso esito senza duplicati", async () => {
    const h = harness();
    const first = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:8",
      input,
      services: h.services,
    });
    const second = await executeCreateCustomerJobSaga({
      sedeId: 1,
      operationKey: "op:8",
      input,
      services: h.services,
    });
    expect(second).toEqual(first);
    expect(h.createCustomer).toHaveBeenCalledTimes(1);
    expect(h.createJob).toHaveBeenCalledTimes(1);
    expect(h.linkCommunication).toHaveBeenCalledTimes(1);
  });
});
