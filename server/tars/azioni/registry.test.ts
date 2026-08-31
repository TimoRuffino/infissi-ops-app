import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Capability } from "../../authz/capabilities";
import type { ContestoRun } from "../strumenti/tipi";
import {
  REGISTRO_AZIONI,
  descrittoreAzione,
  validaRegistroAzioni,
} from "./registry";
import { catalogoAzioniPerContesto } from "./policy";
import {
  creaLedgerEsecuzioniMemoriaPerTest,
  registraEsecuzioneR1,
} from "./executions";

const ENV_ORIGINALE = { ...process.env };

function contesto(
  capability: readonly Capability[] = [
    "commessa.read",
    "fornitore.manage_ordini",
  ]
): ContestoRun {
  return {
    utenteId: 7,
    sedeId: 3,
    ruoli: ["direzione"],
    direzione: true,
    capability: new Set(capability),
    capabilityFingerprint: "caps-registry",
    lingua: "it",
    fuso: "Europe/Rome",
  };
}

beforeEach(() => {
  process.env.NODE_ENV = "test";
  delete process.env.FLAG_TARS;
  delete process.env.FLAG_TARS_READ_TOOLS;
  delete process.env.FLAG_TARS_REMINDERS;
  delete process.env.FLAG_TARS_L2_ACTIONS;
  delete process.env.FLAG_TARS_PROPOSALS;
  delete process.env.FLAG_TARS_MEMORY;
  delete process.env.FLAG_DOCUMENT_INTELLIGENCE;
  delete process.env.FLAG_PROPOSTE;
});

afterEach(() => {
  process.env = { ...ENV_ORIGINALE };
});

describe("registro centrale delle azioni Tars", () => {
  it("registra una volta sola tutti i 21 tool correnti con un descrittore completo", () => {
    expect(REGISTRO_AZIONI).toHaveLength(21);
    expect(new Set(REGISTRO_AZIONI.map(a => a.nome)).size).toBe(21);

    for (const azione of REGISTRO_AZIONI) {
      expect(azione.versioneRegistro).toMatch(/^1\./);
      expect(azione.rischio).toMatch(/^R[0-3]$/);
      expect(Array.isArray(azione.capability)).toBe(true);
      expect(["personale", "sede", "entita"]).toContain(azione.scope);
      expect(azione.schemaRisultato.safeParse(undefined).success).toBe(false);
      expect(azione.prerequisiti.superfici.length).toBeGreaterThan(0);
      expect(azione.prerequisiti.intenti.length).toBeGreaterThan(0);
      expect(azione.idempotenza.strategia).toBeTruthy();
      expect(typeof azione.audit.richiesto).toBe("boolean");
      expect(typeof azione.compensazione.disponibile).toBe("boolean");
      expect(azione.interruttori).toContain("tars");
      expect(azione.timeoutMs).toBeGreaterThan(0);
      expect(azione.costo.unita).toBe("operazione");
      expect(azione.costo.massimo).toBeGreaterThanOrEqual(0);
      expect(azione.strumento.nome).toBe(azione.nome);
    }
  });

  it.each([
    "rischio",
    "capability",
    "scope",
    "schemaRisultato",
    "prerequisiti",
    "idempotenza",
    "audit",
    "compensazione",
    "interruttori",
    "timeoutMs",
    "costo",
  ] as const)("rifiuta un'azione senza %s", campo => {
    const incompleta = { ...REGISTRO_AZIONI[0] } as Record<string, unknown>;
    delete incompleta[campo];
    expect(() => validaRegistroAzioni([incompleta as never])).toThrow(campo);
  });

  it("mantiene L storico e rischio R distinti e deterministici", () => {
    expect(descrittoreAzione("analizza_conferma_ordine")).toMatchObject({
      livello: "L2",
      rischio: "R0",
    });
    expect(descrittoreAzione("prendi_in_carico_caso")).toMatchObject({
      livello: "L2",
      rischio: "R1",
    });
    expect(descrittoreAzione("proponi_data_consegna")).toMatchObject({
      livello: "L3",
      rischio: "R3",
    });
    expect(
      Object.fromEntries(REGISTRO_AZIONI.map(a => [a.nome, a.rischio]))
    ).toEqual({
      analizza_conferma_ordine: "R0",
      annulla_promemoria: "R1",
      cerca_commesse: "R0",
      completa_promemoria: "R1",
      crea_promemoria: "R1",
      dimentica: "R1",
      leggi_analisi_ordine: "R0",
      leggi_centro_azioni: "R0",
      leggi_commessa: "R0",
      leggi_comunicazioni: "R0",
      leggi_fascicolo_commessa: "R0",
      leggi_memorie: "R0",
      leggi_ordini_fornitore: "R0",
      leggi_promemoria: "R0",
      leggi_promemoria_in_scadenza: "R0",
      prendi_in_carico_caso: "R1",
      proponi_data_consegna: "R3",
      ricorda: "R1",
      rinvia_caso: "R1",
      sposta_promemoria: "R1",
      verifica_gate_commessa: "R0",
    });
  });

  it("rifiuta R4 anche se un descrittore viene costruito a runtime", () => {
    const vietata = { ...REGISTRO_AZIONI[0], rischio: "R4" } as never;
    expect(() => validaRegistroAzioni([vietata])).toThrow(/R4.*vietat/i);
  });

  it("rifiuta capability o flag in deriva rispetto al tool storico", () => {
    const comunicazioni = descrittoreAzione("leggi_comunicazioni")!;
    expect(() =>
      validaRegistroAzioni([{ ...comunicazioni, capability: [] }])
    ).toThrow(/capability.*incoerent/i);
    expect(() =>
      validaRegistroAzioni([
        {
          ...comunicazioni,
          interruttori: comunicazioni.interruttori.filter(
            flag => flag !== "tarsCommunications"
          ),
        },
      ])
    ).toThrow(/flag.*incoerent/i);
  });
});

