// D7 slice 3 — la macchina a stati del gateway, isolata dal dominio: qui
// l'azione registrata scrive su una mappa in memoria, così si provano
// idempotenza, scadenza, obsolescenza, doppia applicazione, errore in
// applicazione e cronologia append-only senza dipendere dagli store reali
// (il flusso completo con ordini veri è in routers/proposte.test.ts).

import { beforeEach, describe, expect, it } from "vitest";
import {
  SCADENZA_PROPOSTA_GIORNI,
  annullaProposta,
  applicaProposta,
  approvaProposta,
  creaProposta,
  registraAzioneProposta,
  rifiutaProposta,
  verificaFreschezza,
  type PropostaAzione,
} from "./gateway";

// Bersaglio in memoria dell'azione: il "dato autorevole" del test.
const bersaglio = new Map<number, string | null>();
let applicazioni = 0;
let esplodi = false;

registraAzioneProposta({
  tipo: "ordine_fornitore.aggiorna_data_consegna",
  etichetta: "Aggiorna la data di consegna prevista",
  capabilityFinale: "fornitore.manage_ordini",
  leggiValoreCorrente(proposta) {
    if (!bersaglio.has(proposta.ordineId)) {
      throw new Error("Ordine non trovato.");
    }
    return bersaglio.get(proposta.ordineId) ?? null;
  },
  descriviEffetto(proposta) {
    return `${proposta.valoreCorrente ?? "nessuna data"} → ${proposta.valoreProposto}`;
  },
  applica(proposta) {
    if (esplodi) throw new Error("scrittura fallita di proposito");
    applicazioni += 1;
    bersaglio.set(proposta.ordineId, proposta.valoreProposto);
  },
});

const SEDE = 91001;
let prossimoOrdine = 91100;

function nuovaProposta(extra?: Partial<Parameters<typeof creaProposta>[0]>) {
  const ordineId = extra?.ordineId ?? ++prossimoOrdine;
  if (!bersaglio.has(ordineId)) bersaglio.set(ordineId, "2026-09-10");
  return creaProposta({
    sedeId: SEDE,
    tipo: "ordine_fornitore.aggiorna_data_consegna",
    documentoId: 1,
    documentoNome: "conferma.pdf",
    byteChecksum: "abc123",
    analisiId: 7,
    evidenza: {
      pagina: 1,
      frammento: "Consegna prevista: 24/09/2026",
      metodo: "pattern_testo",
      confidenza: "alta",
    },
    ordineId,
    commessaId: 5,
    valoreCorrente: bersaglio.get(ordineId) ?? null,
    valoreProposto: "2026-09-24",
    motivazione: "La conferma dichiara una consegna diversa.",
    versioni: { estrattore: "1.0.0", confronto: "1.0.0", parser: "1.0.0" },
    ...extra,
  });
}

function tipiEventi(proposta: PropostaAzione): string[] {
  return proposta.eventi.map(evento => evento.tipo);
}

beforeEach(() => {
  applicazioni = 0;
  esplodi = false;
});

