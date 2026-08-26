// Riconciliazione FIC: le regole di match devono essere noiose e
// prevedibili — sono soldi. E il dedupe deve reggere ai rilanci: il sync
// gira ogni 6 ore, le proposte no.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import {
  commessaPerFattura,
  collegaFattureAutomatiche,
  _setScaricaFatturaPdfForTests,
  ficFatture,
  finalizzaSnapshotDocumentiEmessi,
  statoFattura,
  upsertDocumentiEmessi,
  upsertFatture,
} from "./ficFatture";
import { riconciliaPagamentiFic } from "./ficPagamenti";
import { toOpenAIResponse } from "../tars/openaiTestHelpers";
import { proposte } from "../tars/stores";
import { normalizzaRate, runFicSync } from "./fattureInCloud";
import {
  deleteDocumentoFic,
  findDocumentoFic,
} from "./preventiviContratti";

function makeCtx(sedeId = 1): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "local-1",
      name: "Admin Ruffino",
      email: "admin@ruffinogroup.it",
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [sedeId],
  };
}

describe("identita e collegamento persistito FIC", () => {
  it("normalizza l'id stabile della rata FiC", () => {
    expect(
      normalizzaRate(
        [
          {
            id: 444,
            amount: 1_220,
            status: "paid",
            paid_date: "2026-08-20",
          },
        ],
        90_001
      )[0]
    ).toMatchObject({ id: 444, sourceKey: "rate:444" });
  });

  it("non tratta una commessa inferita come collegamento persistito", async () => {
    const sedeId = 120;
    const caller = appRouter.createCaller(makeCtx(sedeId));
    const cliente = await caller.clienti.create({
      nome: "Mario",
      cognome: "Persistito",
      partitaIva: "IT12000000001",
    });
    await caller.commesse.create({ clienteId: cliente.id });
    upsertFatture(
      [
        fatturaBase(120_001, {
          clienteNome: "Persistito Mario",
          clienteVat: "IT12000000001",
        }),
      ],
      sedeId
    );
    const fattura = ficFatture.find(
      item => item.sedeId === sedeId && item.id === 120_001
    )!;
    const commesse = await caller.commesse.list({ archived: "all" });

    expect(commessaPerFattura(fattura, commesse).commessa).toBeNull();
    const list = await caller.ficFatture.list({ anno: 2026 });
    expect(list.find(item => item.id === fattura.id)?.commessaId).toBeNull();
  });

  it("collega automaticamente identita fiscale e unica commessa attiva", async () => {
    const sedeId = 121;
    const caller = appRouter.createCaller(makeCtx(sedeId));
    const cliente = await caller.clienti.create({
      nome: "Anna",
      cognome: "Fiscale",
      codiceFiscale: "FSCLNN80A01H501Z",
    });
    const commessa = await caller.commesse.create({ clienteId: cliente.id });
    upsertFatture(
      [
        fatturaBase(121_001, {
          clienteNome: "Fiscale Anna",
          clienteCf: "fsclnn80a01h501z",
        }),
      ],
      sedeId
    );

    const result = collegaFattureAutomatiche(sedeId);
    const fattura = ficFatture.find(
      item => item.sedeId === sedeId && item.id === 121_001
    )!;

    expect(result).toEqual({ collegate: 1, ambigue: 0 });
    expect(fattura.commessaId).toBe(commessa.id);
    expect(fattura.commessaMatch).toBe("automatico_fiscale");
    expect(fattura.collegataAMano).toBe(false);
  });

  it("non collega per importo quando il cliente ha piu commesse", async () => {
    const sedeId = 122;
    const caller = appRouter.createCaller(makeCtx(sedeId));
    const cliente = await caller.clienti.create({
      nome: "Paolo",
      cognome: "Ambiguo",
      partitaIva: "IT12200000001",
    });
    await caller.commesse.create({ clienteId: cliente.id, importoTotale: 900 });
    await caller.commesse.create({
      clienteId: cliente.id,
      importoTotale: 1_220,
    });
    upsertFatture(
      [
        fatturaBase(122_001, {
          clienteNome: "Ambiguo Paolo",
          clienteVat: "IT12200000001",
        }),
      ],
      sedeId
    );

    expect(collegaFattureAutomatiche(sedeId)).toEqual({
      collegate: 0,
      ambigue: 1,
    });
    expect(
      ficFatture.find(item => item.sedeId === sedeId && item.id === 122_001)!
        .commessaId
    ).toBeNull();
  });
});

