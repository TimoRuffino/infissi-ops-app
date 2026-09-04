// D7 slice 3 — approval gateway sul flusso reale: generazione dalla
// analisi, doppio requisito di capability (con override individuali),
// cross-sede, applicazione con freschezza, conflitto con la posa nel
// Centro Azioni e la prova che l'applicazione tocca SOLO la data di
// consegna dell'ordine — mai pianificazione, commessa o righe.

import { describe, expect, it, vi } from "vitest";
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
        const storageKey = `${collection}/proposte/${++progressivo}`;
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
import { appRouter } from "../routers";
import { collectCurrentSignals } from "../actionCenter/sources";
import { getProposteStore } from "../proposte/gateway";
import { getCommessaById } from "./commesse";
import { getInterventiStore } from "./interventi";
import { getOrdineFornitoreById } from "./fornitori";
import { getUtentiStore } from "./utenti";

const SEDE = 91501;
const ALTRA_SEDE = 91502;
const DIREZIONE_ID = 91511;
const APPROVATORE_ID = 91512; // ruolo `ordini`: entrambe le capability
const ESTRANEO_ID = 91513; // commerciale: nessuna delle due
const PARZIALE_ID = 91514; // commerciale + override SOLO approve_proposals
const DELEGATO_ID = 91515; // commerciale + override su ENTRAMBE

