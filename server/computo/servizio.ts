// Orchestrazione del computo: legge contratto e righe, carica le tariffe,
// invoca il motore puro, salva la fotografia. «Valido» è una domanda sugli
// hash: se righe o parametri sono cambiati dopo l'ultimo computo, il gate
// e la UI lo dicono e chiedono di ricalcolare.
import { leggiContratto } from "../contratti/servizio";
import type { Computo, Contratto } from "@shared/limiti/tipi";
import { calcolaLimiti } from "./motore";
import { getComputiRepository, type IntestazioneComputo } from "./repository";
import { tariffeAttive } from "./tariffe";

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
  return getComputiRepository().salva({
    now,
    computo: {
      sedeId: input.sedeId,
      commessaId: input.commessaId,
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
      createdBy: input.actorUserId,
    },
  });
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

export async function computoValido(sedeId: number, commessaId: number): Promise<boolean> {
  const [{ contratto }, intestazione] = await Promise.all([
    leggiContratto(sedeId, commessaId),
    getComputiRepository().ultimoIntestazione(sedeId, commessaId),
  ]);
  return giudizio(contratto, intestazione).valido;
}
