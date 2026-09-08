// I doppioni nati dalle fatture di Fatture in Cloud (08/09/2026).
//
// Fino a oggi, una fattura FiC che non citava il codice commessa faceva
// nascere un lavoro nuovo anche quando il cliente ne aveva già uno aperto:
// «nonostante ci fosse già una commessa riferimento Sica ne ha creata una
// nuova». La regola è corretta da `creaCommesseDaFattureFic`, ma le
// commesse già nate restano, e vanno unite.
//
// Qui non si indovina niente. Un doppione si unisce solo quando:
//   • è nato da una fattura (`ficSourceRef`), non a mano;
//   • il cliente ha UNA sola altra commessa viva — quella che sopravvive;
//   • dentro non c'è lavoro vero (posa, ticket, merce, costi, incassi):
//     quello che c'è si sposta, il resto è motivo per fermarsi e guardare.
//
// L'unione sposta fatture, documenti e messaggi sulla commessa che resta, e
// poi elimina quella vuota. È una cancellazione: la decide una persona, una
// riga alla volta, e la pagina dice prima che cosa sposterà.

import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { getCommesseStore, eliminaCommessaSvuotata } from "../routers/commesse";
import { getInterventiStore } from "../routers/interventi";
import { getMagazzinoStore } from "../routers/magazzino";
import { getTicketStore } from "../routers/ticket";
import {
  getDocumentiDiCommessa,
  spostaDocumentoDiCommessa,
} from "../routers/preventiviContratti";
import {
  listComunicazioni,
  setMatchComunicazione,
} from "../comunicazioni/comunicazioni";
import {
  ficFatture,
  saveFicFatture,
  sincronizzaPattuitoDaFic,
} from "../routers/ficFatture";

export type CommessaInBreve = {
  id: number;
  codice: string | null;
  cliente: string | null;
  stato: string;
};

export type DoppioneCommessa = {
  duplicata: CommessaInBreve & { creata: string | null };
  sopravvive: CommessaInBreve;
  /** Le fatture FiC attaccate al doppione: passano alla commessa che resta. */
  fatture: Array<{ id: number; numero: string; data: string | null }>;
  documenti: number;
  comunicazioni: number;
  /** Se non è vuoto, il doppione NON si unisce da solo: c'è lavoro dentro. */
  bloccanti: string[];
};

function inBreve(c: any): CommessaInBreve {
  return {
    id: c.id,
    codice: c.codice ?? null,
    cliente: c.cliente ?? null,
    stato: String(c.stato ?? ""),
  };
}

function viva(c: any, sedeId: number): boolean {
  return (
    (c.sedeId ?? DEFAULT_SEDE_ID) === sedeId &&
    !c.archivedAt &&
    c.stato !== "archiviata"
  );
}

/** Che cosa impedisce di unire senza guardare: lavoro vero dentro il doppione. */
export function bloccantiDelDoppione(commessa: any): string[] {
  const bloccanti: string[] = [];
  const interventi = (getInterventiStore() as any[]).filter(
    i => i.commessaId === commessa.id && i.stato !== "annullato"
  );
  if (interventi.length > 0) {
    bloccanti.push(
      `${interventi.length} ${interventi.length === 1 ? "appuntamento" : "appuntamenti"} in agenda`
    );
  }
  const ticket = (getTicketStore() as any[]).filter(t => t.commessaId === commessa.id);
  if (ticket.length > 0) {
    bloccanti.push(`${ticket.length} ${ticket.length === 1 ? "ticket" : "ticket"}`);
  }
  const merce = getMagazzinoStore().filter(p => p.commessaId === commessa.id);
  if (merce.length > 0) {
    bloccanti.push(`${merce.length} ${merce.length === 1 ? "consegna" : "consegne"} a magazzino`);
  }
  if ((commessa.costi ?? []).length > 0) {
    bloccanti.push(`${commessa.costi.length} costi fornitore`);
  }
  if ((commessa.pagamenti ?? []).length > 0 || (commessa.importoIncassato ?? 0) > 0) {
    bloccanti.push("incassi registrati");
  }
  return bloccanti;
}

/**
 * I doppioni di una sede: commesse nate da una fattura il cui cliente ha
 * un'altra sola commessa viva. Sola lettura.
 */
