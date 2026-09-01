// Pattern aziendali (T7) — aggregazioni DETERMINISTICHE, zero token.
//
// Solo entro la sede, su finestre dichiarate e detector versionati; ogni
// pattern richiede un campione minimo di commesse distinte, dichiara la
// baseline e resta una CORRELAZIONE: la causa la decide una persona.
// Fonti: le osservazioni persistite (T6) e il registro reale delle
// transizioni di commessa. Nessun importo entra mai nei risultati.

import { storeTransizioniCommessa } from "../../commesse/transizioni";
import {
  repositoryOsservazioniCorrente,
  type RepositoryOsservazioni,
} from "./repository";
import type { OsservazioneTars } from "./types";

export const VERSIONE_PATTERN = "1.0.0";
export const CAMPIONE_MINIMO_COMMESSE = 3;
export const FINESTRA_DEFAULT_GIORNI = 30;
const MAX_EVIDENZE_PATTERN = 10;

export type EvidenzaPattern = {
  tipo: "osservazione" | "transizione";
  riferimento: string;
  descrizione: string;
};

export type PatternAzienda = {
  chiave: string;
  titolo: string;
  versione: string;
  periodo: { da: string; a: string; giorni: number };
  campione: {
    commesse: number;
    eventi: number;
    minimoCommesse: number;
  };
  baseline: string;
  misura: string;
  confidenza: "media" | "alta";
  /** Sempre true: i pattern sono correlazioni, mai cause dimostrate. */
  correlazione: true;
  avvertenza: string;
  evidenze: EvidenzaPattern[];
  dettagli: Record<string, unknown>;
};

export type EsitoPatternAzienda = {
  sedeId: number;
  periodo: { da: string; a: string; giorni: number };
  versione: string;
  pattern: PatternAzienda[];
  /** Pattern calcolati ma soppressi per campione insufficiente: dichiarati. */
  soppressi: { chiave: string; motivo: string }[];
};

const AVVERTENZA_CAUSALITA =
  "Correlazione osservata nei dati del periodo, non una causa dimostrata: verifica sul campo prima di decidere.";

function commesseDistinte(osservazioni: readonly OsservazioneTars[]): number {
  return new Set(
    osservazioni
      .map(osservazione => osservazione.commessaId)
      .filter((id): id is number => id != null)
  ).size;
}

function evidenzeDaOsservazioni(
  osservazioni: readonly OsservazioneTars[]
): EvidenzaPattern[] {
  return osservazioni.slice(0, MAX_EVIDENZE_PATTERN).map(osservazione => ({
    tipo: "osservazione" as const,
    riferimento: `osservazione:${osservazione.id}`,
    descrizione: osservazione.titolo,
  }));
}

function confidenzaDaCampione(commesse: number): "media" | "alta" {
  return commesse >= CAMPIONE_MINIMO_COMMESSE * 2 ? "alta" : "media";
}

type CostruttorePattern = (input: {
  sedeId: number;
  da: Date;
  a: Date;
  giorni: number;
  osservazioni: readonly OsservazioneTars[];
}) =>
  | { pattern: PatternAzienda }
  | { soppresso: { chiave: string; motivo: string } }
  | null;

function patternDaDetector(input: {
  chiave: string;
  titolo: string;
  detectors: readonly string[];
  baseline: string;
  misuraDi: (eventi: number, commesse: number) => string;
  minimoCommesse?: number;
}): CostruttorePattern {
  return ({ da, a, giorni, osservazioni }) => {
    const rilevanti = osservazioni.filter(osservazione =>
      input.detectors.includes(osservazione.detector)
    );
    if (rilevanti.length === 0) return null;
    const commesse = commesseDistinte(rilevanti);
    const minimo = input.minimoCommesse ?? CAMPIONE_MINIMO_COMMESSE;
    if (commesse < minimo) {
      return {
        soppresso: {
          chiave: input.chiave,
          motivo: `campione insufficiente: ${commesse} commesse distinte su un minimo di ${minimo}`,
        },
      };
    }
    return {
      pattern: {
        chiave: input.chiave,
        titolo: input.titolo,
        versione: VERSIONE_PATTERN,
        periodo: { da: da.toISOString(), a: a.toISOString(), giorni },
        campione: {
          commesse,
          eventi: rilevanti.length,
          minimoCommesse: minimo,
        },
        baseline: input.baseline,
        misura: input.misuraDi(rilevanti.length, commesse),
        confidenza: confidenzaDaCampione(commesse),
        correlazione: true,
        avvertenza: AVVERTENZA_CAUSALITA,
        evidenze: evidenzeDaOsservazioni(rilevanti),
        dettagli: {
          detectors: input.detectors,
          perDetector: Object.fromEntries(
            input.detectors.map(detector => [
              detector,
              rilevanti.filter(o => o.detector === detector).length,
            ])
          ),
        },
      },
    };
  };
}

