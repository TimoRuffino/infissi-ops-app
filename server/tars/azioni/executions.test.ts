// T10 (revisione, rilievo I2): una reservation R1 orfana non blocca per
// sempre lo stesso comando — oltre il TTL scade e apre una nuova
// generazione, ma SOLO per azioni con idempotenza di dominio.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REGISTRO_AZIONI } from "./registry";
import {
  creaLedgerEsecuzioniMemoriaPerTest,
  impostaLedgerEsecuzioniPerTest,
  prenotaEsecuzioneR1,
  type LedgerEsecuzioniR1,
} from "./executions";
import type { ContestoRun } from "../strumenti/tipi";

const SEDE = 96501;

function contesto(): ContestoRun {
  return {
    utenteId: 7,
    sedeId: SEDE,
    ruoli: ["direzione"],
    direzione: true,
    capability: new Set() as ContestoRun["capability"],
    capabilityFingerprint: "caps-exp",
    lingua: "it",
    fuso: "Europe/Rome",
  };
}

let ledger: LedgerEsecuzioniR1;

beforeEach(() => {
  ledger = creaLedgerEsecuzioniMemoriaPerTest();
  impostaLedgerEsecuzioniPerTest(ledger);
  delete process.env.TARS_R1_RESERVATION_TTL_MS;
});

afterEach(() => {
  impostaLedgerEsecuzioniPerTest(null);
  delete process.env.TARS_R1_RESERVATION_TTL_MS;
});

describe("scadenza delle reservation R1 orfane", () => {
  const descrittore = REGISTRO_AZIONI.find(
    azione => azione.nome === "archivia_allegato_comunicazione"
  )!;
  const argomenti = { comunicazioneId: 9, allegatoIndex: 0 };

  it("dentro il TTL la reservation orfana resta bloccante (incerta)", async () => {
    const prima = await prenotaEsecuzioneR1({
      descrittore,
      contesto: contesto(),
      runId: "run-a",
      argomenti,
    });
    expect(prima.tipo).toBe("esegui");
    // Nessun settle: il "processo" muore qui.
    const seconda = await prenotaEsecuzioneR1({
      descrittore,
      contesto: contesto(),
      runId: "run-b",
      argomenti,
    });
    expect(seconda).toMatchObject({ tipo: "incerta", stato: "reserved" });
  });

  it("oltre il TTL scade, apre una nuova generazione e lo storico resta append-only", async () => {
    process.env.TARS_R1_RESERVATION_TTL_MS = "1";
    const prima = await prenotaEsecuzioneR1({
      descrittore,
      contesto: contesto(),
      runId: "run-a",
      argomenti,
    });
    expect(prima.tipo).toBe("esegui");
    await new Promise(resolve => setTimeout(resolve, 5));
    const seconda = await prenotaEsecuzioneR1({
      descrittore,
      contesto: contesto(),
      runId: "run-b",
      argomenti,
    });
    expect(seconda.tipo).toBe("esegui");
    // Nuova generazione: chiave diversa dalla prima.
    expect((seconda as any).idempotencyKey).not.toBe(
      (prima as any).idempotencyKey
    );
    expect(await ledger.eventi((prima as any).idempotencyKey)).toEqual([
      "reserved",
      "expired",
    ]);
  });

  it("senza idempotenza di dominio la reservation orfana NON scade", async () => {
    process.env.TARS_R1_RESERVATION_TTL_MS = "1";
    const senzaDominio = {
      ...descrittore,
      idempotenza: { strategia: "chiave_obbligatoria", fonte: "test" },
    } as typeof descrittore;
    const prima = await prenotaEsecuzioneR1({
      descrittore: senzaDominio,
      contesto: contesto(),
      runId: "run-a",
      argomenti,
    });
    expect(prima.tipo).toBe("esegui");
    await new Promise(resolve => setTimeout(resolve, 5));
    const seconda = await prenotaEsecuzioneR1({
      descrittore: senzaDominio,
      contesto: contesto(),
      runId: "run-b",
      argomenti,
    });
    expect(seconda).toMatchObject({ tipo: "incerta", stato: "reserved" });
  });
});