const fatturaBase = (id: number, extra: Partial<any> = {}) => ({
  id,
  numero: `${id}/A`,
  data: "2026-07-15",
  clienteNome: "Riconcilia Mario",
  clienteVat: null,
  clienteCf: null,
  importoNetto: 1000,
  importoLordo: 1220,
  rate: [
    {
      importo: 1220,
      scadenza: "2026-07-31",
      stato: "paid",
      dataPagamento: "2026-07-20",
    },
  ],
  ...extra,
});

describe("riconciliazione FIC", () => {
  let clienteId: number;
  let commessaId: number;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    caller = appRouter.createCaller(makeCtx());
    const cliente = await caller.clienti.create({
      nome: "Mario",
      cognome: "Riconcilia",
    });
    clienteId = cliente.id;
    const commessa = await caller.commesse.create({ clienteId });
    commessaId = commessa.id;
  });

  it("il sync abbina il cliente per nome, comunque sia scritto", () => {
    const r = upsertFatture(
      [fatturaBase(9001, { clienteNome: "MARIO  riconcilia" })],
      1
    );
    expect(r.nuove).toBe(1);
    const f = ficFatture.find(x => x.id === 9001)!;
    expect(f.clienteId).toBe(clienteId);
  });

  it("la riconciliazione usa soltanto la commessa persistita", async () => {
    const commesse = (await caller.commesse.list({ archived: "all" })) as any[];
    const f = ficFatture.find(x => x.id === 9001)!;
    expect(commessaPerFattura(f, commesse).commessa).toBeNull();

    f.commessaId = commessaId;
    f.commessaMatch = "manuale";
    f.collegataAMano = true;

    expect(commessaPerFattura(f, commesse).commessa?.id).toBe(commessaId);
  });

  it("rata incassata su FIC → movimento FiC idempotente", async () => {
    const prima = riconciliaPagamentiFic({ sedeId: 1, snapshotCompleto: true });
    const seconda = riconciliaPagamentiFic({ sedeId: 1, snapshotCompleto: true });
    const commessa = await caller.commesse.byId(commessaId);

    expect(prima.stats.pagamentiCreati).toBe(1);
    expect(seconda.stats.pagamentiCreati).toBe(0);
    expect(seconda.stats.pagamentiAggiornati).toBe(0);
    expect(commessa!.pagamenti).toEqual([
      expect.objectContaining({
        origine: "fic",
        stato: "attivo",
        ficDocumentoId: 9001,
      }),
    ]);
    expect(
      proposte.some(
        p =>
          p.trigger === "riconciliazione_fic" &&
          p.commessaId === commessaId &&
          (p.tipo === "pagamento" || p.tipo === "modifica_commessa")
      )
    ).toBe(false);
  });

  it("non propone né sovrascrive il pattuito CRM dalla fattura", async () => {
    const commessa = await caller.commesse.byId(commessaId);
    expect(commessa!.importoTotale).toBeNull();
    expect(
      proposte.some(
        p =>
          p.trigger === "riconciliazione_fic" &&
          p.commessaId === commessaId &&
          p.tipo === "modifica_commessa"
      )
    ).toBe(false);
  });

  it("la rata FiC sincronizzata rende la fattura riconciliata", async () => {
    const c = await caller.commesse.byId(commessaId);
    expect(c!.importoIncassato).toBe(1220);
    expect(c!.pagamenti[0].note).toContain("FIC 9001/A");

    const commesse = (await caller.commesse.list({ archived: "all" })) as any[];
    // list non porta i pagamenti: lo stato va calcolato sui dati pieni.
    const piene = [c];
    const f = ficFatture.find(x => x.id === 9001)!;
    expect(statoFattura(f, piene as any[]).stato).toBe("riconciliata");
    void commesse;
  });

  it("cliente con più commesse senza importo distintivo → nessuna proposta", async () => {
    await caller.commesse.create({ clienteId }); // seconda commessa attiva
    upsertFatture(
      [fatturaBase(9002, { numero: "9002/A", importoLordo: 555 })],
      1
    );
    const perQuesta = proposte.filter(p =>
      JSON.stringify(p.payload).includes("9002/A")
    );
    expect(perQuesta).toHaveLength(0);

    const commesse = (await caller.commesse.list({ archived: "all" })) as any[];
    const f = ficFatture.find(x => x.id === 9002)!;
    expect(statoFattura(f, commesse).stato).toBe("non_abbinabile");
  });

  it("cliente sconosciuto → non abbinabile, mai proposte al buio", () => {
    upsertFatture(
      [
        fatturaBase(9003, {
          numero: "9003/A",
          clienteNome: "Sconosciuto Totale",
        }),
      ],
      1
    );
    expect(
      proposte.some(p => JSON.stringify(p.payload).includes("9003/A"))
    ).toBe(false);
  });

  it("l'upsert aggiorna lo stato delle rate senza duplicare la fattura", () => {
    const prima = ficFatture.filter(f => f.id === 9003).length;
    upsertFatture(
      [
        fatturaBase(9003, {
          numero: "9003/A",
          clienteNome: "Sconosciuto Totale",
          rate: [
            {
              importo: 1220,
              scadenza: "2026-08-31",
              stato: "paid",
              dataPagamento: "2026-08-07",
            },
          ],
        }),
      ],
      1
    );
    expect(ficFatture.filter(f => f.id === 9003)).toHaveLength(prima);
    expect(ficFatture.find(f => f.id === 9003)!.rate[0].stato).toBe("paid");
  });
});

