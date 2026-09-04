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

import { ETICHETTA_STATO_FATTURA, type Fattura } from "@shared/fatturazione/tipi";
import { fatturePerCommessa } from "../fatture/servizio";
import { interruttoreAttivo } from "../platform/interruttori";
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
import { istanteComeLocale } from "./tempo";
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
  /** Task 17: una riga per fattura/nota di credito, senza importi. `[]` col flag «fatturazione» spento. */
  fatturazione: string[];
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

/**
 * « · prova SdI» e/o « · avviso: …»: solo per fatture dall'emissione in
 * poi e per le note di credito (mai per una bozza).
 *
 * L'avviso è una frase FISSA, mai il testo di `eiErrore` (Ruling R36):
 * quel campo nasce da Fatture in Cloud e dal confronto dei totali, e ci
 * finiscono dentro gli importi — «Totali FiC diversi dai nostri: totale
 * € …». Il fascicolo vive al pavimento `commessa.read` e per costruzione
 * non porta economia (Ruling R31): qui si dice che c'è qualcosa da
 * guardare, il dettaglio si legge nella tab Fattura.
 */
function codaSdiEAvviso(f: Fattura): string {
  let coda = "";
  if (f.inviataDryRun) coda += " · prova SdI";
  if (f.eiErrore) coda += " · avviso: esito SdI/FiC da verificare nella tab Fattura";
  return coda;
}

/** Una riga di testo per fattura o nota di credito. NIENTE importi (ANTI-LEAK, Ruling R31): id, numero, data, stato leggibile, esito SdI. */
function rigaFatturazione(f: Fattura): string {
  if (f.tipo === "nota_credito") {
    const numero = f.numero ?? `#${f.id}`;
    return `Nota di credito n. ${numero}: ${ETICHETTA_STATO_FATTURA[f.stato]}${codaSdiEAvviso(f)}`;
  }
  if (f.stato === "bozza") {
    // Nessun conteggio di controlli: senza rileggere un computo fresco
    // (una query in più per una riga di testo) `verificaLimiti` non ha i
    // termini di paragone e restituirebbe un numero che non descrive la
    // bozza (Ruling R36). Quello che si sa senza chiedere niente a
    // nessuno è se l'operatore ha già deciso di derogare ai limiti: il
    // motivo, testo libero, resta nel registro della fattura.
    return `Fattura: bozza #${f.id}${f.scavalcoLimiti ? " · scavalco limiti attivo" : ""}`;
  }
  const numero = f.numero ?? `#${f.id}`;
  const conData = f.data ? ` del ${f.data}` : "";
  return `Fattura n. ${numero}${conData}: ${ETICHETTA_STATO_FATTURA[f.stato]}${codaSdiEAvviso(f)}`;
}

/**
 * La sezione «Fatturazione» del fascicolo (Task 17): chi chiama verifica
 * già `interruttoreAttivo("fatturazione")` prima di invocarla, per non
 * pagare la lettura quando la sezione non compare comunque. Ordinate per
 * id crescente: `fatturePerCommessa` torna «più recente prima».
 */
async function righeFatturazione(
  sedeId: number,
  commessaId: number,
  statoCommessa: string
): Promise<string[]> {
  const fatture = (await fatturePerCommessa(sedeId, commessaId))
    .slice()
    .sort((a, b) => a.id - b.id);
  if (fatture.length === 0) {
    // Solo nello stato in cui la bozza si genera dai limiti: prima (o
    // dopo, con la commessa già chiusa) «nessuna fattura» non è una
    // domanda aperta.
    return statoCommessa === "fatture_pagamento"
      ? ["Fattura: nessuna (bozza da generare dai limiti)"]
      : [];
  }
  return fatture.map(rigaFatturazione);
}

async function costruisciContenuto(
  sedeId: number,
  commessaId: number
): Promise<FascicoloCommessa | null> {
  const c: any = getCommessaById(commessaId);
  if (!c || c.sedeId !== sedeId) return null;

  const indice = STATI_COMMESSA.indexOf(c.stato);
  const docRichiesti = REQUIRED_DOC_TIPI_PER_STATO[c.stato] ?? [];
  const gateSoddisfatto = statoHasRequiredDoc(c.id, c.stato);
  // «Oggi» nel fuso del dominio (Europe/Rome), non in UTC: fra le 00:00 e
  // le 02:00 locali un ordine scaduto ieri deve già risultare in ritardo.
  const oggi = istanteComeLocale(new Date()).slice(0, 10);

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

  // Task 17: col flag spento `fatturazione` resta comunque `[]` (un campo
  // presente e vuoto, non assente) e `fonti`/`versioni` non guadagnano le
  // voci sotto legate alla fatturazione — non più «byte-identico» a prima
  // del task in senso stretto, ma il resto del fascicolo (gate, ordini,
  // domande aperte) sì.
  const fatturazioneAttiva = interruttoreAttivo("fatturazione");
  const fatturazione = fatturazioneAttiva
    ? await righeFatturazione(sedeId, c.id, c.stato)
    : [];

  const versioni: Record<string, string> = {
    [`commessa:${c.id}`]: versioneCorrente(`commessa:${c.id}`, sedeId) ?? "-",
    [`ordini-di-commessa:${c.id}`]:
      versioneCorrente(`ordini-di-commessa:${c.id}`, sedeId) ?? "-",
    // Il gate documentale dipende dai DOCUMENTI: un upload deve
    // invalidare il fascicolo (revisione: prima nessuna versione cambiava).
    [`documenti-di-commessa:${c.id}`]:
      versioneCorrente(`documenti-di-commessa:${c.id}`, sedeId) ?? "-",
    [`registroPagamenti:commessa:${c.id}`]:
      versioneCorrente(`registroPagamenti:commessa:${c.id}`, sedeId) ?? "-",
    // «inRitardo» dipende da oggi: il rollover di giornata invalida.
    "giorno-locale": versioneCorrente("giorno-locale", sedeId) ?? "-",
    // Ruling R33 (fix round 1): SEMPRE registrata, acceso o spento —
    // altrimenti una voce costruita col flag spento non porta alcuna
    // chiave che dipenda da esso, e un flip del flag a runtime passerebbe
    // inosservato finché non cambia anche qualcos'altro (fino al rollover
    // di giornata). Un riferimento che il registro non sa sondare è
    // fail-closed (null → ricostruzione), quindi la chiave deve esistere
    // ED essere sondabile: v. il ramo "flag" in versioni.ts.
    "flag:fatturazione": versioneCorrente("flag:fatturazione", sedeId) ?? "-",
    ...(fatturazioneAttiva
      ? {
          [`fatture-di-commessa:${c.id}`]:
            versioneCorrente(`fatture-di-commessa:${c.id}`, sedeId) ?? "-",
        }
      : {}),
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
    fatturazione,
    fonti: [
      "commessa CRM (stato, gate, date)",
      "ordini fornitori CRM (stati e date di consegna)",
      ...(fatturazioneAttiva ? ["fatture CRM (stato ed esito SdI, senza importi)"] : []),
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
    // Sincrona o asincrona (Task 17: costruisciContenuto ora legge le
    // fatture): i test esistenti passano ancora finti sincroni.
    costruttore?: (
      sedeId: number,
      commessaId: number
    ) => FascicoloCommessa | null | Promise<FascicoloCommessa | null>;
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
    contenuto = await costruttore(input.sedeId, input.commessaId);
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
