// Guardia del rebranding sull'UID degli eventi ICS.
//
// L'UID è la chiave d'identità di ogni evento nei calendari già iscritti
// (Google Calendar, Apple Calendar, Outlook, ...): è il campo che il client
// usa per decidere se un evento del feed è «lo stesso di prima, aggiornato»
// o uno mai visto. Cambiare il suffisso dopo la chiocciola farebbe apparire
// ogni intervento come un evento nuovo: gli operatori vedrebbero tutto
// doppio in agenda, e gli eventi col vecchio UID resterebbero orfani nei
// calendari già iscritti, mai più aggiornati né rimossi da un sync
// successivo. È il gemello esatto del caso della cartella Drive
// (driveBackup.brand.test.ts): il vecchio nome qui non è un marchio da
// correggere, è una chiave tecnica che deve restare quella che i client
// hanno già visto.
//
// La spazzata di shared/brand.test.ts non protegge questo caso: cerca il
// nome vecchio del prodotto scritto con le due parole separate da uno
// spazio, e questo suffisso è le stesse due parole in minuscolo unite da un
// trattino, come un segmento di dominio. Da qui l'esigenza di una guardia
// dedicata, ancorata alla riga che genera davvero l'UID.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SORGENTE = readFileSync(
  join("server", "routers", "calendarSync.ts"),
  "utf8"
);

// Composto da pezzi come le altre guardie del rebranding: un test che scrive
// il vecchio nome per intero verrebbe poi esentato dalla spazzata di
// shared/brand.test.ts, e ogni esenzione è un buco.
const SUFFISSO_UID = ["ruffino", "flow"].join("-");

describe("marchio e UID degli eventi ICS", () => {
  it("non cambia il suffisso dell'UID insieme al prodotto", () => {
    // Ancorato al literal esatto che compone l'UID (non a un commento o a
    // un'occorrenza incidentale altrove nel file): se qualcuno lo riscrive
    // — anche solo per «uniformare» al nome nuovo — ogni intervento diventa
    // un evento nuovo nei calendari già iscritti.
    const rigaUid = "`UID:intervento-${i.id}@" + SUFFISSO_UID + "`";
    expect(SORGENTE).toContain(rigaUid);
  });

  it("firma comunque il calendario col nome nuovo del prodotto", () => {
    // PRODID e X-WR-CALNAME sono etichette visibili, non chiavi d'identità:
    // possono e devono seguire il rebranding (spec §7). Solo l'UID resta.
    expect(SORGENTE).toContain("PRODID:-//${PRODOTTO}//Calendario//IT");
    expect(SORGENTE).toContain("X-WR-CALNAME:${PRODOTTO}");
  });
});
