// Tars T3 — le prove dei fascicoli C3 e di C0 v2: il fascicolo è al
// pavimento di capability (anti-leak: MAI importi nel payload), si riusa
// finché le versioni osservate coincidono con le correnti, si
// ricostruisce al cambio (commessa toccata, ordine NUOVO), su errore
// serve l'ultima versione valida MARCATA stale; cross-sede NOT_FOUND; il
// pannello tars.fascicolo sta dietro i kill switch; C0 non serve più
// risposte su entità cambiate nel TTL.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getCommessaById } from "../routers/commesse";
import { azzeraArchivioPerTest } from "./archivio";
import { costruisciContesto } from "./contesto";
import {
  azzeraFascicoliPerTest,
  CONTATORI_FASCICOLI,
  fascicoloCommessa,
} from "./fascicoli";
import { chiamataTool, creaProviderFinto, rispostaTesto } from "./openai/fake";
import { azzeraCacheTarsPerTest, eseguiRun } from "./orchestratore";

const SEDE = 98001;
const ALTRA_SEDE = 98002;
const DIREZIONE_ID = 98011;

function contestoTrpc(sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: DIREZIONE_ID,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: "Direzione T3",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) => appRouter.createCaller(contestoTrpc(sedeId));

async function scenario() {
  const commessa = await direzione().commesse.create({
    cliente: "Fascicolo Prova Srl",
  });
  const fornitore = await direzione().fornitori.create({
    ragioneSociale: "Fornitore Fascicoli Srl",
    partitaIva: "01234567890",
    categoria: "pvc",
  });
  const inRitardo = await direzione().fornitori.ordini.create({
    fornitoreId: fornitore.id,
    commessaId: commessa.id,
    codiceOrdine: `ORD-T3-${commessa.id}-1`,
    dataConsegnaPrevista: "2020-01-10",
    righe: [
      { descrizione: "Telai", quantita: 2, unitaMisura: "pz", prezzoUnitario: 100 },
    ],
  });
  const senzaData = await direzione().fornitori.ordini.create({
    fornitoreId: fornitore.id,
    commessaId: commessa.id,
    codiceOrdine: `ORD-T3-${commessa.id}-2`,
    righe: [{ descrizione: "Vetri", quantita: 1, unitaMisura: "pz" }],
  });
  return { commessa, fornitore, inRitardo, senzaData };
}

function toccaCommessa(id: number) {
  const c: any = getCommessaById(id);
  c.updatedAt = new Date(new Date(c.updatedAt).getTime() + 1000);
}

beforeEach(() => {
  azzeraFascicoliPerTest();
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
});

afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
});