describe("snapshot documenti emessi FIC", () => {
  const baseSnapshot = (id: number) => ({
    id,
    tipo: "invoice" as const,
    numero: `${id}/S`,
    data: "2026-06-15",
    clienteNome: `Cliente snapshot ${id}`,
    clienteVat: null,
    clienteCf: null,
    importoNetto: 100,
    importoIva: 22,
    importoLordo: 122,
    rate: [],
  });

  it("marca assenti i record non visti soltanto dopo uno snapshot completo", () => {
    const ids = [98001, 98002, 98003, 98004];
    upsertDocumentiEmessi(ids.map(baseSnapshot), 1, "sync-iniziale");

    upsertDocumentiEmessi(
      ids.slice(0, 2).map(baseSnapshot),
      1,
      "sync-52-su-54"
    );
    finalizzaSnapshotDocumentiEmessi({
      sedeId: 1,
      tipo: "invoice",
      periodoDa: "2026-01-01",
      periodoA: "2026-12-31",
      syncId: "sync-52-su-54",
      completo: false,
    });
    expect(
      ids.map(id => ficFatture.find(f => f.id === id)!.presenteInFic)
    ).toEqual([true, true, true, true]);

    finalizzaSnapshotDocumentiEmessi({
      sedeId: 1,
      tipo: "invoice",
      periodoDa: "2026-01-01",
      periodoA: "2026-12-31",
      syncId: "sync-52-su-54",
      completo: true,
    });
    expect(
      ids.map(id => ficFatture.find(f => f.id === id)!.presenteInFic)
    ).toEqual([true, true, false, false]);
  });

  it("mantiene collegamenti e preferenze quando aggiorna una fattura", () => {
    const id = 98005;
    upsertDocumentiEmessi([baseSnapshot(id)], 1, "sync-a");
    const record = ficFatture.find(f => f.id === id)!;
    record.commessaId = 1234;
    record.collegataAMano = true;
    record.ignorata = true;

    upsertDocumentiEmessi(
      [
        {
          ...baseSnapshot(id),
          importoNetto: 200,
          importoIva: 44,
          importoLordo: 244,
        },
      ],
      1,
      "sync-b"
    );

    const aggiornato = ficFatture.find(f => f.id === id)!;
    expect(aggiornato.importoNetto).toBe(200);
    expect(aggiornato.commessaId).toBe(1234);
    expect(aggiornato.collegataAMano).toBe(true);
    expect(aggiornato.ignorata).toBe(true);
    expect(aggiornato.tipo).toBe("invoice");
    expect(aggiornato.importoIva).toBe(44);
  });
});

