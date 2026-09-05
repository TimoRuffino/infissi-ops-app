// Il percorso a passi della fatturazione guidata (piano 4): quattro tappe
// in ordine fisso — Documenti, Contratto, Limiti, Fattura — con lo stesso
// significato per il server che le calcola e per il client che le mostra
// come pallini nello stepper e nelle tab in sola lettura della commessa.
// Nessuna logica qui: solo forme. Le regole di calcolo vivono in
// `server/fatturazione/passi.ts` (funzione pura `calcolaPassi`).
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §4.1 (stato dei passi) e §4.3 (importi).

import type { StatoFattura } from "./tipi";
import type { PattuitoTipo } from "../limiti/tipi";

export const ORDINE_PASSI = [
  "documenti",
  "contratto",
  "limiti",
  "fattura",
] as const;
export type PassoFatturazione = (typeof ORDINE_PASSI)[number];

/**
 * `non_disponibile` è per i passi dietro un flag spento (Limiti, Fattura):
 * non è un «da fare» perché non c'è nulla da fare finché il flag resta
 * spento, ed è distinto da `fatto` perché non lo si è mai completato.
 */
export type EsitoPasso = "da_fare" | "in_corso" | "fatto" | "non_disponibile";

export const ETICHETTA_PASSO: Record<PassoFatturazione, string> = {
  documenti: "Documenti",
  contratto: "Contratto",
  limiti: "Limiti",
  fattura: "Fattura",
};

/**
 * Gli unici due stati della commessa che compaiono nell'elenco da
 * fatturare (§2 della specifica): prima dell'accettazione o della posa non
 * ha senso proporre di fatturare.
 */
export type StatoDaFatturare = "aggiornamento_contratto" | "fatture_pagamento";

/**
 * Una riga dell'elenco «da fatturare» e il record dietro la pagina a passi
 * di una commessa: stessa forma per i due usi (§5, router `passi` e
 * `daFare`). `pattuitoCent`/`fatturaPrevistaCent` sono `null` per chi non
 * ha `economia.read`: la card non mostra la riga degli importi.
 */
export type CommessaDaFatturare = {
  commessaId: number;
  codice: string;
  cliente: string;
  stato: StatoDaFatturare;
  /** ISO, dalla timeline (milestone dello stato) o updatedAt. */
  statoDal: string | null;
  giorniNelloStato: number | null;
  documenti: { totale: number; contratti: number };
  passi: Record<PassoFatturazione, EsitoPasso>;
  prossimoPasso: PassoFatturazione | null;
  pattuitoCent: number | null;
  pattuitoTipo: PattuitoTipo | null;
  /** `bozza.totaleCent` se esiste una bozza, altrimenti il pattuito (stima dichiarata). */
  fatturaPrevistaCent: number | null;
  fatturaPrevistaStima: boolean;
  fatturaStato: StatoFattura | null;
};
