// Strumenti di scrittura «Tars libero»: ogni tool esegue la procedura
// canonica con il contesto server dell'utente (stesse autorizzazioni),
// rispetta la sede, rifiuta le archiviate dove serve, e restituisce un
// esito strutturato con prima/dopo.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { getActionCaseRepository } from "../../actionCenter/repository";
import { reconcileActionCases } from "../../actionCenter/reconcile";
import { insertComunicazione, getComunicazione } from "../../comunicazioni/comunicazioni";
import { appRouter } from "../../routers";
import { getClienteById } from "../../routers/clienti";
import { getCommessaById } from "../../routers/commesse";
import {
  _setScaricaFatturaPdfForTests,
  ficFatture,
  upsertFatture,
} from "../../routers/ficFatture";
import { getInterventiStore } from "../../routers/interventi";
import { getTicketById } from "../../routers/ticket";
import { getUtentiStore } from "../../routers/utenti";
import { setFeatureFlagsForTesting } from "../../platform/featureFlags";
import { costruisciContesto } from "../contesto";
import { STRUMENTI_SCRITTURA } from "./scrittura";
import type { ContestoRun } from "./tipi";

const SEDE = 96_801;
const ALTRA_SEDE = 96_802;
const DIREZIONE_ID = 96_811;
const POSA_ID = 96_812;

for (const [id, ruoli] of [
  [DIREZIONE_ID, ["direzione"]],
  [POSA_ID, ["squadra_posa"]],
] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({ id, nome: `N${id}`, cognome: `C${id}`, email: `scr-${id}@example.test`, attivo: true, ruoli: [...ruoli], ruolo: ruoli[0], sediIds: [SEDE] });
  }
}

function contestoTrpc(userId: number, roles: string[], sedeId = SEDE): TrpcContext {
  return {
    user: { id: userId, role: roles.includes("direzione") ? "admin" : "user", ruolo: roles[0], ruoli: roles, name: `Utente ${userId}` } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) => appRouter.createCaller(contestoTrpc(DIREZIONE_ID, ["direzione"], sedeId));
const tool = (nome: string) => STRUMENTI_SCRITTURA.find(s => s.nome === nome)!;
const contesto = (userId = DIREZIONE_ID, roles = ["direzione"]) => costruisciContesto(contestoTrpc(userId, roles));

function conCommessa(c: ContestoRun, commessaId: number): ContestoRun {
  return {
    ...c,
    contestoConversazione: {
      commessaId, clienteId: null, comunicazioneId: null, allegatoIndex: null, superficie: "commessa",
      versioniEntita: {}, chiarificazionePendente: null, versione: 1,
      verifiche: { commessa: "verificato", cliente: "assente", comunicazione: "assente", allegato: "assente" },
    },
  };
}

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_L2_ACTIONS = "on";
  process.env.FLAG_TARS_COMMUNICATIONS = "on";
});
afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
  delete process.env.FLAG_TARS_COMMUNICATIONS;
});

