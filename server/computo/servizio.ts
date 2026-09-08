// Orchestrazione del computo: legge contratto e righe, carica le tariffe,
// invoca il motore puro, salva la fotografia. «Valido» è una domanda sugli
// hash: se righe o parametri sono cambiati dopo l'ultimo computo, il gate
// e la UI lo dicono e chiedono di ricalcolare. Le correzioni a mano
// (08/09/2026) sono parametri del contratto come le altre opzioni del
// computo: si scrivono qui, con l'hash aggiornato, e il computo si rifà subito.
import { hashParametri } from "../contratti/hash";
import { getContrattiRepository } from "../contratti/repository";
import { leggiContratto } from "../contratti/servizio";
import type { Computo, Contratto, CorrezioneVoce, RigaContratto } from "@shared/limiti/tipi";
import { calcolaLimiti, type EsitoMotore } from "./motore";
import { getComputiRepository, type IntestazioneComputo } from "./repository";
import { tariffeAttive, type Tariffe } from "./tariffe";

function calcola(contratto: Contratto, righe: RigaContratto[], now: Date): { esito: EsitoMotore; tariffe: Tariffe } {
  const tariffe = tariffeAttive(now);
  const esito = calcolaLimiti(
    righe,
    {
      zona: contratto.zonaClimatica,
      piano: contratto.piano,
      distanzaKm: contratto.distanzaKm,
      pattuitoCent: contratto.pattuitoCent,
      pattuitoTipo: contratto.pattuitoTipo,
      detrazioneTipo: contratto.detrazioneTipo,
      detrazionePct: contratto.detrazionePct,
      opzioni: contratto.opzioniComputo,
    },
    tariffe
  );
  return { esito, tariffe };
}

function salvaComputo(
  contratto: Contratto,
  esito: EsitoMotore,
  tariffe: Tariffe,
  actorUserId: number | null,
  now: Date
): Promise<Computo> {
  return getComputiRepository().salva({
    now,
    computo: {
      sedeId: contratto.sedeId,
      commessaId: contratto.commessaId,
      hashRighe: contratto.hashRighe,
      hashParametri: contratto.hashParametri,
      tariffeAl: tariffe.versione,
      zona: contratto.zonaClimatica,
      esito: esito.esito,
      check1Cent: esito.check1Cent,
      check2Cent: esito.check2Cent,
      deiProdottiCent: esito.deiProdottiCent,
      limiteCent: esito.limiteCent,
      detraibileCent: esito.detraibileCent,
      detrazioneStimataCent: esito.detrazioneStimataCent,
      avvertenze: esito.avvertenze,
      voci: esito.voci,
      createdBy: actorUserId,
    },
  });
}

export async function eseguiComputo(input: {
  sedeId: number;
  commessaId: number;
  actorUserId: number | null;
  now?: Date;
}): Promise<Computo> {
  const now = input.now ?? new Date();
  const { contratto, righe } = await leggiContratto(input.sedeId, input.commessaId);
  if (!contratto) {
    throw new Error("NOT_FOUND: Contratto non trovato per questa commessa.");
  }
  const { esito, tariffe } = calcola(contratto, righe, now);
  return salvaComputo(contratto, esito, tariffe, input.actorUserId, now);
}

/**
 * Una correzione a mano su una voce del computo (08/09/2026, «devo poter
 * modificare i limiti dal gestionale»): si scrive nelle opzioni del computo
 * del contratto — con l'hash dei parametri aggiornato — e il computo si rifà
 * subito, così tab, stampa e fattura vedono lo stesso numero. `null` toglie
 * la correzione e torna al calcolo. Il codice deve esistere nel computo di
 * questa commessa; una correzione senza valori non è una correzione.
 */
export async function correggiVoce(input: {
  sedeId: number;
  commessaId: number;
  actorUserId: number | null;
  codice: string;
  correzione: Omit<CorrezioneVoce, "codice"> | null;
  now?: Date;
}): Promise<{ computo: Computo; valido: boolean; motivo: string | null }> {
  const now = input.now ?? new Date();
  const { contratto, righe } = await leggiContratto(input.sedeId, input.commessaId);
  if (!contratto) {
    throw new Error("NOT_FOUND: Contratto non trovato per questa commessa.");
  }
  const altre = (contratto.opzioniComputo.correzioni ?? []).filter(c => c.codice !== input.codice);
  let correzioni: CorrezioneVoce[] = altre;
  if (input.correzione) {
    const c = input.correzione;
    if (c.quantita == null && c.prezzoUnitCent == null && c.limiteCent == null && c.inclusa == null) {
      throw new Error(
        "VALIDAZIONE: una correzione senza quantità, prezzo, limite o inclusione non è una correzione: usa «Ripristina il calcolo»."
      );
    }
    correzioni = [
      ...altre,
      {
        codice: input.codice,
        quantita: c.quantita,
        prezzoUnitCent: c.prezzoUnitCent,
        limiteCent: c.limiteCent,
        inclusa: c.inclusa,
        motivo: c.motivo?.trim() || null,
      },
    ];
  }
  const opzioniComputo = { ...contratto.opzioniComputo, correzioni };
  const aggiornato: Contratto = { ...contratto, opzioniComputo };
  const { esito, tariffe } = calcola(aggiornato, righe, now);
  if (input.correzione && !esito.voci.some(v => v.codice === input.codice)) {
    throw new Error(`VALIDAZIONE: la voce «${input.codice}» non esiste nel computo di questa commessa.`);
  }
  const salvato = await getContrattiRepository().aggiornaOpzioniComputo({
    sedeId: input.sedeId,
    commessaId: input.commessaId,
    opzioniComputo,
    hashParametri: hashParametri(aggiornato),
    updatedBy: input.actorUserId,
    now,
  });
  const computo = await salvaComputo(salvato, esito, tariffe, input.actorUserId, now);
  return { computo, ...giudizio(salvato, computo) };
}

