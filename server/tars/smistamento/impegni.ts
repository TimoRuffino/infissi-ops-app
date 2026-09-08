// Le promesse dette a parole, ritrovate (punto 28 del piano
// `2026-09-08-tars-piu-intelligente`).
//
// «Ti mando le misure lunedì». «Vi confermiamo la consegna entro il 20».
// Il CRM registrava i fatti — documenti, stati, date di sistema — e gettava
// gli impegni presi a parole, che sono il modo in cui il lavoro funziona
// davvero. Ora lo smistamento li estrae dal testo (con la frase originale
// come prova) e li salva dentro l'esito; qui si rileggono e si guarda
// quali stanno per scadere e quali sono già scadute.
//
// Sola lettura e deterministica: la lettura l'ha già fatta il modello,
// questa è aritmetica sulle date.

import { repositorySmistamentoCorrente } from "./repository";
import type { ImpegnoLetto, RecordSmistamento } from "./types";

/** Quanto indietro si guarda per raccogliere le promesse. */
export const GIORNI_INDIETRO_IMPEGNI = 45;
/** Una promessa entro questi giorni è «in scadenza». */
export const GIORNI_IN_SCADENZA = 7;

export type ImpegnoInScadenza = ImpegnoLetto & {
  comunicazioneId: number;
  commessaId: number | null;
  /** Negativo se è già passata. */
  giorniAllaScadenza: number;
  scaduto: boolean;
};

export type DipendenzeImpegni = {
  recenti: (input: {
    sedeId: number;
    daAggiornataAl: Date;
    limite: number;
  }) => Promise<RecordSmistamento[]>;
};

export function dipendenzeImpegniReali(): DipendenzeImpegni {
  return { recenti: input => repositorySmistamentoCorrente().recenti(input) };
}

function giorniFra(oggi: string, data: string): number {
  const t1 = Date.parse(`${oggi}T12:00:00Z`);
  const t2 = Date.parse(`${data}T12:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 0;
  return Math.round((t2 - t1) / 86_400_000);
}

/**
 * Le promesse vive di una sede: quelle scadute e quelle che scadono a
 * giorni. Le più urgenti (già scadute, poi le più vicine) per prime.
 */
export async function impegniDiSede(input: {
  sedeId: number;
  adesso: Date;
  deps?: DipendenzeImpegni;
  limite?: number;
}): Promise<ImpegnoInScadenza[]> {
  const deps = input.deps ?? dipendenzeImpegniReali();
  const oggi = input.adesso.toISOString().slice(0, 10);
  const record = await deps.recenti({
    sedeId: input.sedeId,
    daAggiornataAl: new Date(
      input.adesso.getTime() - GIORNI_INDIETRO_IMPEGNI * 86_400_000
    ),
    limite: input.limite ?? 200,
  });

  const impegni: ImpegnoInScadenza[] = [];
  for (const r of record) {
    for (const impegno of r.esito?.impegni ?? []) {
      const giorni = giorniFra(oggi, impegno.entro);
      // Una promessa mantenuta o dimenticata da un mese non serve più.
      if (giorni < -GIORNI_INDIETRO_IMPEGNI || giorni > GIORNI_IN_SCADENZA) continue;
      impegni.push({
        ...impegno,
        comunicazioneId: r.comunicazioneId,
        commessaId: r.esito?.collegamento?.commessaId ?? null,
        giorniAllaScadenza: giorni,
        scaduto: giorni < 0,
      });
    }
  }
  return impegni.sort((a, b) => a.giorniAllaScadenza - b.giorniAllaScadenza);
}

/** La riga per la fotografia: chi, cosa, quando, e la frase come prova. */
export function testoImpegno(i: ImpegnoInScadenza): string {
  const soggetto = i.chi === "noi" ? "Abbiamo promesso" : "Ci hanno promesso";
  const quando = i.scaduto
    ? `era per il ${i.entro}, ${Math.abs(i.giorniAllaScadenza)} giorni fa`
    : i.giorniAllaScadenza === 0
      ? `è per oggi (${i.entro})`
      : `è per il ${i.entro}, fra ${i.giorniAllaScadenza} giorni`;
  return `${soggetto} di ${i.cosa}: ${quando}. Testuale: «${i.frase}».`;
}
