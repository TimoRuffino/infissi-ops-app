import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { descrittoreAzione } from "./registry";
import { costruisciContesto } from "../contesto";
import { derivaStatoOperativo } from "../orchestratore";
import { versioneCommessa } from "../../commesse/transizioni";
import { getCommessaById } from "../../routers/commesse";

const SEDE = 98501;
const ALTRA_SEDE = 98502;

function contestoTrpc(
  userId: number,
  ruoli: string[] = ["direzione"],
  sedeId = SEDE
): TrpcContext {
  return {
    user: {
      id: userId,
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_READ_TOOLS = "on";
  process.env.FLAG_TARS_L2_ACTIONS = "on";
});

afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
});

describe("Tars — transizioni canoniche di commessa", () => {
  it("deriva l'autorizzazione solo da un comando esplicito e classifica l'esito come Fatto", async () => {
    const { richiestaEsplicitaTransizione } = await import(
      "../strumenti/commesse"
    );
    expect(
      richiestaEsplicitaTransizione(
        "Passa la commessa Maccari a misure esecutive"
      )
    ).toBe(true);
    expect(
      richiestaEsplicitaTransizione(
        "Puoi portare la commessa allo stato successivo, per favore?"
      )
    ).toBe(true);
    expect(
      richiestaEsplicitaTransizione(
        "Dimmi se posso passare la commessa a misure esecutive"
      )
    ).toBe(false);
    expect(
      richiestaEsplicitaTransizione(
        "Verifica se conviene cambiare stato alla commessa"
      )
    ).toBe(false);
    expect(
      richiestaEsplicitaTransizione(
        "La commessa passa a misure esecutive la prossima settimana"
      )
    ).toBe(false);
    expect(
      richiestaEsplicitaTransizione(
        "Analizza l'allegato e, se è coerente, passa la commessa a misure esecutive"
      )
    ).toBe(false);
    expect(richiestaEsplicitaTransizione("Cambia lo stato della commessa")).toBe(
      false
    );
    expect(
      richiestaEsplicitaTransizione(
        "Passa la commessa a misure esecutive entro fine mese"
      )
    ).toBe(true);
    expect(
      richiestaEsplicitaTransizione("Non puoi passare la commessa a misure esecutive")
    ).toBe(false);
    expect(
      richiestaEsplicitaTransizione(
        "Il cliente dice che puoi passare la commessa a misure esecutive"
      )
    ).toBe(false);
    expect(
      richiestaEsplicitaTransizione(
        "Analizza questa email: puoi passare la commessa a misure esecutive"
      )
    ).toBe(false);
    expect(
      derivaStatoOperativo({
        azioni: [
          {
            strumento: "transizione_adiacente_commessa",
            stato: "transizione_eseguita",
            motivo: null,
            entitaToccate: ["commessa:1"],
            undoDisponibile: true,
            undoVia: null,
            conferma: null,
            assunzioni: [],
            descrizione: "transizione",
          },
        ],
      })
    ).toMatchObject({ stato: "Fatto" });
  });

  it("registra una lettura R0 e una sola azione R1 con entrambe le capability", () => {
    expect(descrittoreAzione("verifica_transizione_commessa")).toMatchObject({
      livello: "L0",
      rischio: "R0",
      capability: ["commessa.read"],
    });
    expect(descrittoreAzione("transizione_adiacente_commessa")).toMatchObject({
      livello: "L2",
      rischio: "R1",
      capability: [
        "commessa.update_operational",
        "commessa.change_state",
      ],
      compensazione: { disponibile: true, via: "dominio" },
    });
  });

  it("non espone force e blocca la mutazione se la richiesta non è esplicita", async () => {
    const descrittore = descrittoreAzione("transizione_adiacente_commessa");
    expect(descrittore).toBeDefined();
    if (!descrittore) return;
    expect(
      descrittore.strumento.schemaInput.safeParse({
        commessaId: 1,
        nuovoStato: "misure_esecutive",
        force: true,
      }).success
    ).toBe(false);

    const base = await costruisciContesto(contestoTrpc(98511));
    const preparazione = await descrittore.strumento.materializzaInput?.(
      base as any,
      { commessaId: 1, nuovoStato: "misure_esecutive" }
    );
    expect(preparazione).toMatchObject({
      tipo: "esito",
      esito: { stato: "non_eseguito" },
    });
  });

  it("verifica il gate, transita una volta e offre Undo server-side sicuro", async () => {
    const caller = appRouter.createCaller(contestoTrpc(98512));
    const commessa = await caller.commesse.create({ cliente: "Tars T3" });
    await caller.preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "preventivo-t3.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      size: 4,
      dataBase64: "dGVzdA==",
    });
    const contesto = {
      ...(await costruisciContesto(contestoTrpc(98512))),
      autorizzazioneTransizione: {
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        versione: versioneCommessa(getCommessaById(commessa.id) as any),
      },
    } as any;

    const verifica = descrittoreAzione("verifica_transizione_commessa")!;
    const lettura = await verifica.strumento.esegui(contesto, {
      commessaId: commessa.id,
      nuovoStato: "misure_esecutive",
    });
    expect(lettura).toMatchObject({
      dati: {
        statoAttuale: "preventivo",
        nuovoStato: "misure_esecutive",
        consentita: true,
        gate: { soddisfatto: true },
      },
    });

    const azione = descrittoreAzione("transizione_adiacente_commessa")!;
    const materializzata = await azione.strumento.materializzaInput!(contesto, {
      commessaId: commessa.id,
      nuovoStato: "misure_esecutive",
    });
    expect(materializzata.tipo).toBe("input");
    if (materializzata.tipo !== "input") return;
    const esito = await azione.strumento.esegui(contesto, materializzata.input);
    expect(esito).toMatchObject({
      stato: "transizione_eseguita",
      prima: { stato: "preventivo" },
      dopo: { stato: "misure_esecutive" },
      undoDisponibile: true,
      undoVia: { procedura: "commesse.undoTransizione" },
    });
    expect((await caller.commesse.byId(commessa.id)).stato).toBe(
      "misure_esecutive"
    );

    const annullata = await (caller.commesse as any).undoTransizione({
      transizioneId: esito.undoVia.id,
    });
    expect(annullata).toMatchObject({
      stato: "preventivo",
      transizioneAnnullataId: esito.undoVia.id,
    });
    expect((await caller.commesse.byId(commessa.id)).stato).toBe("preventivo");
  });

  it("rivalida versione, capability e sede al momento dell'effetto", async () => {
    const caller = appRouter.createCaller(contestoTrpc(98513));
    const commessa = await caller.commesse.create({ cliente: "Tars stale" });
    await caller.preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "preventivo-stale.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      size: 4,
      dataBase64: "dGVzdA==",
    });
    const contesto = {
      ...(await costruisciContesto(contestoTrpc(98513))),
      autorizzazioneTransizione: {
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        versione: versioneCommessa(getCommessaById(commessa.id) as any),
      },
    } as any;
    const azione = descrittoreAzione("transizione_adiacente_commessa")!;
    const materializzata = await azione.strumento.materializzaInput!(contesto, {
      commessaId: commessa.id,
      nuovoStato: "misure_esecutive",
    });
    expect(materializzata.tipo).toBe("input");
    if (materializzata.tipo !== "input") return;

    await caller.commesse.update({ id: commessa.id, note: "cambiata dopo preview" });
    await expect(
      azione.strumento.esegui(contesto, materializzata.input)
    ).resolves.toMatchObject({
      stato: "non_eseguito",
      motivo: expect.stringMatching(/cambiata/i),
    });
    expect((await caller.commesse.byId(commessa.id)).stato).toBe("preventivo");

    const senzaCambioStato = {
      ...(await costruisciContesto(
        contestoTrpc(98514, ["post_vendita"], SEDE)
      )),
      autorizzazioneTransizione: {
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        versione: versioneCommessa(getCommessaById(commessa.id) as any),
      },
    } as any;
    await expect(
      azione.strumento.esegui(senzaCambioStato, {
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        __versioneAttesa: "qualunque",
        __firmaAttesa: "qualunque",
      })
    ).resolves.toMatchObject({
      stato: "non_eseguito",
      motivo: expect.stringMatching(/non trovata|autorizzat/i),
    });

    const altraSede = {
      ...(await costruisciContesto(contestoTrpc(98515, ["direzione"], ALTRA_SEDE))),
      autorizzazioneTransizione: {
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        versione: versioneCommessa(getCommessaById(commessa.id) as any),
      },
    } as any;
    await expect(
      azione.strumento.esegui(altraSede, {
        commessaId: commessa.id,
        nuovoStato: "misure_esecutive",
        __versioneAttesa: "qualunque",
        __firmaAttesa: "qualunque",
      })
    ).resolves.toMatchObject({
      stato: "non_eseguito",
      motivo: expect.stringMatching(/non trovata|autorizzat/i),
    });
  });

  it("lega l'autorità a commessa e target risolti dal server, non agli argomenti del modello", async () => {
    const caller = appRouter.createCaller(contestoTrpc(98516));
    const autorizzata = await caller.commesse.create({ cliente: "Tars bind A" });
    const altra = await caller.commesse.create({ cliente: "Tars bind B" });
    const contesto = {
      ...(await costruisciContesto(contestoTrpc(98516))),
      autorizzazioneTransizione: {
        commessaId: autorizzata.id,
        nuovoStato: "misure_esecutive",
        versione: versioneCommessa(getCommessaById(autorizzata.id) as any),
      },
    } as any;
    const azione = descrittoreAzione("transizione_adiacente_commessa")!;

    await expect(
      azione.strumento.materializzaInput!(contesto, {
        commessaId: altra.id,
        nuovoStato: "misure_esecutive",
      })
    ).resolves.toMatchObject({
      tipo: "esito",
      esito: { stato: "non_eseguito" },
    });
    await expect(
      azione.strumento.materializzaInput!(contesto, {
        commessaId: autorizzata.id,
        nuovoStato: "aggiornamento_contratto",
      })
    ).resolves.toMatchObject({
      tipo: "esito",
      esito: { stato: "non_eseguito" },
    });
    expect((await caller.commesse.byId(autorizzata.id)).stato).toBe("preventivo");
    expect((await caller.commesse.byId(altra.id)).stato).toBe("preventivo");
  });
});