/**
 * Cancella tutti i computi della commessa (08/09/2026, «devo poter eliminare
 * i limiti già fatti»): il passo Limiti torna «da fare», il gate sulla
 * transizione torna a chiedere il computo, una bozza di fattura resta ma
 * senza limiti da controllare (`computo_assente`). Contratto e correzioni a
 * mano restano: si ricalcola quando serve. NOT_FOUND se la commessa non è
 * di questa sede (la decide `leggiContratto`, come per il calcolo).
 */
export async function eliminaComputi(input: {
  sedeId: number;
  commessaId: number;
  actorUserId: number | null;
}): Promise<{ eliminati: number }> {
  const { contratto } = await leggiContratto(input.sedeId, input.commessaId);
  const commessaEsiste = contratto != null || (await getComputiRepository().ultimoIntestazione(input.sedeId, input.commessaId)) != null;
  if (!commessaEsiste) return { eliminati: 0 };
  const eliminati = await getComputiRepository().elimina(input.sedeId, input.commessaId);
  return { eliminati };
}

/**
 * «È ancora valido?» è una domanda sulla sola intestazione: hash delle righe,
 * hash dei parametri, esito. Le voci non entrano nel giudizio, quindi il
 * predicato non le fa nemmeno leggere.
 */
function giudizio(
  contratto: Contratto | null,
  computo: IntestazioneComputo | null
): { valido: boolean; motivo: string | null } {
  if (!contratto) return { valido: false, motivo: "Manca il contratto." };
  if (!computo) return { valido: false, motivo: "Nessun computo eseguito." };
  if (computo.hashRighe !== contratto.hashRighe) {
    return { valido: false, motivo: "Le righe del contratto sono cambiate dopo il computo." };
  }
  if (computo.hashParametri !== contratto.hashParametri) {
    return { valido: false, motivo: "I parametri del contratto sono cambiati dopo il computo." };
  }
  if (computo.esito !== "ok") {
    return { valido: false, motivo: "Il computo è incompleto: " + computo.avvertenze.join(" ") };
  }
  return { valido: true, motivo: null };
}

export async function ultimoComputo(
  sedeId: number,
  commessaId: number
): Promise<{ computo: Computo | null; valido: boolean; motivo: string | null }> {
  // La UI mostra le voci: qui il computo si legge intero.
  const [{ contratto }, computo] = await Promise.all([
    leggiContratto(sedeId, commessaId),
    getComputiRepository().ultimo(sedeId, commessaId),
  ]);
  return { computo, ...giudizio(contratto, computo) };
}

/**
 * Come `ultimoComputo`, ma senza le voci e senza rileggere il contratto: il
 * chiamante lo ha già in mano. Legge SOLO `ultimoIntestazione` (mai
 * `computo_voci`) e applica lo stesso `giudizio` — per un elenco che deve
 * sapere solo «è valido?», mai mostrare il dettaglio del computo
 * (Ruling P4-R15: 1 query invece delle 2+2 di `ultimoComputo` per commessa).
 */
export async function statoComputoLeggero(
  sedeId: number,
  commessaId: number,
  contratto: Contratto | null
): Promise<{ computo: IntestazioneComputo | null; valido: boolean; motivo: string | null }> {
  const intestazione = await getComputiRepository().ultimoIntestazione(sedeId, commessaId);
  return { computo: intestazione, ...giudizio(contratto, intestazione) };
}

export async function computoValido(sedeId: number, commessaId: number): Promise<boolean> {
  const [{ contratto }, intestazione] = await Promise.all([
    leggiContratto(sedeId, commessaId),
    getComputiRepository().ultimoIntestazione(sedeId, commessaId),
  ]);
  return giudizio(contratto, intestazione).valido;
}
