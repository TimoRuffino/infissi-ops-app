// L'autonomia è la modifica più rischiosa dell'agente: i confini vanno
// verificati, non solo scritti nel prompt.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contestoAutonomo,
  eseguiProposteAutonome,
  valutaAutonomia,
} from "./runner";
import {
  getTarsConfig,
  proposte,
  saveProposte,
  TIPI_AUTONOMIA_AMMESSI,
  TIPI_IRREVERSIBILI,
} from "../stores";
import { getUtentiStore } from "../../routers/utenti";

const SEDE = 900;

function configuraAutonomia(patch: Partial<any> = {}) {
  const config = getTarsConfig(SEDE);
  config.autonomia = {
    attiva: true,
    killSwitch: false,
    tipiConsentiti: ["nota_timeline", "aggiornamento_magazzino"],
    principalUserId: 7,
    ...patch,
  };
  return config;
}

function registraUtente() {
  const utenti = getUtentiStore();
  if (!utenti.some((u: any) => u.id === 7)) {
    utenti.push({
      id: 7,
      nome: "Alessandro",
      cognome: "Responsabile",
      name: "Alessandro Responsabile",
      attivo: true,
      ruolo: "direzione",
      ruoli: ["direzione"],
      sediIds: [SEDE],
    } as any);
  }
}

function creaProposta(id: number, tipo: any) {
  const proposta: any = {
    id,
    sedeId: SEDE,
    tipo,
    titolo: `Proposta ${id}`,
    motivazione: "test",
    confidenza: "alta",
    payload: {},
    commessaId: 1,
    clienteId: null,
    opzioni: null,
    risposta: null,
    stato: "pendente",
    esito: null,
    motivoRifiuto: null,
    esecuzioneId: null,
    trigger: "on_demand",
    createdAt: new Date(),
    decisaAt: null,
    decisaDa: null,
    decisaDaNome: null,
    seguitoAt: null,
    seguitoEsecuzioneId: null,
    origineId: null,
    requestedByUserId: null,
    evidenceRefs: [],
    correzioni: [],
    hiddenForUserIds: [],
  };
  proposte.push(proposta);
  saveProposte();
  return proposta;
}

beforeEach(() => {
  proposte.length = 0;
  registraUtente();
  configuraAutonomia();
});

describe("valutaAutonomia", () => {
  it("consente un tipo in whitelist con autonomia attiva", () => {
    expect(valutaAutonomia({ sedeId: SEDE, tipo: "nota_timeline" })).toEqual({
      consentito: true,
      motivo: expect.any(String),
    });
  });

  it("nega i tipi irreversibili anche se qualcuno li mette in whitelist", () => {
    configuraAutonomia({ tipiConsentiti: TIPI_IRREVERSIBILI });
    for (const tipo of TIPI_IRREVERSIBILI) {
      const esito = valutaAutonomia({ sedeId: SEDE, tipo });
      expect(esito.consentito).toBe(false);
      expect(esito.motivo).toContain("senza ritorno");
    }
  });

  it("i tipi irreversibili non sono nemmeno proponibili in configurazione", () => {
    for (const tipo of TIPI_IRREVERSIBILI) {
      expect(TIPI_AUTONOMIA_AMMESSI).not.toContain(tipo);
    }
  });

  it("il kill switch nega tutto senza svuotare la whitelist", () => {
    configuraAutonomia({ killSwitch: true });
    expect(valutaAutonomia({ sedeId: SEDE, tipo: "nota_timeline" })).toEqual({
      consentito: false,
      motivo: "kill switch attivo",
    });
  });

  it("senza autonomia attiva nega, anche con whitelist piena", () => {
    configuraAutonomia({ attiva: false });
    expect(
      valutaAutonomia({ sedeId: SEDE, tipo: "nota_timeline" }).consentito
    ).toBe(false);
  });

  it("un tipo fuori whitelist resta all'operatore", () => {
    expect(valutaAutonomia({ sedeId: SEDE, tipo: "pagamento" }).consentito).toBe(
      false
    );
  });

  it("senza responsabile configurato nega", () => {
    configuraAutonomia({ principalUserId: null });
    expect(
      valutaAutonomia({ sedeId: SEDE, tipo: "nota_timeline" }).consentito
    ).toBe(false);
  });
});

