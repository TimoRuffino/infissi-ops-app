// D7 slice 2 — collegamento assistito documento → ordine fornitore.
// Scenari richiesti dalla direzione (28/08/2026): riferimento esatto,
// riferimento mancante, più ordini compatibili, fornitore errato, commessa
// incoerente, stesso numero d'ordine in sedi diverse, duplicato, flusso
// completo collega/rifiuta/correggi/annulla con audit, cross-sede, utente
// non autorizzato, e la prova che il collegamento non modifica alcun dato
// autorevole.

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
        const storageKey = `${collection}/collega/${++progressivo}`;
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
import { getCommessaById } from "../routers/commesse";
import { getOrdineFornitoreById } from "../routers/fornitori";
import { getDocumentoRecordById } from "../routers/preventiviContratti";
import { getUtentiStore } from "../routers/utenti";

const SEDE = 90501;
const ALTRA_SEDE = 90502;
const DIREZIONE_ID = 90511;
const OWNER_ID = 90512;
const ESTRANEO_ID = 90513;

// `requireAssignableUser` esige utenti reali della sede.
for (const [id, ruoli] of [
  [OWNER_ID, ["commerciale"]],
  [ESTRANEO_ID, ["commerciale"]],
] as const) {
  const utenti = getUtentiStore() as any[];
  if (!utenti.some(u => u.id === id)) {
    utenti.push({
      id,
      nome: `Nome${id}`,
      cognome: `Cognome${id}`,
      email: `collega-${id}@example.test`,
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
const owner = () =>
  appRouter.createCaller(context(OWNER_ID, ["commerciale"], SEDE));
const estraneo = () =>
  appRouter.createCaller(context(ESTRANEO_ID, ["commerciale"], SEDE));

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

type Scenario = Awaited<ReturnType<typeof scenario>>;
let condiviso: Scenario | null = null;

/** Tre ordini nella sede (due WND, uno Alias) + un omonimo in altra sede. */
async function scenario() {
  if (condiviso) return condiviso;
  const admin = direzione();
  const commessaA = await admin.commesse.create({ cliente: "Collega A" });
  const commessaB = await admin.commesse.create({ cliente: "Collega B" });
  const commessaC = await admin.commesse.create({ cliente: "Collega C" });
  const wnd = await admin.fornitori.create({
    ragioneSociale: "WND Serramenti SRL",
    partitaIva: "01234567890",
    categoria: "pvc",
  });
  const alias = await admin.fornitori.create({
    ragioneSociale: "Alias Persiane SNC",
    partitaIva: "09876543210",
    categoria: "persiane",
  });
  const ordineA = await admin.fornitori.ordini.create({
    fornitoreId: wnd.id,
    commessaId: commessaA.id,
    codiceOrdine: "ORD-A-100",
    dataConsegnaPrevista: "2026-09-03",
    righe: [
      {
        descrizione: "Finestra 100",
        codiceArticolo: "FIN-100",
        quantita: 2,
        unitaMisura: "pz",
        prezzoUnitario: 400,
      },
    ],
  });
  const ordineB = await admin.fornitori.ordini.create({
    fornitoreId: wnd.id,
    commessaId: commessaB.id,
    codiceOrdine: "ORD-B-200",
    righe: [
      {
        descrizione: "Portafinestra 200",
        codiceArticolo: "PF-200",
        quantita: 1,
        unitaMisura: "pz",
      },
    ],
  });
  const ordineC = await admin.fornitori.ordini.create({
    fornitoreId: alias.id,
    commessaId: commessaC.id,
    codiceOrdine: "ORD-C-300",
    righe: [
      {
        descrizione: "Persiana 300",
        codiceArticolo: "PER-300",
        quantita: 3,
        unitaMisura: "pz",
      },
    ],
  });

  // Omonimo in un'altra sede: stesso codice d'ordine, mondo separato.
  const adminAltrove = direzione(ALTRA_SEDE);
  const commessaAltrove = await adminAltrove.commesse.create({
    cliente: "Altrove",
  });
  const wndAltrove = await adminAltrove.fornitori.create({
    ragioneSociale: "WND Serramenti SRL",
    partitaIva: "01234567890",
    categoria: "pvc",
  });
  const ordineAltrove = await adminAltrove.fornitori.ordini.create({
    fornitoreId: wndAltrove.id,
    commessaId: commessaAltrove.id,
    codiceOrdine: "ORD-A-100",
    righe: [
      {
        descrizione: "Finestra 100",
        codiceArticolo: "FIN-100",
        quantita: 1,
        unitaMisura: "pz",
      },
    ],
  });

  condiviso = {
    admin,
    commessaA,
    commessaB,
    commessaC,
    ordineA,
    ordineB,
    ordineC,
    ordineAltrove,
  };
  return condiviso;
}

describe("candidati deterministici", () => {
  it("riferimento ordine esatto → stato certa, con evidenza del codice", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaA.id,
      "certa.pdf",
      pdfDaTesto(["Conferma per Vs. ordine ORD-A-100", "Consegna 03/09/2026"])
    );
    const risposta = await s.admin.analisiDocumenti.candidati({
      documentoId: documento.id,
    });
    expect(risposta.statoDocumento).toBe("estratto");
    expect(risposta.esito!.stato).toBe("certa");
    const primo = risposta.esito!.candidati[0];
    expect(primo.ordineId).toBe(s.ordineA.id);
    const codice = primo.segnali.find(x => x.tipo === "codice_ordine");
    expect(codice).toBeTruthy();
    expect(codice!.evidenza?.frammento).toContain("ORD-A-100");
    // Anche la data di consegna coincidente contribuisce, spiegata.
    expect(primo.segnali.some(x => x.tipo === "data_consegna")).toBe(true);
    // «Certa» resta una PROPOSTA: nessun collegamento è stato creato.
    expect(risposta.collegamento).toBeNull();
  });

  it("riferimento mancante → candidata (commessa citata) o assente (testo generico)", async () => {
    const s = await scenario();
    const conCommessa = await caricaPdf(
      s.commessaA.id,
      "solo-commessa.pdf",
      pdfDaTesto([`Riferimento pratica ${s.commessaA.codice}`])
    );
    const rispostaCommessa = await s.admin.analisiDocumenti.candidati({
      documentoId: conCommessa.id,
    });
    expect(rispostaCommessa.esito!.stato).toBe("candidata");
    expect(rispostaCommessa.esito!.candidati[0].ordineId).toBe(s.ordineA.id);
    expect(rispostaCommessa.esito!.motivo).toMatch(/conferma/i);

    const generico = await caricaPdf(
      s.commessaA.id,
      "generico.pdf",
      pdfDaTesto(["Buongiorno, in allegato quanto richiesto. Cordiali saluti."])
    );
    const rispostaGenerico = await s.admin.analisiDocumenti.candidati({
      documentoId: generico.id,
    });
    expect(rispostaGenerico.esito!.stato).toBe("assente");
  });

  it("più ordini compatibili (solo il fornitore in comune) → ambigua, mai un collegamento automatico", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaA.id,
      "ambigua.pdf",
      pdfDaTesto(["WND Serramenti SRL", "Conferma di consegna materiale"])
    );
    const risposta = await s.admin.analisiDocumenti.candidati({
      documentoId: documento.id,
    });
    expect(risposta.esito!.stato).toBe("ambigua");
    const ordiniProposti = risposta.esito!.candidati.map(c => c.ordineId);
    expect(ordiniProposti).toEqual(
      expect.arrayContaining([s.ordineA.id, s.ordineB.id])
    );
    expect(risposta.collegamento).toBeNull();
  });

  it("fornitore errato: un ordine di un altro fornitore non guadagna il segnale", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaC.id,
      "fornitore-errato.pdf",
      pdfDaTesto(["WND Serramenti SRL", "Nota di consegna"])
    );
    const risposta = await s.admin.analisiDocumenti.candidati({
      documentoId: documento.id,
    });
    // L'ordine Alias non compare: nessun suo riferimento è nel testo.
    expect(
      risposta.esito!.candidati.some(c => c.ordineId === s.ordineC.id)
    ).toBe(false);
  });

  it("commessa incoerente: il candidato di un'altra commessa porta l'avvertenza sul fascicolo", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaA.id,
      "fascicolo-diverso.pdf",
      pdfDaTesto([`Vs. ordine ORD-B-200 — commessa ${s.commessaB.codice}`])
    );
    const risposta = await s.admin.analisiDocumenti.candidati({
      documentoId: documento.id,
    });
    expect(risposta.esito!.stato).toBe("certa");
    const candidato = risposta.esito!.candidati[0];
    expect(candidato.ordineId).toBe(s.ordineB.id);
    expect(candidato.avvertenze.join(" ")).toMatch(/altra commessa/i);
  });

  it("stesso numero d'ordine in sedi differenti: il candidato è solo quello della propria sede", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaA.id,
      "omonimo.pdf",
      pdfDaTesto(["Vs. ordine ORD-A-100"])
    );
    const risposta = await s.admin.analisiDocumenti.candidati({
      documentoId: documento.id,
    });
    const conCodice = risposta.esito!.candidati.filter(c =>
      c.segnali.some(x => x.tipo === "codice_ordine")
    );
    expect(conCodice).toHaveLength(1);
    expect(conCodice[0].ordineId).toBe(s.ordineA.id);
    expect(
      risposta.esito!.candidati.some(c => c.ordineId === s.ordineAltrove.id)
    ).toBe(false);
  });
});

