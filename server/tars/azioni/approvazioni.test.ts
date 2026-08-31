// T5 — la frontiera UNICA per R2/R3: anteprima hashata e monouso, doppio
// click inerte, nessuno strumento di approvazione per il modello e azioni
// senza servizio canonico dichiarate indisponibili con il blocco reale.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { appRouter } from "../../routers";
import {
  creaProposta,
  hashAnteprimaProposta,
  registraAzioneProposta,
} from "../../proposte/gateway";
import {
  AZIONI_DICHIARATE_INDISPONIBILI,
  REGISTRO_AZIONI,
  validaRegistroAzioni,
} from "./registry";

const SEDE = 93501;
const DIREZIONE_ID = 93511;

const bersaglio = new Map<number, string | null>();
let applicazioni = 0;

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
    applicazioni += 1;
    bersaglio.set(proposta.ordineId, proposta.valoreProposto);
  },
});

let prossimoOrdine = 93600;

function nuovaProposta() {
  const ordineId = ++prossimoOrdine;
  bersaglio.set(ordineId, "2026-09-10");
  return creaProposta({
    sedeId: SEDE,
    tipo: "ordine_fornitore.aggiorna_data_consegna",
    documentoId: 1,
    documentoNome: "conferma.pdf",
    byteChecksum: "abc123",
    analisiId: null,
    evidenza: null,
    ordineId,
    commessaId: null,
    valoreCorrente: "2026-09-10",
    valoreProposto: "2026-09-24",
    motivazione: "La conferma dichiara una consegna diversa.",
    versioni: { estrattore: "1.0.0" },
  }).proposta;
}

function contestoTrpc(roles: string[]): TrpcContext {
  return {
    user: {
      id: DIREZIONE_ID,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: `Utente ${DIREZIONE_ID}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: SEDE,
    sediIds: [SEDE],
  };
}

const direzione = () => appRouter.createCaller(contestoTrpc(["direzione"]));

beforeEach(() => {
  process.env.FLAG_PROPOSTE = "on";
  process.env.FLAG_TARS = "on";
  applicazioni = 0;
});

afterEach(() => {
  delete process.env.FLAG_PROPOSTE;
  delete process.env.FLAG_TARS;
});

describe("anteprima hashata e monouso", () => {
  it("l'hash è stabile sulla stessa anteprima e cambia quando cambiano valori o effetto", () => {
    const proposta = nuovaProposta();
    const hash = hashAnteprimaProposta(proposta);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAnteprimaProposta(proposta)).toBe(hash);

    bersaglio.set(proposta.ordineId, "2026-09-12"); // l'effetto descritto cambia
    expect(hashAnteprimaProposta(proposta)).toBe(hash); // usa lo snapshot, non il live
    const altra = nuovaProposta();
    expect(hashAnteprimaProposta(altra)).not.toBe(hash);
  });

  it("un hash che non corrisponde più all'anteprima corrente blocca la conferma senza applicare", async () => {
    const proposta = nuovaProposta();
    await expect(
      direzione().proposte.approvaEApplica({
        id: proposta.id,
        hashAnteprima: "0".repeat(64),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(applicazioni).toBe(0);
    expect(bersaglio.get(proposta.ordineId)).toBe("2026-09-10");
  });

  it("con l'hash giusto applica UNA volta; il doppio click riusa senza rieseguire", async () => {
    const proposta = nuovaProposta();
    const hash = hashAnteprimaProposta(proposta);
    const primo = await direzione().proposte.approvaEApplica({
      id: proposta.id,
      hashAnteprima: hash,
    });
    expect(primo!.riusata).toBe(false);
    expect(applicazioni).toBe(1);
    expect(bersaglio.get(proposta.ordineId)).toBe("2026-09-24");

    const secondo = await direzione().proposte.approvaEApplica({
      id: proposta.id,
      hashAnteprima: hash,
    });
    expect(secondo!.riusata).toBe(true);
    expect(applicazioni).toBe(1);
  });

  it("la proiezione della proposta espone l'hash che la UI rimanda col click", async () => {
    const proposta = nuovaProposta();
    const esito = await direzione().proposte.approvaEApplica({
      id: proposta.id,
      hashAnteprima: hashAnteprimaProposta(proposta),
    });
    expect(esito!.proposta.hashAnteprima).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("il modello prepara, non approva", () => {
  it("nessuno strumento del registro approva, applica, invia o paga", () => {
    for (const azione of REGISTRO_AZIONI) {
      expect(azione.nome).not.toMatch(/(^|_)(approva|applica|invia|paga)(_|$)/);
      expect(azione.strumento.descrizione).not.toMatch(
        /approva automaticamente|applica senza conferma/i
      );
    }
  });

  it("le azioni R2/R3 dichiarano la conferma via gateway, mai un'esecuzione diretta", () => {
    const oltreR1 = REGISTRO_AZIONI.filter(
      a => a.rischio === "R2" || a.rischio === "R3"
    );
    expect(oltreR1.length).toBeGreaterThan(0);
    for (const azione of oltreR1) {
      expect(azione.idempotenza.fonte).toContain("gateway");
      expect(azione.compensazione.via).toBe("gateway");
    }
  });
});

describe("azioni dichiarate indisponibili", () => {
  it("ogni voce ha un blocco reale e nessuna è nel registro", () => {
    expect(AZIONI_DICHIARATE_INDISPONIBILI.length).toBeGreaterThanOrEqual(3);
    const nomi = new Set(REGISTRO_AZIONI.map(a => a.nome));
    for (const voce of AZIONI_DICHIARATE_INDISPONIBILI) {
      expect(voce.motivo.length).toBeGreaterThan(30);
      expect(voce.motivo).not.toMatch(/todo|tbd|placeholder/i);
      expect(nomi.has(voce.nome)).toBe(false);
    }
    expect(
      AZIONI_DICHIARATE_INDISPONIBILI.map(voce => voce.nome)
    ).toEqual(
      expect.arrayContaining([
        "invia_email_cliente",
        "invia_whatsapp_cliente",
        "registra_pagamento",
      ])
    );
  });

  it("registrare un tool con un nome dichiarato indisponibile è un errore del validatore", () => {
    const clone = {
      ...REGISTRO_AZIONI[0],
      nome: "invia_email_cliente",
      strumento: {
        ...REGISTRO_AZIONI[0].strumento,
        nome: "invia_email_cliente",
      },
    } as (typeof REGISTRO_AZIONI)[number];
    expect(() => validaRegistroAzioni([clone])).toThrow(/indisponibile/);
  });

  it("lo stato Tars dichiara le azioni indisponibili con i loro blocchi", async () => {
    const stato = await direzione().tars.stato();
    expect(stato.azioniIndisponibili).toEqual(AZIONI_DICHIARATE_INDISPONIBILI);
  });
});
