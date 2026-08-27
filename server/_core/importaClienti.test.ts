// Un doppione in anagrafica si propaga per anni: due schede per la stessa
// persona, commesse spartite, fatture che agganciano quella sbagliata. Il
// valore di questo import è quello che NON crea, quindi è lì che va guardato.

import { describe, expect, it, vi } from "vitest";
import {
  chiaveLarga,
  importaClienti,
  leggiRighe,
  normKeyNome,
  normFiscale,
  parseCsv,
  type ClienteEsistente,
  type RigaImport,
} from "./importaClienti";

const riga = (extra: Partial<RigaImport> = {}): RigaImport => ({
  denominazione: "",
  indirizzo: "",
  comune: "",
  cap: "",
  provincia: "",
  email: "",
  referente: "",
  telefono: "",
  partitaIva: "",
  codiceFiscale: "",
  note: "",
  ...extra,
});

function deps(esistenti: ClienteEsistente[] = []) {
  return {
    clientiEsistenti: esistenti,
    sedeId: 1,
    crea: vi.fn().mockReturnValue(999),
    arricchisci: vi.fn(),
    salva: vi.fn(),
    // Semplificati: la versione vera arriva da fattureInCloud e resta testata lì.
    isAzienda: (nome: string) => /\b(srl|spa|snc|sas)\b/i.test(nome),
    dividiPersona: (nome: string) => {
      const t = nome.trim().split(/\s+/);
      return { cognome: t[0] ?? nome, nome: t.slice(1).join(" ") || nome };
    },
  };
}

describe("parseCsv", () => {
  it("regge virgolette, virgole e ritorni a capo dentro un campo", () => {
    const righe = parseCsv('a,b\n"uno, due","tre\nquattro"\n');
    expect(righe).toEqual([
      ["a", "b"],
      ["uno, due", "tre\nquattro"],
    ]);
  });

  it("regge le virgolette raddoppiate", () => {
    expect(parseCsv('x\n"dice ""ciao"""')).toEqual([["x"], ['dice "ciao"']]);
  });
});

describe("leggiRighe", () => {
  it("mappa le intestazioni dell'export FiC", () => {
    const csv = [
      "Denominazione,Indirizzo,Comune,CAP,Provincia,Indirizzo e-mail,Referente,Telefono,P.IVA/TAX ID,Codice Fiscale,Note",
      "Rossi Mario,Via Roma 1,Sarzana,19038,SP,m@r.it,,3451234567,,RSSMRA80A01H501U,nota",
    ].join("\n");
    expect(leggiRighe(csv)[0]).toMatchObject({
      denominazione: "Rossi Mario",
      comune: "Sarzana",
      email: "m@r.it",
      telefono: "3451234567",
      codiceFiscale: "RSSMRA80A01H501U",
    });
  });

  it("non si rompe se una colonna attesa manca", () => {
    const letto = leggiRighe("Denominazione\nSolo Nome");
    expect(letto).toHaveLength(1);
    expect(letto[0].telefono).toBe("");
  });
});

describe("normalizzazioni", () => {
  it("il nome collide comunque sia ordinato o accentato", () => {
    expect(normKeyNome("Rossi Mario")).toBe(normKeyNome("MARIO  rossi"));
    expect(normKeyNome("Nicolò Rossi")).toBe(normKeyNome("ROSSI NICOLO"));
  });

  it("la chiave larga supera anche l'apostrofo, che normKey conserva", () => {
    // `normKey` è quella del sync FiC e tiene l'apostrofo: qui le due forme
    // NON collidono, ed è il motivo per cui esiste la chiave larga.
    expect(normKeyNome("Nicolò D'Amico")).not.toBe(normKeyNome("D AMICO NICOLO"));
    expect(chiaveLarga("Nicolò D'Amico")).toBe(chiaveLarga("D AMICO NICOLO"));
  });

  it("la partita IVA perde il prefisso IT", () => {
    expect(normFiscale("IT01172230110", true)).toBe("01172230110");
    expect(normFiscale(" rss mra 80a01h501u ")).toBe("RSSMRA80A01H501U");
  });
});

