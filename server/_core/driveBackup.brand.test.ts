// Guardia del rebranding sul backup Drive.
//
// Il nome della cartella non è un marchio: è la chiave con cui
// driveCreateFolder ritrova la cartella già creata. Rinominarlo per coerenza
// di brand ne creerebbe una nuova e lascerebbe i backup esistenti orfani in
// quella vecchia, invisibili al codice. Questo test esiste perché la
// tentazione, durante un rebranding, è esattamente quella.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SORGENTE = readFileSync(join("server", "_core", "driveBackup.ts"), "utf8");

// Composto da pezzi come in tokenDiscipline.test.ts: un test che scrive il
// vecchio nome per intero dovrebbe poi essere esentato dalla spazzata di
// shared/brand.test.ts, e ogni esenzione è un buco.
const VECCHIO_NOME = ["Ruffino", "Flow"].join(" ");
const CARTELLA_BACKUP = ["Backup", "CRM", "Ruffino"].join(" ");

describe("marchio e backup su Drive", () => {
  it("non rinomina la cartella dei backup insieme al prodotto", () => {
    // Ancora l'asserzione alla chiamata funzionale, non solo alla stringa nei
    // commenti. Se un futuro sviluppatore rinomina solo la riga 308
    // (driveCreateFolder) lasciando intatto il commento adiacente, il test
    // deve fallire. Cerchiamo la sequenza: funzione, primo argomento, cartella.
    expect(SORGENTE).toContain(`driveCreateFolder(token, "${CARTELLA_BACKUP}"`);
  });

  it("firma i PDF col nome nuovo del prodotto", () => {
    expect(SORGENTE).toContain("${PRODOTTO}");
    expect(SORGENTE).not.toContain(VECCHIO_NOME);
  });
});