describe("policy dinamica del catalogo", () => {
  it("restringe per superficie, entità attiva e intento", () => {
    const risultato = catalogoAzioniPerContesto({
      ...contesto(),
      superficie: "documenti-ordini",
      entitaAttiva: { tipo: "ordine_fornitore", id: 41 },
      intento: "proposta",
    });
    expect(risultato.map(a => a.nome)).toEqual(["proponi_data_consegna"]);
  });

  it("applica capability, direzione, sede e flag in modo fail-closed", () => {
    const selettori = {
      superficie: "documenti-ordini" as const,
      entitaAttiva: { tipo: "ordine_fornitore" as const, id: 41 },
      intento: "proposta" as const,
    };
    expect(
      catalogoAzioniPerContesto({
        ...contesto([]),
        ...selettori,
        direzione: false,
        ruoli: ["commerciale"],
      })
    ).toEqual([]);
    expect(
      catalogoAzioniPerContesto({ ...contesto(), ...selettori, sedeId: 0 })
    ).toEqual([]);

    process.env.FLAG_TARS_PROPOSALS = "off";
    expect(
      catalogoAzioniPerContesto({ ...contesto(), ...selettori })
    ).toEqual([]);
  });

  it("senza selettori mantiene il catalogo compatibile; senza match usa solo il fallback R0", () => {
    const completo = catalogoAzioniPerContesto(contesto()).map(a => a.nome);
    expect(completo).toHaveLength(21);
    expect(completo).toContain("crea_promemoria");
    expect(completo).toContain("proponi_data_consegna");

    const fallback = catalogoAzioniPerContesto({
      ...contesto(),
      superficie: "post-vendita",
      intento: "azione_esplicita",
    });
    expect(fallback.map(a => a.nome)).toEqual(["cerca_commesse"]);
    expect(fallback.every(a => a.rischio === "R0")).toBe(true);
  });
});

describe("ledger append-only delle esecuzioni R1", () => {
  it("deduplica la stessa idempotency key senza rieseguire alcun effetto", async () => {
    const ledger = creaLedgerEsecuzioniMemoriaPerTest();
    const input = {
      idempotencyKey: "run-1:crea_promemoria:abc",
      runId: "run-1",
      sedeId: 3,
      utenteId: 7,
      strumento: "crea_promemoria",
      versioneStrumento: "1.0.0",
      versioneOggetto: "promemoria:12:v1",
      esito: "creato",
      audit: { auditId: "reminder_events:12", azioneId: "promemoria:12" },
      compensazione: { disponibile: true, via: "promemoria.cancel:12" },
      createdAt: new Date("2026-08-31T10:00:00.000Z"),
    } as const;

    const prima = await ledger.append(input);
    const seconda = await ledger.append({
      ...input,
      versioneOggetto: "promemoria:12:v2",
      esito: "duplicato",
    });

    expect(prima.inserita).toBe(true);
    expect(seconda.inserita).toBe(false);
    expect(seconda.riga.versioneOggetto).toBe("promemoria:12:v1");
    expect(await ledger.lista({ sedeId: 3 })).toHaveLength(1);
  });

  it("registra solo R1 dopo l'esito e conserva audit e compensazione", async () => {
    const ledger = creaLedgerEsecuzioniMemoriaPerTest();
    const esito = {
      tipo: "azione" as const,
      strumento: "crea_promemoria",
      stato: "creato",
      motivo: null,
      azioneId: "promemoria:12",
      auditId: "reminder_events:12",
      entitaToccate: ["promemoria:12"],
      prima: null,
      dopo: { id: 12, stato: "pending" },
      undoDisponibile: true,
      undoEntro: "finché è pending",
      undoVia: { procedura: "promemoria.cancel" as const, id: 12 },
      conferma: null,
      avvertenze: [],
      assunzioni: [],
      dati: { id: 12 },
      evidenze: [],
      freschezza: "2026-08-31T10:00:00.000Z",
    };

    await registraEsecuzioneR1({
      ledger,
      descrittore: descrittoreAzione("crea_promemoria")!,
      contesto: contesto(),
      runId: "run-1",
      argomenti: { titolo: "finanziamento Maccari" },
      esito,
    });
    await registraEsecuzioneR1({
      ledger,
      descrittore: descrittoreAzione("cerca_commesse")!,
      contesto: contesto(),
      runId: "run-1",
      argomenti: { query: "Maccari" },
      esito,
    });

    const righe = await ledger.lista({ sedeId: 3 });
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatchObject({
      strumento: "crea_promemoria",
      esito: "creato",
      audit: { auditId: "reminder_events:12" },
      compensazione: { disponibile: true },
    });
    expect(righe[0].versioneOggetto).toMatch(/^sha256:/);
  });
});
