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

// Il Client ID e l'Access Token vivono nella stessa schermata di Fatture in
// Cloud, un rigo sopra l'altro: incollare il primo al posto del secondo è
// l'errore più facile da fare, e produce un 401 che non spiega niente.
describe("validazione token FIC", () => {
  it("riconosce un token vero", async () => {
    const { tokenSembraValido } = await import("./fattureInCloud");
    expect(
      tokenSembraValido(
        "a/eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmno"
      )
    ).toBe(true);
  });

  it("rifiuta il Client ID e altri valori che token non sono", async () => {
    const { tokenSembraValido } = await import("./fattureInCloud");
    // Il Client ID reale ha questa forma: niente prefisso "a/".
    expect(tokenSembraValido("46YmsOEc2PqxzQaluXRbvV9kShqkTl8E")).toBe(false);
    expect(tokenSembraValido("")).toBe(false);
    expect(tokenSembraValido("a/corto")).toBe(false);
    expect(tokenSembraValido("Bearer a/eyJ0eXAiOiJKV1Qi")).toBe(false);
  });

  it("il salvataggio rifiuta il Client ID con un messaggio che dice cosa fare", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.fattureInCloud.saveConfig({
        accessToken: "46YmsOEc2PqxzQaluXRbvV9kShqkTl8E",
      })
    ).rejects.toThrow(/Client ID/);
  });
});

// Le fatture che il motore deterministico NON sa abbinare vanno a Tars:
// lui indaga e propone il collegamento; l'approvazione collega davvero e
// fa partire le proposte su pattuito e incassi. Il giro si paga una volta.
describe("fatture orfane → Tars", () => {
  it("orfana → proposta di collegamento → approvazione collega e riconcilia", async () => {
    const { vi } = await import("vitest");
    const { getTarsConfig } = await import("../tars/stores");
    const { smistaFatture } = await import("../tars/smistamento");
    const realFetch = global.fetch;
    process.env.ANTHROPIC_API_KEY = "test-key";
    getTarsConfig().attivo = true;

    try {
      const caller = appRouter.createCaller(makeCtx());
      // La commessa giusta esiste, ma il nome in fattura non è in anagrafica.
      const cliente = await caller.clienti.create({
        nome: " ",
        cognome: "Condominio Girasole",
        tipo: "condominio",
      });
      const commessa = await caller.commesse.create({ clienteId: cliente.id });

      upsertFatture([
        fatturaBase(9100, {
          numero: "9100/A",
          // Grafia diversa: il match per nome fallisce, Tars deve capire.
          clienteNome: "COND. GIRASOLE - AMM. BRUNI",
          importoLordo: 7320,
          rate: [
            { importo: 7320, scadenza: "2026-07-31", stato: "paid", dataPagamento: "2026-07-25" },
          ],
        }),
      ]);

      let i = 0;
      const risposte = [
        {
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            { type: "tool_use", id: "t1", name: "cerca_clienti", input: { query: "Girasole" } },
          ],
        },
        {
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "proponi_collegamento_fattura",
              input: {
                ficId: 9100,
                commessaId: commessa.id,
                titolo: `Collega la fattura 9100/A a ${commessa.codice} (Condominio Girasole)`,
                motivazione:
                  "Il nome in fattura è il Condominio Girasole scritto con l'amministratore; l'importo è compatibile.",
                confidenza: "media",
              },
            },
          ],
        },
        {
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{ type: "text", text: "Proposto un collegamento." }],
        },
      ];
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => risposte[Math.min(i++, risposte.length - 1)],
        text: async () => "",
      })) as any;

      await smistaFatture(1);

      const proposta = proposte.find(
        (p) => p.tipo === "collega_fattura" && p.payload?.ficId === 9100
      );
      expect(proposta).toBeDefined();
      expect(ficFatture.find((f) => f.id === 9100)!.tarsAnalizzata).toBe(true);

      // Approvazione (direzione) → collegata + proposte soldi in coda.
      await caller.tars.proposte.approva({ id: proposta!.id });
      const f = ficFatture.find((x) => x.id === 9100)!;
      expect(f.commessaId).toBe(commessa.id);
      expect(
        proposte.some(
          (p) =>
            p.tipo === "pagamento" &&
            p.commessaId === commessa.id &&
            JSON.stringify(p.payload).includes("9100/A")
        )
      ).toBe(true);

      // Già esaminata: il secondo giro non richiama l'API.
      const spy = vi.fn();
      global.fetch = spy as any;
      await smistaFatture(1);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
      delete process.env.ANTHROPIC_API_KEY;
      getTarsConfig().attivo = false;
    }
  });
});
