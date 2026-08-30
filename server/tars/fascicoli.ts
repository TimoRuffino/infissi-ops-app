// Fascicoli sintetici per entità (C3, T3) — spec §10 e §21.
//
// Il fascicolo della commessa è un derivato PERSISTENTE al «pavimento»
// di capability (`commessa.read`): fatti operativi, gate, ordini senza
// importi, domande aperte deterministiche, fonti e versioni. NIENTE
// economia e NIENTE derivati direzione-only: per costruzione il payload
// è identico per chiunque possa vederlo, quindi condivisibile a livello
// sede (decisione 15, con test anti-leak). Ricostruzione SOLO quando le
// versioni osservate non coincidono più con le correnti; su errore si
// serve l'ultima versione valida marcata stale (mai per azioni).

import { getCommessaById, STATI_COMMESSA } from "../routers/commesse";
import {
  REQUIRED_DOC_TIPI_PER_STATO,
  statoHasRequiredDoc,
} from "../routers/preventiviContratti";
import { getOrdiniFornitoreDiSede } from "../routers/fornitori";
import {
  azzeraCachePersistentePerTest,
  leggiVoceCache,
  scriviVoceCache,
} from "./cache/entries";
import { versioneCorrente, versioniAncoraValide } from "./versioni";

export type OrdineFascicolo = {
  id: number;
  codiceOrdine: string;
  fornitoreNome: string | null;
  stato: string;
  dataOrdine: string | null;
  dataConsegnaPrevista: string | null;
  dataConsegnaEffettiva: string | null;
  inRitardo: boolean;
};

export type FascicoloCommessa = {
  commessaId: number;
  codice: string;
  cliente: string;
  stato: string;
  priorita: string;
  assegnatoA: string | null;
  dataConsegnaConfermata: string | null;
  daSaldare: boolean;
  gate: { documentiRichiesti: string[]; soddisfatto: boolean };
  transizioni: { precedente: string | null; successivo: string | null };
  ordini: OrdineFascicolo[];
  domandeAperte: string[];
  fonti: string[];
  versioni: Record<string, string>;
  generatoIl: string;
  stale: boolean;
};

export const CONTATORI_FASCICOLI = {
  costruzioni: 0,
  riusi: 0,
  invalidazioniVersione: 0,
  staleServiti: 0,
};

export function azzeraFascicoliPerTest(): void {
  CONTATORI_FASCICOLI.costruzioni = 0;
  CONTATORI_FASCICOLI.riusi = 0;
  CONTATORI_FASCICOLI.invalidazioniVersione = 0;
  CONTATORI_FASCICOLI.staleServiti = 0;
  azzeraCachePersistentePerTest();
}

