import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetComunicazioniInMemoria,
  deleteComunicazione,
  getLiveComunicazione,
  insertComunicazione,
  listComunicazioniCollegatePagina,
  setClassificazioneComunicazione,
} from "./comunicazioni";

const SEDE = 97101;
const ALTRA_SEDE = 97102;
const COMMESSA = 81201;

async function semina(input: {
  messageId: string;
  receivedAt: string;
  sedeId?: number;
  commessaId?: number | null;
  canale?: "email" | "whatsapp";
  casellaId?: number;
  mittente?: string;
  testo?: string;
}) {
  const row = await insertComunicazione({
    sedeId: input.sedeId ?? SEDE,
    casellaId: input.casellaId ?? 1,
    messageId: input.messageId,
    canale: input.canale ?? "email",
    direzione: "in",
    mittente: input.mittente ?? "fornitore@example.test",
    mittenteNome: "Fornitore",
    destinatari: ["sede@example.test"],
    oggetto: input.messageId,
    testo: input.testo ?? `corpo ${input.messageId}`,
    allegati: [],
    clienteId: null,
    commessaId: input.commessaId === undefined ? COMMESSA : input.commessaId,
    matchConfidenza: "alta",
    matchMotivo: "fixture",
    stato: "gestita",
    categoria: "operativa",
    receivedAt: new Date(input.receivedAt),
  });
  if (!row) throw new Error("fixture duplicata");
  return row;
}

beforeEach(() => _resetComunicazioniInMemoria());

describe("repository timeline comunicazioni collegate per Tars", () => {
  it("pagina per (receivedAt,id), resta stabile dopo un nuovo arrivo e restituisce la pagina in cronologia", async () => {
    const stessaOra = "2026-08-31T08:00:00.000Z";
    const uno = await semina({ messageId: "uno", receivedAt: "2026-08-31T07:00:00.000Z" });
    const due = await semina({ messageId: "due", receivedAt: stessaOra });
    const tre = await semina({ messageId: "tre", receivedAt: stessaOra });
    const quattro = await semina({ messageId: "quattro", receivedAt: "2026-08-31T09:00:00.000Z" });

    const prima = await listComunicazioniCollegatePagina({
      sedeId: SEDE,
      commessaId: COMMESSA,
      limite: 2,
    });
    expect(prima.messaggi.map(m => m.id)).toEqual([tre.id, quattro.id]);
    expect(prima.hasMore).toBe(true);
    expect(prima.nextBefore).toEqual({ receivedAt: tre.receivedAt, id: tre.id });

    await semina({ messageId: "nuovissima", receivedAt: "2026-08-31T10:00:00.000Z" });
    const seconda = await listComunicazioniCollegatePagina({
      sedeId: SEDE,
      commessaId: COMMESSA,
      limite: 2,
      before: prima.nextBefore!,
    });
    expect(seconda.messaggi.map(m => m.id)).toEqual([uno.id, due.id]);
    expect(seconda.hasMore).toBe(false);
    expect(new Set([...prima.messaggi, ...seconda.messaggi].map(m => m.id)).size).toBe(4);
  });

  it("esclude e conta tombstone e spam, non include righe scollegate o di altra sede", async () => {
    const live = await semina({ messageId: "live", receivedAt: "2026-08-31T08:00:00.000Z" });
    const deleted = await semina({ messageId: "deleted", receivedAt: "2026-08-31T07:00:00.000Z" });
    const spam = await semina({ messageId: "spam", receivedAt: "2026-08-31T06:00:00.000Z" });
    await semina({ messageId: "unlinked", receivedAt: "2026-08-31T05:00:00.000Z", commessaId: null });
    await semina({ messageId: "other-sede", receivedAt: "2026-08-31T04:00:00.000Z", sedeId: ALTRA_SEDE });
    await deleteComunicazione(deleted.id, SEDE);
    await setClassificazioneComunicazione(spam.id, SEDE, {
      categoria: "spam",
      motivo: "fixture",
      fonte: "utente",
    });

    const pagina = await listComunicazioniCollegatePagina({
      sedeId: SEDE,
      commessaId: COMMESSA,
      limite: 20,
    });
    expect(pagina.messaggi.map(m => m.id)).toEqual([live.id]);
    expect(pagina.omissioni).toEqual({
      eliminate: 1,
      categorieEscluse: 1,
      nonCollegate: 0,
    });
  });

  it("getLiveComunicazione è sede-scoped e non restituisce tombstone", async () => {
    const record = await semina({ messageId: "live-getter", receivedAt: "2026-08-31T08:00:00.000Z" });
    expect(await getLiveComunicazione(record.id, ALTRA_SEDE)).toBeNull();
    expect((await getLiveComunicazione(record.id, SEDE))?.id).toBe(record.id);
    await deleteComunicazione(record.id, SEDE);
    expect(await getLiveComunicazione(record.id, SEDE)).toBeNull();
  });
});