describe("clienti e commesse", () => {
  it("crea_cliente + crea_commessa + aggiorna_commessa (dal contesto) + archivia/ripristina", async () => {
    const ctx = await contesto();
    const cliente = await tool("crea_cliente").esegui(ctx, { nome: "Anna", cognome: "Rossi", tipo: "privato", telefono: "3331112222" });
    expect(cliente.stato).toBe("creato");
    const clienteId = cliente.dati.id;
    expect((getClienteById(clienteId) as any).note).toContain("Tars");

    const commessa = await tool("crea_commessa").esegui(ctx, { clienteId, citta: "Sarzana", priorita: "alta" });
    expect(commessa.stato).toBe("creato");
    const commessaId = commessa.dati.id;
    expect((getCommessaById(commessaId) as any).clienteId).toBe(clienteId);

    const aggiornata = await tool("aggiorna_commessa").esegui(conCommessa(ctx, commessaId), { citta: "La Spezia", note: "Portone rosso" });
    expect(aggiornata.stato).toBe("aggiornato");
    expect(aggiornata.prima).toMatchObject({ citta: "Sarzana" });
    expect((getCommessaById(commessaId) as any).citta).toBe("La Spezia");

    const archiviata = await tool("archivia_commessa").esegui(conCommessa(ctx, commessaId), {});
    expect(archiviata.stato).toBe("archiviata");
    expect((getCommessaById(commessaId) as any).archivedAt).toBeTruthy();
    const suArchiviata = await tool("aggiorna_commessa").esegui(ctx, { commessaId, note: "x" });
    expect(suArchiviata.stato).toBe("non_eseguito");
    expect(suArchiviata.motivo).toContain("archiviata");
    const ripristinata = await tool("ripristina_commessa").esegui(ctx, { commessaId });
    expect(ripristinata.stato).toBe("ripristinata");
    expect((getCommessaById(commessaId) as any).archivedAt).toBeNull();
  });

  it("aggiorna_cliente propaga i contatti; cross-sede e campi vuoti non eseguiti", async () => {
    const ctx = await contesto();
    const cliente = await direzione().clienti.create({ nome: "Luca", cognome: "Verdi", telefono: "3330000000" });
    const esito = await tool("aggiorna_cliente").esegui(ctx, { clienteId: cliente.id, telefono: "3339999999" });
    expect(esito.stato).toBe("aggiornato");
    expect((getClienteById(cliente.id) as any).telefono).toBe("3339999999");
    expect((await tool("aggiorna_cliente").esegui(ctx, { clienteId: cliente.id })).stato).toBe("non_eseguito");
    const altrove = await direzione(ALTRA_SEDE).clienti.create({ nome: "Altra", cognome: "Sede" });
    const crossSede = await tool("aggiorna_cliente").esegui(ctx, { clienteId: altrove.id, telefono: "1" });
    expect(crossSede.stato).toBe("non_eseguito");
    expect(crossSede.motivo).toContain("non trovato");
  });

  it("senza la capability la procedura rifiuta e lo strumento risponde non_eseguito senza leak", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Assegna Test" });
    const ticket = await direzione().ticket.create({ commessaId: commessa.id, oggetto: "Da assegnare", categoria: "altro" });
    // squadra_posa non ha ticket.assign: con la policy in enforce il router
    // rifiuta anche se lo strumento venisse invocato fuori catalogo.
    setFeatureFlagsForTesting(SEDE, { policyMode: "enforce" }, { actorUserId: null, reason: "test" });
    try {
      const ctxPosa = await contesto(POSA_ID, ["squadra_posa"]);
      const esito = await tool("aggiorna_ticket").esegui(ctxPosa, { ticketId: ticket.id, assegnatoA: DIREZIONE_ID });
      expect(esito.stato).toBe("non_eseguito");
      expect(esito.motivo).toMatch(/autorizzat|permess|FORBIDDEN|propriet/i);
      expect((getTicketById(ticket.id) as any).assegnatoA ?? null).toBeNull();
    } finally {
      setFeatureFlagsForTesting(SEDE, { policyMode: "legacy" }, { actorUserId: null, reason: "test" });
    }
  });
});

describe("ticket, interventi, comunicazioni, casi", () => {
  it("aggiorna_ticket e chiudi_ticket", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Ticket Test" });
    const ticket = await direzione().ticket.create({ commessaId: commessa.id, oggetto: "Vetro rotto", categoria: "difetto_prodotto" });
    const agg = await tool("aggiorna_ticket").esegui(ctx, { ticketId: ticket.id, priorita: "urgente", descrizione: "Cliente furioso" });
    expect(agg.stato).toBe("aggiornato");
    expect((getTicketById(ticket.id) as any).priorita).toBe("urgente");
    const chiuso = await tool("chiudi_ticket").esegui(ctx, { ticketId: ticket.id, esitoIntervento: "Sostituito il vetro" });
    expect(chiuso.stato).toBe("chiuso");
    expect((getTicketById(ticket.id) as any).stato).toBe("chiuso");
    expect((await tool("chiudi_ticket").esegui(ctx, { ticketId: ticket.id })).stato).toBe("non_eseguito");
  });

  it("pianifica_intervento con «quando» in linguaggio naturale, sulla commessa del contesto", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Rilievo Test", indirizzo: "Via Roma 1" });
    const esito = await tool("pianifica_intervento").esegui(conCommessa(ctx, commessa.id), { tipo: "rilievo", quando: "domani alle 9", oraInizio: "09:00" });
    expect(esito.stato).toBe("pianificato");
    expect(esito.dati.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const intervento = (getInterventiStore() as any[]).find(i => i.id === esito.dati.id);
    expect(intervento).toMatchObject({ commessaId: commessa.id, tipo: "rilievo", stato: "pianificato", indirizzo: "Via Roma 1" });
    expect(intervento.note).toContain("Tars");
  });

  it("collega_comunicazione, classifica_comunicazione, segna_gestita_comunicazione", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Mail Test" });
    const c = (await insertComunicazione({
      sedeId: SEDE, casellaId: 9, messageId: `scr-${Date.now()}`, canale: "email", direzione: "in",
      mittente: "x@example.test", mittenteNome: null, destinatari: [], oggetto: "Prova", testo: "ciao",
      allegati: [], clienteId: null, commessaId: null, matchConfidenza: "nessuna", matchMotivo: null,
      stato: "nuova", receivedAt: new Date(),
    }))!;
    const coll = await tool("collega_comunicazione").esegui(ctx, { comunicazioneId: c.id, commessaId: commessa.id });
    expect(coll.stato).toBe("collegata");
    const dopo = (await getComunicazione(c.id, SEDE))!;
    expect(dopo.commessaId).toBe(commessa.id);
    expect(dopo.stato).toBe("gestita");
    expect(dopo.categoria).toBe("operativa");
    const cls = await tool("classifica_comunicazione").esegui(ctx, { comunicazioneId: c.id, categoria: "amministrativa" });
    expect(cls.stato).toBe("classificata");
    expect((await getComunicazione(c.id, SEDE))!.categoria).toBe("amministrativa");
    const riaperta = await tool("segna_gestita_comunicazione").esegui(ctx, { comunicazioneId: c.id, gestita: false });
    expect(riaperta.stato).toBe("riaperta");
    expect((await getComunicazione(c.id, SEDE))!.stato).toBe("vista");
  });

  it("risolvi_caso chiude un caso del Centro Azioni (direzione)", async () => {
    const ctx = await contesto();
    const repo = getActionCaseRepository();
    const commessa = await direzione().commesse.create({ cliente: "Caso Test" });
    await reconcileActionCases({
      repository: repo,
      sedeId: SEDE,
      drafts: [{
        canonicalKey: `commessa:${commessa.id}`, sedeId: SEDE, targetType: "commessa", targetId: commessa.id,
        commessaId: commessa.id, clienteId: null, title: "Caso di prova", priority: "alta", priorityScore: 70,
        assigneeUserId: null, dueAt: null, link: `/commesse/${commessa.id}`, signals: [], signalFingerprint: "fp-1",
        nextAction: { sourceKind: "stato_daily", label: "Fai qualcosa" },
      }],
      now: new Date(),
    });
    const caso = (await repo.list({ sedeId: SEDE, limit: 100 })).items.find(
      c => c.canonicalKey === `commessa:${commessa.id}`
    )!;
    expect(caso).toBeDefined();
    const esito = await tool("risolvi_caso").esegui(ctx, { casoId: caso.id, esito: "risolto" });
    expect(esito.stato).toBe("risolto");
    expect((await repo.findById(SEDE, caso.id))?.status).toBe("risolta");
    expect((await tool("risolvi_caso").esegui(ctx, { casoId: caso.id })).stato).toBe("non_eseguito");
  });
});

