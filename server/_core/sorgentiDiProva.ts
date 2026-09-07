// server/_core/sorgentiDiProva.ts
// Helper condivisi dai test STRUTTURALI che leggono il sorgente del
// repository invece di eseguirlo — `server/tenants/confine.test.ts` (Task 15)
// e `server/_core/idGlobali.test.ts` (Task 4): elencare i file .ts/.tsx di
// alcune cartelle e ridurne il percorso a quello relativo alla radice del
// repo. Vive fuori da un file .test.ts apposta: importarlo da un .test.ts
// farebbe girare due volte le sue suite (vitest tratta ogni file che importa
// come dipendenza, ma un *.test.ts è anche un entry point autonomo).

import { readdirSync, statSync } from "node:fs";
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
