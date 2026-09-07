// server/_core/sorgentiDiProva.ts
// Helper condivisi dai test STRUTTURALI che leggono il sorgente del
// repository invece di eseguirlo — `server/tenants/confine.test.ts` (Task 15),
// `server/_core/idGlobali.test.ts` (Task 4), `server/_core/storeGlobali.test.ts`
// (Task 5) e `server/tenants/verifica.confine.test.ts` (Task 13, R18):
// elencare i file .ts/.tsx di alcune cartelle, ridurne il percorso a quello
// relativo alla radice del repo, trovare le dichiarazioni `persistedStore`.
// Vive fuori da un file .test.ts apposta: importarlo da un .test.ts farebbe
// girare due volte le sue suite (vitest tratta ogni file che importa come
// dipendenza, ma un *.test.ts è anche un entry point autonomo).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const RADICE = join(__dirname, "..", "..");

export function fileSorgente(cartelle: string[]): string[] {
  const trovati: string[] = [];
  const visita = (percorso: string) => {
    for (const voce of readdirSync(percorso)) {
      if (voce === "node_modules" || voce === "dist" || voce.startsWith(".")) continue;
      const completo = join(percorso, voce);
      if (statSync(completo).isDirectory()) visita(completo);
      else if (/\.(ts|tsx)$/.test(voce)) trovati.push(completo);
    }
  };
  for (const cartella of cartelle) visita(join(RADICE, cartella));
  return trovati;
}

export function relativo(percorso: string): string {
  return percorso.slice(RADICE.length + 1);
}

/** Una chiamata `persistedStore("nome", …)` trovata nei sorgenti. */
export type DichiarazioneStore = {
  nome: string;
  /** L'argomento di tipo di `persistedStore<T>`: "any" per gli store non tipizzati, null se manca. */
  tipo: string | null;
  ambito: "tenant" | "globale";
  /** Percorso relativo alla radice del repo. */
  file: string;
};

// Due file di `server/` contengono il testo `persistedStore(` senza dichiarare
// uno store: `persistence.ts` DEFINISCE la funzione e nel commento di testa
// mostra `persistedStore<MyType>("clienti")` e `{ ambito: "globale" }` come
// esempi; questo file contiene le regex che li cercano.
const NON_DICHIARANO = new Set(["server/_core/persistence.ts", "server/_core/sorgentiDiProva.ts"]);

/** I file di `server/` in cui può vivere una dichiarazione di store: niente test, niente definizione. */
export function sorgentiDegliStore(): string[] {
  return fileSorgente(["server"]).filter(f => !/\.test\.ts$/.test(f) && !NON_DICHIARANO.has(relativo(f)));
}

const RE_CHIAMATA = /\bpersistedStore(?:<([^(]*)>)?\(/g;
// Il nome è il primo argomento, un letterale subito dopo la parentesi:
// commenti di riga o di blocco in mezzo sono ammessi (whatsapp_conversation_aliases).
const RE_NOME = /^persistedStore(?:<[^(]*>)?\(\s*(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*"([a-z0-9_]+)"/;
const RE_GLOBALE = /\{\s*ambito:\s*"globale"\s*\}/;

/**
 * Tutte le dichiarazioni `persistedStore(...)` dei sorgenti, con l'ambito
 * letto dal TERZO argomento della stessa chiamata: il testo fra una chiamata
 * e la successiva (o la fine del file) appartiene a quella chiamata, per
 * quanto lunga sia la callback onLoad — nessuna finestra di caratteri da
 * tarare. `chiamate` è il conteggio grezzo delle chiamate: se supera
 * `dichiarazioni.length`, una chiamata non ha il nome come letterale stringa
 * e la guardia che usa l'elenco deve dirlo, non ignorarla.
 */
export function dichiarazioniPersistedStore(): { dichiarazioni: DichiarazioneStore[]; chiamate: number } {
  const dichiarazioni: DichiarazioneStore[] = [];
  let chiamate = 0;
  for (const f of sorgentiDegliStore()) {
    const s = readFileSync(f, "utf8");
    const trovate = [...s.matchAll(RE_CHIAMATA)];
    chiamate += trovate.length;
    trovate.forEach((m, i) => {
      const fine = i + 1 < trovate.length ? trovate[i + 1].index! : s.length;
      const segmento = s.slice(m.index!, fine);
      const nome = RE_NOME.exec(segmento)?.[1];
      if (!nome) return;
      dichiarazioni.push({
        nome,
        tipo: m[1]?.trim() || null,
        ambito: RE_GLOBALE.test(segmento) ? "globale" : "tenant",
        file: relativo(f),
      });
    });
  }
  return { dichiarazioni, chiamate };
}