const COSTRUTTORI: CostruttorePattern[] = [
  patternDaDetector({
    chiave: "ritardi_fornitore",
    titolo: "Consegne fornitore in ritardo ricorrenti",
    detectors: ["consegna_fornitore", "consegna"],
    baseline: "commesse della sede con segnali di consegna nel periodo",
    misuraDi: (eventi, commesse) =>
      `${eventi} segnali di consegna in ritardo su ${commesse} commesse distinte nel periodo`,
  }),
  patternDaDetector({
    chiave: "colli_di_bottiglia",
    titolo: "Commesse ferme oltre la soglia nella stessa fase",
    detectors: ["priority_aging", "stato_daily", "stato_role"],
    baseline: "soglie di permanenza per stato già usate dal Centro Azioni",
    misuraDi: (eventi, commesse) =>
      `${eventi} segnali di permanenza oltre soglia su ${commesse} commesse distinte`,
  }),
  patternDaDetector({
    chiave: "ricorrenze_post_vendita",
    titolo: "Ricorrenze post-vendita (ticket, garanzie, interventi)",
    detectors: ["ticket", "garanzia", "intervento"],
    baseline: "commesse della sede con segnali post-vendita nel periodo",
    misuraDi: (eventi, commesse) =>
      `${eventi} segnali post-vendita su ${commesse} commesse distinte`,
  }),
];

