// Quanto ci mette normalmente un lavoro a passare da uno stato al
// successivo, misurato sui lavori veri di questa azienda (punto 17 del
// piano `2026-09-08-tars-piu-intelligente`).
//
// Fino a oggi le soglie erano inventate a mano: sette giorni per
// sollecitare un preventivo, trenta per darlo perso, sessanta per
// dichiarare dormiente una commessa. Numeri ragionevoli, ma di nessuno.
// La timeline registra da sempre quando ogni milestone è stata completata,
// e da lì la mediana per stato si calcola: «in produzione da 40 giorni, la
// mediana è 18» dice qualcosa che «da 40 giorni» non dice.
//
// La mediana, non la media: un lavoro fermo sei mesi sposterebbe la media
// e non sposta la mediana. E si dichiara solo con un campione decente:
// sotto, si tace.

import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { getCommesseStore } from "../routers/commesse";
import { milestoneCompletate } from "../routers/timeline";

/** Sotto questo numero di passaggi osservati la mediana non è una misura. */
export const CAMPIONE_MINIMO_STATO = 5;
/** Oltre questo multiplo della mediana un lavoro è «più lento del solito». */
export const FATTORE_LENTEZZA = 2;
/** E comunque non si segnala niente sotto questi giorni: è rumore. */
export const GIORNI_MINIMI_SEGNALAZIONE = 7;

export type MedianaStato = {
  stato: string;
  /** Giorni: la metà dei lavori ci mette meno di così. */
  mediana: number;
  campione: number;
};

export type DipendenzeTempi = {
  commesse: () => any[];
  milestone: (commessaId: number) => { stato: string; quando: string }[];
};

export function dipendenzeTempiReali(): DipendenzeTempi {
  return {
    commesse: () => getCommesseStore() as any[],
    milestone: commessaId => milestoneCompletate(commessaId),
  };
}

function mediana(valori: number[]): number {
  const ordinati = [...valori].sort((a, b) => a - b);
  const meta = Math.floor(ordinati.length / 2);
  return ordinati.length % 2 === 1
    ? ordinati[meta]
    : Math.round((ordinati[meta - 1] + ordinati[meta]) / 2);
}

function giorniFra(da: string, a: string): number | null {
  const t1 = Date.parse(`${da}T12:00:00Z`);
  const t2 = Date.parse(`${a}T12:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  const giorni = Math.round((t2 - t1) / 86_400_000);
  return giorni >= 0 ? giorni : null;
}

/**
 * Quanto dura di solito ogni stato, in questa sede. Guarda anche i lavori
 * archiviati: è lì che sta la storia.
 */
export function medianePerStato(input: {
  sedeId: number;
  deps?: DipendenzeTempi;
}): Map<string, MedianaStato> {
  const deps = input.deps ?? dipendenzeTempiReali();
  const durate = new Map<string, number[]>();
  for (const commessa of deps.commesse()) {
    if ((commessa.sedeId ?? DEFAULT_SEDE_ID) !== input.sedeId) continue;
    const tappe = deps.milestone(commessa.id);
    for (let i = 0; i < tappe.length - 1; i++) {
      const giorni = giorniFra(tappe[i].quando, tappe[i + 1].quando);
      if (giorni == null) continue;
      const lista = durate.get(tappe[i].stato) ?? [];
      lista.push(giorni);
      durate.set(tappe[i].stato, lista);
    }
  }
  const mappa = new Map<string, MedianaStato>();
  for (const [stato, valori] of durate) {
    if (valori.length < CAMPIONE_MINIMO_STATO) continue;
    mappa.set(stato, { stato, mediana: mediana(valori), campione: valori.length });
  }
  return mappa;
}

export type CommessaLenta = {
  commessaId: number;
  stato: string;
  giorni: number;
  mediana: number;
  campione: number;
};

/**
 * I lavori che stanno nel loro stato molto più a lungo del normale per
 * questa azienda. Non è «ferma da tanto»: è «ferma più di quanto dica la
 * tua storia», che è una cosa che si può discutere.
 */
export function piuLenteDelSolito(input: {
  mediane: Map<string, MedianaStato>;
  commesse: readonly { id: number; stato: string }[];
  giorniNelloStato: (commessaId: number) => number | null;
}): CommessaLenta[] {
  const lente: CommessaLenta[] = [];
  for (const commessa of input.commesse) {
    const riferimento = input.mediane.get(commessa.stato);
    if (!riferimento) continue;
    const giorni = input.giorniNelloStato(commessa.id);
    if (giorni == null || giorni < GIORNI_MINIMI_SEGNALAZIONE) continue;
    if (giorni < Math.max(riferimento.mediana * FATTORE_LENTEZZA, GIORNI_MINIMI_SEGNALAZIONE))
      continue;
    lente.push({
      commessaId: commessa.id,
      stato: commessa.stato,
      giorni,
      mediana: riferimento.mediana,
      campione: riferimento.campione,
    });
  }
  return lente.sort((a, b) => b.giorni / b.mediana - a.giorni / a.mediana);
}

/**
 * Il giro completo per una sede: mediane dalla storia, poi i lavori vivi
 * che le sforano. `giorniNelloStato` si legge dalla milestone che ha fatto
 * entrare la commessa nello stato in cui è.
 */
export function commesseLenteDiSede(input: {
  sedeId: number;
  adesso: Date;
  deps?: DipendenzeTempi;
}): { mediane: Map<string, MedianaStato>; lente: CommessaLenta[] } {
  const deps = input.deps ?? dipendenzeTempiReali();
  const mediane = medianePerStato({ sedeId: input.sedeId, deps });
  const oggi = input.adesso.toISOString().slice(0, 10);
  const vive = deps
    .commesse()
    .filter(
      c =>
        (c.sedeId ?? DEFAULT_SEDE_ID) === input.sedeId &&
        !c.archivedAt &&
        c.stato !== "archiviata"
    );
  const lente = piuLenteDelSolito({
    mediane,
    commesse: vive.map(c => ({ id: c.id, stato: String(c.stato ?? "") })),
    giorniNelloStato: commessaId => {
      const commessa = vive.find(c => c.id === commessaId);
      if (!commessa) return null;
      const tappe = deps.milestone(commessaId);
      const entrata = [...tappe].reverse().find(t => t.stato === commessa.stato);
      return entrata ? giorniFra(entrata.quando, oggi) : null;
    },
  });
  return { mediane, lente };
}
