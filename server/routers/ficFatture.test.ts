// Riconciliazione FIC: le regole di match devono essere noiose e
// prevedibili — sono soldi. E il dedupe deve reggere ai rilanci: il sync
// gira ogni 6 ore, le proposte no.

import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import {
  commessaPerFattura,
  ficFatture,
  generaProposteRiconciliazione,
  statoFattura,
  upsertFatture,
} from "./ficFatture";
import { proposte } from "../tars/stores";

function makeCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "local-1",
      name: "Admin Ruffino",
      email: "admin@ruffinogroup.it",
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    sedeId: 1,
    sediIds: [1],
  };
}

const fatturaBase = (id: number, extra: Partial<any> = {}) => ({
  id,
  numero: `${id}/A`,
  data: "2026-07-15",
  clienteNome: "Riconcilia Mario",
  clienteVat: null,
  clienteCf: null,
  importoNetto: 1000,
  importoLordo: 1220,
  rate: [
    {
      importo: 1220,
      scadenza: "2026-07-31",
      stato: "paid",
      dataPagamento: "2026-07-20",
    },
  ],
  ...extra,
});

describe("riconciliazione FIC", () => {
  let clienteId: number;
  let commessaId: number;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    caller = appRouter.createCaller(makeCtx());
    const cliente = await caller.clienti.create({
      nome: "Mario",
      cognome: "Riconcilia",
    });
    clienteId = cliente.id;
    const commessa = await caller.commesse.create({ clienteId });
    commessaId = commessa.id;
  });

  it("il sync abbina il cliente per nome, comunque sia scritto", () => {
    const r = upsertFatture([
      fatturaBase(9001, { clienteNome: "MARIO  riconcilia" }),
    ]);
    expect(r.nuove).toBe(1);
    const f = ficFatture.find((x) => x.id === 9001)!;
    expect(f.clienteId).toBe(clienteId);
  });

  it("cliente con una sola commessa attiva → commessa individuata", async () => {
    const commesse = (await caller.commesse.list({ archived: "all" })) as any[];
    const f = ficFatture.find((x) => x.id === 9001)!;
    const m = commessaPerFattura(f, commesse);
    expect(m.commessa?.id).toBe(commessaId);
  });

  it("rata incassata su FIC → proposta di pagamento, e il rilancio non duplica", async () => {
    const prima = generaProposteRiconciliazione();
    expect(prima).toBeGreaterThanOrEqual(1);
    const mie = proposte.filter(
      (p) =>
        p.trigger === "riconciliazione_fic" &&
        p.commessaId === commessaId &&
        p.tipo === "pagamento"
    );
    expect(mie).toHaveLength(1);
    expect(mie[0].payload.importo).toBe(1220);
    expect(mie[0].payload.note).toContain("FIC 9001/A");

    // Idempotenza: il sync gira ogni 6 ore, la proposta resta una.
    const seconda = generaProposteRiconciliazione();
    const dopo = proposte.filter(
      (p) =>
        p.trigger === "riconciliazione_fic" &&
        p.commessaId === commessaId &&
        p.tipo === "pagamento"
    );
    expect(dopo).toHaveLength(1);
    expect(seconda).toBe(0);
  });

  it("pattuito proposto solo se assente, dall'unica fattura", () => {
    const p = proposte.find(
      (x) =>
        x.trigger === "riconciliazione_fic" &&
        x.commessaId === commessaId &&
        x.tipo === "modifica_commessa"
    );
    expect(p).toBeDefined();
    expect(p!.payload.campi.importoTotale).toBe(1220);
  });

  it("approvare la proposta registra la rata e la fattura risulta riconciliata", async () => {
    const p = proposte.find(
      (x) =>
        x.trigger === "riconciliazione_fic" &&
        x.commessaId === commessaId &&
        x.tipo === "pagamento"
    )!;
    await caller.tars.proposte.approva({ id: p.id });

    const c = await caller.commesse.byId(commessaId);
    expect(c!.importoIncassato).toBe(1220);
    expect(c!.pagamenti[0].note).toContain("FIC 9001/A");

    const commesse = (await caller.commesse.list({ archived: "all" })) as any[];
    // list non porta i pagamenti: lo stato va calcolato sui dati pieni.
    const piene = [c];
    const f = ficFatture.find((x) => x.id === 9001)!;
    expect(statoFattura(f, piene as any[]).stato).toBe("riconciliata");
    void commesse;
  });

  it("cliente con più commesse senza importo distintivo → nessuna proposta", async () => {
    await caller.commesse.create({ clienteId }); // seconda commessa attiva
    upsertFatture([fatturaBase(9002, { numero: "9002/A", importoLordo: 555 })]);
    const create = generaProposteRiconciliazione();
    const perQuesta = proposte.filter((p) =>
      JSON.stringify(p.payload).includes("9002/A")
    );
    expect(perQuesta).toHaveLength(0);
    void create;

    const commesse = (await caller.commesse.list({ archived: "all" })) as any[];
    const f = ficFatture.find((x) => x.id === 9002)!;
    expect(statoFattura(f, commesse).stato).toBe("non_abbinabile");
  });

  it("cliente sconosciuto → non abbinabile, mai proposte al buio", () => {
    upsertFatture([
      fatturaBase(9003, { numero: "9003/A", clienteNome: "Sconosciuto Totale" }),
    ]);
    generaProposteRiconciliazione();
    expect(
      proposte.some((p) => JSON.stringify(p.payload).includes("9003/A"))
    ).toBe(false);
  });

  it("l'upsert aggiorna lo stato delle rate senza duplicare la fattura", () => {
    const prima = ficFatture.filter((f) => f.id === 9003).length;
    upsertFatture([
      fatturaBase(9003, {
        numero: "9003/A",
        clienteNome: "Sconosciuto Totale",
        rate: [
          { importo: 1220, scadenza: "2026-08-31", stato: "paid", dataPagamento: "2026-08-07" },
        ],
      }),
    ]);
    expect(ficFatture.filter((f) => f.id === 9003)).toHaveLength(prima);
    expect(ficFatture.find((f) => f.id === 9003)!.rate[0].stato).toBe("paid");
  });
});
