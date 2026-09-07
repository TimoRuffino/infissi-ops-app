// «Ricevuto tutto» per commessa (direzione 07/09/2026) e la consegna che
// nasce da una conferma: una riga sola con gli articoli dentro.

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { getCommessaById } from "./commesse";
import { creaConsegnaDaConferma, getMagazzinoStore } from "./magazzino";
import { getUtentiStore } from "./utenti";

const SEDE = 97_601;
const ALTRA_SEDE = 97_602;
const DIREZIONE_ID = 97_611;

{
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === DIREZIONE_ID)) {
    utenti.push({
      id: DIREZIONE_ID,
      nome: "Dir",
      cognome: "Magazzino",
      email: "magazzino-dir@example.test",
      attivo: true,
      ruoli: ["direzione"],
      ruolo: "direzione",
      sediIds: [SEDE, ALTRA_SEDE],
    });
  }
}

function contesto(sedeId: number): TrpcContext {
  return {
    user: { id: DIREZIONE_ID, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [SEDE, ALTRA_SEDE],
    tenantId: 1,
    tenant: null,
  };
}
const caller = (sedeId = SEDE) => appRouter.createCaller(contesto(sedeId));

describe("magazzino.segnaTuttoRicevuto", () => {
  it("segna ricevute solo le consegne aperte della commessa, in sede; il secondo click non fa niente", async () => {
    const commessa = await caller().commesse.create({ cliente: "Tesconi Giorgio" });
    (getCommessaById(commessa.id) as any).stato = "produzione";
    const a = await caller().magazzino.create({ commessaId: commessa.id, nome: "Finestra 1", quantita: 2 });
    const b = await caller().magazzino.create({ commessaId: commessa.id, nome: "Finestra 2", quantita: 1 });
    await caller().magazzino.update({ id: b.id, arrivato: true });

    const primo = await caller().magazzino.segnaTuttoRicevuto({ commessaId: commessa.id });
    expect(primo).toEqual({ segnate: 1 });
    const righe = getMagazzinoStore().filter(p => p.commessaId === commessa.id);
    expect(righe.every(p => p.arrivato)).toBe(true);
    expect(righe.find(p => p.id === a.id)?.arrivato).toBe(true);

    const secondo = await caller().magazzino.segnaTuttoRicevuto({ commessaId: commessa.id });
    expect(secondo).toEqual({ segnate: 0 });
  });

  it("una commessa di un'altra sede non si tocca", async () => {
    const commessa = await caller().commesse.create({ cliente: "Altrove Anna" });
    (getCommessaById(commessa.id) as any).stato = "produzione";
    await caller().magazzino.create({ commessaId: commessa.id, nome: "Porta", quantita: 1 });
    await expect(
      caller(ALTRA_SEDE).magazzino.segnaTuttoRicevuto({ commessaId: commessa.id })
    ).rejects.toThrow();
    expect(getMagazzinoStore().find(p => p.commessaId === commessa.id)?.arrivato).toBe(false);
  });
});

describe("creaConsegnaDaConferma", () => {
  it("una conferma è una consegna sola con gli articoli dentro, idempotente per documento", async () => {
    const commessa = await caller().commesse.create({ cliente: "Cecconi Simona" });
    (getCommessaById(commessa.id) as any).stato = "da_ordinare";
    const documentoId = 990_001;
    const consegna = creaConsegnaDaConferma({
      commessaId: commessa.id,
      sedeId: SEDE,
      documentoId,
      nome: "PORVP5 PORTA BLINDATA VEGAPLUS",
      articoli: [
        { nome: "KPO50 KIT PORTA", quantita: 1 },
        { nome: "PORVP5 PORTA BLINDATA VEGAPLUS", quantita: 1 },
        { nome: "   ", quantita: 3 },
      ],
      fornitore: "Alias",
      numeroOrdine: "1684077",
      dataOrdine: "2026-08-04",
      dataConsegna: null,
      prontaDal: "2026-05-18",
      note: "Letta dalla conferma",
    });
    expect(consegna).toMatchObject({
      nome: "PORVP5 PORTA BLINDATA VEGAPLUS",
      quantita: 1,
      fornitore: "Alias",
      numeroOrdine: "1684077",
      prontaDal: "2026-05-18",
      arrivato: false,
      documentoId,
    });
    expect(consegna.articoli).toEqual([
      { nome: "KPO50 KIT PORTA", quantita: 1 },
      { nome: "PORVP5 PORTA BLINDATA VEGAPLUS", quantita: 1 },
    ]);
    const ripetuta = creaConsegnaDaConferma({
      commessaId: commessa.id,
      sedeId: SEDE,
      documentoId,
      nome: "altro",
      articoli: [],
      fornitore: null,
      numeroOrdine: null,
      dataOrdine: null,
      dataConsegna: null,
      prontaDal: null,
      note: null,
    });
    expect(ripetuta.id).toBe(consegna.id);
    expect(getMagazzinoStore().filter(p => p.documentoId === documentoId)).toHaveLength(1);
  });
});
