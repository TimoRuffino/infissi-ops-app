// crea_ticket: commessa dal contesto verificato o esplicita, cliente
// ereditato, archiviata rifiutata, cross-sede = non trovata, senza
// riferimento = non eseguito con istruzione. Nessuna assegnazione.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import { getTicketStore } from "../../routers/ticket";
import { costruisciContesto } from "../contesto";
import type { ContestoRun } from "./tipi";
import { STRUMENTI_TICKET } from "./ticket";

const SEDE = 96_701;
const ALTRA_SEDE = 96_702;
const DIREZIONE_ID = 96_711;

function contestoTrpc(sedeId = SEDE): TrpcContext {
  return {
    user: { id: DIREZIONE_ID, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) => appRouter.createCaller(contestoTrpc(sedeId));
const strumento = STRUMENTI_TICKET.find(s => s.nome === "crea_ticket")!;

function conCommessaInContesto(contesto: ContestoRun, commessaId: number, verificata = true): ContestoRun {
  return {
    ...contesto,
    contestoConversazione: {
      commessaId,
      clienteId: null,
      comunicazioneId: null,
      allegatoIndex: null,
      superficie: "commessa",
      versioniEntita: {},
      chiarificazionePendente: null,
      versione: 1,
      verifiche: { commessa: verificata ? "verificato" : "stale", cliente: "assente", comunicazione: "assente", allegato: "assente" },
    },
  };
}

beforeEach(() => {
  process.env.FLAG_TARS = "on";
  process.env.FLAG_TARS_L2_ACTIONS = "on";
});
afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
});

describe("crea_ticket", () => {
  it("crea il ticket sulla commessa verificata del contesto, aperto e con il cliente della commessa", async () => {
    const cliente = await direzione().clienti.create({ nome: "Duilio", cognome: "Bertoli" });
    const commessa = await direzione().commesse.create({ cliente: "Bertoli Duilio", clienteId: cliente.id });
    const contesto = conCommessaInContesto(await costruisciContesto(contestoTrpc()), commessa.id);
    const esito = await strumento.esegui(contesto, {
      oggetto: "Misure sbagliate Mottura",
      descrizione: "PEC per danni",
      categoria: "difetto_posa",
      priorita: "alta",
    });
    expect(esito.stato).toBe("creato");
    expect(esito.entitaToccate).toContain(`commessa:${commessa.id}`);
    const ticket = (getTicketStore() as any[]).find(t => t.id === esito.dati.id);
    expect(ticket).toMatchObject({
      sedeId: SEDE,
      commessaId: commessa.id,
      clienteId: cliente.id,
      stato: "aperto",
      assegnatoA: null,
      categoria: "difetto_posa",
      priorita: "alta",
      apertoBy: DIREZIONE_ID,
    });
    expect(esito.undoDisponibile).toBe(false);
    expect(esito.avvertenze.join(" ")).toContain("Post-vendita");
  });

  it("una commessa in contesto ma NON verificata non basta; senza riferimenti chiede la commessa", async () => {
    const commessa = await direzione().commesse.create({ cliente: "Rossi Anna" });
    const contesto = conCommessaInContesto(await costruisciContesto(contestoTrpc()), commessa.id, false);
    const esito = await strumento.esegui(contesto, { oggetto: "Prova", categoria: "altro", priorita: "media" });
    expect(esito.stato).toBe("non_eseguito");
    expect(esito.motivo).toContain("indica la commessa");
  });

  it("commessa archiviata o di un'altra sede: non eseguito, nessun ticket", async () => {
    const archiviata = await direzione().commesse.create({ cliente: "Verdi Luca" });
    await direzione().commesse.archive(archiviata.id);
    const contesto = await costruisciContesto(contestoTrpc());
    const prima = (getTicketStore() as any[]).length;
    const esitoArchiviata = await strumento.esegui(contesto, {
      oggetto: "Ticket su archiviata",
      categoria: "altro",
      priorita: "media",
      commessaId: archiviata.id,
    });
    expect(esitoArchiviata.stato).toBe("non_eseguito");
    expect(esitoArchiviata.motivo).toContain("archiviata");

    const altrove = await direzione(ALTRA_SEDE).commesse.create({ cliente: "Altra Sede" });
    const esitoAltrove = await strumento.esegui(contesto, {
      oggetto: "Ticket cross-sede",
      categoria: "altro",
      priorita: "media",
      commessaId: altrove.id,
    });
    expect(esitoAltrove.stato).toBe("non_eseguito");
    expect(esitoAltrove.motivo).toContain("non trovata");
    expect((getTicketStore() as any[]).length).toBe(prima);
  });
});