function patternPermanenzaFase(input: {
  sedeId: number;
  da: Date;
  a: Date;
  giorni: number;
}):
  | { pattern: PatternAzienda }
  | { soppresso: { chiave: string; motivo: string } }
  | null {
  // Permanenze CONCLUSE nel periodo: dall'ingresso in uno stato (transizione
  // verso X) all'uscita (transizione successiva della stessa commessa).
  const transizioni = storeTransizioniCommessa.items
    .filter(riga => riga.sedeId === input.sedeId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (transizioni.length === 0) return null;

  const perCommessa = new Map<number, typeof transizioni>();
  for (const riga of transizioni) {
    // Le compensazioni (undo) non sono permanenze reali: una coppia
    // avanzamento+annullo produrrebbe durate fantasma di pochi minuti e
    // falsi ingressi di fase (revisione R2#3).
    if (riga.compensaTransizioneId != null || riga.compensataDaId != null) {
      continue;
    }
    const lista = perCommessa.get(riga.commessaId) ?? [];
    lista.push(riga);
    perCommessa.set(riga.commessaId, lista);
  }

  const permanenze: {
    stato: string;
    giorni: number;
    commessaId: number;
    transizioneId: number;
  }[] = [];
  for (const [commessaId, lista] of perCommessa) {
    for (let i = 0; i + 1 < lista.length; i += 1) {
      const ingresso = lista[i];
      const uscita = lista[i + 1];
      if (uscita.createdAt.getTime() < input.da.getTime()) continue;
      if (ingresso.createdAt.getTime() > input.a.getTime()) continue;
      const stato = String(ingresso.dopo?.stato ?? "");
      if (!stato) continue;
      permanenze.push({
        stato,
        commessaId,
        transizioneId: uscita.id,
        giorni:
          (uscita.createdAt.getTime() - ingresso.createdAt.getTime()) /
          86_400_000,
      });
    }
  }
  if (permanenze.length === 0) return null;

  const perStato = new Map<string, typeof permanenze>();
  for (const permanenza of permanenze) {
    const lista = perStato.get(permanenza.stato) ?? [];
    lista.push(permanenza);
    perStato.set(permanenza.stato, lista);
  }
  const mediaComplessiva =
    permanenze.reduce((somma, p) => somma + p.giorni, 0) / permanenze.length;

  let peggiore: { stato: string; media: number; voci: typeof permanenze } | null =
    null;
  for (const [stato, voci] of perStato) {
    const commesse = new Set(voci.map(v => v.commessaId)).size;
    if (commesse < CAMPIONE_MINIMO_COMMESSE) continue;
    const media = voci.reduce((somma, v) => somma + v.giorni, 0) / voci.length;
    if (!peggiore || media > peggiore.media) {
      peggiore = { stato, media, voci };
    }
  }
  if (!peggiore) {
    return {
      soppresso: {
        chiave: "permanenza_fase",
        motivo: `nessuno stato con almeno ${CAMPIONE_MINIMO_COMMESSE} commesse distinte con permanenze concluse nel periodo`,
      },
    };
  }
  const commesse = new Set(peggiore.voci.map(v => v.commessaId)).size;
  return {
    pattern: {
      chiave: "permanenza_fase",
      titolo: `Permanenza media più alta nella fase «${peggiore.stato}»`,
      versione: VERSIONE_PATTERN,
      periodo: {
        da: input.da.toISOString(),
        a: input.a.toISOString(),
        giorni: input.giorni,
      },
      campione: {
        commesse,
        eventi: peggiore.voci.length,
        minimoCommesse: CAMPIONE_MINIMO_COMMESSE,
      },
      baseline: `permanenza media complessiva del periodo: ${mediaComplessiva.toFixed(1)} giorni`,
      misura: `media di ${peggiore.media.toFixed(1)} giorni in «${peggiore.stato}» su ${commesse} commesse`,
      confidenza: confidenzaDaCampione(commesse),
      correlazione: true,
      avvertenza: AVVERTENZA_CAUSALITA,
      evidenze: peggiore.voci.slice(0, MAX_EVIDENZE_PATTERN).map(voce => ({
        tipo: "transizione" as const,
        riferimento: `commesse_transizioni:${voce.transizioneId}`,
        descrizione: `commessa ${voce.commessaId}: ${voce.giorni.toFixed(1)} giorni in ${voce.stato}`,
      })),
      dettagli: {
        perStato: Object.fromEntries(
          [...perStato.entries()].map(([stato, voci]) => [
            stato,
            {
              permanenze: voci.length,
              mediaGiorni: Number(
                (
                  voci.reduce((somma, v) => somma + v.giorni, 0) / voci.length
                ).toFixed(1)
              ),
            },
          ])
        ),
      },
    },
  };
}

function patternGateBypass(input: {
  sedeId: number;
  da: Date;
  a: Date;
  giorni: number;
}):
  | { pattern: PatternAzienda }
  | { soppresso: { chiave: string; motivo: string } }
  | null {
  const nelPeriodo = storeTransizioniCommessa.items.filter(
    riga =>
      riga.sedeId === input.sedeId &&
      riga.createdAt.getTime() >= input.da.getTime() &&
      riga.createdAt.getTime() <= input.a.getTime()
  );
  const bypass = nelPeriodo.filter(riga => riga.bypassGateDocumentale);
  if (bypass.length === 0) return null;
  const commesse = new Set(bypass.map(riga => riga.commessaId)).size;
  if (commesse < CAMPIONE_MINIMO_COMMESSE) {
    return {
      soppresso: {
        chiave: "documenti_gate",
        motivo: `campione insufficiente: ${commesse} commesse con bypass del gate su un minimo di ${CAMPIONE_MINIMO_COMMESSE}`,
      },
    };
  }
  return {
    pattern: {
      chiave: "documenti_gate",
      titolo: "Gate documentale scavalcato con force ricorrente",
      versione: VERSIONE_PATTERN,
      periodo: {
        da: input.da.toISOString(),
        a: input.a.toISOString(),
        giorni: input.giorni,
      },
      campione: {
        commesse,
        eventi: bypass.length,
        minimoCommesse: CAMPIONE_MINIMO_COMMESSE,
      },
      baseline: `${nelPeriodo.length} transizioni totali della sede nel periodo`,
      misura: `${bypass.length} transizioni con bypass del gate documentale su ${commesse} commesse distinte`,
      confidenza: confidenzaDaCampione(commesse),
      correlazione: true,
      avvertenza: AVVERTENZA_CAUSALITA,
      evidenze: bypass.slice(0, MAX_EVIDENZE_PATTERN).map(riga => ({
        tipo: "transizione" as const,
        riferimento: `commesse_transizioni:${riga.id}`,
        descrizione: `commessa ${riga.commessaId}: ${String(riga.prima?.stato ?? "?")} → ${String(riga.dopo?.stato ?? "?")} con bypass`,
      })),
      dettagli: {},
    },
  };
}

export async function calcolaPatternAzienda(input: {
  sedeId: number;
  now: Date;
  finestraGiorni?: number;
  repository?: RepositoryOsservazioni;
}): Promise<EsitoPatternAzienda> {
  const giorni = Math.min(
    Math.max(input.finestraGiorni ?? FINESTRA_DEFAULT_GIORNI, 7),
    90
  );
  const a = input.now;
  const da = new Date(a.getTime() - giorni * 86_400_000);
  const repository = input.repository ?? repositoryOsservazioniCorrente();
  const lette = await repository.lista({ sedeId: input.sedeId, limite: 1000 });
  const osservazioni = lette.filter(
    osservazione => osservazione.aggiornataAt.getTime() >= da.getTime()
  );

  const pattern: PatternAzienda[] = [];
  const soppressi: { chiave: string; motivo: string }[] = [];
  if (lette.length >= 1000) {
    // Troncamento DICHIARATO (revisione M5): oltre il cap il campione
    // sottostima e il report deve dirlo, mai fingere completezza.
    soppressi.push({
      chiave: "campione",
      motivo:
        "letto il massimo di 1000 osservazioni: i conteggi possono sottostimare il periodo",
    });
  }
  const registra = (
    esito:
      | { pattern: PatternAzienda }
      | { soppresso: { chiave: string; motivo: string } }
      | null
  ) => {
    if (!esito) return;
    if ("pattern" in esito) pattern.push(esito.pattern);
    else soppressi.push(esito.soppresso);
  };

  for (const costruttore of COSTRUTTORI) {
    registra(
      costruttore({ sedeId: input.sedeId, da, a, giorni, osservazioni })
    );
  }
  registra(patternPermanenzaFase({ sedeId: input.sedeId, da, a, giorni }));
  registra(patternGateBypass({ sedeId: input.sedeId, da, a, giorni }));

  return {
    sedeId: input.sedeId,
    periodo: { da: da.toISOString(), a: a.toISOString(), giorni },
    versione: VERSIONE_PATTERN,
    pattern,
    soppressi,
  };
}
