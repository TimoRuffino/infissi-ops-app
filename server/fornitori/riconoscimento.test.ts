// Il riconoscitore di una sede: dall'anagrafica quando l'interruttore è
// acceso, dal seed della Ruffino quando è spento — e a spento il
// comportamento deve essere identico a quello di prima del 10/09/2026.
//
// L'interruttore si dichiara in ogni test: in `NODE_ENV=test` il default è
// ACCESO (interruttori.ts, «fail closed» solo fuori dagli ambienti di
// lavoro), quindi affidarsi al default renderebbe il test una fotografia di
// quella scelta invece che del riconoscitore.
import { afterEach, describe, expect, it } from "vitest";
import { riconoscitoreDiRipiego, riconoscitoreDiSede } from "./riconoscimento";
import { storeFornitori } from "./anagrafica";

const SEDE = 96_501;
const ALTRA_SEDE = 96_502;

function interruttore(stato: "on" | "off"): void {
  process.env.FLAG_FORNITORI_AZIENDA = stato;
}
afterEach(() => {
  delete process.env.FLAG_FORNITORI_AZIENDA;
});

function censisci(sedeId: number, ragioneSociale: string, chiavi: string[], portali: string[] = []) {
  storeFornitori.items.push({
    id: storeFornitori.prossimoId(),
    sedeId,
    ragioneSociale,
    categoria: "altro",
    attivo: true,
    chiavi,
    canale: portali.length ? "portale" : "mail",
    portaleDomini: portali,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
}

describe("riconoscitoreDiSede", () => {
  it("a interruttore spento vale il seed della Ruffino, com'era", () => {
    interruttore("off");
    expect(riconoscitoreDiSede(SEDE).nome(null, "v.gregori@aliasblindate.com")).toBe("Alias");
    expect(riconoscitoreDiSede(SEDE).nome(null, "noreply@antenore.biz")).toBe("Wnd");
  });

  it("il ripiego è il seed, qualunque cosa dica l'interruttore", () => {
    interruttore("on");
    expect(riconoscitoreDiRipiego().nome(null, "ordini@pailporte.com")).toBe("Pail");
  });

  it("a interruttore acceso vale l'anagrafica della sede, e solo la sua", () => {
    interruttore("on");
    censisci(SEDE, "Vetreria Bianchi", ["vetreriabianchi"]);
    censisci(ALTRA_SEDE, "Ferramenta Rossi", ["ferramentarossi"]);

    const mio = riconoscitoreDiSede(SEDE);
    expect(mio.nome(null, "ordini@vetreriabianchi.it")).toBe("Vetreria Bianchi");
    // Il fornitore di un'altra sede non esiste qui.
    expect(mio.nome(null, "ordini@ferramentarossi.it")).toBeNull();
    // E Alias è del seed: a interruttore acceso non lo conosce nessuno finché
    // qualcuno non lo censisce.
    expect(mio.nome(null, "v.gregori@aliasblindate.com")).toBeNull();
  });

  it("il portale di un fornitore censito riconduce al fornitore", () => {
    interruttore("on");
    censisci(SEDE + 10, "Wnd", ["wnd"], ["antenore"]);
    expect(riconoscitoreDiSede(SEDE + 10).nome(null, "noreply@antenore.biz")).toBe("Wnd");
  });

  it("un'anagrafica vuota non riconosce nessun mittente, mai tutti", () => {
    interruttore("on");
    const vuoto = riconoscitoreDiSede(SEDE + 20);
    expect(vuoto.nome(null, "v.gregori@aliasblindate.com")).toBeNull();
    expect(new RegExp(vuoto.sorgenteMittenti(), "i").test("chiunque@ovunque.it")).toBe(false);
  });

  it("non tiene una cache: un fornitore censito adesso si riconosce subito", () => {
    interruttore("on");
    const sede = SEDE + 30;
    expect(riconoscitoreDiSede(sede).nome(null, "ordini@citea.it")).toBeNull();
    censisci(sede, "Citea", ["citea"]);
    expect(riconoscitoreDiSede(sede).nome(null, "ordini@citea.it")).toBe("Citea");
  });
});
