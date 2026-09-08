// Punto 29 del piano «Tars più intelligente»: il documento e il dato non
// dicono la stessa cosa. La discordanza che costa è una sola — la merce
// arriva dopo la posa — e le altre due sono «guarda quale delle due è
// vecchia», non allarmi.

import { describe, expect, it } from "vitest";
import { discordanzeDiSede, type DipendenzeDiscordanze } from "./discordanze";

const SEDE = 96_501;
const ALTRA = 96_502;
const ADESSO = new Date("2026-09-08T08:00:00Z");

const commessa = (patch: Record<string, unknown> = {}) => ({
  id: 12,
  sedeId: SEDE,
  codice: "COM-2026-012",
  cliente: "De Nino Gianluca",
  stato: "attesa_posa",
  archivedAt: null,
  costi: [],
  ...patch,
});

const posa = (patch: Record<string, unknown> = {}) => ({
  id: 40,
  sedeId: SEDE,
  commessaId: 12,
  tipo: "posa",
  stato: "pianificato",
  dataPianificata: "2026-09-17",
  ...patch,
});

const merce = (patch: Record<string, unknown> = {}) => ({
  id: 70,
  sedeId: SEDE,
  commessaId: 12,
  nome: "PORTA BLIND.STEEL/C",
  fornitore: "Alias",
  numeroOrdine: "CV0031",
  dataConsegna: "2026-09-25",
  arrivato: false,
  ...patch,
});

const voce = (patch: Record<string, unknown> = {}) => ({
  id: 1,
  sedeId: SEDE,
  commessaId: 12,
  lettura: {
    numeroOrdine: "CV 0031",
    dataConsegna: "2026-09-25",
    imponibile: 1240,
  },
  ...patch,
});

function deps(patch: Partial<DipendenzeDiscordanze> = {}): DipendenzeDiscordanze {
  return {
    commesse: () => [commessa()],
    interventi: () => [],
    magazzino: () => [],
    archivio: () => [],
    ...patch,
  };
}

const trova = (d: DipendenzeDiscordanze) =>
  discordanzeDiSede({ sedeId: SEDE, adesso: ADESSO, deps: d });

describe("la merce arriva dopo la posa", () => {
  it("lo dice con le due date, i giorni e cosa fare", () => {
    const [d] = trova(deps({ interventi: () => [posa()], magazzino: () => [merce()] }));
    expect(d.gravita).toBe("critica");
    expect(d.testo).toContain("la posa è il 2026-09-17");
    expect(d.testo).toContain("2026-09-25");
    expect(d.testo).toContain("8 giorni dopo");
    expect(d.testo).toContain("De Nino Gianluca");
    expect(d.commessaId).toBe(12);
  });

  it("merce che arriva prima della posa non è una discordanza", () => {
    expect(
      trova(
        deps({
          interventi: () => [posa()],
          magazzino: () => [merce({ dataConsegna: "2026-09-15" })],
        })
      )
    ).toEqual([]);
  });

  it("merce già arrivata non conta, e nemmeno una posa passata", () => {
    expect(
      trova(deps({ interventi: () => [posa()], magazzino: () => [merce({ arrivato: true })] }))
    ).toEqual([]);
    expect(
      trova(
        deps({
          interventi: () => [posa({ dataPianificata: "2026-09-01" })],
          magazzino: () => [merce()],
        })
      )
    ).toEqual([]);
  });

  it("con due pose vale la prima: è quella che trova il cantiere vuoto", () => {
    const [d] = trova(
      deps({
        interventi: () => [posa(), posa({ id: 41, dataPianificata: "2026-09-30" })],
        magazzino: () => [merce()],
      })
    );
    expect(d.testo).toContain("2026-09-17");
  });

  it("una posa annullata non fa suonare niente", () => {
    expect(
      trova(
        deps({ interventi: () => [posa({ stato: "annullato" })], magazzino: () => [merce()] })
      )
    ).toEqual([]);
  });

  it("le sedi non si mescolano", () => {
    expect(
      trova(
        deps({
          commesse: () => [commessa({ sedeId: ALTRA })],
          interventi: () => [posa({ sedeId: ALTRA })],
          magazzino: () => [merce({ sedeId: ALTRA })],
        })
      )
    ).toEqual([]);
  });
});

describe("la conferma e la scheda non concordano", () => {
  it("due date diverse per lo stesso ordine: una delle due è vecchia", () => {
    const [d] = trova(
      deps({
        magazzino: () => [merce({ dataConsegna: "2026-10-02" })],
        archivio: () => [voce()],
      })
    );
    expect(d.gravita).toBe("da_guardare");
    expect(d.testo).toContain("la conferma CV 0031 dice consegna il 2026-09-25");
    expect(d.testo).toContain("a magazzino risulta il 2026-10-02");
  });

  it("il numero d'ordine si confronta senza spazi né trattini", () => {
    expect(
      trova(
        deps({
          magazzino: () => [merce({ numeroOrdine: "cv-0031", dataConsegna: "2026-09-25" })],
          archivio: () => [voce()],
        })
      )
    ).toEqual([]);
  });

  it("costo registrato diverso dalla conferma: lo dice senza scrivere le cifre", () => {
    const [d] = trova(
      deps({
        commesse: () => [
          commessa({ costi: [{ id: 1, numeroOrdine: "CV0031", importo: 980 }] }),
        ],
        archivio: () => [voce()],
      })
    );
    expect(d.testo).toContain("non è quello che dichiara la conferma");
    expect(d.testo).not.toContain("1240");
    expect(d.testo).not.toContain("980");
  });

  it("uno scarto di un euro è arrotondamento, non discordanza", () => {
    expect(
      trova(
        deps({
          commesse: () => [
            commessa({ costi: [{ id: 1, numeroOrdine: "CV0031", importo: 1240.5 }] }),
          ],
          archivio: () => [voce()],
        })
      )
    ).toEqual([]);
  });

  it("una conferma non collegata a nessuna commessa non genera confronti", () => {
    expect(trova(deps({ archivio: () => [voce({ commessaId: null })] }))).toEqual([]);
  });
});

describe("ordine", () => {
  it("la merce dopo la posa viene prima di tutto il resto", () => {
    const righe = trova(
      deps({
        commesse: () => [
          commessa({ costi: [{ id: 1, numeroOrdine: "CV0031", importo: 980 }] }),
        ],
        interventi: () => [posa()],
        magazzino: () => [merce()],
        archivio: () => [voce()],
      })
    );
    expect(righe.map(r => r.gravita)).toEqual(["critica", "da_guardare"]);
  });
});