describe("importaClienti — riconoscimento", () => {
  it("riconosce per partita IVA anche con nome diverso", () => {
    const d = deps([
      { id: 1, sedeId: 1, cognome: "ABC", nome: " ", partitaIva: "01172230110" },
    ]);
    const r = importaClienti(
      [riga({ denominazione: "ABC Sas di Tizio", partitaIva: "IT01172230110" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(r.creati).toBe(0);
    expect(r.giaPresenti).toBe(1);
    expect(d.crea).not.toHaveBeenCalled();
  });

  it("riconosce per codice fiscale", () => {
    const d = deps([
      {
        id: 2,
        sedeId: 1,
        cognome: "Rossi",
        nome: "Mario",
        codiceFiscale: "RSSMRA80A01H501U",
      },
    ]);
    const r = importaClienti(
      [riga({ denominazione: "Mario Rossi", codiceFiscale: "rssmra80a01h501u" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(r.giaPresenti).toBe(1);
    expect(r.esiti[0]).toMatchObject({ criterio: "codice_fiscale" });
  });

  it("riconosce per nome comunque ordinato", () => {
    const d = deps([{ id: 3, sedeId: 1, cognome: "Bello", nome: "Adele" }]);
    const r = importaClienti(
      [riga({ denominazione: "Adele Bello" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(r.giaPresenti).toBe(1);
    expect(r.esiti[0]).toMatchObject({ criterio: "nome" });
  });

  it("crea chi non c'è", () => {
    const d = deps([{ id: 3, sedeId: 1, cognome: "Bello", nome: "Adele" }]);
    const r = importaClienti(
      [riga({ denominazione: "Verdi Giuseppe" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(r.creati).toBe(1);
    expect(d.crea).toHaveBeenCalledTimes(1);
    expect(d.salva).toHaveBeenCalled();
  });

  it("un cliente di un'altra sede non conta come già presente", () => {
    const d = deps([{ id: 4, sedeId: 2, cognome: "Bello", nome: "Adele" }]);
    const r = importaClienti(
      [riga({ denominazione: "Adele Bello" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(r.creati).toBe(1);
  });
});

describe("importaClienti — doppioni dentro il file", () => {
  it("la stessa persona ripetuta viene creata una volta sola", () => {
    const d = deps();
    const r = importaClienti(
      [
        riga({ denominazione: "Verdi Giuseppe" }),
        riga({ denominazione: "GIUSEPPE  verdi" }),
      ],
      { apply: true, arricchisci: false },
      d
    );
    expect(r.creati).toBe(1);
    expect(r.duplicatiNelFile).toBe(1);
    expect(d.crea).toHaveBeenCalledTimes(1);
  });

  it("stessa partita IVA con ragioni sociali diverse: una sola", () => {
    const d = deps();
    const r = importaClienti(
      [
        riga({ denominazione: "Alfa Srl", partitaIva: "01172230110" }),
        riga({ denominazione: "Alfa Srl Unipersonale", partitaIva: "IT01172230110" }),
      ],
      { apply: true, arricchisci: false },
      d
    );
    expect(r.creati).toBe(1);
    expect(r.duplicatiNelFile).toBe(1);
  });
});

describe("importaClienti — arricchimento", () => {
  it("riempie solo i campi vuoti e non sovrascrive mai", () => {
    const d = deps([
      {
        id: 5,
        sedeId: 1,
        cognome: "Rossi",
        nome: "Mario",
        email: "vecchia@example.it",
        telefono: null,
      },
    ]);
    importaClienti(
      [
        riga({
          denominazione: "Rossi Mario",
          email: "nuova@example.it",
          telefono: "3451234567",
        }),
      ],
      { apply: true, arricchisci: true },
      d
    );
    expect(d.arricchisci).toHaveBeenCalledWith(5, {
      telefono: "3451234567",
    });
  });

  it("senza --arricchisci non tocca niente", () => {
    const d = deps([{ id: 5, sedeId: 1, cognome: "Rossi", nome: "Mario" }]);
    importaClienti(
      [riga({ denominazione: "Rossi Mario", telefono: "345" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(d.arricchisci).not.toHaveBeenCalled();
  });
});

describe("importaClienti — simulazione e scarti", () => {
  it("il dry-run conta senza scrivere", () => {
    const d = deps();
    const r = importaClienti(
      [riga({ denominazione: "Verdi Giuseppe" })],
      { apply: false, arricchisci: true },
      d
    );
    expect(r.creati).toBe(1);
    expect(r.dryRun).toBe(true);
    expect(d.crea).not.toHaveBeenCalled();
    expect(d.salva).not.toHaveBeenCalled();
  });

  it("scarta le righe senza denominazione utile", () => {
    const d = deps();
    const r = importaClienti(
      [riga({ denominazione: "" }), riga({ denominazione: "-" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(r.scartati).toBe(2);
    expect(r.creati).toBe(0);
  });
});

describe("importaClienti — tipo del cliente", () => {
  it("una partita IVA reale fa azienda", () => {
    const d = deps();
    importaClienti(
      [riga({ denominazione: "Qualcosa", partitaIva: "01172230110" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(d.crea).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "azienda", cognome: "Qualcosa" })
    );
  });

  it("condominio ha il suo tipo", () => {
    const d = deps();
    importaClienti(
      [riga({ denominazione: "Condominio Via Roma 4" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(d.crea).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "condominio" })
    );
  });

  it("un codice fiscale non valido non finisce nel campo", () => {
    const d = deps();
    importaClienti(
      [riga({ denominazione: "Verdi Giuseppe", codiceFiscale: "12345" })],
      { apply: true, arricchisci: false },
      d
    );
    expect(d.crea).toHaveBeenCalledWith(
      expect.objectContaining({ codiceFiscale: undefined, tipo: "privato" })
    );
  });
});
