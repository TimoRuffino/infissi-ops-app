import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import {
  _resetComunicazioniInMemoria,
  getComunicazione,
  insertComunicazione,
} from "../tars/comunicazioni";
import { getClientiStore } from "./clienti";
import { getCommesseStore } from "./commesse";
import { deleteDocumentiByCommessa } from "./preventiviContratti";
import { deleteFileQuiet, putFile } from "../_core/fileStorage";

function createContext(sedeId: number): TrpcContext {
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
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [1, 2],
  };
}

const nuovaEmail = (overrides: Record<string, unknown> = {}) => ({
  sedeId: 1,
  casellaId: 1,
  messageId: "email-canali-1",
  canale: "email" as const,
  direzione: "in" as const,
  mittente: "cliente@example.com",
  mittenteNome: "Cliente Email",
  destinatari: ["ordini@ruffinogroup.it"],
  oggetto: "Richiesta preventivo",
  testo: "Vorrei ricevere un preventivo.",
  allegati: [],
  clienteId: null,
  commessaId: null,
  matchConfidenza: "nessuna" as const,
  matchMotivo: null,
  stato: "nuova" as const,
  receivedAt: new Date("2026-08-22T09:00:00Z"),
  categoria: "operativa" as const,
  ...overrides,
});

const nuovoMessaggioWhatsApp = (overrides: Record<string, unknown> = {}) => ({
  sedeId: 1,
  casellaId: 8,
  messageId: "wa-canali-1",
  canale: "whatsapp" as const,
  direzione: "in" as const,
  mittente: "+393331112222",
  mittenteNome: "Cliente WhatsApp",
  destinatari: [],
  oggetto: "",
  testo: "Messaggio WhatsApp",
  allegati: [],
  clienteId: null,
  commessaId: null,
  matchConfidenza: "nessuna" as const,
  matchMotivo: null,
  stato: "nuova" as const,
  receivedAt: new Date("2026-08-22T10:00:00Z"),
  categoria: "operativa" as const,
  ...overrides,
});