describe("conferma, rifiuto, correzione, annullamento", () => {
  it("il collegamento è idempotente e NON modifica documento, ordine o commessa", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaA.id,
      "collega.pdf",
      pdfDaTesto(["Vs. ordine ORD-A-100", "Consegna 03/09/2026"])
    );
    const primaDoc = JSON.stringify(getDocumentoRecordById(documento.id));
    const primaOrdine = JSON.stringify(
      getOrdineFornitoreById(s.ordineA.id)!.ordine
    );
    const primaCommessa = JSON.stringify(getCommessaById(s.commessaA.id));

    const prima = await s.admin.analisiDocumenti.collega({
      documentoId: documento.id,
      ordineId: s.ordineA.id,
    });
    expect(prima.riusato).toBe(false);
    expect(prima.collegamento.stato).toBe("confermato");
    expect(prima.collegamento.punteggio).toBeGreaterThanOrEqual(100);
    expect(prima.collegamento.motivazioni.join(" ")).toContain("ORD-A-100");
    expect(prima.collegamento.eventi[0]).toMatchObject({
      azione: "confermato",
      utenteId: DIREZIONE_ID,
    });

    const seconda = await s.admin.analisiDocumenti.collega({
      documentoId: documento.id,
      ordineId: s.ordineA.id,
    });
    expect(seconda.riusato).toBe(true);
    expect(seconda.collegamento.id).toBe(prima.collegamento.id);

    // Requisito inderogabile: nessun dato autorevole è cambiato.
    expect(JSON.stringify(getDocumentoRecordById(documento.id))).toBe(primaDoc);
    expect(
      JSON.stringify(getOrdineFornitoreById(s.ordineA.id)!.ordine)
    ).toBe(primaOrdine);
    expect(JSON.stringify(getCommessaById(s.commessaA.id))).toBe(primaCommessa);
  });

  it("rifiuto registrato, correzione (annulla + conferma) e audit completo", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaA.id,
      "flusso.pdf",
      pdfDaTesto(["Vs. ordine ORD-A-100"])
    );

    // Rifiuto del candidato certo → lo stato non può più dirsi «certa».
    await s.admin.analisiDocumenti.rifiuta({
      documentoId: documento.id,
      ordineId: s.ordineA.id,
      motivo: "Non è la conferma di questo ordine",
    });
    const dopoRifiuto = await s.admin.analisiDocumenti.candidati({
      documentoId: documento.id,
    });
    expect(dopoRifiuto.esito!.stato).toBe("assente");
    expect(
      dopoRifiuto.esito!.candidati.find(c => c.ordineId === s.ordineA.id)!
        .rifiutato
    ).toBe(true);

    // Collegamento a un altro ordine, poi correzione: annulla e riconferma
    // quello giusto — la conferma esplicita supera il rifiuto registrato.
    await s.admin.analisiDocumenti.collega({
      documentoId: documento.id,
      ordineId: s.ordineB.id,
      motivo: "Prima lettura",
    });
    await expect(
      s.admin.analisiDocumenti.collega({
        documentoId: documento.id,
        ordineId: s.ordineA.id,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await s.admin.analisiDocumenti.annulla({
      documentoId: documento.id,
      motivo: "Collegato all'ordine sbagliato",
    });
    const corretto = await s.admin.analisiDocumenti.collega({
      documentoId: documento.id,
      ordineId: s.ordineA.id,
      motivo: "Correzione dopo verifica",
    });
    expect(corretto.collegamento.stato).toBe("confermato");
    const azioni = corretto.collegamento.eventi.map(evento => evento.azione);
    expect(azioni).toEqual(["rifiutato", "confermato"]);

    const finale = await s.admin.analisiDocumenti.candidati({
      documentoId: documento.id,
    });
    expect(finale.collegamento?.ordineId).toBe(s.ordineA.id);
  });

  it("un documento identico già collegato viene segnalato come possibile duplicato", async () => {
    const s = await scenario();
    const bytes = pdfDaTesto(["Vs. ordine ORD-B-200, copia identica"]);
    const originale = await caricaPdf(s.commessaB.id, "orig.pdf", bytes);
    const copia = await caricaPdf(s.commessaB.id, "copia.pdf", bytes);
    await s.admin.analisiDocumenti.collega({
      documentoId: originale.id,
      ordineId: s.ordineB.id,
    });
    const risposta = await s.admin.analisiDocumenti.candidati({
      documentoId: copia.id,
    });
    expect(risposta.duplicato).toBeTruthy();
    expect(risposta.duplicato!.documentoId).toBe(originale.id);
    expect(risposta.duplicato!.ordineId).toBe(s.ordineB.id);
  });

  it("dopo il collegamento, l'analisi slice 1 accetta il documento anche da un altro fascicolo", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaA.id,
      "cross-fascicolo.pdf",
      pdfDaTesto(["Vs. ordine ORD-B-200", "Consegna prevista: 10/09/2026"])
    );
    await expect(
      s.admin.analisiDocumenti.analizzaConferma({
        ordineId: s.ordineB.id,
        documentoId: documento.id,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await s.admin.analisiDocumenti.collega({
      documentoId: documento.id,
      ordineId: s.ordineB.id,
    });
    const { run } = await s.admin.analisiDocumenti.analizzaConferma({
      ordineId: s.ordineB.id,
      documentoId: documento.id,
    });
    expect(run.stato).toBe("analizzata");
  });
});

