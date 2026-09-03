import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Capability } from "../../authz/capabilities";
import type { ContestoRun } from "../strumenti/tipi";
import {
  REGISTRO_AZIONI,
  descrittoreAzione,
  validaRegistroAzioni,
} from "./registry";
import { azioniPertinentiAlContesto, catalogoAzioniPerContesto } from "./policy";
import {
  chiaveIdempotenzaR1,
  creaLedgerEsecuzioniMemoriaPerTest,
} from "./executions";

const ENV_ORIGINALE = { ...process.env };

function contesto(
  capability: readonly Capability[] = [
    "cliente.read",
    "cliente.create",
    "cliente.update_operational",
    "commessa.read",
    "commessa.create",
    "ticket.create",
    "ticket.manage",
    "intervento.plan",
    "commessa.update_operational",
    "commessa.change_state",
    "commessa.manage_documents",
    "fornitore.manage_ordini",
    "economia.read",
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
  delete process.env.FLAG_TARS_COMMUNICATIONS;
  delete process.env.FLAG_TARS_MEMORY;
  delete process.env.FLAG_DOCUMENT_INTELLIGENCE;
  delete process.env.FLAG_PROPOSTE;
});

afterEach(() => {
  process.env = { ...ENV_ORIGINALE };
});

describe("registro centrale delle azioni Tars", () => {
  it("registra una volta sola tutti i tool correnti con un descrittore completo", () => {
    expect(REGISTRO_AZIONI).toHaveLength(53);
    expect(new Set(REGISTRO_AZIONI.map(a => a.nome)).size).toBe(53);

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
      archivia_allegato_comunicazione: "R1",
      cerca_clienti: "R0",
      cerca_commesse: "R0",
      cerca_comunicazioni: "R0",
      cerca_fatture: "R0",
      cerca_documenti: "R0",
      leggi_cliente: "R0",
      completa_promemoria: "R1",
      crea_promemoria: "R1",
      crea_ticket: "R1",
      crea_cliente: "R1",
      aggiorna_cliente: "R1",
      crea_commessa: "R1",
      aggiorna_commessa: "R1",
      archivia_commessa: "R1",
      ripristina_commessa: "R1",
      aggiorna_ticket: "R1",
      chiudi_ticket: "R1",
      pianifica_intervento: "R1",
      leggi_agenda: "R0",
      sposta_intervento: "R1",
      segna_intervento_fatto: "R1",
      migra_calendario_google: "R1",
      collega_comunicazione: "R1",
      classifica_comunicazione: "R1",
      segna_gestita_comunicazione: "R1",
      risolvi_caso: "R1",
      collega_fattura_commessa: "R1",
      sposta_documento: "R1",
      dimentica: "R1",
      leggi_analisi_ordine: "R0",
      leggi_allegato_comunicazione: "R0",
      leggi_centro_azioni: "R0",
      leggi_commessa: "R0",
      leggi_comunicazioni: "R0",
      leggi_thread_comunicazioni: "R0",
      leggi_fascicolo_commessa: "R0",
      leggi_memorie: "R0",
      leggi_miglioramenti: "R0",
      leggi_ordini_fornitore: "R0",
      leggi_promemoria: "R0",
      leggi_promemoria_in_scadenza: "R0",
      panorama_azienda: "R0",
      prendi_in_carico_caso: "R1",
      proponi_data_consegna: "R3",
      ricorda: "R1",
      rinvia_caso: "R1",
      sposta_promemoria: "R1",
      transizione_adiacente_commessa: "R1",
      verifica_gate_commessa: "R0",
      verifica_transizione_commessa: "R0",
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

  it("espone i lettori di thread/allegato solo con capability e flag comunicazioni", () => {
    for (const nome of [
      "leggi_thread_comunicazioni",
      "leggi_allegato_comunicazione",
    ]) {
      expect(descrittoreAzione(nome)).toMatchObject({
        rischio: "R0",
        capability: ["commessa.read"],
        interruttori: ["tars", "tarsReadTools", "tarsCommunications"],
      });
    }
    expect(descrittoreAzione("leggi_allegato_comunicazione")).toMatchObject({
      timeoutMs: 120_000,
      costo: { classe: "medio" },
    });
    process.env.FLAG_TARS_COMMUNICATIONS = "off";
    const spento = catalogoAzioniPerContesto(contesto()).map(a => a.nome);
    expect(spento).not.toContain("leggi_thread_comunicazioni");
    expect(spento).not.toContain("leggi_allegato_comunicazione");
    process.env.FLAG_TARS_COMMUNICATIONS = "on";
    const senzaCapability = catalogoAzioniPerContesto(contesto([])).map(
      a => a.nome
    );
    expect(senzaCapability).not.toContain("leggi_thread_comunicazioni");
    expect(senzaCapability).not.toContain("leggi_allegato_comunicazione");
  });

  it("dichiara lo scope esplicitamente per tutti i tool", () => {
    expect(Object.fromEntries(REGISTRO_AZIONI.map(a => [a.nome, a.scope]))).toEqual({
      analizza_conferma_ordine: "entita",
      annulla_promemoria: "personale",
      archivia_allegato_comunicazione: "entita",
      cerca_clienti: "sede",
      cerca_commesse: "sede",
      cerca_comunicazioni: "sede",
      cerca_fatture: "sede",
      cerca_documenti: "sede",
      leggi_cliente: "entita",
      completa_promemoria: "personale",
      crea_promemoria: "personale",
      crea_ticket: "entita",
      crea_cliente: "sede",
      aggiorna_cliente: "entita",
      crea_commessa: "sede",
      aggiorna_commessa: "entita",
      archivia_commessa: "entita",
      ripristina_commessa: "entita",
      aggiorna_ticket: "entita",
      chiudi_ticket: "entita",
      pianifica_intervento: "entita",
      leggi_agenda: "sede",
      sposta_intervento: "entita",
      segna_intervento_fatto: "entita",
      migra_calendario_google: "sede",
      collega_comunicazione: "entita",
      classifica_comunicazione: "entita",
      segna_gestita_comunicazione: "entita",
      risolvi_caso: "entita",
      collega_fattura_commessa: "entita",
      sposta_documento: "entita",
      dimentica: "sede",
      leggi_analisi_ordine: "entita",
      leggi_allegato_comunicazione: "entita",
      leggi_centro_azioni: "sede",
      leggi_commessa: "entita",
      leggi_comunicazioni: "entita",
      leggi_thread_comunicazioni: "entita",
      leggi_fascicolo_commessa: "entita",
      leggi_memorie: "sede",
      leggi_miglioramenti: "sede",
      leggi_ordini_fornitore: "entita",
      leggi_promemoria: "personale",
      leggi_promemoria_in_scadenza: "personale",
      panorama_azienda: "sede",
      prendi_in_carico_caso: "entita",
      proponi_data_consegna: "entita",
      ricorda: "sede",
      rinvia_caso: "entita",
      sposta_promemoria: "personale",
      transizione_adiacente_commessa: "entita",
      verifica_gate_commessa: "entita",
      verifica_transizione_commessa: "entita",
    });
  });

  it("dichiara compensazione R1 solo dove l'esito espone davvero Undo", () => {
    expect(
      Object.fromEntries(
        REGISTRO_AZIONI.filter(a => a.rischio === "R1").map(a => [
          a.nome,
          a.compensazione.disponibile,
        ])
      )
    ).toEqual({
      annulla_promemoria: false,
      archivia_allegato_comunicazione: false,
      completa_promemoria: false,
      crea_promemoria: true,
      crea_ticket: false,
      crea_cliente: false,
      aggiorna_cliente: false,
      crea_commessa: false,
      aggiorna_commessa: false,
      archivia_commessa: false,
      ripristina_commessa: false,
      aggiorna_ticket: false,
      chiudi_ticket: false,
      pianifica_intervento: false,
      sposta_intervento: false,
      segna_intervento_fatto: false,
      migra_calendario_google: false,
      collega_comunicazione: false,
      classifica_comunicazione: false,
      segna_gestita_comunicazione: false,
      risolvi_caso: false,
      collega_fattura_commessa: false,
      sposta_documento: false,
      dimentica: false,
      prendi_in_carico_caso: false,
      ricorda: false,
      rinvia_caso: false,
      sposta_promemoria: false,
      transizione_adiacente_commessa: true,
    });
  });

  it("usa uno schema azione tool-specifico e completo", () => {
    const schema = descrittoreAzione("crea_promemoria")!.schemaRisultato;
    const completo = {
      tipo: "azione",
      strumento: "crea_promemoria",
      stato: "creato",
      motivo: null,
      azioneId: "evento:12",
      auditId: "audit:12",
      entitaToccate: ["promemoria:12"],
      prima: null,
      dopo: { id: 12 },
      undoDisponibile: true,
      undoEntro: "finché attivo",
      undoVia: { procedura: "promemoria.cancel", id: 12 },
      conferma: null,
      avvertenze: [],
      assunzioni: [],
      dati: { id: 12 },
      evidenze: [],
      freschezza: "2026-08-31T10:00:00.000Z",
    };
    expect(schema.safeParse(completo).success).toBe(true);
    expect(
      schema.safeParse({ ...completo, strumento: "sposta_promemoria" }).success
    ).toBe(false);
    const { undoVia: _via, ...senzaUndoVia } = completo;
    expect(schema.safeParse(senzaUndoVia).success).toBe(false);
    const { conferma: _conferma, ...senzaConferma } = completo;
    expect(schema.safeParse(senzaConferma).success).toBe(false);
  });
});

describe("policy dinamica del catalogo", () => {
  it("i selettori (superficie, entità, intento) NON potano il catalogo: pertinenza solo informativa (Tars libero)", () => {
    const selettori = {
      superficie: "documenti-ordini" as const,
      entitaAttiva: { tipo: "ordine_fornitore" as const, id: 41 },
      intento: "proposta" as const,
    };
    const catalogo = catalogoAzioniPerContesto({ ...contesto(), ...selettori });
    expect(catalogo).toHaveLength(53);
    expect(catalogo.map(a => a.nome)).toContain("proponi_data_consegna");
    expect(catalogo.map(a => a.nome)).toContain("cerca_commesse");
    expect(
      azioniPertinentiAlContesto({ ...contesto(), ...selettori }).map(a => a.nome)
    ).toEqual(["proponi_data_consegna"]);
  });

  it("applica capability, direzione, sede e flag in modo fail-closed", () => {
    const selettori = {
      superficie: "documenti-ordini" as const,
      entitaAttiva: { tipo: "ordine_fornitore" as const, id: 41 },
      intento: "proposta" as const,
    };
    const senzaCapability = catalogoAzioniPerContesto({
      ...contesto([]),
      ...selettori,
      direzione: false,
      ruoli: ["commerciale"],
    }).map(a => a.nome);
    expect(senzaCapability).not.toContain("proponi_data_consegna");
    expect(senzaCapability).not.toContain("leggi_commessa");
    expect(senzaCapability).not.toContain("crea_ticket");
    expect(
      catalogoAzioniPerContesto({ ...contesto(), ...selettori, sedeId: 0 })
    ).toEqual([]);

    process.env.FLAG_TARS_PROPOSALS = "off";
    expect(
      catalogoAzioniPerContesto({ ...contesto(), ...selettori }).map(a => a.nome)
    ).not.toContain("proponi_data_consegna");
  });

  it("i tool direzione-only non esistono nel catalogo di chi non è direzione", () => {
    const nonDirezione = catalogoAzioniPerContesto({
      ...contesto(),
      ruoli: ["commerciale"],
      direzione: false,
    }).map(a => a.nome);
    expect(nonDirezione).not.toContain("panorama_azienda");
    expect(nonDirezione).not.toContain("leggi_miglioramenti");
    expect(nonDirezione).not.toContain("leggi_analisi_ordine");
    const direzione = catalogoAzioniPerContesto(contesto()).map(a => a.nome);
    expect(direzione).toContain("panorama_azienda");
    expect(direzione).toContain("leggi_miglioramenti");
  });

  it("con o senza selettori il catalogo è lo stesso: tutto l'autorizzato", () => {
    const completo = catalogoAzioniPerContesto(contesto()).map(a => a.nome);
    expect(completo).toHaveLength(53);
    expect(completo).toContain("crea_promemoria");
    expect(completo).toContain("proponi_data_consegna");

    const conSelettori = catalogoAzioniPerContesto({
      ...contesto(),
      superficie: "economia",
      intento: "azione_esplicita",
    }).map(a => a.nome);
    expect(conSelettori).toEqual(completo);
    expect(
      azioniPertinentiAlContesto({
        ...contesto(),
        superficie: "economia",
        intento: "azione_esplicita",
      }).map(a => a.nome)
    ).toEqual(["collega_fattura_commessa"]);
  });

  it("in produzione senza PostgreSQL non espone R1", () => {
    process.env.NODE_ENV = "production";
    process.env.FLAG_TARS = "on";
    process.env.FLAG_TARS_READ_TOOLS = "on";
    process.env.FLAG_TARS_REMINDERS = "on";
    process.env.FLAG_TARS_L2_ACTIONS = "on";
    process.env.FLAG_TARS_MEMORY = "on";
    const catalogo = catalogoAzioniPerContesto(contesto());
    expect(catalogo.some(a => a.rischio === "R1")).toBe(false);
    expect(catalogo.some(a => a.rischio === "R0")).toBe(true);
  });
});

describe("ledger append-only delle esecuzioni R1", () => {
  it("un risultato legacy non_eseguito senza id non è un effetto riusabile", async () => {
    const verifica = descrittoreAzione("crea_promemoria")!
      .idempotenza.esitoAncoraValido!;
    const esito = {
      ...azioneDiTest("crea_promemoria", "audit:no-effect", 12),
      stato: "non_eseguito",
      motivo: "la commessa è cambiata",
      azioneId: null,
      auditId: null,
      entitaToccate: [],
      dopo: null,
      undoDisponibile: false,
      undoEntro: null,
      undoVia: null,
      dati: null,
    } as const;

    await expect(verifica(contesto(), {}, esito)).resolves.toBe(false);
  });

  it("prenota prima dell'esito e persiste transizioni append-only", async () => {
    const ledger = creaLedgerEsecuzioniMemoriaPerTest();
    const prenotazione = {
      idempotencyKey: "r1:abc",
      runId: "run-1",
      sedeId: 3,
      utenteId: 7,
      strumento: "crea_promemoria",
      versioneStrumento: "1.0.0",
      createdAt: new Date("2026-08-31T10:00:00.000Z"),
    } as const;
    const prima = await ledger.prenota(prenotazione);
    const duplicata = await ledger.prenota(prenotazione);
    expect(prima.tipo).toBe("prenotata");
    expect(duplicata).toMatchObject({ tipo: "esistente", riga: { stato: "reserved" } });

    const esito = azioneDiTest("crea_promemoria", "audit:12", 12);
    await ledger.concludi({
      idempotencyKey: prenotazione.idempotencyKey,
      versioneOggetto: "sha256:v1",
      esito,
      audit: { auditId: esito.auditId, azioneId: esito.azioneId },
      compensazione: { disponibile: true, via: "promemoria.cancel:12" },
      createdAt: new Date("2026-08-31T10:01:00.000Z"),
    });
    const settled = await ledger.prenota(prenotazione);
    expect(settled).toMatchObject({
      tipo: "esistente",
      riga: { stato: "settled", esito: "creato", risultato: esito },
    });
    expect(await ledger.eventi(prenotazione.idempotencyKey)).toEqual([
      "reserved",
      "settled",
    ]);
  });

  it("la chiave pre-effetto è canonica e distingue input legittimi", () => {
    const descrittore = descrittoreAzione("ricorda")!;
    const comune = { descrittore, contesto: contesto() };
    const a = chiaveIdempotenzaR1({
      ...comune,
      argomenti: { contenuto: "Maccari", tipo: "preferenza" },
    });
    const riordinata = chiaveIdempotenzaR1({
      ...comune,
      argomenti: { tipo: "preferenza", contenuto: "Maccari" },
    });
    const b = chiaveIdempotenzaR1({
      ...comune,
      argomenti: { contenuto: "Bianchi", tipo: "preferenza" },
    });
    expect(a).toBe(riordinata);
    expect(a).not.toBe(b);
  });
});

function azioneDiTest(strumento: string, auditId: string, id: number) {
  return {
    tipo: "azione" as const,
    strumento,
    stato: "creato",
    motivo: null,
    azioneId: `evento:${auditId}`,
    auditId,
    entitaToccate: [`promemoria:${id}`],
    prima: null,
    dopo: { id, stato: "pending" },
    undoDisponibile: true,
    undoEntro: "finché è pending",
    undoVia: { procedura: "promemoria.cancel" as const, id },
    conferma: null,
    avvertenze: [],
    assunzioni: [],
    dati: { id },
    evidenze: [],
    freschezza: "2026-08-31T10:00:00.000Z",
  };
}