describe("mail channel APIs", () => {
  beforeEach(() => _resetComunicazioniInMemoria());
  afterEach(() => _resetComunicazioniInMemoria());

  it("espone Email e WhatsApp limitando le letture alla sede attiva", async () => {
    const email = await insertComunicazione(nuovaEmail());
    await insertComunicazione(nuovoMessaggioWhatsApp());
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        sedeId: 2,
        messageId: "wa-sede-2-stessa-conversazione",
        testo: "Messaggio di un'altra sede",
      })
    );
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        sedeId: 2,
        messageId: "wa-sede-2-soltanto",
        mittente: "+393339999999",
      })
    );

    const caller = appRouter.createCaller(createContext(1));

    const emails = await caller.mail.email.list({ limit: 20 });
    expect(emails.map(messaggio => messaggio.id)).toEqual([email!.id]);

    const stats = await caller.mail.email.stats();
    expect(stats).toMatchObject({ email: 1, whatsapp: 0 });

    await expect(caller.mail.email.segnaTutteViste()).resolves.toEqual({
      aggiornate: 1,
    });
    expect((await getComunicazione(email!.id, 1))?.stato).toBe("vista");

    const conversazioni = await caller.mail.whatsapp.conversazioni({
      limit: 20,
    });
    expect(conversazioni).toEqual([
      expect.objectContaining({
        casellaId: 8,
        controparte: "+393331112222",
        ultimoMessaggio: "Messaggio WhatsApp",
      }),
    ]);

    const thread = await caller.mail.whatsapp.thread({
      casellaId: 8,
      controparte: "+393331112222",
      limit: 50,
    });
    expect(thread.messaggi.map(messaggio => messaggio.testo)).toEqual([
      "Messaggio WhatsApp",
    ]);
    expect(thread.nextBefore).toEqual({
      receivedAt: new Date("2026-08-22T10:00:00Z"),
      id: thread.messaggi[0]!.id,
    });

    await expect(
      caller.mail.whatsapp.thread({
        casellaId: 8,
        controparte: "+393339999999",
        before: {
          receivedAt: new Date("2026-08-22T10:00:00Z"),
          id: 1,
        },
        limit: 50,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("non espone un messaggio WhatsApp attraverso email.byId", async () => {
    const email = await insertComunicazione(nuovaEmail());
    const whatsapp = await insertComunicazione(nuovoMessaggioWhatsApp());
    const altraSede = await insertComunicazione(
      nuovaEmail({
        sedeId: 2,
        messageId: "email-by-id-sede-2",
      })
    );
    const caller = appRouter.createCaller(createContext(1));

    await expect(caller.mail.email.byId(email!.id)).resolves.toMatchObject({
      id: email!.id,
      canale: "email",
    });
    await expect(caller.mail.email.byId(whatsapp!.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.mail.email.byId(altraSede!.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("collega una comunicazione a un cliente della sede senza inventare una commessa", async () => {
    const clienteId = 951_101;
    const clienti = getClientiStore();
    clienti.push({
      id: clienteId,
      sedeId: 1,
      nome: "Ada",
      cognome: "Infissi Tirreno",
    });
    const email = await insertComunicazione(nuovaEmail());
    const caller = appRouter.createCaller(createContext(1));

    try {
      await expect(
        caller.mail.comunicazioni.collega({ id: email!.id, clienteId })
      ).resolves.toEqual({ success: true });
      await expect(getComunicazione(email!.id, 1)).resolves.toMatchObject({
        clienteId,
        commessaId: null,
      });
      await expect(
        caller.mail.comunicazioni.collega({
          id: email!.id,
          clienteId: 951_999,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      const index = clienti.findIndex(cliente => cliente.id === clienteId);
      if (index >= 0) clienti.splice(index, 1);
    }
  });

  it("serializza retry concorrenti dello stesso allegato in un solo documento", async () => {
    const commessaId = 952_001;
    const commesse = getCommesseStore();
    commesse.push({
      id: commessaId,
      sedeId: 1,
      codice: "COM-2026-952",
      cliente: "Cliente Archivio",
      clienteId: 952_101,
      assegnatoA: 1,
      stato: "preventivo",
      archivedAt: null,
    });
    const bytes = Buffer.from("contenuto allegato email", "utf8");
    const fixture = await putFile(
      "mail_test",
      commessaId,
      1,
      "ordine.pdf",
      bytes,
      "application/pdf"
    );
    const email = await insertComunicazione(
      nuovaEmail({
        messageId: "email-archivio-idempotente",
        clienteId: 952_101,
        commessaId,
        allegati: [
          {
            nome: "ordine.pdf",
            mimeType: "application/pdf",
            size: bytes.length,
            storageKey: fixture.storageKey,
          },
        ],
      })
    );
    const whatsapp = await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-archivio-vietato",
        clienteId: 952_101,
        commessaId,
        allegati: [
          {
            nome: "ordine.pdf",
            mimeType: "application/pdf",
            size: bytes.length,
            storageKey: fixture.storageKey,
          },
        ],
      })
    );
    const caller = appRouter.createCaller(createContext(1));

    try {
      const input = { id: email!.id, allegatoIndex: 0, commessaId };
      const [prima, seconda] = await Promise.all([
        caller.mail.email.archiviaAllegato(input),
        caller.mail.email.archiviaAllegato(input),
      ]);

      expect(seconda.id).toBe(prima.id);
      expect(await caller.preventiviContratti.byCommessa(commessaId)).toEqual([
        expect.objectContaining({
          id: prima.id,
          commessaId,
          nome: "ordine.pdf",
          source: "comunicazione",
          sourceRef: `1:${email!.id}:0`,
          storageKey: expect.any(String),
        }),
      ]);
      await expect(
        caller.mail.email.archiviaAllegato({
          id: whatsapp!.id,
          allegatoIndex: 0,
          commessaId,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      deleteDocumentiByCommessa(commessaId);
      deleteFileQuiet(fixture.storageKey);
      const index = commesse.findIndex(commessa => commessa.id === commessaId);
      if (index >= 0) commesse.splice(index, 1);
    }
  });
});