describe("gateway proposte — macchina a stati", () => {
  it("crea la proposta completa: snapshot, evidenza, scadenza, cronologia", () => {
    const prima = Date.now();
    const { proposta, riusata } = nuovaProposta();
    expect(riusata).toBe(false);
    expect(proposta.stato).toBe("proposta");
    expect(proposta.autore).toBe("sistema");
    expect(proposta.valoreCorrente).toBe("2026-09-10");
    expect(proposta.valoreProposto).toBe("2026-09-24");
    expect(proposta.evidenza?.pagina).toBe(1);
    expect(proposta.chiaveIdempotenza).toContain("aggiorna_data_consegna");
    expect(tipiEventi(proposta)).toEqual(["creata"]);
    const attesa = prima + SCADENZA_PROPOSTA_GIORNI * 86_400_000;
    expect(Math.abs(proposta.scadeIl.getTime() - attesa)).toBeLessThan(60_000);
  });

  it("è idempotente: stessa chiave aperta → stessa proposta, nessun duplicato", () => {
    const { proposta } = nuovaProposta();
    const seconda = nuovaProposta({ ordineId: proposta.ordineId });
    expect(seconda.riusata).toBe(true);
    expect(seconda.proposta.id).toBe(proposta.id);
  });

  it("approva e applica una sola volta, con cronologia append-only", async () => {
    const { proposta } = nuovaProposta();
    const approvata = approvaProposta({
      sedeId: SEDE,
      id: proposta.id,
      utenteId: 42,
    });
    expect(approvata.stato).toBe("approvata");

    const esito = await applicaProposta({
      sedeId: SEDE,
      id: proposta.id,
      utenteId: 42,
    });
    expect(esito.riusata).toBe(false);
    expect(esito.proposta.stato).toBe("applicata");
    expect(bersaglio.get(proposta.ordineId)).toBe("2026-09-24");
    expect(applicazioni).toBe(1);
    expect(tipiEventi(esito.proposta)).toEqual([
      "creata",
      "approvata",
      "applicata",
    ]);
    expect(esito.proposta.eventi[1].utenteId).toBe(42);

    // Doppia applicazione: nessuna seconda scrittura.
    const doppia = await applicaProposta({
      sedeId: SEDE,
      id: proposta.id,
      utenteId: 42,
    });
    expect(doppia.riusata).toBe(true);
    expect(applicazioni).toBe(1);
  });

  it("non applica senza approvazione", async () => {
    const { proposta } = nuovaProposta();
    await expect(
      applicaProposta({ sedeId: SEDE, id: proposta.id, utenteId: 1 })
    ).rejects.toThrow(/non è ancora approvata/);
    expect(applicazioni).toBe(0);
  });

  it("rifiuta con motivo e non lascia riaprire", () => {
    const { proposta } = nuovaProposta();
    const rifiutata = rifiutaProposta({
      sedeId: SEDE,
      id: proposta.id,
      utenteId: 9,
      motivo: "La conferma è del preventivo, non dell'ordine.",
    });
    expect(rifiutata.stato).toBe("rifiutata");
    expect(rifiutata.eventi.at(-1)?.motivo).toContain("preventivo");
    expect(() =>
      approvaProposta({ sedeId: SEDE, id: proposta.id, utenteId: 9 })
    ).toThrow(/rifiutata/);
  });

  it("annulla anche una proposta già approvata", () => {
    const { proposta } = nuovaProposta();
    approvaProposta({ sedeId: SEDE, id: proposta.id, utenteId: 3 });
    const annullata = annullaProposta({
      sedeId: SEDE,
      id: proposta.id,
      utenteId: 3,
      motivo: "Arrivata una conferma più recente.",
    });
    expect(annullata.stato).toBe("annullata");
    expect(tipiEventi(annullata)).toEqual(["creata", "approvata", "annullata"]);
  });

  it("marca obsoleta la proposta se il valore corrente è cambiato, senza applicare", async () => {
    const { proposta } = nuovaProposta();
    approvaProposta({ sedeId: SEDE, id: proposta.id, utenteId: 4 });
    // Qualcuno (o un'altra conferma) cambia il dato sorgente nel frattempo.
    bersaglio.set(proposta.ordineId, "2026-10-01");
    await expect(
      applicaProposta({ sedeId: SEDE, id: proposta.id, utenteId: 4 })
    ).rejects.toThrow(/obsoleta/);
    expect(proposta.stato).toBe("obsoleta");
    expect(proposta.eventi.at(-1)?.motivo).toContain("2026-10-01");
    expect(applicazioni).toBe(0);
    expect(bersaglio.get(proposta.ordineId)).toBe("2026-10-01");
  });

  it("marca obsoleta la proposta se il dato sorgente non è più leggibile", () => {
    const { proposta } = nuovaProposta();
    bersaglio.delete(proposta.ordineId);
    const esito = verificaFreschezza(proposta);
    expect(esito.stato).toBe("obsoleta");
    expect(esito.eventi.at(-1)?.motivo).toContain("non più leggibile");
  });

  it("scade dopo la finestra temporale, senza applicare", () => {
    const passato = new Date(
      Date.now() - (SCADENZA_PROPOSTA_GIORNI + 1) * 86_400_000
    );
    const { proposta } = nuovaProposta({ now: passato });
    expect(() =>
      approvaProposta({ sedeId: SEDE, id: proposta.id, utenteId: 2 })
    ).toThrow(/scaduta/);
    expect(proposta.stato).toBe("scaduta");
    expect(applicazioni).toBe(0);
  });

  it("registra il fallimento dell'applicazione con il motivo, senza mascherarlo", async () => {
    const { proposta } = nuovaProposta();
    approvaProposta({ sedeId: SEDE, id: proposta.id, utenteId: 6 });
    esplodi = true;
    await expect(
      applicaProposta({ sedeId: SEDE, id: proposta.id, utenteId: 6 })
    ).rejects.toThrow(/scrittura fallita di proposito/);
    expect(proposta.stato).toBe("fallita");
    expect(proposta.eventi.at(-1)?.motivo).toContain("fallita di proposito");
    expect(bersaglio.get(proposta.ordineId)).toBe("2026-09-10");
  });

  it("isola le sedi: id giusto, sede sbagliata → non trovata", () => {
    const { proposta } = nuovaProposta();
    expect(() =>
      approvaProposta({ sedeId: SEDE + 1, id: proposta.id, utenteId: 1 })
    ).toThrow(/non trovata/);
  });
});
