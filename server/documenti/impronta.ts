// L'impronta di un MODULO di conferma: che cosa c'è STAMPATO sul foglio,
// senza niente di quello che ci viene scritto sopra.
//
// Serve come chiave del profilo di lettura (spec §5) e, quando arriverà il
// catalogo comune, come chiave di quello. Identifica il modulo e non il
// fornitore, e questo risolve una circolarità: per scegliere il profilo
// servirebbe sapere di chi è la conferma, che è una delle cose che il profilo
// aiuta a leggere.
//
// Dentro entrano SOLO le parole stampate — le celle che non portano cifre —
// normalizzate e ordinate. Fuori restano i numeri d'ordine, i clienti, i
// prezzi e le date: è quello che rende l'impronta uguale su due conferme
// dello stesso modulo, e che la renderà promuovibile senza portarsi dietro i
// dati di nessuno.

import { createHash } from "node:crypto";

// Tre regole, e ognuna toglie una classe di VALORI dalle etichette.
//
// 1. L'etichetta sta PRIMA dei due punti: «Totale imponibile: EUR 948,73» è
//    l'etichetta «Totale imponibile» più un valore, e «Rif. cliente: ROSSI
//    MARIO» è un'etichetta più il nome di una persona.
// 2. Una cella con cifre è un valore: numeri d'ordine, prezzi, date.
// 3. Un'etichetta stampata ha almeno una MINUSCOLA. In questi moduli ciò che
//    viene scritto dentro è in maiuscolo — il nome del cliente, il codice
//    articolo — e senza questa regola «ROSSI MARIO» finirebbe nell'impronta,
//    che cambierebbe a ogni conferma. È il difetto che il primo test ha
//    trovato.
const CON_CIFRE = /\d/;
const CON_MINUSCOLA = /[a-zà-ú]/;

function etichetteDi(testo: string): string[] {
  const trovate = new Set<string>();
  for (const riga of testo.split(/\r?\n/)) {
    // Le celle: separate da almeno due spazi, come le rende un PDF a colonne.
    for (const cella of riga.split(/\s{2,}/)) {
      const parteEtichetta = cella.split(":")[0];
      if (CON_CIFRE.test(parteEtichetta)) continue;
      if (!CON_MINUSCOLA.test(parteEtichetta)) continue;
      const pulita = parteEtichetta
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (pulita.length < 3 || pulita.length > 40) continue;
      trovate.add(pulita);
    }
  }
  return [...trovate].sort();
}

/** 16 caratteri esadecimali: abbastanza per una chiave, corti da leggere. */
export function improntaLayout(pagine: readonly string[]): string {
  const canonica = etichetteDi(pagine.join("\n")).join("|");
  return createHash("sha256").update(canonica, "utf8").digest("hex").slice(0, 16);
}
