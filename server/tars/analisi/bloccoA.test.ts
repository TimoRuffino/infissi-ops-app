// Blocco A del piano «Tars più intelligente» (08/09/2026):
//   7. le fonti mute — Tars deve accorgersi di quando è cieco;
//   1. la merce ordinata entra nella fotografia;
//  16. la variazione rispetto all'ultima analisi;
//   2. gli strumenti proponibili si derivano dal registro;
//  20. nessun elenco è tagliato in silenzio.

import { describe, expect, it } from "vitest";
import { analisiDeterministica } from "./analisi";
import { costruisciFotografia, type DipendenzeFotografia } from "./fotografia";
import { guastiDiSede, ORE_CASELLA_FERMA, ORE_FIC_FERMO } from "./guasti";
import { STRUMENTI_MAI_PROPOSTI, strumentiProponibili } from "./proponibili";

const SEDE = 97_301;
const ALTRA = 97_302;
const ADESSO = new Date("2026-09-08T07:30:00+02:00");
const oreFa = (n: number) => new Date(ADESSO.getTime() - n * 3_600_000);

function casella(patch: Record<string, unknown> = {}) {
  return {
    id: 1,
    sedeId: SEDE,
    nome: "Ordini",
    attiva: true,
    ultimaSync: oreFa(1),
    ultimoErrore: null,
    ...patch,
  } as any;
}

function depsGuasti(patch: Record<string, unknown> = {}) {
  return {
    caselle: () => [casella()],
    whatsapp: () => [],
    fic: () => null,
    ...patch,
  } as any;
}

describe("occhi chiusi (punto 7)", () => {
  it("una casella che va bene non è un guasto", () => {
    expect(guastiDiSede({ sedeId: SEDE, adesso: ADESSO, deps: depsGuasti() })).toEqual([]);
  });

  it("la casella in errore ferma tutto, e il motivo arriva senza indirizzi né token", () => {
    const deps = depsGuasti({
      caselle: () => [
        casella({
          ultimoErrore: "AUTHENTICATIONFAILED per ordini@ruffinogroup.it token abc123\nstack…",
        }),
      ],
    });
    const [guasto] = guastiDiSede({ sedeId: SEDE, adesso: ADESSO, deps });
    expect(guasto.gravita).toBe("ferma");
    expect(guasto.testo).toContain("Ordini");
    expect(guasto.testo).toContain("nessuna conferma d'ordine");
    expect(guasto.testo).not.toContain("ordini@ruffinogroup.it");
    expect(guasto.testo).not.toContain("abc123");
    expect(guasto.testo).not.toContain("stack");
    // Anche un id opaco lungo, che nessun messaggio d'errore dovrebbe
    // portarsi dietro fin dentro la pagina.
    expect(
      guastiDiSede({
        sedeId: SEDE,
        adesso: ADESSO,
        deps: depsGuasti({
          caselle: () => [casella({ ultimoErrore: "rifiutato EAAG9ZBk1ZCZAoBO7ZCxQZDZD8ZAt" })],
        }),
      })[0].testo
    ).not.toContain("EAAG9ZBk1ZCZAoBO7ZCxQZDZD8ZAt");
  });

  it("una casella muta da più di sei ore è ferma, a cinque no", () => {
    const con = (ore: number) =>
      guastiDiSede({
        sedeId: SEDE,
        adesso: ADESSO,
        deps: depsGuasti({ caselle: () => [casella({ ultimaSync: oreFa(ore) })] }),
      });
    expect(con(ORE_CASELLA_FERMA - 1)).toEqual([]);
    expect(con(ORE_CASELLA_FERMA + 1)).toHaveLength(1);
    expect(con(ORE_CASELLA_FERMA + 1)[0].testo).toContain("nessuna sincronizzazione");
  });

  it("caselle spente e caselle di un'altra sede non contano", () => {
    const deps = depsGuasti({
      caselle: () => [
        casella({ id: 2, attiva: false, ultimoErrore: "rotta" }),
        casella({ id: 3, sedeId: ALTRA, ultimoErrore: "rotta" }),
      ],
    });
    expect(guastiDiSede({ sedeId: SEDE, adesso: ADESSO, deps })).toEqual([]);
  });

  it("WhatsApp in errore è un occhio chiuso: i file dei clienti possono non arrivare", () => {
    const deps = depsGuasti({
      whatsapp: () => [
        { id: 9, sedeId: SEDE, nome: "Numero ufficio", attiva: true, ultimoErrore: "190 token scaduto" },
        { id: 10, sedeId: SEDE, nome: "Spento", attiva: false, ultimoErrore: "rotto" },
      ],
    });
    const guasti = guastiDiSede({ sedeId: SEDE, adesso: ADESSO, deps });
    expect(guasti).toHaveLength(1);
    expect(guasti[0].chiave).toBe("whatsapp:9");
  });

  it("Fatture in Cloud: senza refresh token è fermo, vecchio di due giorni è rallentato", () => {
    const scollegato = guastiDiSede({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: depsGuasti({
        fic: () => ({
          enabled: true,
          authMode: "oauth",
          refreshTokenCifrato: null,
          accessTokenExpiresAt: oreFa(2),
          lastSyncAt: oreFa(2),
          lastResult: "ok",
        }),
      }),
    });
    expect(scollegato[0].gravita).toBe("ferma");
    expect(scollegato[0].testo).toContain("ricollegato");

    const vecchio = guastiDiSede({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: depsGuasti({
        fic: () => ({
          enabled: true,
          authMode: "oauth",
          refreshTokenCifrato: "v1.xxx",
          accessTokenExpiresAt: null,
          lastSyncAt: oreFa(ORE_FIC_FERMO + 5),
          lastResult: "ok",
        }),
      }),
    });
    expect(vecchio[0].gravita).toBe("rallentata");
  });

  it("Fatture in Cloud spento non è un guasto: non è acceso, non deve vedere", () => {
    const deps = depsGuasti({ fic: () => ({ enabled: false, authMode: "oauth" }) });
    expect(guastiDiSede({ sedeId: SEDE, adesso: ADESSO, deps })).toEqual([]);
  });
});