describe("archivio PDF FIC", () => {
  it("la sincronizzazione recupera il PDF di una fattura gia collegata", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const cliente = await caller.clienti.create({
      nome: "Giulia",
      cognome: "Archivio FIC",
    });
    const commessa = await caller.commesse.create({ clienteId: cliente.id });
    const ficId = 9200;
    const previousKey = process.env.MAIL_ENCRYPTION_KEY;
    const realFetch = global.fetch;
    let failPdf = true;

    upsertFatture(
      [
        fatturaBase(ficId, {
          numero: "9200-B",
          clienteNome: "Archivio FIC Giulia",
        }),
      ],
      1
    );
    const collegata = ficFatture.find(f => f.id === ficId && f.sedeId === 1)!;
    collegata.commessaId = commessa.id;
    collegata.collegataAMano = true;

    process.env.MAIL_ENCRYPTION_KEY = "test-only-fic-archive-key";
    await caller.fattureInCloud.saveConfig({
      accessToken: "a/test-token-fatture-archive-9200",
      companyId: 77,
      enabled: true,
    });

    const pdf = Buffer.from("%PDF-1.4\narchivio-fic\n%%EOF");
    global.fetch = vi.fn(async input => {
      const url = String(input);
      if (url === "https://files.example.test/fattura-9200.pdf") {
        if (failPdf) {
          return {
            ok: false,
            status: 503,
            headers: new Headers(),
            arrayBuffer: async () => Buffer.alloc(0),
          } as any;
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": String(pdf.length) }),
          arrayBuffer: async () => pdf,
        } as any;
      }
      if (url.includes(`/issued_documents/${ficId}?fields=id,url`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: ficId,
              url: "https://files.example.test/fattura-9200.pdf",
            },
          }),
          text: async () => "",
        } as any;
      }
      if (!url.includes("type=invoice")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
          text: async () => "",
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: ficId,
              number: 9200,
              numeration: "-B",
              date: `${new Date().getFullYear()}-08-25`,
              entity: { name: "Archivio FIC Giulia" },
              amount_net: 1000,
              amount_gross: 1220,
              payments_list: [
                {
                  id: 444,
                  amount: 1220,
                  status: "paid",
                  paid_date: `${new Date().getFullYear()}-08-25`,
                },
              ],
            },
          ],
        }),
        text: async () => "",
      } as any;
    }) as any;

    try {
      const first = await runFicSync(1);
      failPdf = false;
      const second = await runFicSync(1);
      const documentAfterSecond = findDocumentoFic(1, ficId);
      const third = await runFicSync(1);
      const listUrls = (global.fetch as any).mock.calls
        .map((call: any[]) => String(call[0]))
        .filter((url: string) => /\/(issued|received)_documents\?/.test(url));
      expect(listUrls).toHaveLength(12);
      for (const url of listUrls) {
        const query = new URL(url).searchParams;
        const year = new Date().getFullYear();
        expect(query.get("q")).toBe(
          `date >= '${year - 1}-01-01' and date <= '${year}-12-31'`
        );
        expect(query.has("date_from")).toBe(false);
        expect(query.has("date_to")).toBe(false);
      }
      const documenti = await caller.preventiviContratti.byCommessa(
        commessa.id
      );
      expect(documenti.filter((doc: any) => doc.source === "fic")).toEqual([
        expect.objectContaining({
          nome: "Fattura 9200-B.pdf",
          tipo: "fattura",
          mimeType: "application/pdf",
          hasData: true,
        }),
      ]);
      const storedCommessa = await caller.commesse.byId(commessa.id);
      expect(first.stats.pagamentiCreati).toBe(1);
      expect(first.stats.pdfFalliti).toBe(1);
      expect(second.stats.pagamentiCreati).toBe(0);
      expect(second.stats.pagamentiAggiornati).toBe(0);
      expect(second.stats.pdfArchiviati).toBe(1);
      expect(third.stats.pagamentiCreati).toBe(0);
      expect(third.stats.pagamentiAggiornati).toBe(0);
      expect(
        storedCommessa!.pagamenti.filter((p: any) => p.ficRataId === 444)
      ).toHaveLength(1);
      expect(findDocumentoFic(1, ficId)?.id).toBe(documentAfterSecond?.id);
      expect(first.result).toMatch(/pagamenti \+1\/aggiornati 0/);
      expect(first.result).not.toContain("9200-B");
      expect((await caller.fattureInCloud.status()).lastStats).toMatchObject({
        pagamentiCreati: 0,
        pagamentiAggiornati: 0,
        pdfFalliti: 0,
      });

      global.fetch = vi.fn(async input => {
        const url = String(input);
        if (url.includes("/issued_documents?") && url.includes("type=invoice")) {
          throw new Error("pagina fatture incompleta");
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
          text: async () => "",
        } as any;
      }) as any;
      const incomplete = await runFicSync(1);
      expect(incomplete.complete).toBe(false);
      expect(storedCommessa!.pagamenti[0].stato).toBe("attivo");
      expect(storedCommessa!.importoIncassato).toBe(1_220);
    } finally {
      global.fetch = realFetch;
      deleteDocumentoFic(1, ficId);
      if (previousKey === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
      else process.env.MAIL_ENCRYPTION_KEY = previousKey;
    }
  });
});

