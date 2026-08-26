// Esecuzione autonoma delle proposte.
//
// Fino al 26/08/2026 Tars proponeva e basta: ogni scrittura aspettava un
// click. Il costo di quel modello non era la sicurezza ma l'attesa — decine
// di conferme al giorno su azioni che venivano approvate comunque, e token
// spesi a richiedere permessi invece che a lavorare.
//
// Da qui l'autonomia, con tre confini che restano fermi:
//
//   1. i tipi irreversibili non entrano mai (`TIPI_IRREVERSIBILI`);
//   2. l'esecuzione è attribuita a un utente reale della sede, con i suoi
//      permessi — non a un principal onnipotente. Se quell'utente non
//      potrebbe fare l'azione a mano, Tars non la fa al posto suo;
//   3. ogni esecuzione viene annunciata. "Deve sempre dire cosa fa" non è
//      una cortesia: è la condizione che rende l'autonomia reversibile,
//      perché nessuno può annullare quello che non ha visto.
//
// Se una qualsiasi delle tre non è soddisfatta, la proposta resta pendente e
// l'operatore la approva come prima. Fallire in chiuso, mai in aperto.

import type { TrpcContext } from "../../_core/context";
import { getUtentiStore } from "../../routers/utenti";
import {
  getTarsConfig,
  proposte,
  TIPI_IRREVERSIBILI,
  type TipoProposta,
} from "../stores";

export type EsitoValutazioneAutonomia = {
  consentito: boolean;
  motivo: string;
};

export function valutaAutonomia(input: {
  sedeId: number;
  tipo: TipoProposta;
}): EsitoValutazioneAutonomia {
  const config = getTarsConfig(input.sedeId);
  const autonomia = config.autonomia;
  if (TIPI_IRREVERSIBILI.includes(input.tipo)) {
    return {
      consentito: false,
      motivo: "azione senza ritorno: resta all'approvazione umana",
    };
  }
  if (!autonomia?.attiva) {
    return { consentito: false, motivo: "autonomia non attiva per la sede" };
  }
  if (autonomia.killSwitch) {
    return { consentito: false, motivo: "kill switch attivo" };
  }
  if (!autonomia.tipiConsentiti.includes(input.tipo)) {
    return {
      consentito: false,
      motivo: `tipo "${input.tipo}" fuori dai tipi consentiti`,
    };
  }
  if (autonomia.principalUserId == null) {
    return {
      consentito: false,
      motivo: "nessun utente responsabile configurato",
    };
  }
  return { consentito: true, motivo: "consentita dalla configurazione di sede" };
}

/**
 * Il contesto con cui gira un'esecuzione autonoma: l'utente configurato
 * dalla direzione, con i suoi ruoli veri. `autonomo` è una marcatura per
 * l'audit, non un permesso.
 */
export function contestoAutonomo(sedeId: number): TrpcContext | null {
  const config = getTarsConfig(sedeId);
  const userId = config.autonomia?.principalUserId;
  if (userId == null) return null;
  const utente: any = getUtentiStore().find(
    (u: any) =>
      Number(u.id) === Number(userId) &&
      u.attivo !== false &&
      Array.isArray(u.sediIds) &&
      u.sediIds.includes(sedeId)
  );
  if (!utente) return null;
  return {
    user: { ...utente, autonomo: true } as any,
    req: { protocol: "https", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

export type EsecuzioneAutonoma = {
  propostaId: number;
  tipo: TipoProposta;
  titolo: string;
  commessaId: number | null;
  eseguita: boolean;
  esito: string;
};

/**
 * Esegue in autonomia le proposte indicate, saltando in silenzio quelle non
 * ammesse — restano pendenti e visibili, che è il comportamento di prima.
 *
 * Non lancia: un errore su una proposta non deve fermare le altre né far
 * fallire il run di Tars che le ha create. La proposta fallita passa a
 * `errore` come se un operatore avesse cliccato approva, quindi resta
 * visibile con il motivo.
 */
export async function eseguiProposteAutonome(input: {
  sedeId: number;
  propostaIds: readonly number[];
  approva: (id: number, ctx: TrpcContext) => Promise<any>;
  annuncia?: (esecuzioni: EsecuzioneAutonoma[]) => Promise<void> | void;
}): Promise<EsecuzioneAutonoma[]> {
  const ctx = contestoAutonomo(input.sedeId);
  if (!ctx) return [];

  const eseguite: EsecuzioneAutonoma[] = [];
  for (const id of input.propostaIds) {
    const proposta = proposte.find(p => p.id === id);
    if (!proposta || proposta.sedeId !== input.sedeId) continue;
    if (proposta.stato !== "pendente") continue;
    if (!valutaAutonomia({ sedeId: input.sedeId, tipo: proposta.tipo }).consentito) {
      continue;
    }
    try {
      const risultato = await input.approva(id, ctx);
      eseguite.push({
        propostaId: id,
        tipo: proposta.tipo,
        titolo: proposta.titolo,
        commessaId: proposta.commessaId ?? null,
        eseguita: risultato?.stato !== "errore",
        esito: String(risultato?.esito ?? "eseguita"),
      });
    } catch (errore: any) {
      eseguite.push({
        propostaId: id,
        tipo: proposta.tipo,
        titolo: proposta.titolo,
        commessaId: proposta.commessaId ?? null,
        eseguita: false,
        esito: errore?.message ?? String(errore),
      });
    }
  }

  // L'annuncio è parte dell'operazione, non un effetto collaterale: se il
  // canale è rotto lo diciamo nei log, ma non si torna indietro sulle
  // scritture già fatte — sarebbe peggio.
  if (eseguite.length > 0 && input.annuncia) {
    try {
      await input.annuncia(eseguite);
    } catch (errore: any) {
      console.error(
        `[tars] annuncio autonomia sede ${input.sedeId} fallito:`,
        errore?.message ?? errore
      );
    }
  }
  return eseguite;
}
