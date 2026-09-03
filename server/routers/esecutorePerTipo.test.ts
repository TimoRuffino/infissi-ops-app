// Chi esegue un intervento dipende dal tipo, e sono due insiemi di persone
// diversi: un rilievo lo fa un tecnico dei rilievi, una posa una squadra di
// posa. Il form lo propone, ma la regola vera sta nel dominio — questi casi
// fissano cosa succede quando i due campi arrivano entrambi pieni, o quando
// un intervento cambia tipo dopo essere già stato assegnato.
//
// L'errore che questi test impediscono è concreto: un rilievo che resta
// assegnato a una squadra di posa, e una squadra che si presenta a un
// appuntamento che non le compete.
import { describe, expect, it } from "vitest";

import { esecutorePerTipo } from "./interventi";

describe("esecutorePerTipo", () => {
  it("un rilievo tiene il tecnico e lascia andare la squadra", () => {
    expect(
      esecutorePerTipo({ tipo: "rilievo", squadraId: 3, tecnicoId: 7 })
    ).toEqual({ squadraId: null, tecnicoId: 7 });
  });

  it("una posa tiene la squadra e lascia andare il tecnico", () => {
    expect(
      esecutorePerTipo({ tipo: "posa", squadraId: 3, tecnicoId: 7 })
    ).toEqual({ squadraId: 3, tecnicoId: null });
  });

  it("assistenza e altro seguono la posa: li fa una squadra", () => {
    for (const tipo of ["assistenza", "altro"]) {
      expect(esecutorePerTipo({ tipo, squadraId: 3, tecnicoId: 7 })).toEqual({
        squadraId: 3,
        tecnicoId: null,
      });
    }
  });

  it("un tipo mancante non è un rilievo: non si inventa un tecnico", () => {
    expect(esecutorePerTipo({ squadraId: 3, tecnicoId: 7 })).toEqual({
      squadraId: 3,
      tecnicoId: null,
    });
  });

  it("i campi assenti diventano null, non undefined", () => {
    expect(esecutorePerTipo({ tipo: "rilievo" })).toEqual({
      squadraId: null,
      tecnicoId: null,
    });
    expect(esecutorePerTipo({ tipo: "posa" })).toEqual({
      squadraId: null,
      tecnicoId: null,
    });
  });

  it("una posa che diventa rilievo perde la squadra", () => {
    // È il caso vero: l'intervento esiste già con una squadra, qualcuno
    // corregge il tipo. La squadra non deve sopravvivere al cambio.
    const esistente = { squadraId: 3, tecnicoId: null };
    expect(esecutorePerTipo({ ...esistente, tipo: "rilievo" })).toEqual({
      squadraId: null,
      tecnicoId: null,
    });
  });

  it("un rilievo che diventa posa perde il tecnico", () => {
    const esistente = { squadraId: null, tecnicoId: 7 };
    expect(esecutorePerTipo({ ...esistente, tipo: "posa" })).toEqual({
      squadraId: null,
      tecnicoId: null,
    });
  });

  it("non restano mai pieni tutti e due i campi", () => {
    for (const tipo of ["rilievo", "posa", "assistenza", "altro", undefined]) {
      const r = esecutorePerTipo({ tipo, squadraId: 1, tecnicoId: 2 });
      expect(r.squadraId != null && r.tecnicoId != null).toBe(false);
    }
  });

  it("applicarla due volte non cambia il risultato", () => {
    for (const tipo of ["rilievo", "posa", "assistenza", "altro"]) {
      const una = esecutorePerTipo({ tipo, squadraId: 1, tecnicoId: 2 });
      expect(esecutorePerTipo({ tipo, ...una })).toEqual(una);
    }
  });
});