describe("contestoAutonomo", () => {
  it("usa l'utente configurato, marcato per l'audit", () => {
    const ctx = contestoAutonomo(SEDE);
    expect((ctx?.user as any)?.id).toBe(7);
    expect((ctx?.user as any)?.autonomo).toBe(true);
    expect(ctx?.sedeId).toBe(SEDE);
  });

  it("nessun contesto se l'utente non è più della sede", () => {
    configuraAutonomia({ principalUserId: 9999 });
    expect(contestoAutonomo(SEDE)).toBeNull();
  });
});

describe("eseguiProposteAutonome", () => {
  it("esegue solo i tipi consentiti e annuncia una volta sola", async () => {
    const consentita = creaProposta(1, "nota_timeline");
    const esclusa = creaProposta(2, "pagamento");
    const approva = vi.fn().mockResolvedValue({ esito: "fatto" });
    const annuncia = vi.fn();

    const azioni = await eseguiProposteAutonome({
      sedeId: SEDE,
      propostaIds: [consentita.id, esclusa.id],
      approva,
      annuncia,
    });

    expect(approva).toHaveBeenCalledTimes(1);
    expect(approva).toHaveBeenCalledWith(1, expect.objectContaining({ sedeId: SEDE }));
    expect(azioni).toEqual([
      expect.objectContaining({ propostaId: 1, eseguita: true }),
    ]);
    expect(annuncia).toHaveBeenCalledTimes(1);
  });

  it("un errore su una proposta non ferma le altre", async () => {
    creaProposta(1, "nota_timeline");
    creaProposta(2, "aggiornamento_magazzino");
    const approva = vi
      .fn()
      .mockRejectedValueOnce(new Error("doc gate"))
      .mockResolvedValueOnce({ esito: "ok" });

    const azioni = await eseguiProposteAutonome({
      sedeId: SEDE,
      propostaIds: [1, 2],
      approva,
    });

    expect(azioni).toEqual([
      expect.objectContaining({ propostaId: 1, eseguita: false, esito: "doc gate" }),
      expect.objectContaining({ propostaId: 2, eseguita: true }),
    ]);
  });

  it("un annuncio fallito non annulla le esecuzioni", async () => {
    creaProposta(1, "nota_timeline");
    const errore = vi.spyOn(console, "error").mockImplementation(() => {});

    const azioni = await eseguiProposteAutonome({
      sedeId: SEDE,
      propostaIds: [1],
      approva: vi.fn().mockResolvedValue({ esito: "ok" }),
      annuncia: () => {
        throw new Error("chat giù");
      },
    });

    expect(azioni).toHaveLength(1);
    expect(errore).toHaveBeenCalled();
    errore.mockRestore();
  });

  it("senza contesto autonomo non esegue niente", async () => {
    configuraAutonomia({ principalUserId: null });
    creaProposta(1, "nota_timeline");
    const approva = vi.fn();

    expect(
      await eseguiProposteAutonome({ sedeId: SEDE, propostaIds: [1], approva })
    ).toEqual([]);
    expect(approva).not.toHaveBeenCalled();
  });

  it("ignora una proposta già decisa", async () => {
    const proposta = creaProposta(1, "nota_timeline");
    proposta.stato = "approvata";
    const approva = vi.fn();

    await eseguiProposteAutonome({ sedeId: SEDE, propostaIds: [1], approva });
    expect(approva).not.toHaveBeenCalled();
  });

  it("ignora una proposta di un'altra sede", async () => {
    const proposta = creaProposta(1, "nota_timeline");
    proposta.sedeId = SEDE + 1;
    const approva = vi.fn();

    await eseguiProposteAutonome({ sedeId: SEDE, propostaIds: [1], approva });
    expect(approva).not.toHaveBeenCalled();
  });
});