describe("controllo sincronizzazione FIC", () => {
  it("mostra il sync attivo e permette di fermarlo anche da una nuova richiesta", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const previousKey = process.env.MAIL_ENCRYPTION_KEY;
    const realFetch = global.fetch;
    const richiesteInAttesa: Array<() => void> = [];

    process.env.MAIL_ENCRYPTION_KEY = "test-only-fic-cancel-key";
    await caller.fattureInCloud.saveConfig({
      accessToken: "a/test-token-fatture-cancel-9300",
      companyId: 77,
      enabled: true,
    });

    global.fetch = vi.fn((_input, init) => {
      return new Promise((resolve, reject) => {
        const completa = () =>
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
            text: async () => "",
          } as any);
        richiesteInAttesa.push(completa);
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("richiesta annullata")),
          { once: true }
        );
      });
    }) as any;

    const syncPromise = caller.fattureInCloud.syncNow();
    try {
      await vi.waitFor(() => {
        expect(richiesteInAttesa).toHaveLength(4);
      });
      const durante = await caller.fattureInCloud.status();
      expect((durante as any).syncInCorso).toBe(true);
      expect((durante as any).syncAvviataAt).toBeInstanceOf(Date);

      const arresto = await (caller.fattureInCloud as any).annullaSync();
      expect(arresto).toEqual({ annullata: true });
      await expect(syncPromise).rejects.toThrow(/annullata/i);

      const dopo = await caller.fattureInCloud.status();
      expect((dopo as any).syncInCorso).toBe(false);
      expect((dopo as any).syncAvviataAt).toBeNull();
    } finally {
      richiesteInAttesa.forEach(completa => completa());
      await syncPromise.catch(() => undefined);
      global.fetch = realFetch;
      if (previousKey === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
      else process.env.MAIL_ENCRYPTION_KEY = previousKey;
    }
  });
});

