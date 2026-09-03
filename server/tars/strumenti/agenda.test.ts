// T4: agenda della sede (interventi + squadre, eventi Google in sola
// lettura), spostamento con «quando» in parole, completamento con la
// transizione CONSIGLIATA — mai eseguita di nascosto.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { getInterventiStore } from "../../routers/interventi";
import { getSquadreStore } from "../../routers/squadre";
import { costruisciContesto } from "../contesto";
import { STRUMENTI_AGENDA, transizioneConsigliataPerTipo } from "./agenda";

const SEDE = 96_881;
const ALTRA_SEDE = 96_882;
const DIREZIONE_ID = 96_891;
const SQUADRA_ID = 96_895;

function contestoTrpc(sedeId = SEDE): TrpcContext {
  return {
    user: { id: DIREZIONE_ID, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione Agenda" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}
const direzione = (sedeId = SEDE) => appRouter.createCaller(contestoTrpc(sedeId));
const tool = (nome: string) => STRUMENTI_AGENDA.find(s => s.nome === nome)!;
const contesto = () => costruisciContesto(contestoTrpc());

const squadre = getSquadreStore() as any[];
if (!squadre.some(s => s.id === SQUADRA_ID)) {
  squadre.push({ id: SQUADRA_ID, sedeId: SEDE, nome: "Squadra Posa 1", attiva: true });
}

const oggi = new Date();
const giornoIso = (offset: number) => {
  const d = new Date(oggi.getTime() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_L2_ACTIONS = "on";
});
afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
});

describe("leggi_agenda", () => {
  it("interventi della settimana con squadra e commessa; altre sedi fuori; squadre elencate", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Agenda Test" });
    await direzione().interventi.create({
      commessaId: commessa.id, tipo: "posa", dataPianificata: giornoIso(2),
      oraInizio: "08:30", squadraId: SQUADRA_ID,
    });
    await direzione(ALTRA_SEDE).interventi.create({
      tipo: "rilievo", dataPianificata: giornoIso(2),
    });

    const esito = await tool("leggi_agenda").esegui(ctx, { giorni: 7 });
    const voci = esito.dati.interventi.filter((i: any) => i.commessaId === commessa.id);
    expect(voci).toHaveLength(1);
    expect(voci[0]).toMatchObject({
      tipo: "posa", squadra: "Squadra Posa 1", fonte: "crm",
      commessa: `${commessa.codice} — Agenda Test`,
    });
    expect(esito.dati.squadre.some((s: any) => s.nome === "Squadra Posa 1")).toBe(true);
    expect(esito.dati.appuntamentiGoogle).toEqual([]);
    expect(esito.omissioni.join(" ")).toContain("sola lettura");
    // La sede estranea non esiste in questa agenda.
    expect(
      esito.dati.interventi.every((i: any) => i.commessaId !== null || i.fonte === "crm")
    ).toBe(true);
  });
});

describe("sposta_intervento", () => {
  it("sposta data (in parole), orari e squadra con prima/dopo; cross-sede invisibile", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Sposta Test" });
    const intervento = await direzione().interventi.create({
      commessaId: commessa.id, tipo: "rilievo", dataPianificata: giornoIso(1), oraInizio: "09:00",
    });
    const esito = await tool("sposta_intervento").esegui(ctx, {
      interventoId: intervento.id, quando: "dopodomani", oraInizio: "15:00", squadraId: SQUADRA_ID,
    });
    expect(esito.stato).toBe("spostato");
    expect(esito.prima).toMatchObject({ oraInizio: "09:00", squadraId: null });
    expect(esito.dati.oraInizio).toBe("15:00");
    expect(esito.dati.squadraId).toBe(SQUADRA_ID);
    expect(esito.dati.data >= giornoIso(1)).toBe(true);
    const salvato = (getInterventiStore() as any[]).find(i => i.id === intervento.id)!;
    expect(salvato.oraInizio).toBe("15:00");

    const altrove = await direzione(ALTRA_SEDE).interventi.create({
      tipo: "posa", dataPianificata: giornoIso(1),
    });
    const invisibile = await tool("sposta_intervento").esegui(ctx, {
      interventoId: altrove.id, oraInizio: "10:00",
    });
    expect(invisibile.stato).toBe("non_eseguito");
    expect(invisibile.motivo).toContain("non trovato");
  });
});

describe("segna_intervento_fatto", () => {
  it("completa e consiglia la transizione per tipo, senza eseguirla; doppio segna non eseguito", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Posa Fatta" });
    const intervento = await direzione().interventi.create({
      commessaId: commessa.id, tipo: "posa", dataPianificata: giornoIso(0),
    });
    const esito = await tool("segna_intervento_fatto").esegui(ctx, { interventoId: intervento.id });
    expect(esito.stato).toBe("completato");
    expect(esito.dati.transizioneConsigliata).toEqual({ commessaId: commessa.id, nuovoStato: "finiture_saldo" });
    expect(esito.avvertenze.join(" ")).toContain("transizione_adiacente_commessa");
    // La commessa NON è avanzata da sola.
    expect((await direzione().commesse.list()).find((c: any) => c.id === commessa.id)?.stato ?? "preventivo").toBe("preventivo");
    const doppio = await tool("segna_intervento_fatto").esegui(ctx, { interventoId: intervento.id });
    expect(doppio.stato).toBe("non_eseguito");
    expect(doppio.motivo).toContain("già");
  });

  it("mappa dei consigli: posa→finiture_saldo, rilievo→misure_esecutive, assistenza→nessuno", () => {
    expect(transizioneConsigliataPerTipo("posa")).toBe("finiture_saldo");
    expect(transizioneConsigliataPerTipo("rilievo")).toBe("misure_esecutive");
    expect(transizioneConsigliataPerTipo("assistenza")).toBeNull();
  });
});
