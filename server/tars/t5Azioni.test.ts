// Tars T5 — le prove delle azioni L2 e del gateway L3: prendere in
// carico e rinviare i casi è esecuzione DIRETTA (zero conferme, audit
// negli eventi del caso, anti-stale del servizio); la proposta L3 nasce
// INERTE dal gateway D7 con UNA sola conferma umana
// (proposte.approvaEApplica, stessa doppia capability), il modello non
// ha alcuno strumento per approvare, la freschezza blocca le proposte
// stantie, e i flag (anche multipli per strumento) non si aggirano.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";

const memoriaStorage = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../_core/fileStorage", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/fileStorage")>();
  const { createHash } = await import("node:crypto");
  let progressivo = 0;
  return {
    ...actual,
    putFile: vi.fn(
      async (
        collection: string,
        _parentId: number,
        _recordId: number,
        _originalName: string,
        buffer: Buffer,
        _mimeType: string
      ) => {
        const storageKey = `${collection}/t5/${++progressivo}`;
        memoriaStorage.set(storageKey, Buffer.from(buffer));
        return {
          storageKey,
          checksum: createHash("sha256").update(buffer).digest("hex"),
        };
      }
    ),
    getFile: vi.fn(async (storageKey: string) =>
      memoriaStorage.get(storageKey) ?? null
    ),
  };
});

import type { TrpcContext } from "../_core/context";
import { getActionCaseRepository } from "../actionCenter/repository";
import { getProposteStore } from "../proposte/gateway";
import { appRouter } from "../routers";
import { getOrdineFornitoreById } from "../routers/fornitori";
import { getUtentiStore } from "../routers/utenti";
import { azzeraArchivioPerTest, turniDiConversazione } from "./archivio";
import { costruisciContesto } from "./contesto";
import { chiamataTool, creaProviderFinto, rispostaTesto } from "./openai/fake";
import { azzeraCacheTarsPerTest, eseguiRun } from "./orchestratore";
import { strumentiPerContesto } from "./profili";
import type { PassoCopione } from "./openai/fake";

const SEDE = 90101;
const ALTRA_SEDE = 90102;
const DIREZIONE_ID = 90111;
const COMMERCIALE_ID = 90112;

