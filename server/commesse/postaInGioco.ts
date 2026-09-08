// Quanto costa ignorare una cosa (punti 8 e 22 del piano
// `2026-09-08-tars-piu-intelligente`).
//
// Le proposte del mattino non erano ordinate per posta in gioco: il gate su
// un lavoro da quarantamila stava accanto alla nota su una dormiente. E il
// margine non si nominava mai — «Mai importi in euro» proteggeva dalle
// cifre inventate dal modello e costava la frase che conta.
//
// La regola, decisa dalla direzione l'08/09/2026: **il flag lo vedono
// tutti, la cifra solo la direzione**. Quindi il modello riceve soltanto un
// segnale («questa commessa è sotto la soglia di margine»), i numeri li
// calcola il codice e li mette accanto alla proposta, e il filtro dei
// destinatari li toglie a chi non è direzione.

import { calcolaMargine } from "../_core/margine";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { getCommesseStore } from "../routers/commesse";

/** Sotto questa quota di margine un lavoro merita una riga. */
export function sogliaMargine(): number {
  const n = Number.parseFloat(process.env.TARS_MARGINE_MINIMO ?? "");
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.2;
}

export type PostaCommessa = {
  commessaId: number;
  /** Quanto resta da incassare: è il denaro esposto se la cosa si ferma. */
  residuo: number;
  marginePerc: number | null;
  /** Il segnale che vede anche chi non può vedere le cifre. */
  sottoMargine: boolean;
  /** Nessun imponibile o nessun costo: il margine non è ancora una misura. */
  datiIncompleti: boolean;
};

export type DipendenzePosta = {
  commesse: () => any[];
};

export function dipendenzePostaReali(): DipendenzePosta {
  return { commesse: () => getCommesseStore() as any[] };
}

/** La posta in gioco di ogni commessa viva della sede. */
export function postaInGiocoDiSede(input: {
  sedeId: number;
  deps?: DipendenzePosta;
}): Map<number, PostaCommessa> {
  const deps = input.deps ?? dipendenzePostaReali();
  const soglia = sogliaMargine();
  const mappa = new Map<number, PostaCommessa>();
  for (const c of deps.commesse()) {
    if ((c.sedeId ?? DEFAULT_SEDE_ID) !== input.sedeId) continue;
    if (c.archivedAt || c.stato === "archiviata") continue;
    const margine = calcolaMargine(c);
    const totale = Number(c.importoTotale ?? 0);
    const incassato = Number(c.importoIncassato ?? 0);
    mappa.set(c.id, {
      commessaId: c.id,
      residuo: Math.max(0, Math.round((totale - incassato) * 100) / 100),
      marginePerc: margine.marginePerc,
      sottoMargine:
        !margine.datiIncompleti &&
        margine.marginePerc != null &&
        margine.marginePerc < soglia,
      datiIncompleti: margine.datiIncompleti,
    });
  }
  return mappa;
}

/**
 * La posta dietro ogni riferimento della fotografia. Serve a ordinare le
 * proposte per quanto costa ignorarle e a scrivere le cifre accanto a
 * quelle della direzione: non entra MAI nel testo che legge il modello.
 */
export function postaPerEntita(
  posta: Map<number, PostaCommessa>
): Record<string, { residuo: number; marginePerc: number | null }> {
  const peso: Record<string, { residuo: number; marginePerc: number | null }> = {};
  for (const [id, riga] of posta) {
    peso[`commessa:${id}`] = { residuo: riga.residuo, marginePerc: riga.marginePerc };
  }
  return peso;
}
