import { describe, expect, it } from "vitest";
import { collectEntityFacts, type ContextCollectorSource } from "./collectors";
import type { EntityContextKey } from "./types";

const UPDATED = new Date("2026-08-25T09:30:00.000Z");

function source(): ContextCollectorSource {
  return {
    async getCliente() {
      return {
        id: 7,
        sedeId: 1,
        nome: "Mario",
        cognome: "Rossi",
        email: "mario@example.test",
        telefono: "+39 333 1234567",
        codiceFiscale: "RSSMRA80A01H501U",
        partitaIva: null,
        assegnatoA: 4,
        updatedAt: UPDATED,
      };
    },
    async getCommessa() {
      return {
        id: 42,
        sedeId: 1,
        clienteId: 7,
        codice: "COM-2026-042",
        cliente: "Rossi Mario",
        stato: "attesa_posa",
        priorita: "alta",
        assegnatoA: 4,
        importoTotale: 12_000,
        importoIncassato: 4_000,
        costoPosaStimato: 1_200,
        costi: [{ id: 1, importo: 2_500, categoria: "fornitore" }],
        pagamenti: [{ id: 1, importo: 4_000, data: "2026-08-20" }],
        updatedAt: UPDATED,
      };
    },
    async listComunicazioni() {
      return [
        {
          id: 91,
          sedeId: 1,
          clienteId: 7,
          commessaId: 42,
          canale: "whatsapp",
          direzione: "in",
          oggetto: "Conferma appuntamento",
          categoria: "cliente_esistente",
          receivedAt: new Date("2026-08-25T08:00:00.000Z"),
          testo: "CORPO SEGRETO DA NON INCLUDERE",
          allegati: [{ nome: "foto.jpg", storageKey: "chiave-segreta" }],
        },
      ];
    },
    async listFatture() {
      return [
        {
          id: 501,
          sedeId: 1,
          clienteId: 7,
          commessaId: 42,
          numero: "18/A",
          data: "2026-08-15",
          importoLordo: 4_000,
          rate: [{ importo: 4_000, stato: "paid", scadenza: "2026-08-20" }],
          aggiornataAt: UPDATED,
        },
      ];
    },
    async listTickets() {
      return [
        {
          id: 71,
          sedeId: 1,
          clienteId: 7,
          commessaId: 42,
          stato: "aperto",
          priorita: "alta",
          oggetto: "Regolazione",
          updatedAt: UPDATED,
        },
      ];
    },
    async listInterventi() {
      return [
        {
          id: 81,
          sedeId: 1,
          commessaId: 42,
          tipo: "posa",
          stato: "pianificato",
          dataPianificata: "2026-09-02",
          oraInizio: "08:30",
          updatedAt: UPDATED,
        },
      ];
    },
    async listDocumenti() {
      return [
        {
          id: 61,
          sedeId: 1,
          commessaId: 42,
          tipo: "contratto",
          nome: "Contratto firmato.pdf",
          updatedAt: UPDATED,
          dataBase64: "BLOB-SEGRETO",
          storageKey: "storage-segreto",
        },
      ];
    },
    async listActionCases() {
      return [
        {
          id: 31,
          sedeId: 1,
          entityType: "commessa",
          entityId: 42,
          title: "Posa da confermare",
          status: "da_valutare",
          priority: 8,
          updatedAt: UPDATED,
        },
      ];
    },
  };
}

function key(scope: EntityContextKey["scope"]): EntityContextKey {
  return { sedeId: 1, entityType: "commessa", entityId: 42, scope };
}

describe("collectEntityFacts", () => {
  it("raccoglie fonti operative senza corpi, blob o chiavi storage", async () => {
    const result = await collectEntityFacts(key("operativo"), {
      source: source(),
    });
    const serialized = JSON.stringify(result);

    expect(result?.facts.map(fact => fact.key)).toEqual(
      expect.arrayContaining([
        "commessa.identita",
        "commessa.stato",
        "comunicazioni.riferimenti",
        "documenti.riferimenti",
        "ticket.aperti",
        "interventi.pianificati",
        "centro_azioni.casi",
      ])
    );
    expect(serialized).not.toContain("CORPO SEGRETO");
    expect(serialized).not.toContain("BLOB-SEGRETO");
    expect(serialized).not.toContain("storage-segreto");
    expect(serialized).not.toContain("importoTotale");
  });

  it("aggiunge fatture e pagamenti soltanto dallo scope amministrazione", async () => {
    const operational = await collectEntityFacts(key("operativo"), {
      source: source(),
    });
    const administration = await collectEntityFacts(key("amministrazione"), {
      source: source(),
    });

    expect(operational?.facts.map(fact => fact.key)).not.toContain(
      "fatture.riepilogo"
    );
    expect(administration?.facts.map(fact => fact.key)).toEqual(
      expect.arrayContaining(["fatture.riepilogo", "pagamenti.riepilogo"])
    );
    expect(JSON.stringify(administration)).not.toContain("costoPosaStimato");
  });

  it("espone costi e marginalita solo alla direzione", async () => {
    const direction = await collectEntityFacts(key("direzione"), {
      source: source(),
    });
    const economic = direction?.facts.find(
      fact => fact.key === "economia.direzione"
    );

    expect(economic?.value).toMatchObject({
      importoTotale: 12_000,
      importoIncassato: 4_000,
      costoPosaStimato: 1_200,
      totaleCostiRegistrati: 2_500,
    });
  });

  it("rifiuta una entita che non appartiene alla sede richiesta", async () => {
    const remote = source();
    remote.getCommessa = async () =>
      ({ ...(await source().getCommessa(42)), sedeId: 2 }) as any;
    expect(
      await collectEntityFacts(key("operativo"), { source: remote })
    ).toBeNull();
  });

  it("restituisce versioni sorgente per invalidazione deterministica", async () => {
    const result = await collectEntityFacts(key("operativo"), {
      source: source(),
    });
    expect(result?.sourceVersions).toMatchObject({
      commessa: UPDATED.toISOString(),
      comunicazioni: "2026-08-25T08:00:00.000Z",
      documenti: UPDATED.toISOString(),
    });
  });
});
