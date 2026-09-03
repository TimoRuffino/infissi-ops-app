// Il getter in blocco esiste per una ragione sola: prendere in una domanda
// quello che prima costava una domanda per riga. Se cambia il contratto —
// sede, tombstone, chiavi mancanti — cambia il senso di ogni chiamante, quindi
// il contratto sta scritto qui e non nella testa di chi legge.
import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetComunicazioniInMemoria,
  deleteComunicazione,
  getComunicazione,
  getComunicazioniByIds,
  insertComunicazione,
} from "./comunicazioni";

const SEDE = 97301;
const ALTRA_SEDE = 97302;

async function semina(messageId: string, sedeId = SEDE) {
  const row = await insertComunicazione({
    sedeId,
    casellaId: 1,
    messageId,
    canale: "email",
    direzione: "in",
    mittente: "cliente@example.test",
    mittenteNome: "Cliente",
    destinatari: ["sede@example.test"],
    oggetto: messageId,
    testo: `corpo ${messageId}`,
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "alta",
    matchMotivo: "fixture",
    stato: "nuova",
    categoria: "operativa",
    receivedAt: new Date("2026-09-01T08:00:00.000Z"),
  });
  if (!row) throw new Error("fixture duplicata");
  return row;
}

beforeEach(() => _resetComunicazioniInMemoria());

describe("getComunicazioniByIds", () => {
  it("restituisce le righe chieste, indicizzate per id", async () => {
    const a = await semina("a");
    const b = await semina("b");
    const mappa = await getComunicazioniByIds([a.id, b.id], SEDE);
    expect(mappa.size).toBe(2);
    expect(mappa.get(a.id)?.oggetto).toBe("a");
    expect(mappa.get(b.id)?.oggetto).toBe("b");
  });

  it("un id di un'altra sede non esiste", async () => {
    const mia = await semina("mia");
    const altrui = await semina("altrui", ALTRA_SEDE);
    const mappa = await getComunicazioniByIds([mia.id, altrui.id], SEDE);
    expect(mappa.has(mia.id)).toBe(true);
    expect(mappa.has(altrui.id)).toBe(false);
  });

  it("gli id sconosciuti mancano dalla mappa, non la fanno fallire", async () => {
    const a = await semina("a");
    const mappa = await getComunicazioniByIds([a.id, 999_999], SEDE);
    expect(mappa.size).toBe(1);
    expect(mappa.get(999_999)).toBeUndefined();
  });

  it("nessun id: nessuna domanda al database, mappa vuota", async () => {
    expect((await getComunicazioniByIds([], SEDE)).size).toBe(0);
  });

  it("gli id ripetuti valgono una riga sola", async () => {
    const a = await semina("a");
    const mappa = await getComunicazioniByIds([a.id, a.id, a.id], SEDE);
    expect(mappa.size).toBe(1);
  });

  it("le cancellate restano dentro: chi chiama guarda deletedAt da sé", async () => {
    const a = await semina("a");
    await deleteComunicazione(a.id, SEDE);
    const mappa = await getComunicazioniByIds([a.id], SEDE);
    expect(mappa.get(a.id)?.deletedAt).toBeTruthy();
  });

  it("dice la stessa cosa del getter singolo, riga per riga", async () => {
    const righe = [await semina("a"), await semina("b"), await semina("c")];
    const mappa = await getComunicazioniByIds(
      righe.map(r => r.id),
      SEDE
    );
    for (const riga of righe) {
      expect(mappa.get(riga.id)).toEqual(await getComunicazione(riga.id, SEDE));
    }
  });
});
