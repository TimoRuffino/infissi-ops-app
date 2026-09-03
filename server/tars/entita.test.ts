// I riferimenti di Tars devono uscire col NOME e col link giusto: chi legge
// non conosce gli id, e una comunicazione WhatsApp deve aprire la sua
// conversazione, non la pagina generale (direzione, 03/09/2026).

import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { insertComunicazione } from "../comunicazioni/comunicazioni";
import { appRouter } from "../routers";
import { risolviEntitaTars } from "./entita";
import { linkComunicazione } from "./smistamento/segnali";

const SEDE = 97_301;
const ALTRA_SEDE = 97_302;
const UTENTE = 97_311;

function ctx(sedeId = SEDE): TrpcContext {
  return {
    user: { id: UTENTE, role: "admin", ruolo: "direzione", ruoli: ["direzione"], name: "Direzione" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}
const caller = (sedeId = SEDE) => appRouter.createCaller(ctx(sedeId));

describe("linkComunicazione", () => {
  it("email apre il messaggio; WhatsApp apre la conversazione, non la lista", () => {
    expect(
      linkComunicazione({ id: 42, canale: "email", casellaId: 3, mittente: "x@y.test" })
    ).toBe("/messaggi/email?messaggio=42");
    expect(
      linkComunicazione({ id: 43, canale: "whatsapp", casellaId: 8, mittente: "393371563627" })
    ).toBe("/messaggi/whatsapp?conversazione=wa%3A8%3A%2B393371563627");
  });
});

describe("risolviEntitaTars", () => {
  it("dà nome e link a commessa, cliente, ticket e comunicazione; l'altra sede resta anonima", async () => {
    const api = caller();
    const cliente = await api.clienti.create({ nome: "Gianluca", cognome: "De Nino" });
    const commessa = await api.commesse.create({ cliente: "De Nino Gianluca", clienteId: cliente.id });
    const ticket = await api.ticket.create({
      commessaId: commessa.id,
      oggetto: "Finestre con infiltrazioni",
      categoria: "difetto_posa",
    });
    const wa = (await insertComunicazione({
      sedeId: SEDE, casellaId: 8, messageId: `ent-${Date.now()}`, canale: "whatsapp", direzione: "in",
      mittente: "393371563627", mittenteNome: "Chiara", destinatari: [], oggetto: "", testo: "Buongiorno",
      allegati: [], clienteId: null, commessaId: null, matchConfidenza: "nessuna", matchMotivo: null,
      stato: "nuova", receivedAt: new Date(),
    }))!;
    const altrove = await caller(ALTRA_SEDE).commesse.create({ cliente: "Altra Sede" });

    const risolto = await risolviEntitaTars(
      [
        `commessa:${commessa.id}`,
        `cliente:${cliente.id}`,
        `ticket:${ticket.id}`,
        `comunicazione:${wa.id}`,
        `commessa:${altrove.id}`,
        "pattern:colli_di_bottiglia",
      ],
      SEDE
    );

    expect(risolto.get(`commessa:${commessa.id}`)).toMatchObject({
      etichetta: expect.stringContaining("De Nino Gianluca"),
      link: `/commesse/${commessa.id}`,
    });
    expect(risolto.get(`commessa:${commessa.id}`)!.etichetta).toMatch(/^COM-/);
    expect(risolto.get(`cliente:${cliente.id}`)).toMatchObject({
      etichetta: "De Nino Gianluca",
      link: `/clienti/${cliente.id}`,
    });
    const t = risolto.get(`ticket:${ticket.id}`)!;
    expect(t.etichetta).toContain("Finestre con infiltrazioni");
    expect(t.etichetta).toMatch(/COM-/);
    expect(t.link).toBe("/ticket");
    expect(risolto.get(`comunicazione:${wa.id}`)).toMatchObject({
      etichetta: "WhatsApp: Chiara",
      link: "/messaggi/whatsapp?conversazione=wa%3A8%3A%2B393371563627",
    });
    // Altra sede: nessun nome, nessun link da cui dedurre qualcosa.
    expect(risolto.get(`commessa:${altrove.id}`)).toMatchObject({
      etichetta: `Commessa ${altrove.id}`,
      link: null,
    });
    expect(risolto.get("pattern:colli_di_bottiglia")).toMatchObject({
      etichetta: "Andamento colli_di_bottiglia",
      link: null,
    });
  });
});

describe("riferimenti a file", () => {
  it("un documento citato da Tars si apre: nome, commessa e link di anteprima; l'altra sede resta anonima", async () => {
    const { caricaDocumentoCommessaDaBuffer } = await import(
      "../routers/preventiviContratti"
    );
    const commessa = await caller().commesse.create({ cliente: "Anteprima File" });
    const documento = await caricaDocumentoCommessaDaBuffer({
      commessaId: commessa.id,
      nome: "conferma-ordine-tesconi.pdf",
      tipo: "conferma_ordine",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 conferma"),
      sedeId: SEDE,
      createdBy: UTENTE,
      keepNome: true,
    });

    const risolti = await risolviEntitaTars([`documento:${documento.id}`], SEDE);
    const voce = risolti.get(`documento:${documento.id}`)!;
    expect(voce.etichetta).toContain("conferma-ordine-tesconi.pdf");
    expect(voce.etichetta).toContain(commessa.codice);
    expect(voce.link).toBe(`/api/documenti/${documento.id}/file`);

    // Sede diversa: niente nome del file e niente link apribile.
    const altrove = await risolviEntitaTars(
      [`documento:${documento.id}`],
      ALTRA_SEDE
    );
    expect(altrove.get(`documento:${documento.id}`)!.link).toBeNull();
  });
});