describe("tars T3 — fascicolo C3", () => {
  it("contiene gate, ordini e domande aperte deterministiche", async () => {
    const { commessa } = await scenario();
    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(f).not.toBeNull();
    expect(f!.ordini).toHaveLength(2);
    expect(f!.ordini.filter(o => o.inRitardo)).toHaveLength(1);
    const testoDomande = f!.domandeAperte.join(" | ");
    expect(testoDomande).toContain("manca la data di consegna prevista");
    expect(testoDomande).toContain("superata senza consegna effettiva");
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(1);
  });

  it("ANTI-LEAK: il payload condiviso non contiene mai importi", async () => {
    const { commessa } = await scenario();
    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    const serializzato = JSON.stringify(f);
    expect(serializzato).not.toMatch(/importo/i);
    expect(serializzato).not.toMatch(/prezzo/i);
    expect(serializzato).not.toMatch(/residuo/i);
    // Il booleano operativo sanzionato invece c'è.
    expect(f).toHaveProperty("daSaldare");
  });

  it("riusa finché nulla cambia; ricostruisce quando la commessa viene toccata", async () => {
    const { commessa } = await scenario();
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(1);
    expect(CONTATORI_FASCICOLI.riusi).toBe(1);

    toccaCommessa(commessa.id);
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(CONTATORI_FASCICOLI.invalidazioniVersione).toBe(1);
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(2);
  });

  it("un DOCUMENTO nuovo invalida il fascicolo: il gate non resta stantio (revisione)", async () => {
    const { commessa } = await scenario();
    const prima = await fascicoloCommessa({
      sedeId: SEDE,
      commessaId: commessa.id,
    });
    expect(prima!.gate.soddisfatto).toBe(false);

    const bytes = Buffer.from("finto-pdf-di-prova");
    await direzione().preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "preventivo-t3.pdf",
      tipo: "preventivo",
      mimeType: "application/pdf",
      size: bytes.length,
      dataBase64: bytes.toString("base64"),
      keepNome: true,
    });

    const dopo = await fascicoloCommessa({
      sedeId: SEDE,
      commessaId: commessa.id,
    });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(2); // ricostruito
    expect(dopo!.gate.soddisfatto).toBe(true);
  });

  it("un ordine NUOVO invalida il fascicolo (hash della lista)", async () => {
    const { commessa, fornitore } = await scenario();
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    await direzione().fornitori.ordini.create({
      fornitoreId: fornitore.id,
      commessaId: commessa.id,
      codiceOrdine: `ORD-T3-${commessa.id}-3`,
      righe: [{ descrizione: "Maniglie", quantita: 4, unitaMisura: "pz" }],
    });
    const f = await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    expect(CONTATORI_FASCICOLI.costruzioni).toBe(2);
    expect(f!.ordini).toHaveLength(3);
  });

  it("su errore di ricostruzione serve l'ultima versione valida MARCATA stale", async () => {
    const { commessa } = await scenario();
    await fascicoloCommessa({ sedeId: SEDE, commessaId: commessa.id });
    toccaCommessa(commessa.id); // versioni non più valide → serve ricostruire
    const f = await fascicoloCommessa(
      { sedeId: SEDE, commessaId: commessa.id },
      {
        costruttore: () => {
          throw new Error("boom di prova");
        },
      }
    );
    expect(f!.stale).toBe(true);
    expect(f!.commessaId).toBe(commessa.id);
    expect(CONTATORI_FASCICOLI.staleServiti).toBe(1);
  });

  it("cross-sede: il fascicolo di un'altra sede non esiste", async () => {
    const { commessa } = await scenario();
    expect(
      await fascicoloCommessa({ sedeId: ALTRA_SEDE, commessaId: commessa.id })
    ).toBeNull();
    await expect(
      direzione(ALTRA_SEDE).tars.fascicolo({ commessaId: commessa.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tars T3 — pannello tars.fascicolo", () => {
  it("serve il fascicolo alla pagina commessa, dietro i kill switch", async () => {
    const { commessa } = await scenario();
    const f = await direzione().tars.fascicolo({ commessaId: commessa.id });
    expect(f.commessaId).toBe(commessa.id);
    expect(Array.isArray(f.domandeAperte)).toBe(true);

    process.env.FLAG_TARS_READ_TOOLS = "off";
    await expect(
      direzione().tars.fascicolo({ commessaId: commessa.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    delete process.env.FLAG_TARS_READ_TOOLS;
    process.env.FLAG_TARS = "off";
    await expect(
      direzione().tars.fascicolo({ commessaId: commessa.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("tars T3 — C0 v2 con versioni di entità", () => {
  it("riusa entro il TTL solo se le entità osservate NON sono cambiate", async () => {
    const { commessa } = await scenario();
    const contesto = await costruisciContesto(contestoTrpc());
    let chiamateProvider = 0;
    const copione = () =>
      creaProviderFinto(() => {
        chiamateProvider += 1;
        return rispostaTesto("Stato letto.");
      });
    // Il riferimento canonico fa sì che entrambe le conversazioni partano
    // dallo stesso contesto verificato; un id numerico non è un riferimento
    // commessa e non deve ereditare il fingerprint appreso da un altro run.
    const messaggio = `Com'è messa la commessa ${commessa.codice}?`;

    const prima = await eseguiRun({ contesto, provider: copione(), messaggio });
    expect(prima.cache.c0Hit).toBe(false);
    const dopoPrima = chiamateProvider;

    const seconda = await eseguiRun({ contesto, provider: copione(), messaggio });
    expect(seconda.cache.c0Hit).toBe(true);
    expect(chiamateProvider).toBe(dopoPrima); // zero model call

    toccaCommessa(commessa.id);
    const terza = await eseguiRun({ contesto, provider: copione(), messaggio });
    expect(terza.cache.c0Hit).toBe(false); // entità cambiata → niente riuso
    expect(chiamateProvider).toBeGreaterThan(dopoPrima);
  });
});