describe("isolamento e autorizzazioni", () => {
  it("cross-sede: documento e ordine di un'altra sede non esistono", async () => {
    const s = await scenario();
    const documento = await caricaPdf(
      s.commessaA.id,
      "isolato.pdf",
      pdfDaTesto(["Vs. ordine ORD-A-100"])
    );
    await expect(
      direzione(ALTRA_SEDE).analisiDocumenti.candidati({
        documentoId: documento.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      direzione(ALTRA_SEDE).analisiDocumenti.collega({
        documentoId: documento.id,
        ordineId: s.ordineA.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      s.admin.analisiDocumenti.collega({
        documentoId: documento.id,
        ordineId: s.ordineAltrove.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("capability, non ruoli: l'assegnatario collega, l'estraneo no, senza requireDirezione", async () => {
    const s = await scenario();
    const commessaOwner = await s.admin.commesse.create({
      cliente: "Di Proprieta",
      assegnatoA: OWNER_ID,
    });
    const documento = await caricaPdf(
      commessaOwner.id,
      "owner.pdf",
      pdfDaTesto(["Vs. ordine ORD-A-100"])
    );

    await expect(
      estraneo().analisiDocumenti.candidati({ documentoId: documento.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      estraneo().analisiDocumenti.collega({
        documentoId: documento.id,
        ordineId: s.ordineA.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const risposta = await owner().analisiDocumenti.candidati({
      documentoId: documento.id,
    });
    expect(risposta.esito!.stato).toBe("certa");
    const collegato = await owner().analisiDocumenti.collega({
      documentoId: documento.id,
      ordineId: s.ordineA.id,
    });
    expect(collegato.collegamento.eventi[0].utenteId).toBe(OWNER_ID);
    await owner().analisiDocumenti.annulla({
      documentoId: documento.id,
      motivo: "pulizia test",
    });
  });
});