function costruisciContenuto(
  sedeId: number,
  commessaId: number
): FascicoloCommessa | null {
  const c: any = getCommessaById(commessaId);
  if (!c || c.sedeId !== sedeId) return null;

  const indice = STATI_COMMESSA.indexOf(c.stato);
  const docRichiesti = REQUIRED_DOC_TIPI_PER_STATO[c.stato] ?? [];
  const gateSoddisfatto = statoHasRequiredDoc(c.id, c.stato);
  const oggi = new Date().toISOString().slice(0, 10);

  const ordini: OrdineFascicolo[] = getOrdiniFornitoreDiSede(sedeId)
    .filter(o => o.ordine.commessaId === c.id)
    .map(o => ({
      id: o.ordine.id,
      codiceOrdine: o.ordine.codiceOrdine,
      fornitoreNome: o.fornitoreNome ?? null,
      stato: o.ordine.stato,
      dataOrdine: o.ordine.dataOrdine ?? null,
      dataConsegnaPrevista: o.ordine.dataConsegnaPrevista ?? null,
      dataConsegnaEffettiva: o.ordine.dataConsegnaEffettiva ?? null,
      inRitardo: Boolean(
        o.ordine.dataConsegnaPrevista &&
          !o.ordine.dataConsegnaEffettiva &&
          o.ordine.stato !== "ricevuto" &&
          o.ordine.dataConsegnaPrevista < oggi
      ),
    }))
    .sort((a, b) => a.id - b.id);

  // Domande aperte DETERMINISTICHE: confronti di date e gate, nessuna
  // inferenza del modello. L'ordine è stabile.
  const domandeAperte: string[] = [];
  if (!gateSoddisfatto && docRichiesti.length > 0) {
    domandeAperte.push(
      `Gate documentale: serve almeno un documento di tipo ${docRichiesti.join(" o ")} nello stato «${c.stato}».`
    );
  }
  for (const o of ordini) {
    if (!o.dataConsegnaPrevista && o.stato !== "ricevuto") {
      domandeAperte.push(
        `Ordine ${o.codiceOrdine}: manca la data di consegna prevista.`
      );
    }
    if (
      o.dataConsegnaPrevista &&
      c.dataConsegnaConfermata &&
      o.dataConsegnaPrevista > c.dataConsegnaConfermata
    ) {
      domandeAperte.push(
        `Ordine ${o.codiceOrdine}: consegna prevista (${o.dataConsegnaPrevista}) DOPO la data confermata al cliente (${c.dataConsegnaConfermata}).`
      );
    }
    if (o.inRitardo) {
      domandeAperte.push(
        `Ordine ${o.codiceOrdine}: consegna prevista (${o.dataConsegnaPrevista}) superata senza consegna effettiva.`
      );
    }
  }

  const versioni: Record<string, string> = {
    [`commessa:${c.id}`]: versioneCorrente(`commessa:${c.id}`, sedeId) ?? "-",
    [`ordini-di-commessa:${c.id}`]:
      versioneCorrente(`ordini-di-commessa:${c.id}`, sedeId) ?? "-",
    [`registroPagamenti:commessa:${c.id}`]:
      versioneCorrente(`registroPagamenti:commessa:${c.id}`, sedeId) ?? "-",
  };

  return {
    commessaId: c.id,
    codice: c.codice,
    cliente: c.cliente,
    stato: c.stato,
    priorita: c.priorita ?? "media",
    assegnatoA: c.assegnatoA ?? null,
    dataConsegnaConfermata: c.dataConsegnaConfermata ?? null,
    daSaldare:
      (c.importoTotale ?? 0) > 0 &&
      (c.importoTotale ?? 0) - (c.importoIncassato ?? 0) > 0,
    gate: { documentiRichiesti: [...docRichiesti], soddisfatto: gateSoddisfatto },
    transizioni: {
      precedente: indice > 0 ? STATI_COMMESSA[indice - 1] : null,
      successivo: STATI_COMMESSA[indice + 1] ?? null,
    },
    ordini,
    domandeAperte,
    fonti: [
      "commessa CRM (stato, gate, date)",
      "ordini fornitori CRM (stati e date di consegna)",
    ],
    versioni,
    generatoIl: new Date().toISOString(),
    stale: false,
  };
}

/**
 * Il fascicolo C3 della commessa: riusa la voce in cache se le versioni
 * osservate coincidono con le correnti; altrimenti ricostruisce. Su
 * errore di ricostruzione serve l'ultima versione valida marcata stale.
 * Ritorna null per commesse inesistenti o di altra sede (NOT_FOUND a
 * monte, nessuna informazione utile a enumerare).
 */
export async function fascicoloCommessa(
  input: { sedeId: number; commessaId: number },
  opzioni: {
    costruttore?: typeof costruisciContenuto;
  } = {}
): Promise<FascicoloCommessa | null> {
  const chiave = `fascicolo:commessa:${input.sedeId}:${input.commessaId}`;
  const costruttore = opzioni.costruttore ?? costruisciContenuto;

  const voce = await leggiVoceCache(chiave, input.sedeId);
  if (voce && !voce.stale) {
    if (versioniAncoraValide(voce.versioni, input.sedeId)) {
      CONTATORI_FASCICOLI.riusi += 1;
      return voce.payload as FascicoloCommessa;
    }
    CONTATORI_FASCICOLI.invalidazioniVersione += 1;
  }

  let contenuto: FascicoloCommessa | null;
  try {
    contenuto = costruttore(input.sedeId, input.commessaId);
  } catch (errore) {
    if (voce) {
      // Ultima versione valida, dichiarata stale: mai per azioni.
      CONTATORI_FASCICOLI.staleServiti += 1;
      return { ...(voce.payload as FascicoloCommessa), stale: true };
    }
    throw errore;
  }
  if (!contenuto) return null;

  CONTATORI_FASCICOLI.costruzioni += 1;
  await scriviVoceCache({
    chiave,
    sedeId: input.sedeId,
    tipo: "fascicolo",
    payload: contenuto,
    versioni: contenuto.versioni,
    stale: false,
  });
  return contenuto;
}
