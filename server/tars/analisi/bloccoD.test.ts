// Punti 31, 10/25 e 24 del piano «Tars più intelligente»: i documenti che
// il tipo di lavoro vuole (avviso, non blocco), la memoria della chat che
// arriva al mattino, e le proposte rifiutate che poi si sono avverate in un
// altro modo.

import { describe, expect, it } from "vitest";
import { documentiAttesi, testoAttesi } from "../../commesse/documentiAttesi";
import { correttivi } from "./correttivi";
import type { PropostaAnalisi, RecordAnalisiAzienda } from "./types";

describe("documenti che il lavoro vuole (punto 31)", () => {
  const base = { tipoCliente: "privato", tipiPresenti: new Set<string>(), posaFatta: false };

  it("un condominio vuole la delibera dell'assemblea", () => {
    const attesi = documentiAttesi({ ...base, tipoCliente: "condominio" });
    expect(attesi.map(a => a.tipo)).toEqual(["delibera_condominio"]);
    expect(testoAttesi(attesi)).toContain("assemblea");
  });

  it("ma se la delibera c'è già non manca niente", () => {
    expect(
      documentiAttesi({
        ...base,
        tipoCliente: "condominio",
        tipiPresenti: new Set(["delibera_condominio"]),
      })
    ).toEqual([]);
  });

  it("una posa fatta vuole il suo verbale", () => {
    expect(documentiAttesi({ ...base, posaFatta: true }).map(a => a.tipo)).toEqual([
      "verbale_posa",
    ]);
  });

  it("una pratica fiscale vuole l'asseverazione, una edilizia la conformità", () => {
    expect(
      documentiAttesi({ ...base, tipiPresenti: new Set(["pratica_fiscale"]) }).map(a => a.tipo)
    ).toEqual(["asseverazione"]);
    expect(
      documentiAttesi({ ...base, tipiPresenti: new Set(["pratica_edilizia"]) }).map(a => a.tipo)
    ).toEqual(["dichiarazione_conformita"]);
  });

  it("un lavoro normale non vuole niente di speciale", () => {
    expect(documentiAttesi(base)).toEqual([]);
  });
});

describe("cosa hai fatto invece (punto 24)", () => {
  const scartata = (azione: PropostaAnalisi["azione"]): PropostaAnalisi => ({
    testo: "Portala al passo successivo.",
    richiestaPerTars: "Portala avanti.",
    fonte: "pronte",
    entita: ["commessa:12"],
    link: null,
    azione,
    esecuzione: {
      stato: "scartata",
      motivo: null,
      azioneId: null,
      entitaToccate: [],
      quando: "2026-09-04T09:00:00Z",
      daUtente: 1,
    },
  });

  const analisi = (proposte: PropostaAnalisi[]): RecordAnalisiAzienda =>
    ({
      id: 1,
      sedeId: 1,
      giorno: "2026-09-04",
      versione: "1.2.0",
      stato: "pronta",
      esito: {
        versione: "1.2.0",
        fonte: "modello",
        modello: null,
        sintesi: "",
        punti: [],
        proposte,
        domande: [],
        avvertenze: [],
        contatori: {},
        fattiConsiderati: 0,
      },
      errore: null,
      richiestaDa: null,
      tentativi: 1,
      generataAt: new Date(),
    }) as any;

  const deps = (stato: string, interventi: any[] = []) => ({
    commessa: (id: number) => (id === 12 ? { id, stato } : null),
    interventiDi: () => interventi,
  });

  it("proponevo uno stato, la commessa è finita in un altro: lo dice", () => {
    const righe = correttivi(
      [
        analisi([
          scartata({
            strumento: "transizione_adiacente_commessa",
            input: JSON.stringify({ commessaId: 12, nuovoStato: "attesa_posa" }),
          }),
        ]),
      ],
      deps("finiture_saldo")
    );
    expect(righe).toHaveLength(1);
    expect(righe[0].testo).toContain("«attesa_posa»");
    expect(righe[0].testo).toContain("«finiture_saldo»");
  });

  it("se è ferma dov'era, il rifiuto è stato solo un rifiuto", () => {
    expect(
      correttivi(
        [
          analisi([
            scartata({
              strumento: "transizione_adiacente_commessa",
              input: JSON.stringify({ commessaId: 12, nuovoStato: "attesa_posa" }),
            }),
          ]),
        ],
        deps("ordini_ultimazione")
      )
    ).toEqual([]);
  });

  it("e se ci è andata comunque, non è un correttivo", () => {
    expect(
      correttivi(
        [
          analisi([
            scartata({
              strumento: "transizione_adiacente_commessa",
              input: JSON.stringify({ commessaId: 12, nuovoStato: "attesa_posa" }),
            }),
          ]),
        ],
        deps("attesa_posa")
      )
    ).toEqual([]);
  });

  it("proponevo di pianificare un rilievo: l'hai messo tu, a modo tuo", () => {
    const righe = correttivi(
      [
        analisi([
          scartata({
            strumento: "pianifica_intervento",
            input: JSON.stringify({ commessaId: 12, tipo: "rilievo", quando: "giovedì" }),
          }),
        ]),
      ],
      deps("produzione", [{ tipo: "rilievo", dataPianificata: "2026-09-09" }])
    );
    expect(righe[0].testo).toContain("2026-09-09");
    expect(righe[0].testo).toContain("il momento che dicevo no");
  });

  it("una proposta eseguita, o senza azione, non è un correttivo", () => {
    const senzaAzione = { ...scartata(null) };
    expect(correttivi([analisi([senzaAzione])], deps("finiture_saldo"))).toEqual([]);
  });
});