// ── la fotografia ────────────────────────────────────────────────────────

function depsVuote(patch: Partial<DipendenzeFotografia> = {}): DipendenzeFotografia {
  return {
    commesse: () => [],
    ticket: () => [],
    interventi: () => [],
    casiAperti: async () => [],
    osservazioniAperte: async () => [],
    pattern: async () => null,
    smistamento: async () => null,
    proposteGateway: () => [],
    ultimeComunicazioni: async () => new Map(),
    attivita: () => ({ giorni: 1, fonte: "documento" }),
    fatture: () => [],
    statoFattura: () => "attesa_incasso",
    gate: () => ({ ok: true, mancano: [] }),
    ordini: () => [],
    confermeMancanti: async () => [],
    confermeSenzaCosto: async () => [],
    consegne: () => [],
    guasti: () => [],
    ...patch,
  };
}

const consegna = (patch: Record<string, unknown> = {}) => ({
  prodottoId: 1,
  fornitore: "Alias",
  nome: "PORTA BLIND.STEEL/C",
  quantita: 1,
  articoli: [],
  dataConsegna: "2026-08-30",
  prontaDal: null,
  arrivato: false,
  numeroOrdine: "CV0031",
  documentoId: null,
  fileUrl: null,
  commessa: { id: 12, codice: "COM-2026-012", cliente: "De Nino Gianluca", stato: "attesa_posa" },
  giorniDiRitardo: 9,
  ...patch,
});

describe("la merce entra nella fotografia (punto 1)", () => {
  it("la consegna in ritardo dice fornitore, cliente, stato e giorni", async () => {
    const foto = await costruisciFotografia({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: depsVuote({ consegne: () => [consegna()] as any }),
    });
    const sezione = foto.sezioni.find(s => s.chiave === "magazzino")!;
    expect(sezione.fatti[0].testo).toContain("Alias");
    expect(sezione.fatti[0].testo).toContain("De Nino Gianluca");
    expect(sezione.fatti[0].testo).toContain("attesa_posa");
    expect(sezione.fatti[0].testo).toContain("9 giorni di ritardo");
    expect(sezione.fatti[0].entita).toContain("commessa:12");
    expect(foto.contatori.merceInRitardo).toBe(1);
  });

  it("una riga senza data non è un ritardo: è un buco, e si dice", async () => {
    const foto = await costruisciFotografia({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: depsVuote({
        consegne: () => [consegna({ dataConsegna: null, giorniDiRitardo: 0 })] as any,
      }),
    });
    const sezione = foto.sezioni.find(s => s.chiave === "magazzino")!;
    expect(foto.contatori.merceInRitardo).toBe(0);
    expect(foto.contatori.merceSenzaDataConsegna).toBe(1);
    expect(sezione.fatti.some(f => f.chiave === "consegne:senza_data")).toBe(true);
  });
});