for (const [id, ruoli] of [
  [APPROVATORE_ID, ["ordini"]],
  [ESTRANEO_ID, ["commerciale"]],
  [PARZIALE_ID, ["commerciale"]],
  [DELEGATO_ID, ["commerciale"]],
] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Nome${id}`,
      cognome: `Cognome${id}`,
      email: `proposte-${id}@example.test`,
      attivo: true,
      ruoli: [...ruoli],
      ruolo: ruoli[0],
      sediIds: [SEDE],
    });
  }
}

function context(userId: number, roles: string[], sedeId = SEDE): TrpcContext {
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
  appRouter.createCaller(context(DIREZIONE_ID, ["direzione"], sedeId));
const approvatore = () =>
  appRouter.createCaller(context(APPROVATORE_ID, ["ordini"], SEDE));
const estraneo = () =>
  appRouter.createCaller(context(ESTRANEO_ID, ["commerciale"], SEDE));
const parziale = () =>
  appRouter.createCaller(context(PARZIALE_ID, ["commerciale"], SEDE));
const delegato = () =>
  appRouter.createCaller(context(DELEGATO_ID, ["commerciale"], SEDE));

function pdfDaTesto(righe: string[]): Buffer {
  const doc = new jsPDF();
  righe.forEach((riga, n) => doc.text(riga, 12, 16 + n * 8));
  return Buffer.from(doc.output("arraybuffer"));
}

async function caricaPdf(commessaId: number, nome: string, bytes: Buffer) {
  return direzione().preventiviContratti.upload({
    commessaId,
    nome,
    tipo: "conferma_ordine",
    mimeType: "application/pdf",
    size: bytes.length,
    dataBase64: bytes.toString("base64"),
    keepNome: true,
  });
}

/**
 * Un ordine con conferma analizzata che dichiara la consegna al
 * 24/09/2026 contro il 10/09/2026 dell'ordine: la materia prima di ogni
 * proposta. Ogni chiamata costruisce un caso NUOVO e indipendente.
 */
async function casoConferma(opzioni?: { consegnaOrdine?: string }) {
  const admin = direzione();
  const commessa = await admin.commesse.create({ cliente: "Gateway Prova" });
  const fornitore = await admin.fornitori.create({
    ragioneSociale: `Serramenti Gateway ${Date.now()}-${Math.random()}`,
    partitaIva: "01234567890",
    categoria: "pvc",
  });
  const ordine = await admin.fornitori.ordini.create({
    fornitoreId: fornitore.id,
    commessaId: commessa.id,
    codiceOrdine: `ORD-GW-${Math.floor(Math.random() * 1_000_000)}`,
    dataConsegnaPrevista: opzioni?.consegnaOrdine ?? "2026-09-10",
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
  const documento = await caricaPdf(
    commessa.id,
    `conferma-${ordine.id}.pdf`,
    pdfDaTesto([
      "CONFERMA D'ORDINE",
      `Vs. ordine: ${ordine.codiceOrdine}`,
      "Consegna prevista: 24/09/2026",
      "Art. FIN-2A quantita 2",
    ])
  );
  await admin.analisiDocumenti.analizzaConferma({
    ordineId: ordine.id,
    documentoId: documento.id,
  });
  return { commessa, fornitore, ordine, documento };
}

async function generaProposta(ordineId: number, documentoId: number) {
  const esito = await direzione().proposte.genera({ ordineId, documentoId });
  expect(esito.proposte).toHaveLength(1);
  return esito.proposte[0].proposta;
}

describe("proposte documentali — approval gateway sul flusso reale", () => {
  it("genera dalla analisi una proposta con evidenza, snapshot e motivazione; idempotente", async () => {
    const { ordine, documento } = await casoConferma();
    const esito = await direzione().proposte.genera({
      ordineId: ordine.id,
      documentoId: documento.id,
    });
    expect(esito.motivo).toBeNull();
    expect(esito.proposte).toHaveLength(1);
    const { proposta, riusata } = esito.proposte[0];
    expect(riusata).toBe(false);
    expect(proposta.tipo).toBe("ordine_fornitore.aggiorna_data_consegna");
    expect(proposta.stato).toBe("proposta");
    expect(proposta.autore).toBe("sistema");
    expect(proposta.valoreCorrente).toBe("2026-09-10");
    expect(proposta.valoreProposto).toBe("2026-09-24");
    expect(proposta.evidenza?.frammento).toContain("24/09/2026");
    expect(proposta.evidenza?.pagina).toBe(1);
    expect(proposta.motivazione).toContain("2026-09-24");
    expect(proposta.versioni.estrattore).toBe("1.1.0");
    expect(proposta.effetto).toContain(ordine.codiceOrdine);
    expect(proposta.effetto).toContain("10/09/2026 → 24/09/2026");

    const secondo = await direzione().proposte.genera({
      ordineId: ordine.id,
      documentoId: documento.id,
    });
    expect(secondo.proposte[0].riusata).toBe(true);
    expect(secondo.proposte[0].proposta.id).toBe(proposta.id);
  });

  it("senza analisi non genera; documento inesistente → NOT_FOUND", async () => {
    const { commessa, ordine } = await casoConferma();
    // Documento del fascicolo MA mai analizzato su questo ordine.
    const senzaAnalisi = await caricaPdf(
      commessa.id,
      `mai-analizzato-${ordine.id}.pdf`,
      pdfDaTesto(["Documento qualunque"])
    );
    await expect(
      direzione().proposte.genera({
        ordineId: ordine.id,
        documentoId: senzaAnalisi.id,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      direzione().proposte.genera({ ordineId: ordine.id, documentoId: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un documento di un'altra commessa senza collegamento attivo non genera proposte", async () => {
    const { ordine } = await casoConferma();
    const altra = await direzione().commesse.create({
      cliente: "Fascicolo Estraneo",
    });
    const estraneo = await caricaPdf(
      altra.id,
      `estraneo-${ordine.id}.pdf`,
      pdfDaTesto(["CONFERMA D'ORDINE", "Consegna prevista: 24/09/2026"])
    );
    await expect(
      direzione().proposte.genera({
        ordineId: ordine.id,
        documentoId: estraneo.id,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("non propone nulla se l'ordine è già allineato alla conferma", async () => {
    const { ordine, documento } = await casoConferma({
      consegnaOrdine: "2026-09-24",
    });
    const esito = await direzione().proposte.genera({
      ordineId: ordine.id,
      documentoId: documento.id,
    });
    expect(esito.proposte).toHaveLength(0);
    expect(esito.motivo).toContain("coincide già");
  });

  it("doppio requisito: senza capability niente lettura né decisioni; il ruolo ordini le ha entrambe", async () => {
    const { ordine, documento } = await casoConferma();
    const proposta = await generaProposta(ordine.id, documento.id);

    await expect(
      estraneo().proposte.perOrdine({ ordineId: ordine.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      estraneo().proposte.approva({ id: proposta.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const vista = await approvatore().proposte.perOrdine({
      ordineId: ordine.id,
    });
    expect(vista.puoApprovare).toBe(true);
    expect(vista.puoApplicare).toBe(true);
    expect(vista.proposte.map(p => p.id)).toContain(proposta.id);
    const approvata = await approvatore().proposte.approva({
      id: proposta.id,
    });
    expect(approvata.stato).toBe("approvata");
    expect(approvata.eventi.at(-1)?.utenteId).toBe(APPROVATORE_ID);
  });

  it("metà del requisito non basta: solo approve_proposals (override) → FORBIDDEN", async () => {
    const admin = direzione();
    await admin.permessi.updateOverride({
      userId: PARZIALE_ID,
      capability: "documento.approve_proposals",
      effect: "allow",
      reason: "Test doppio requisito: metà permesso.",
    });
    const { ordine, documento } = await casoConferma();
    const proposta = await generaProposta(ordine.id, documento.id);

    // La lettura passa (ha una delle due capability)...
    const vista = await parziale().proposte.perOrdine({ ordineId: ordine.id });
    expect(vista.puoApprovare).toBe(false);
    // ...ma approvare richiede ANCHE l'operazione finale sull'ordine.
    await expect(
      parziale().proposte.approva({ id: proposta.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("gli override individuali su ENTRAMBE le capability abilitano un non-ordini: decide il motore, non il ruolo", async () => {
    const admin = direzione();
    for (const capability of [
      "documento.approve_proposals",
      "fornitore.manage_ordini",
    ] as const) {
      await admin.permessi.updateOverride({
        userId: DELEGATO_ID,
        capability,
        effect: "allow",
        reason: "Delega temporanea per il test.",
      });
    }
    const { ordine, documento } = await casoConferma();
    const proposta = await generaProposta(ordine.id, documento.id);
    const approvata = await delegato().proposte.approva({ id: proposta.id });
    expect(approvata.stato).toBe("approvata");
    const esito = await delegato().proposte.applica({ id: proposta.id });
    expect(esito.proposta.stato).toBe("applicata");
  });

  it("applica SOLO la data di consegna: pianificazione, commessa e righe restano intatte", async () => {
    const { commessa, ordine, documento } = await casoConferma();
    const admin = direzione();
    // Posa pianificata PRIMA della nuova consegna: il conflitto che NON
    // deve essere risolto in automatico.
    const posa = await admin.interventi.create({
      commessaId: commessa.id,
      tipo: "posa",
      dataPianificata: "2026-09-15",
    });
    const proposta = await generaProposta(ordine.id, documento.id);
    await admin.proposte.approva({ id: proposta.id });

    const fotografiaCommessa = JSON.stringify(getCommessaById(commessa.id));
    const fotografiaInterventi = JSON.stringify(
      getInterventiStore().filter((i: any) => i.commessaId === commessa.id)
    );
    const ordinePrima: any = getOrdineFornitoreById(ordine.id)!.ordine;
    const righePrima = JSON.stringify(ordinePrima.righe);
    const statoPrima = ordinePrima.stato;

    // Prima dell'applicazione la data NON è cambiata (approvare ≠ applicare).
    expect(ordinePrima.dataConsegnaPrevista).toBe("2026-09-10");

    const esito = await admin.proposte.applica({ id: proposta.id });
    expect(esito.proposta.stato).toBe("applicata");
    expect(esito.avvisoPosa).toContain("2026-09-15");
    expect(esito.avvisoPosa).toContain("Nessuna data di posa è stata modificata");

    const ordineDopo: any = getOrdineFornitoreById(ordine.id)!.ordine;
    expect(ordineDopo.dataConsegnaPrevista).toBe("2026-09-24");
    expect(JSON.stringify(ordineDopo.righe)).toBe(righePrima);
    expect(ordineDopo.stato).toBe(statoPrima);
    expect(JSON.stringify(getCommessaById(commessa.id))).toBe(
      fotografiaCommessa
    );
    expect(
      JSON.stringify(
        getInterventiStore().filter((i: any) => i.commessaId === commessa.id)
      )
    ).toBe(fotografiaInterventi);

    // Doppia applicazione: idempotente, nessuna seconda scrittura.
    const updatedAtDopo = String(ordineDopo.updatedAt);
    const doppia = await admin.proposte.applica({ id: proposta.id });
    expect(doppia.riusata).toBe(true);
    expect(
      String((getOrdineFornitoreById(ordine.id)!.ordine as any).updatedAt)
    ).toBe(updatedAtDopo);

    // Il conflitto diventa un caso del Centro Azioni con priorità ed
    // evidenza documentale — e si spegne quando la posa viene ripianificata.
    const segnale = collectCurrentSignals(SEDE).find(
      s => s.kind === "consegna_fornitore" && s.commessaId === commessa.id
    );
    expect(segnale).toBeDefined();
    expect(segnale!.summary).toContain(ordine.codiceOrdine);
    expect(segnale!.summary).toContain("2026-09-15");
    expect(segnale!.summary).toContain(documento.nome);
    expect(segnale!.priority).toBe("alta");
    expect(segnale!.actionLabel).toBe("Rivedi la pianificazione della posa");

    await admin.interventi.update({
      id: posa.id,
      dataPianificata: "2026-09-30",
    });
    expect(
      collectCurrentSignals(SEDE).find(
        s => s.kind === "consegna_fornitore" && s.commessaId === commessa.id
      )
    ).toBeUndefined();
  });

  it("non applica una proposta solo proposta, né una rifiutata", async () => {
    const { ordine, documento } = await casoConferma();
    const proposta = await generaProposta(ordine.id, documento.id);
    await expect(
      direzione().proposte.applica({ id: proposta.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const rifiutata = await direzione().proposte.rifiuta({
      id: proposta.id,
      motivo: "Conferma superata da una revisione successiva.",
    });
    expect(rifiutata.stato).toBe("rifiutata");
    await expect(
      direzione().proposte.applica({ id: proposta.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (getOrdineFornitoreById(ordine.id)!.ordine as any).dataConsegnaPrevista
    ).toBe("2026-09-10");
  });

  it("proposta obsoleta: se la data dell'ordine cambia dopo la generazione, serve una nuova revisione", async () => {
    const { ordine, documento } = await casoConferma();
    const proposta = await generaProposta(ordine.id, documento.id);
    await direzione().proposte.approva({ id: proposta.id });
    // Il dato sorgente cambia fuori dalla proposta (altra decisione umana).
    const { aggiornaDataConsegnaOrdine } = await import("./fornitori");
    aggiornaDataConsegnaOrdine(ordine.id, SEDE, "2026-10-05");

    await expect(
      direzione().proposte.applica({ id: proposta.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const vista = await direzione().proposte.perOrdine({
      ordineId: ordine.id,
    });
    const aggiornata = vista.proposte.find(p => p.id === proposta.id)!;
    expect(aggiornata.stato).toBe("obsoleta");
    expect(aggiornata.eventi.at(-1)?.motivo).toContain("2026-10-05");
    expect(
      (getOrdineFornitoreById(ordine.id)!.ordine as any).dataConsegnaPrevista
    ).toBe("2026-10-05");
  });

  it("collegamento annullato → il run resta ma non genera più proposte", async () => {
    const admin = direzione();
    const { ordine } = await casoConferma();
    // Documento in un ALTRO fascicolo, collegato esplicitamente all'ordine.
    const altra = await admin.commesse.create({ cliente: "Fascicolo B" });
    const documento = await caricaPdf(
      altra.id,
      `collegato-${ordine.id}.pdf`,
      pdfDaTesto([
        "CONFERMA D'ORDINE",
        `Vs. ordine: ${ordine.codiceOrdine}`,
        "Consegna prevista: 24/09/2026",
      ])
    );
    await admin.analisiDocumenti.collega({
      documentoId: documento.id,
      ordineId: ordine.id,
    });
    await admin.analisiDocumenti.analizzaConferma({
      ordineId: ordine.id,
      documentoId: documento.id,
    });
    // Col collegamento attivo la generazione funziona.
    const prima = await admin.proposte.genera({
      ordineId: ordine.id,
      documentoId: documento.id,
    });
    expect(prima.proposte).toHaveLength(1);
    await admin.proposte.annulla({ id: prima.proposte[0].proposta.id });

    // L'umano annulla il collegamento: il run resta in archivio, ma da un
    // documento che NON appartiene più all'ordine non nascono proposte
    // (rilievo della revisione indipendente).
    await admin.analisiDocumenti.annulla({ documentoId: documento.id });
    await expect(
      admin.proposte.genera({ ordineId: ordine.id, documentoId: documento.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("annulla con motivo e audit completo degli eventi", async () => {
    const { ordine, documento } = await casoConferma();
    const proposta = await generaProposta(ordine.id, documento.id);
    await approvatore().proposte.approva({ id: proposta.id });
    const annullata = await approvatore().proposte.annulla({
      id: proposta.id,
      motivo: "Il fornitore ha ritirato la conferma.",
    });
    expect(annullata.stato).toBe("annullata");
    expect(annullata.eventi.map(e => e.tipo)).toEqual([
      "creata",
      "approvata",
      "annullata",
    ]);
    expect(annullata.eventi.at(-1)?.utenteId).toBe(APPROVATORE_ID);
    expect(annullata.eventi.at(-1)?.motivo).toContain("ritirato");
  });

  it("isola le sedi: proposta e ordine di un'altra sede → NOT_FOUND", async () => {
    const { ordine, documento } = await casoConferma();
    const proposta = await generaProposta(ordine.id, documento.id);
    const altraSede = direzione(ALTRA_SEDE);
    await expect(
      altraSede.proposte.perOrdine({ ordineId: ordine.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      altraSede.proposte.approva({ id: proposta.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      altraSede.proposte.applica({ id: proposta.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("proposta scaduta: oltre la finestra niente approvazione, stato esplicito", async () => {
    const { ordine, documento } = await casoConferma();
    const proposta = await generaProposta(ordine.id, documento.id);
    const record = getProposteStore().find(p => p.id === proposta.id)! as any;
    record.scadeIl = new Date(Date.now() - 1000);
    await expect(
      direzione().proposte.approva({ id: proposta.id })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const vista = await direzione().proposte.perOrdine({
      ordineId: ordine.id,
    });
    expect(vista.proposte.find(p => p.id === proposta.id)?.stato).toBe(
      "scaduta"
    );
  });
});
