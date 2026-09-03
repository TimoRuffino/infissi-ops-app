// «porta la commessa 393 su finiture»: 393 è il progressivo del codice
// (COM-2026-393), mai l'id del database (04/09/2026 notte: Tars ha mosso la
// commessa con id 393, cioè COM-2026-385, e scavalcato cinque gate).

import { describe, expect, it } from "vitest";
import { getCommesseStore } from "../../routers/commesse";
import { estraiProgressivoCommessa, risolviCommessa } from "./resolver";

const SEDE = 97_701;

{
  const commesse = getCommesseStore() as any[];
  const fixture = [
    { id: 990_393, codice: "COM-2026-393", cliente: "Guerrero Medina Herminia Milauri" },
    { id: 990_394, codice: "COM-2025-393", cliente: "Pratica Vecchia" },
    { id: 990_385, codice: "COM-2026-385", cliente: "D'Isanto Antonella" },
    { id: 990_012, codice: "COM-2025-012", cliente: "Dodici Primo" },
    { id: 990_013, codice: "COM-2024-012", cliente: "Dodici Secondo" },
  ];
  for (const c of fixture) {
    if (!commesse.some(x => x.id === c.id)) {
      commesse.push({ ...c, sedeId: SEDE, stato: "produzione", archivedAt: null, costi: [], pagamenti: [] });
    }
  }
}

describe("estraiProgressivoCommessa", () => {
  it("legge il numero solo accanto alla parola commessa", () => {
    expect(estraiProgressivoCommessa("porta la commessa 393 su finiture")).toBe(393);
    expect(estraiProgressivoCommessa("commessa n. 96, chiudila")).toBe(96);
    expect(estraiProgressivoCommessa("la pratica #12")).toBe(12);
    expect(estraiProgressivoCommessa("quanto costa 393 euro")).toBeNull();
    expect(estraiProgressivoCommessa("commessa 2026-393")).toBeNull(); // è un codice, non un progressivo
  });
});

describe("risolviCommessa con il numero nudo", () => {
  it("«la commessa 393» è COM-2026-393 (anno corrente), non l'id 393", () => {
    const esito = risolviCommessa({ sedeId: SEDE, riferimento: "porta la commessa 393 su finiture" });
    expect(esito.stato).toBe("unico");
    if (esito.stato === "unico") {
      expect(esito.candidato.codice).toBe("COM-2026-393");
      expect(esito.candidato.commessaId).toBe(990_393);
    }
  });

  it("lo stesso progressivo in due anni passati è ambiguo; il codice completo resta sovrano", () => {
    const ambiguo = risolviCommessa({ sedeId: SEDE, riferimento: "commessa 12" });
    expect(ambiguo.stato).toBe("ambiguo");
    const esplicito = risolviCommessa({ sedeId: SEDE, riferimento: "intendo la commessa COM-2026-393" });
    expect(esplicito.stato).toBe("unico");
    if (esplicito.stato === "unico") expect(esplicito.candidato.codice).toBe("COM-2026-393");
  });

  it("un numero senza «commessa» accanto non è un riferimento", () => {
    expect(risolviCommessa({ sedeId: SEDE, riferimento: "porta la 393 su finiture" }).stato).toBe(
      "non_trovato"
    );
  });
});
