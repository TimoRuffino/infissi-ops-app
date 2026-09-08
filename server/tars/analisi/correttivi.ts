// Cosa hai fatto invece (punto 24 del piano
// `2026-09-08-tars-piu-intelligente`).
//
// Il tasso di accettazione (punto 12) dice SE una proposta viene presa. Non
// dice cosa succede quando viene rifiutata e poi la cosa si fa lo stesso, in
// un altro modo: quella differenza è il segnale più forte che esista, e non
// veniva registrata da nessuna parte.
//
// Niente storage nuovo: la proposta rifiutata porta già l'azione che
// intendeva (`{strumento, input}`), e lo stato di adesso si legge dai
// domini. Due confronti, entrambi deterministici:
//   • transizione — proponevo lo stato X, la commessa è finita altrove;
//   • intervento — proponevo di pianificare, l'hai pianificato tu, a modo tuo.

import { STATI_COMMESSA } from "../../commesse/transizioni";
import type { RecordAnalisiAzienda } from "./types";

export type Correttivo = {
  chiave: string;
  commessaId: number;
  testo: string;
  /** Quando era stata proposta. */
  giorno: string;
};

export type DipendenzeCorrettivi = {
  commessa: (id: number) => { id: number; stato?: string | null } | null;
  interventiDi: (commessaId: number) => { tipo: string; dataPianificata?: string | null }[];
};

/** Lo stato da cui si arriva a `nuovo`: la proposta partiva da lì. */
function precedente(nuovo: string): string | null {
  const stati = STATI_COMMESSA as readonly string[];
  const i = stati.indexOf(nuovo);
  return i > 0 ? stati[i - 1] : null;
}

function argomenti(input: string): Record<string, unknown> | null {
  try {
    const valore = JSON.parse(input);
    return valore && typeof valore === "object" ? (valore as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Le proposte rifiutate che poi si sono avverate in un altro modo. Sola
 * lettura: nessuna correzione automatica, solo la constatazione — chi la
 * legge decide se la regola va cambiata.
 */
export function correttivi(
  record: readonly RecordAnalisiAzienda[],
  deps: DipendenzeCorrettivi
): Correttivo[] {
  const esito: Correttivo[] = [];
  for (const r of record) {
    for (const p of r.esito?.proposte ?? []) {
      if (p.esecuzione?.stato !== "scartata" || !p.azione) continue;
      const input = argomenti(p.azione.input);
      const commessaId = Number(input?.commessaId);
      if (!Number.isFinite(commessaId)) continue;
      const commessa = deps.commessa(commessaId);
      if (!commessa) continue;

      if (p.azione.strumento === "transizione_adiacente_commessa") {
        const proposto = String(input?.nuovoStato ?? "");
        const adesso = String(commessa.stato ?? "");
        const partenza = precedente(proposto);
        if (!proposto || !adesso || adesso === proposto || adesso === partenza) continue;
        esito.push({
          chiave: `correttivo:${r.giorno}:${commessaId}:stato`,
          commessaId,
          giorno: r.giorno,
          testo: `Il ${r.giorno} avevo proposto di portarla in «${proposto}» e l'hai scartata: adesso è in «${adesso}». Il passaggio serviva, la destinazione no.`,
        });
        continue;
      }

      if (p.azione.strumento === "pianifica_intervento") {
        const tipo = String(input?.tipo ?? "");
        const fatto = deps.interventiDi(commessaId).find(i => i.tipo === tipo);
        if (!tipo || !fatto) continue;
        esito.push({
          chiave: `correttivo:${r.giorno}:${commessaId}:${tipo}`,
          commessaId,
          giorno: r.giorno,
          testo: `Il ${r.giorno} avevo proposto di pianificare un ${tipo} e l'hai scartata: in agenda c'è comunque${fatto.dataPianificata ? ` (${fatto.dataPianificata})` : ""}. L'idea andava bene, il momento che dicevo no.`,
        });
      }
    }
  }
  return esito;
}