export async function doppioniDaFatture(sedeId: number): Promise<DoppioneCommessa[]> {
  const commesse = (getCommesseStore() as any[]).filter(c => viva(c, sedeId));
  const esito: DoppioneCommessa[] = [];
  for (const duplicata of commesse) {
    if (!duplicata.ficSourceRef || duplicata.clienteId == null) continue;
    const altre = commesse.filter(
      c => c.id !== duplicata.id && c.clienteId === duplicata.clienteId
    );
    // Nessuna altra commessa: non è un doppione. Più di una: quale resta?
    // Non lo decide un automatismo.
    if (altre.length !== 1) continue;
    const fatture = ficFatture.filter(
      f => f.sedeId === sedeId && f.commessaId === duplicata.id
    );
    const messaggi = await listComunicazioni({
      sedeId,
      commessaId: duplicata.id,
      limit: 50,
    });
    esito.push({
      duplicata: {
        ...inBreve(duplicata),
        creata: duplicata.createdAt ? new Date(duplicata.createdAt).toISOString() : null,
      },
      sopravvive: inBreve(altre[0]),
      fatture: fatture.map(f => ({ id: f.id, numero: f.numero, data: f.data ?? null })),
      documenti: getDocumentiDiCommessa(duplicata.id).length,
      comunicazioni: messaggi.length,
      bloccanti: bloccantiDelDoppione(duplicata),
    });
  }
  return esito.sort((a, b) =>
    String(b.duplicata.creata ?? "").localeCompare(String(a.duplicata.creata ?? ""))
  );
}

export type EsitoFusione = {
  fattureSpostate: number;
  documentiSpostati: number;
  comunicazioniSpostate: number;
  sopravvive: CommessaInBreve;
};

/**
 * Unisce un doppione nella commessa che resta: fatture, documenti e
 * messaggi passano di là, poi il doppione viene eliminato. Gli id sono
 * espliciti — mai «unisci tutti» — e i bloccanti fermano l'operazione.
 */
export async function unisciDoppione(input: {
  sedeId: number;
  duplicataId: number;
  sopravviveId: number;
  utenteId: number | null;
}): Promise<EsitoFusione> {
  const commesse = getCommesseStore() as any[];
  const duplicata = commesse.find(c => c.id === input.duplicataId);
  const sopravvive = commesse.find(c => c.id === input.sopravviveId);
  if (!duplicata || !viva(duplicata, input.sedeId)) {
    throw new Error("NOT_FOUND: commessa doppia non trovata.");
  }
  if (!sopravvive || !viva(sopravvive, input.sedeId)) {
    throw new Error("NOT_FOUND: commessa di destinazione non trovata.");
  }
  if (duplicata.id === sopravvive.id) {
    throw new Error("BAD_REQUEST: le due commesse coincidono.");
  }
  if (!duplicata.ficSourceRef) {
    throw new Error(
      "PRECONDITION_FAILED: questa commessa non è nata da una fattura: si elimina dalla scheda, non da qui."
    );
  }
  if (duplicata.clienteId !== sopravvive.clienteId) {
    throw new Error("PRECONDITION_FAILED: le due commesse non sono dello stesso cliente.");
  }
  const bloccanti = bloccantiDelDoppione(duplicata);
  if (bloccanti.length > 0) {
    throw new Error(
      `PRECONDITION_FAILED: dentro c'è lavoro vero (${bloccanti.join(", ")}): va guardata a mano.`
    );
  }

  // 1. Le fatture passano alla commessa che resta. Il legame diventa
  //    manuale: l'ha deciso una persona, non una regola.
  let fattureSpostate = 0;
  for (const fattura of ficFatture) {
    if (fattura.sedeId !== input.sedeId || fattura.commessaId !== duplicata.id) continue;
    fattura.commessaId = sopravvive.id;
    fattura.commessaMatch = "manuale";
    fattura.collegataAMano = true;
    fattura.pdfSync.stato = "in_attesa";
    fattura.aggiornataAt = new Date();
    fattureSpostate += 1;
  }
  if (fattureSpostate > 0) saveFicFatture();

  // 2. I documenti seguono: il fascicolo non si butta con la commessa.
  let documentiSpostati = 0;
  for (const documento of getDocumentiDiCommessa(duplicata.id)) {
    spostaDocumentoDiCommessa({
      documentoId: documento.id,
      commessaId: sopravvive.id,
      sedeId: input.sedeId,
      note: `Spostato unendo ${duplicata.codice ?? duplicata.id} in ${sopravvive.codice ?? sopravvive.id}.`,
    });
    documentiSpostati += 1;
  }

  // 3. E i messaggi collegati.
  let comunicazioniSpostate = 0;
  for (const messaggio of await listComunicazioni({
    sedeId: input.sedeId,
    commessaId: duplicata.id,
    limit: 200,
  })) {
    const ok = await setMatchComunicazione(messaggio.id, input.sedeId, {
      clienteId: sopravvive.clienteId ?? null,
      commessaId: sopravvive.id,
      confidenza: "alta",
      motivo: `Spostato unendo ${duplicata.codice ?? duplicata.id} in ${sopravvive.codice ?? sopravvive.id}.`,
    });
    if (ok) comunicazioniSpostate += 1;
  }

  // 4. Il doppione, ormai vuoto, se ne va.
  await eliminaCommessaSvuotata(duplicata.id, input.sedeId);
  sincronizzaPattuitoDaFic(input.sedeId);

  return {
    fattureSpostate,
    documentiSpostati,
    comunicazioniSpostate,
    sopravvive: inBreve(sopravvive),
  };
}
