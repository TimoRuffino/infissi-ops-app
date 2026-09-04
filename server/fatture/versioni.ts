// Versione (T3, Task 17) della lista fatture/note di credito di una
// commessa: un contatore monotono IN MEMORIA, mai persistito. Non è un
// dato di dominio — serve solo al registro `server/tars/versioni.ts`
// (riferimento "fatture-di-commessa:<id>") per capire quando il
// fascicolo Tars della commessa va ricostruito. Ogni scrittura del
// repository (`crea`, `aggiornaBozza`, `aggiornaStato`, `aggiornaScadenza`,
// `appendEvento`) tocca il contatore della propria commessa.
//
// Un contatore condiviso fra tutte le commesse (non `Date.now()` per
// chiave) evita che due scritture nello stesso millisecondo restino
// indistinguibili. Un riavvio del processo azzera la mappa: la versione
// osservata da una voce di cache scritta prima del riavvio non coincide
// più con quella corrente (che riparte da "0"), quindi il fascicolo si
// ricostruisce alla richiesta successiva — fail-closed by design, mai un
// falso riuso dopo un deploy o un restart.
const contatori = new Map<string, number>();
let prossimo = 1;

function chiave(sedeId: number, commessaId: number): string {
  return `${sedeId}:${commessaId}`;
}

/** "0" se nessuna scrittura ha ancora toccato questa commessa. */
export function versioneFattureCommessa(sedeId: number, commessaId: number): string {
  return String(contatori.get(chiave(sedeId, commessaId)) ?? 0);
}

export function toccaFattureCommessa(sedeId: number, commessaId: number): void {
  contatori.set(chiave(sedeId, commessaId), prossimo++);
}