describe("occhi chiusi e derivata nella fotografia (punti 7 e 16)", () => {
  it("i guasti stanno in cima a tutto: si leggono prima di dire che va bene", async () => {
    const foto = await costruisciFotografia({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: depsVuote({
        guasti: () => [
          { chiave: "casella:1", testo: "Casella «Ordini»: ferma.", gravita: "ferma", link: "/impostazioni" },
        ],
      }),
    });
    expect(foto.sezioni[0].chiave).toBe("guasti");
    expect(foto.contatori.fontiCieche).toBe(1);
  });

  it("senza analisi precedente non nasce nessun confronto inventato", async () => {
    const foto = await costruisciFotografia({ sedeId: SEDE, adesso: ADESSO, deps: depsVuote() });
    expect(foto.sezioni.some(s => s.chiave === "derivata")).toBe(false);
  });

  it("il confronto dice il numero di oggi, il segno e quello di ieri", async () => {
    const foto = await costruisciFotografia({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: depsVuote({ consegne: () => [consegna(), consegna({ prodottoId: 2 })] as any }),
      contatoriPrecedenti: { merceInRitardo: 1, commesseAttive: 0 },
    });
    const derivata = foto.sezioni.find(s => s.chiave === "derivata")!;
    const riga = derivata.fatti.find(f => f.chiave === "derivata:merceInRitardo")!;
    expect(riga.testo).toContain("Consegne in ritardo: 2");
    expect(riga.testo).toContain("+1");
    expect(riga.testo).toContain("erano 1");
    // Un contatore identico non è una variazione: non occupa una riga.
    expect(derivata.fatti.some(f => f.chiave === "derivata:commesseAttive")).toBe(false);
  });
});

describe("nessun taglio silenzioso (punto 20)", () => {
  it("oltre il limite la fotografia dice quante righe restano fuori", async () => {
    const tante = Array.from({ length: 14 }, (_, i) =>
      consegna({ prodottoId: 100 + i, giorniDiRitardo: 20 - i })
    );
    const foto = await costruisciFotografia({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: depsVuote({ consegne: () => tante as any }),
    });
    const sezione = foto.sezioni.find(s => s.chiave === "magazzino")!;
    const resto = sezione.fatti.find(f => f.chiave.startsWith("resto:"))!;
    expect(resto.testo).toContain("E altre 6");
    expect(resto.testo).toContain("consegne in ritardo");
  });
});

describe("strumenti proponibili derivati dal registro (punto 2)", () => {
  const proponibili = strumentiProponibili();

  it("i dieci di prima ci sono ancora tutti", () => {
    for (const nome of [
      "crea_ticket",
      "aggiorna_ticket",
      "pianifica_intervento",
      "crea_promemoria",
      "collega_comunicazione",
      "collega_fattura_commessa",
      "sposta_documento",
      "archivia_commessa",
      "transizione_adiacente_commessa",
      "archivia_allegato_comunicazione",
    ]) {
      expect(proponibili).toContain(nome);
    }
  });

  it("e ora ce ne sono molti di più: quello che l'utente farebbe a mano", () => {
    expect(proponibili.length).toBeGreaterThan(20);
    expect(proponibili).toContain("aggiorna_commessa");
    expect(proponibili).toContain("chiudi_ticket");
    expect(proponibili).toContain("risolvi_caso");
    expect(proponibili).toContain("segna_intervento_fatto");
  });

  it("soldi, cancellazioni definitive e importazioni massive restano fuori", () => {
    for (const nome of Object.keys(STRUMENTI_MAI_PROPOSTI)) {
      expect(proponibili).not.toContain(nome);
    }
    expect(proponibili).toContain("crea_commessa");
    expect(proponibili).not.toContain("registra_costo_fornitore");
  });

  it("niente letture e niente azioni che vogliono la conferma umana", () => {
    expect(proponibili).not.toContain("leggi_commessa");
    expect(proponibili).not.toContain("cerca_commesse");
    expect(proponibili).not.toContain("proponi_data_consegna");
  });
});

describe("senza modello, il silenzio non diventa una buona notizia", () => {
  it("la sintesi deterministica dice per prime le fonti mute e la merce in ritardo", async () => {
    const foto = await costruisciFotografia({
      sedeId: SEDE,
      adesso: ADESSO,
      deps: depsVuote({
        consegne: () => [consegna()] as any,
        guasti: () => [
          { chiave: "casella:1", testo: "Casella «Ordini»: ferma da 3 giorni.", gravita: "ferma", link: "/impostazioni" },
        ],
      }),
    });
    const esito = analisiDeterministica(foto);
    expect(esito.sintesi).toContain("non stanno più portando dati");
    expect(esito.sintesi).toContain("1 consegne in ritardo");
    expect(esito.punti[0].priorita).toBe("alta");
    expect(esito.punti[0].testo).toContain("Ordini");
    expect(esito.punti.some(p => p.testo.includes("giorni di ritardo"))).toBe(true);
  });
});