// Il Client ID e l'Access Token vivono nella stessa schermata di Fatture in
// Cloud, un rigo sopra l'altro: incollare il primo al posto del secondo è
// l'errore più facile da fare, e produce un 401 che non spiega niente.
describe("validazione token FIC", () => {
  it("riconosce un token vero", async () => {
    const { tokenSembraValido } = await import("./fattureInCloud");
    expect(
      tokenSembraValido(
        "a/eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmno"
      )
    ).toBe(true);
  });

  it("rifiuta il Client ID e altri valori che token non sono", async () => {
    const { tokenSembraValido } = await import("./fattureInCloud");
    // Il Client ID reale ha questa forma: niente prefisso "a/".
    expect(tokenSembraValido("46YmsOEc2PqxzQaluXRbvV9kShqkTl8E")).toBe(false);
    expect(tokenSembraValido("")).toBe(false);
    expect(tokenSembraValido("a/corto")).toBe(false);
    expect(tokenSembraValido("Bearer a/eyJ0eXAiOiJKV1Qi")).toBe(false);
  });

  it("il salvataggio rifiuta il Client ID con un messaggio che dice cosa fare", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.fattureInCloud.saveConfig({
        accessToken: "46YmsOEc2PqxzQaluXRbvV9kShqkTl8E",
      })
    ).rejects.toThrow(/Client ID/);
  });
});

describe("collegamento fattura e PDF", () => {
  it("mantiene il collegamento se il primo download PDF fallisce", async () => {
    const sedeId = 130;
    const ficId = 130_001;
    const caller = appRouter.createCaller(makeCtx(sedeId));
    const commessa = await caller.commesse.create({
      cliente: "Collegamento prima del PDF",
    });
    upsertFatture(
      [
        fatturaBase(ficId, {
          numero: "130/PDF",
          clienteNome: "Collegamento prima del PDF",
          rate: [],
        }),
      ],
      sedeId
    );
    _setScaricaFatturaPdfForTests(async () => {
      throw new Error("download non disponibile");
    });

    try {
      const result = await caller.ficFatture.collega({
        ficId,
        commessaId: commessa.id,
      });

      expect(result.pdf.stato).toBe("errore");
      expect(
        ficFatture.find(item => item.sedeId === sedeId && item.id === ficId)
      ).toMatchObject({
        commessaId: commessa.id,
        commessaMatch: "manuale",
        collegataAMano: true,
        pdfSync: { stato: "errore" },
      });
    } finally {
      _setScaricaFatturaPdfForTests(null);
      deleteDocumentoFic(sedeId, ficId);
    }
  });
});

