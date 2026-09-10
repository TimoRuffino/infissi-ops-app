// Lo store dei profili: la chiave è (sede, fornitore, impronta), perché un
// fornitore può avere più moduli — Alias manda sia «Ordini_di_Vendi» sia
// «Esportazione».
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { improntaLayout } from "../documenti/impronta";
import {
  azzeraLetturePulite,
  azzeraProfiliPerTest,
  contestoProfilo,
  moduloSconosciuto,
  profiliDiFornitore,
  profiloPerPagine,
  salvaProfilo,
  segnaLetturaPulita,
  storeProfili,
} from "./profili";

const SEDE = 95_301;
const ALTRA = 95_302;
const PAGINE = ["ALIAS Srl Porte blindate\nConferma Ordine\nCV 100 del 01/01/2026"];
const ALTRO_MODULO = ["Pail serramenti\nconferma numero\nRiferimento cliente"];

const ancore = [
  {
    campo: "numeroConferma" as const,
    etichetta: "CV",
    posizione: "dopo_etichetta" as const,
    forma: "numero" as const,
    pagina: 1,
  },
];

const base = (sedeId: number, fornitoreId: number, pagine: readonly string[]) => ({
  sedeId,
  fornitoreId,
  impronta: improntaLayout(pagine),
  ancore,
  blocco: null,
  esempioId: null,
  createdBy: 1,
});

beforeEach(() => {
  // I profili sono uno store di modulo: senza azzerarli un test eredita i
  // profili del precedente, e con la stessa impronta si pestano i piedi.
  azzeraProfiliPerTest();
});
afterEach(() => {
  delete process.env.FLAG_PROFILI_LETTURA;
});

describe("store dei profili", () => {
  it("un profilo si ritrova dalle pagine che hanno la sua impronta", () => {
    const p = salvaProfilo(base(SEDE, 7, PAGINE));
    expect(profiloPerPagine(SEDE, PAGINE)?.id).toBe(p.id);
    expect(profiloPerPagine(SEDE, ALTRO_MODULO)).toBeNull();
  });

  it("il profilo di un'altra sede non si vede", () => {
    salvaProfilo(base(SEDE, 8, PAGINE));
    expect(profiloPerPagine(ALTRA, PAGINE)).toBeNull();
  });

  it("risalvare la stessa impronta aggiorna il profilo e alza la versione", () => {
    const primo = salvaProfilo(base(SEDE, 9, PAGINE));
    // `salvaProfilo` MUTA e restituisce lo stesso oggetto: la versione di
    // prima va letta ora, non dopo.
    const idPrimo = primo.id;
    const versionePrima = primo.versione;
    const secondo = salvaProfilo({ ...base(SEDE, 9, PAGINE), ancore: [] });
    expect(secondo.id).toBe(idPrimo);
    expect(secondo.versione).toBe(versionePrima + 1);
    expect(profiliDiFornitore(SEDE, 9)).toHaveLength(1);
  });

  it("lo stesso fornitore con due moduli ha due profili", () => {
    salvaProfilo(base(SEDE, 10, PAGINE));
    salvaProfilo(base(SEDE, 10, ALTRO_MODULO));
    expect(profiliDiFornitore(SEDE, 10)).toHaveLength(2);
  });

  it("le letture pulite si contano, una correzione le azzera, un'altra sede non tocca niente", () => {
    const p = salvaProfilo(base(SEDE, 11, PAGINE));
    segnaLetturaPulita(p.id, SEDE);
    segnaLetturaPulita(p.id, SEDE);
    expect(storeProfili.items.find(x => x.id === p.id)?.lettureSenzaCorrezione).toBe(2);
    segnaLetturaPulita(p.id, ALTRA);
    expect(storeProfili.items.find(x => x.id === p.id)?.lettureSenzaCorrezione).toBe(2);
    azzeraLetturePulite(p.id, SEDE);
    expect(storeProfili.items.find(x => x.id === p.id)?.lettureSenzaCorrezione).toBe(0);
  });

  it("riscrivere un profilo lo rimette in prova", () => {
    const p = salvaProfilo(base(SEDE, 12, PAGINE));
    segnaLetturaPulita(p.id, SEDE);
    const riscritto = salvaProfilo({ ...base(SEDE, 12, PAGINE), ancore: [] });
    expect(riscritto.lettureSenzaCorrezione).toBe(0);
  });
});

describe("contestoProfilo e moduloSconosciuto", () => {
  it("a interruttore acceso risolve il profilo dalle pagine", () => {
    process.env.FLAG_PROFILI_LETTURA = "on";
    const p = salvaProfilo(base(SEDE, 21, PAGINE));
    const c = contestoProfilo(SEDE, PAGINE);
    expect(c.profiloId).toBe(p.id);
    expect(c.profilo?.ancore).toHaveLength(1);
  });

  it("a interruttore spento non risolve niente, qualunque profilo esista", () => {
    process.env.FLAG_PROFILI_LETTURA = "off";
    salvaProfilo(base(SEDE, 22, PAGINE));
    expect(contestoProfilo(SEDE, PAGINE)).toEqual({ profilo: null, profiloId: null });
  });

  it("un fornitore con profili ma nessuno che combacia ha cambiato modulo", () => {
    process.env.FLAG_PROFILI_LETTURA = "on";
    salvaProfilo(base(SEDE, 33, PAGINE));
    expect(moduloSconosciuto(SEDE, 33, ALTRO_MODULO)).toBe(true);
    expect(moduloSconosciuto(SEDE, 33, PAGINE)).toBe(false);
  });

  it("un fornitore senza profili non ha cambiato niente: non ne ha mai avuti", () => {
    process.env.FLAG_PROFILI_LETTURA = "on";
    expect(moduloSconosciuto(SEDE, 999, PAGINE)).toBe(false);
    expect(moduloSconosciuto(SEDE, null, PAGINE)).toBe(false);
  });

  it("a interruttore spento non si dice niente", () => {
    process.env.FLAG_PROFILI_LETTURA = "off";
    salvaProfilo(base(SEDE, 44, PAGINE));
    expect(moduloSconosciuto(SEDE, 44, ALTRO_MODULO)).toBe(false);
  });
});