for (const [id, ruoli] of [
  [DIREZIONE_ID, ["direzione"]],
  [COMMERCIALE_ID, ["commerciale"]],
] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Nome${id}`,
      cognome: `Cognome${id}`,
      email: `tars-t5-${id}@example.test`,
      attivo: true,
      ruoli: [...ruoli],
      ruolo: ruoli[0],
      sediIds: [SEDE],
    });
  }
}

function contestoTrpc(
  userId: number,
  roles: string[],
  sedeId = SEDE
): TrpcContext {
  return {
    user: {
      id: userId,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

const direzione = (sedeId = SEDE) =>
  appRouter.createCaller(contestoTrpc(DIREZIONE_ID, ["direzione"], sedeId));
const commerciale = () =>
  appRouter.createCaller(contestoTrpc(COMMERCIALE_ID, ["commerciale"]));

function copioneSequenza(...passi: any[]): PassoCopione {
  return (_richiesta, passo) => passi[Math.min(passo, passi.length - 1)];
}

async function runDirezione(copione: PassoCopione, sedeId = SEDE) {
  const contesto = await costruisciContesto(
    contestoTrpc(DIREZIONE_ID, ["direzione"], sedeId)
  );
  return eseguiRun({
    contesto,
    provider: creaProviderFinto(copione),
    messaggio: "Agisci sul caso/proposta di prova",
  });
}

async function seminaCaso(sedeId = SEDE) {
  const commessa = await direzione(sedeId).commesse.create({
    cliente: `Caso T5 ${Date.now()}-${Math.random()}`,
  });
  const { record } = await getActionCaseRepository().upsertDraft(
    {
      canonicalKey: `t5:caso:${commessa.id}`,
      sedeId,
      targetType: "commessa",
      targetId: commessa.id,
      commessaId: commessa.id,
      clienteId: null,
      title: `Caso T5 su ${commessa.codice}`,
      priority: "alta",
      priorityScore: 70,
      assigneeUserId: null,
      dueAt: null,
      link: `/commesse/${commessa.id}`,
      signals: [],
      signalFingerprint: `t5-${commessa.id}`,
      nextAction: { sourceKind: "consegna", label: "Verifica" },
    },
    new Date()
  );
  return record;
}

function pdfDaTesto(righe: string[]): Buffer {
  const doc = new jsPDF();
  righe.forEach((riga, n) => doc.text(riga, 12, 16 + n * 8));
  return Buffer.from(doc.output("arraybuffer"));
}

/** Ordine con conferma analizzata: consegna 24/09 contro 10/09. */
async function casoConferma() {
  const admin = direzione();
  const commessa = await admin.commesse.create({ cliente: "Gateway Tars T5" });
  const fornitore = await admin.fornitori.create({
    ragioneSociale: `Fornitore T5 ${Date.now()}-${Math.random()}`,
    partitaIva: "01234567890",
    categoria: "pvc",
  });
  const ordine = await admin.fornitori.ordini.create({
    fornitoreId: fornitore.id,
    commessaId: commessa.id,
    codiceOrdine: `ORD-T5-${Math.floor(Math.random() * 1_000_000)}`,
    dataConsegnaPrevista: "2026-09-10",
    righe: [
      {
        descrizione: "Finestra due ante",
        codiceArticolo: "FIN-2A",
        quantita: 2,
        unitaMisura: "pz",
        prezzoUnitario: 400,
      },
    ],
  });
  const bytes = pdfDaTesto([
    "CONFERMA D'ORDINE",
    `Vs. ordine: ${ordine.codiceOrdine}`,
    "Consegna prevista: 24/09/2026",
    "Art. FIN-2A quantita 2",
  ]);
  const documento = await admin.preventiviContratti.upload({
    commessaId: commessa.id,
    nome: `conferma-t5-${ordine.id}.pdf`,
    tipo: "conferma_ordine",
    mimeType: "application/pdf",
    size: bytes.length,
    dataBase64: bytes.toString("base64"),
    keepNome: true,
  });
  await admin.analisiDocumenti.analizzaConferma({
    ordineId: ordine.id,
    documentoId: documento.id,
  });
  return { commessa, ordine, documento };
}

beforeEach(() => {
  azzeraCacheTarsPerTest();
  azzeraArchivioPerTest();
});

afterEach(() => {
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
  delete process.env.FLAG_TARS_PROPOSALS;
  delete process.env.FLAG_PROPOSTE;
});

describe("tars T5 — azioni L2 sui casi (esecuzione diretta)", () => {
  it("prendi_in_carico_caso esegue SUBITO: zero conferme, audit nell'evento, assegnatario = principal", async () => {
    const caso = await seminaCaso();
    const risposta = await runDirezione(
      copioneSequenza(
        chiamataTool("prendi_in_carico_caso", { casoId: caso.id }),
        rispostaTesto("Preso in carico.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("preso_in_carico");
    const aggiornato = await getActionCaseRepository().findById(SEDE, caso.id);
    expect(aggiornato?.status).toBe("in_carico");
    expect(aggiornato?.assigneeUserId).toBe(DIREZIONE_ID);
    const eventi = await getActionCaseRepository().listEvents(SEDE, caso.id);
    expect(eventi.map(e => e.eventType)).toContain("presa_in_carico");

    const turni = await turniDiConversazione(risposta.conversazioneId, SEDE);
    expect(turni).toHaveLength(2); // zero turni di conferma
  });

  it("rinvia_caso usa il parser temporale e registra il rinvio", async () => {
    const caso = await seminaCaso();
    const primaDelRun = Date.now();
    const risposta = await runDirezione(
      copioneSequenza(
        chiamataTool("rinvia_caso", {
          casoId: caso.id,
          quando: "tra due ore",
          motivo: "aspetto il fornitore",
        }),
        rispostaTesto("Rinviato.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("rinviato");
    const aggiornato = await getActionCaseRepository().findById(SEDE, caso.id);
    expect(aggiornato?.status).toBe("rinviata");
    const delta =
      (aggiornato!.snoozedUntil!.getTime() - primaDelRun) / 3_600_000;
    expect(delta).toBeGreaterThan(1.9);
    expect(delta).toBeLessThan(2.1);
  });

  it("cross-sede: un caso di un'altra sede non si tocca", async () => {
    const caso = await seminaCaso(ALTRA_SEDE);
    const risposta = await runDirezione(
      copioneSequenza(
        chiamataTool("prendi_in_carico_caso", { casoId: caso.id }),
        rispostaTesto("Non trovato.")
      )
    );
    expect(risposta.azioni[0].stato).toBe("non_eseguito");
    const intatto = await getActionCaseRepository().findById(
      ALTRA_SEDE,
      caso.id
    );
    expect(intatto?.status).toBe("da_valutare");
  });

  it("con FLAG_TARS_L2_ACTIONS spento gli strumenti casi non esistono e la chiamata forzata non agisce", async () => {
    const caso = await seminaCaso();
    process.env.FLAG_TARS_L2_ACTIONS = "off";
    const contesto = await costruisciContesto(
      contestoTrpc(DIREZIONE_ID, ["direzione"])
    );
    expect(
      strumentiPerContesto(contesto).some(s => s.nome === "prendi_in_carico_caso")
    ).toBe(false);
    const risposta = await runDirezione(
      copioneSequenza(
        chiamataTool("prendi_in_carico_caso", { casoId: caso.id }),
        rispostaTesto("Niente.")
      )
    );
    expect(risposta.azioni).toHaveLength(0);
    const intatto = await getActionCaseRepository().findById(SEDE, caso.id);
    expect(intatto?.status).toBe("da_valutare");
  });
});

describe("tars T5 — proposte L3 attraverso il gateway", () => {
  it("proponi_data_consegna genera una proposta INERTE con anteprima e conferma; l'ordine non cambia", { timeout: 120_000 }, async () => {
    const { ordine } = await casoConferma();
    const risposta = await runDirezione(
      copioneSequenza(
        chiamataTool("proponi_data_consegna", { ordineId: ordine.id }),
        rispostaTesto("Proposta pronta: tocca a te approvare.")
      )
    );
    const azione = risposta.azioni[0];
    expect(azione.stato).toBe("proposta_creata");
    expect(azione.conferma).toMatchObject({ via: "proposte.approvaEApplica" });
    expect(azione.assunzioni.join(" ")).toContain("più recente");

    const proposta = getProposteStore().find(
      p => p.id === azione.conferma!.propostaId
    );
    expect(proposta?.stato).toBe("proposta");
    expect(proposta?.valoreProposto).toBe("2026-09-24");
    // INERTE: il dato vivo non è cambiato.
    expect(getOrdineFornitoreById(ordine.id)!.ordine.dataConsegnaPrevista).toBe(
      "2026-09-10"
    );
  });

  it("il modello NON ha strumenti di approvazione, in nessun profilo (L5)", async () => {
    const contesto = await costruisciContesto(
      contestoTrpc(DIREZIONE_ID, ["direzione"])
    );
    const nomi = strumentiPerContesto(contesto).map(s => s.nome);
    expect(nomi.some(n => /approva|applica/.test(n))).toBe(false);
  });

  it("UNICA conferma umana: approvaEApplica applica in un click, è idempotente al doppio click e aggiorna l'ordine", { timeout: 120_000 }, async () => {
    const { ordine } = await casoConferma();
    const risposta = await runDirezione(
      copioneSequenza(
        chiamataTool("proponi_data_consegna", { ordineId: ordine.id }),
        rispostaTesto("Proposta pronta.")
      )
    );
    const propostaId = risposta.azioni[0].conferma!.propostaId;

    const primo = await direzione().proposte.approvaEApplica({ id: propostaId });
    expect(primo.proposta.stato).toBe("applicata");
    expect(primo.riusata).toBe(false);
    expect(getOrdineFornitoreById(ordine.id)!.ordine.dataConsegnaPrevista).toBe(
      "2026-09-24"
    );

    const secondo = await direzione().proposte.approvaEApplica({
      id: propostaId,
    });
    expect(secondo.riusata).toBe(true);
  });

  it("senza capability niente conferma: il commerciale è FORBIDDEN e non vede lo strumento", { timeout: 120_000 }, async () => {
    const { ordine } = await casoConferma();
    const risposta = await runDirezione(
      copioneSequenza(
        chiamataTool("proponi_data_consegna", { ordineId: ordine.id }),
        rispostaTesto("Proposta pronta.")
      )
    );
    const propostaId = risposta.azioni[0].conferma!.propostaId;
    await expect(
      commerciale().proposte.approvaEApplica({ id: propostaId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const contesto = await costruisciContesto(
      contestoTrpc(COMMERCIALE_ID, ["commerciale"])
    );
    expect(
      strumentiPerContesto(contesto).some(
        s => s.nome === "proponi_data_consegna"
      )
    ).toBe(false);

    // soloDirezione deve MORDERE da solo: il ruolo `ordini` HA la
    // capability fornitore.manage_ordini ma non è direzione.
    const contestoOrdini = await costruisciContesto(
      contestoTrpc(COMMERCIALE_ID, ["ordini"])
    );
    expect(contestoOrdini.capability.has("fornitore.manage_ordini")).toBe(true);
    expect(
      strumentiPerContesto(contestoOrdini).some(
        s => s.nome === "proponi_data_consegna"
      )
    ).toBe(false);
  });

  it("freschezza: se l'ordine cambia dopo la proposta, la conferma unica viene rifiutata", { timeout: 120_000 }, async () => {
    const { ordine } = await casoConferma();
    const risposta = await runDirezione(
      copioneSequenza(
        chiamataTool("proponi_data_consegna", { ordineId: ordine.id }),
        rispostaTesto("Proposta pronta.")
      )
    );
    const propostaId = risposta.azioni[0].conferma!.propostaId;
    const vivo = getOrdineFornitoreById(ordine.id)!.ordine;
    (vivo as any).dataConsegnaPrevista = "2026-09-12"; // cambiato nel frattempo
    await expect(
      direzione().proposte.approvaEApplica({ id: propostaId })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const proposta = getProposteStore().find(p => p.id === propostaId);
    expect(proposta?.stato).toBe("obsoleta");
  });

  it("gli interruttori multipli valgono TUTTI: con FLAG_PROPOSTE spento lo strumento sparisce", { timeout: 120_000 }, async () => {
    process.env.FLAG_PROPOSTE = "off";
    const contesto = await costruisciContesto(
      contestoTrpc(DIREZIONE_ID, ["direzione"])
    );
    expect(
      strumentiPerContesto(contesto).some(
        s => s.nome === "proponi_data_consegna"
      )
    ).toBe(false);
  });
});
