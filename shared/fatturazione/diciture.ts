// Testi fissi della fattura (copiati dalle fatture reali 2026). Sono dati:
// la direzione li cambierà da UI in una fase successiva (spec §4.3).

import type { PraticaEdilizia } from "./tipi";

export const DICITURE = {
  intestazione: "Fattura per la prossima fornitura e posa di:",
  seguira_ddt: "(seguirà ddt. alla consegna)",
  beni_significativi: "Beni Significativi:",
  beni_autonomi:
    "Beni dotati di autonomia funzionale (strutturalmente non integrati):",
  prestazioni:
    "Prestazioni professionali e opere complementari relative all'installazione e alla messa in opera delle tecnologie:",
  markup: "MarkUp servizi di vendita",
  storno_bs: "Detrazione per diversa imputazione iva beni significativi",
  riaddebito_bs:
    "Riaddebito per diversa imputazione iva agevolata beni significativi",
  intervento_manutenzione:
    "Manutenzione Ordinaria\nD.P.R. 380/2001 (art. 3, 1°comma, lettera a)",
  intervento_straordinaria:
    "Manutenzione Straordinaria\nD.P.R. 380/2001 (art. 3, 1°comma, lettera b)",
  bonifico_ristrutturazione:
    "Bonifico bancario parlante per Ristrutturazione Edilizia ai sensi del T.U.I.R. 917/1986 e s.m.i.",
  bonifico_ecobonus:
    "Bonifico bancario parlante per Detrazione Ecobonus Risparmio Energetico L.296/06 e s.m.i.",
  indicare_cf: "Indicare sul bonifico il Codice Fiscale e la nostra P.I.V.A.",
  copia_ade:
    "Copia del documento elettronico disponibile nella Sua area riservata dell'Agenzia delle Entrate",
  pagamento_50_40_10:
    "Bonifico Bancario 50/40/10: 50% all'ordine, 40% arrivo merce pronta, 10% posa in opera ultimata (date di pagamento indicative)",
  spese_professionali_escluse: "Spese professionali escluse",
  // Template: il generatore compila {tipo} (CIL/CILA/SCIA) e lascia il
  // resto fra graffe, da riempire a mano prima dell'emissione (R19).
  pratica_edilizia:
    "{tipo} N. {numero} del {data}, rilasciata dal Comune di {comune} e intestata a {intestatario}.",
} as const;

export type ChiaveDicitura = keyof typeof DICITURE;

/**
 * Le diciture da stampare in fattura in base al tipo di detrazione: il
 * bonifico parlante cambia frase fra ristrutturazione ed ecobonus, la
 * manutenzione e il rimando alla copia AdE sono sempre presenti.
 *
 * La pratica edilizia del cliente decide quale manutenzione: CILA e SCIA
 * sono straordinaria (D.P.R. 380/2001 lettera b, fatture 106 e 119); la
 * CIL, come l'assenza di pratica, resta ordinaria (lettera a).
 */
export function dicitureDefault(
  detrazioneTipo: "nessuna" | "ecobonus" | "ristrutturazione",
  praticaEdilizia: PraticaEdilizia = "nessuna"
): ChiaveDicitura[] {
  const straordinaria = praticaEdilizia === "cila" || praticaEdilizia === "scia";
  const base: ChiaveDicitura[] = [
    straordinaria ? "intervento_straordinaria" : "intervento_manutenzione",
  ];
  if (detrazioneTipo === "ristrutturazione")
    base.push("bonifico_ristrutturazione", "indicare_cf");
  if (detrazioneTipo === "ecobonus")
    base.push("bonifico_ecobonus", "indicare_cf");
  base.push("copia_ade");
  return base;
}