describe("fatture e documenti del fascicolo (T1)", () => {
  it("collega_fattura_commessa collega, con prima/dopo; già collegata e cross-sede non eseguite", async () => {
    const ctx = await contesto();
    const commessa = await direzione().commesse.create({ cliente: "Fattura Test" });
    upsertFatture([{
      id: 968_101, numero: "130/T", data: "2026-08-01",
      clienteNome: "Fattura Test", clienteVat: null, clienteCf: null,
      importoNetto: 1000, importoLordo: 1220, rate: [],
    }], SEDE);
    upsertFatture([{
      id: 968_102, numero: "131/T", data: "2026-08-02",
      clienteNome: "Altra Sede Srl", clienteVat: null, clienteCf: null,
      importoNetto: 500, importoLordo: 610, rate: [],
    }], ALTRA_SEDE);
    _setScaricaFatturaPdfForTests(async () => Buffer.from("%PDF-1.4 finto"));
    try {
      const esito = await tool("collega_fattura_commessa").esegui(ctx, {
        ficId: 968_101, commessaId: commessa.id,
      });
      expect(esito.stato).toBe("collegata");
      expect(esito.prima).toMatchObject({ commessaId: null });
      expect(esito.dati.commessaId).toBe(commessa.id);
      const f = (ficFatture as any[]).find(x => x.id === 968_101)!;
      expect(f.commessaId).toBe(commessa.id);
      expect(f.collegataAMano).toBe(true);

      const doppia = await tool("collega_fattura_commessa").esegui(ctx, {
        ficId: 968_101, commessaId: commessa.id,
      });
      expect(doppia.stato).toBe("non_eseguito");
      expect(doppia.motivo).toContain("già collegata");

      const crossSede = await tool("collega_fattura_commessa").esegui(ctx, {
        ficId: 968_102, commessaId: commessa.id,
      });
      expect(crossSede.stato).toBe("non_eseguito");
      expect(crossSede.motivo).toContain("non trovata");
    } finally {
      _setScaricaFatturaPdfForTests(null);
    }
  });

  it("collega_fattura_commessa: senza direzione/amministrazione il router rifiuta senza leak", async () => {
    const ctxPosa = await contesto(POSA_ID, ["squadra_posa"]);
    const commessa = await direzione().commesse.create({ cliente: "Fattura Ruoli" });
    upsertFatture([{
      id: 968_103, numero: "132/T", data: "2026-08-03",
      clienteNome: "Fattura Ruoli", clienteVat: null, clienteCf: null,
      importoNetto: 100, importoLordo: 122, rate: [],
    }], SEDE);
    const esito = await tool("collega_fattura_commessa").esegui(ctxPosa, {
      ficId: 968_103, commessaId: commessa.id,
    });
    expect(esito.stato).toBe("non_eseguito");
    expect(esito.motivo).toMatch(/autorizzat|direzione|amministrazione/i);
    expect((ficFatture as any[]).find(x => x.id === 968_103)!.commessaId ?? null).toBeNull();
  });
});