// Le fatture che il motore deterministico NON sa abbinare vanno a Tars:
// lui indaga e propone il collegamento; l'approvazione collega davvero e
// fa partire le proposte su pattuito e incassi. Il giro si paga una volta.
describe("fatture orfane → Tars", () => {
  beforeAll(() => {
    _setScaricaFatturaPdfForTests(async () =>
      Buffer.from("%PDF-1.4\n%%EOF", "ascii")
    );
  });

  afterAll(() => _setScaricaFatturaPdfForTests(null));

  it("orfana → proposta di collegamento → approvazione collega e riconcilia", async () => {
    const { vi } = await import("vitest");
    const { getTarsConfig } = await import("../tars/stores");
    const { smistaFatture } = await import("../tars/smistamento");
    const realFetch = global.fetch;
    process.env.OPENAI_API_KEY = "test-key";
    getTarsConfig().attivo = true;

    try {
      const caller = appRouter.createCaller(makeCtx());
      // La commessa giusta esiste, ma il nome in fattura non è in anagrafica.
      const cliente = await caller.clienti.create({
        nome: " ",
        cognome: "Condominio Girasole",
        tipo: "condominio",
      });
      const commessa = await caller.commesse.create({ clienteId: cliente.id });

      upsertFatture(
        [
          fatturaBase(9100, {
            numero: "9100/A",
            // Grafia diversa: il match per nome fallisce, Tars deve capire.
            clienteNome: "COND. GIRASOLE - AMM. BRUNI",
            importoLordo: 7320,
            rate: [
              {
                importo: 7320,
                scadenza: "2026-07-31",
                stato: "paid",
                dataPagamento: "2026-07-25",
              },
            ],
          }),
        ],
        1
      );

      let i = 0;
      const risposte = [
        {
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "cerca_clienti",
              input: { query: "Girasole" },
            },
          ],
        },
        {
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "proponi_collegamento_fattura",
              input: {
                ficId: 9100,
                commessaId: commessa.id,
                titolo: `Collega la fattura 9100/A a ${commessa.codice} (Condominio Girasole)`,
                motivazione:
                  "Il nome in fattura è il Condominio Girasole scritto con l'amministratore; l'importo è compatibile.",
                confidenza: "media",
              },
            },
          ],
        },
        {
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{ type: "text", text: "Proposto un collegamento." }],
        },
      ];
      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () =>
          toOpenAIResponse(risposte[Math.min(i++, risposte.length - 1)]),
        text: async () => "",
      })) as any;

      await smistaFatture(1);

      const proposta = proposte.find(
        p => p.tipo === "collega_fattura" && p.payload?.ficId === 9100
      );
      expect(proposta).toBeDefined();
      expect(ficFatture.find(f => f.id === 9100)!.tarsAnalizzata).toBe(true);
      const elenco = await caller.ficFatture.list({ anno: 2026 });
      expect(elenco.find(f => f.id === 9100)).toMatchObject({
        stato: "proposta",
        propostaTars: {
          id: proposta!.id,
          tipo: "collega_fattura",
          stato: "pendente",
          commessaId: commessa.id,
        },
      });

      // Approvazione (direzione) → collegata + sync FiC deterministico.
      await caller.tars.proposte.approva({ id: proposta!.id });
      const f = ficFatture.find(x => x.id === 9100)!;
      expect(f.commessaId).toBe(commessa.id);
      const docs = await caller.preventiviContratti.byCommessa(commessa.id);
      const fatture = docs.filter((d: any) => d.source === "fic");
      expect(fatture).toHaveLength(1);
      expect(fatture[0]).toMatchObject({
        nome: "Fattura 9100-A.pdf",
        tipo: "fattura",
        mimeType: "application/pdf",
        hasData: true,
      });

      await caller.ficFatture.collega({ ficId: 9100, commessaId: commessa.id });
      const docsDopo = await caller.preventiviContratti.byCommessa(commessa.id);
      expect(docsDopo.filter((d: any) => d.source === "fic")).toHaveLength(1);
      expect((await caller.commesse.byId(commessa.id))?.pagamenti).toEqual([
        expect.objectContaining({
          origine: "fic",
          stato: "attivo",
          ficDocumentoId: 9100,
        }),
      ]);

      // Già esaminata: il secondo giro non richiama l'API.
      const spy = vi.fn();
      global.fetch = spy as any;
      await smistaFatture(1);
      expect(spy).not.toHaveBeenCalled();

      await caller.ficFatture.collega({ ficId: 9100, commessaId: null });
      const docsScollegati = await caller.preventiviContratti.byCommessa(
        commessa.id
      );
      expect(docsScollegati.some((d: any) => d.source === "fic")).toBe(true);
    } finally {
      global.fetch = realFetch;
      deleteDocumentoFic(1, 9100);
      delete process.env.OPENAI_API_KEY;
      getTarsConfig().attivo = false;
    }
  });
});
