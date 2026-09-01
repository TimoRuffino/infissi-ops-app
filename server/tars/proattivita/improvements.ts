// Proposte di miglioramento del CRM e dei processi (T8).
//
// Derivate SOLO dai pattern T7 sopra soglia, con template chiusi per
// chiave: ogni proposta è INERTE — testo strutturato con problema,
// evidenze, impatto, soluzione, alternative, rischi, metrica, esperimento,
// rollout e rollback. Il feedback umano influenza cooldown e ranking, mai
// policy o codice; «accetta» registra una DECISIONE e non esegue nulla.

import { createHash } from "node:crypto";
import { kvSql } from "../../_core/persistence";
import {
  calcolaPatternAzienda,
  type PatternAzienda,
} from "./patterns";
import type { RepositoryOsservazioni } from "./repository";

export const VERSIONE_MIGLIORAMENTI = "1.0.0";
export const COOLDOWN_FEEDBACK_MS = 30 * 24 * 60 * 60 * 1000;

export type FeedbackMiglioramento =
  | "utile"
  | "non_utile"
  | "gia_risolto"
  | "troppo_rumore";

export type StatoMiglioramento = "proposta" | "accettata" | "scartata";

export type PropostaMiglioramento = {
  id: number;
  sedeId: number;
  chiavePattern: string;
  fingerprintPattern: string;
  titolo: string;
  problema: string;
  evidenze: { riferimento: string; descrizione: string }[];
  baseline: string;
  impatto: string;
  soluzione: string;
  alternative: string[];
  rischi: string[];
  dipendenze: string[];
  costoIndicativo: "basso" | "medio" | "alto";
  priorita: "normale" | "alta";
  /** Ranking effettivo dopo il feedback: il feedback pesa, non decide. */
  ranking: number;
  confidenza: "media" | "alta";
  responsabileSuggerito: string;
  metrica: string;
  esperimento: string;
  rollout: string;
  rollback: string;
  test: string[];
  stato: StatoMiglioramento;
  feedback: FeedbackMiglioramento | null;
  cooldownFinoA: Date | null;
  decisione: { utenteId: number; nota: string | null; at: Date } | null;
  createdAt: Date;
  aggiornataAt: Date;
};

type TemplateMiglioramento = {
  titolo: string;
  problema: (pattern: PatternAzienda) => string;
  impatto: string;
  soluzione: string;
  alternative: string[];
  rischi: string[];
  dipendenze: string[];
  costoIndicativo: PropostaMiglioramento["costoIndicativo"];
  responsabileSuggerito: string;
  metrica: string;
  esperimento: string;
  rollout: string;
  rollback: string;
  test: string[];
};

// Set CHIUSO: una proposta esiste solo se il suo pattern esiste sopra
// soglia. Nessuna generazione libera.
const TEMPLATES: Record<string, TemplateMiglioramento> = {
  ritardi_fornitore: {
    titolo: "Sollecito strutturato delle conferme d'ordine fornitore",
    problema: pattern =>
      `Le consegne fornitore in ritardo sono ricorrenti nel periodo: ${pattern.misura}.`,
    impatto:
      "Meno pose ripianificate e meno commesse ferme in attesa del materiale.",
    soluzione:
      "Introdurre un sollecito operativo a N giorni dall'ordine senza conferma, con responsabile e canale unico, alimentato dai casi già presenti nel Centro Azioni.",
    alternative: [
      "Rinegoziare i termini di conferma con i fornitori più ricorrenti",
      "Anticipare l'ordine dei componenti critici nella fase precedente",
    ],
    rischi: [
      "Solleciti a tappeto percepiti come rumore dal fornitore",
      "Il ritardo reale può dipendere dal vettore, non dal fornitore",
    ],
    dipendenze: ["Centro Azioni attivo sulla sede", "anagrafica fornitori aggiornata"],
    costoIndicativo: "basso",
    responsabileSuggerito: "ordini",
    metrica: "quota di ordini con conferma entro la soglia concordata",
    esperimento:
      "4 settimane su una sede pilota, confronto con la baseline del periodo precedente",
    rollout: "una sede pilota → tutte le sedi dopo la verifica della metrica",
    rollback: "sospendere il sollecito automatico; i casi restano nel Centro Azioni",
    test: ["il sollecito nasce solo da casi reali", "nessun sollecito duplicato per ordine"],
  },
  colli_di_bottiglia: {
    titolo: "Revisione delle soglie e checklist di sblocco per la fase critica",
    problema: pattern =>
      `Più commesse restano oltre soglia nella stessa fase: ${pattern.misura}.`,
    impatto: "Riduzione del tempo di attraversamento delle commesse.",
    soluzione:
      "Definire una checklist di sblocco per la fase più lenta e rivedere le soglie di permanenza con i responsabili.",
    alternative: [
      "Assegnare un owner esplicito alle commesse oltre soglia",
      "Introdurre un rito settimanale di revisione della fase critica",
    ],
    rischi: ["Soglie troppo strette generano falsi allarmi"],
    dipendenze: ["registro transizioni attivo", "Centro Azioni attivo"],
    costoIndicativo: "basso",
    responsabileSuggerito: "direzione",
    metrica: "permanenza media nella fase critica",
    esperimento: "6 settimane con checklist sulla sola fase individuata",
    rollout: "fase critica → altre fasi solo dopo la verifica",
    rollback: "ritirare la checklist; le soglie tornano quelle correnti",
    test: ["la permanenza media è misurata dal registro reale"],
  },
  ricorrenze_post_vendita: {
    titolo: "Analisi dei difetti ricorrenti e checklist di collaudo",
    problema: pattern =>
      `I segnali post-vendita si ripetono su più commesse: ${pattern.misura}.`,
    impatto: "Meno interventi ripetuti e meno ticket sulla stessa commessa.",
    soluzione:
      "Classificare i motivi ricorrenti dei ticket e introdurre una checklist di collaudo mirata prima della chiusura posa.",
    alternative: ["Formazione mirata alle squadre sulla causa più frequente"],
    rischi: ["La classificazione manuale dei motivi richiede disciplina"],
    dipendenze: ["modulo post-vendita attivo"],
    costoIndicativo: "medio",
    responsabileSuggerito: "post_vendita",
    metrica: "ticket ricorrenti per commessa nel trimestre",
    esperimento: "8 settimane con checklist sulle nuove pose",
    rollout: "nuove pose → parco storico",
    rollback: "ritirare la checklist di collaudo",
    test: ["il conteggio ricorrenze usa solo ticket reali della sede"],
  },
  permanenza_fase: {
    titolo: "Intervento sul processo della fase con permanenza più alta",
    problema: pattern =>
      `Una fase concentra la permanenza media più alta: ${pattern.misura} (baseline: ${pattern.baseline}).`,
    impatto: "Tempo di consegna complessivo più corto e prevedibile.",
    soluzione:
      "Mappare i passi reali della fase con chi la lavora e rimuovere l'attesa dominante (documenti, conferme, materiali).",
    alternative: ["Parallelizzare i passi indipendenti della fase"],
    rischi: ["Il campione può includere commesse atipiche"],
    dipendenze: ["registro transizioni attivo"],
    costoIndicativo: "medio",
    responsabileSuggerito: "direzione",
    metrica: "permanenza media della fase sul trimestre",
    esperimento: "confronto prima/dopo su 6 settimane",
    rollout: "una fase → le fasi adiacenti",
    rollback: "ripristinare il flusso precedente della fase",
    test: ["le permanenze sono calcolate solo su transizioni concluse"],
  },
  documenti_gate: {
    titolo: "Riduzione dei bypass del gate documentale",
    problema: pattern =>
      `Il gate documentale viene scavalcato con force in modo ricorrente: ${pattern.misura}.`,
    impatto: "Fascicoli completi e transizioni sostenute dai documenti giusti.",
    soluzione:
      "Richiedere un motivo esplicito per ogni bypass e rivedere i tipi documento richiesti dove il gate risulta sistematicamente scavalcato.",
    alternative: ["Limitare il force a un sottoinsieme di ruoli"],
    rischi: ["Un gate troppo rigido rallenta i casi legittimi d'urgenza"],
    dipendenze: ["registro transizioni con flag bypass"],
    costoIndicativo: "basso",
    responsabileSuggerito: "direzione",
    metrica: "quota di transizioni con bypass sul totale",
    esperimento: "motivo obbligatorio per 4 settimane, poi revisione dei tipi richiesti",
    rollout: "tutte le sedi (è una regola di processo, non un automatismo)",
    rollback: "rimuovere l'obbligo del motivo",
    test: ["ogni bypass registrato conserva l'attore e il motivo"],
  },
};

function fingerprintPattern(pattern: PatternAzienda): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        chiave: pattern.chiave,
        versione: pattern.versione,
        misura: pattern.misura,
        campione: pattern.campione,
      })
    )
    .digest("hex")
    .slice(0, 24);
}

function rankingBase(pattern: PatternAzienda): number {
  return (
    pattern.campione.commesse * 10 +
    (pattern.confidenza === "alta" ? 20 : 0)
  );
}

// ————— Persistenza (PG additiva, memoria solo test) ————————————————————

export type RepositoryMiglioramenti = {
  ensureSchema(): Promise<void>;
  perChiave(
    sedeId: number,
    chiavePattern: string
  ): Promise<PropostaMiglioramento | null>;
  /**
   * Con `soloSeStato` l'aggiornamento vale solo se lo stato su disco è
   * ancora quello atteso (null = perso il confronto, nessuna scrittura).
   */
  salva(
    proposta: PropostaMiglioramento,
    opzioni?: { soloSeStato?: StatoMiglioramento }
  ): Promise<PropostaMiglioramento | null>;
  lista(sedeId: number): Promise<PropostaMiglioramento[]>;
  byId(sedeId: number, id: number): Promise<PropostaMiglioramento | null>;
};

export function creaRepositoryMiglioramentiMemoriaPerTest(): RepositoryMiglioramenti {
  const record: PropostaMiglioramento[] = [];
  let nextId = 1;
  return {
    async ensureSchema() {},
    async perChiave(sedeId, chiavePattern) {
      return (
        structuredClone(
          record.find(
            r => r.sedeId === sedeId && r.chiavePattern === chiavePattern
          )
        ) ?? null
      );
    },
    async salva(proposta, opzioni) {
      const esistente = record.find(
        r => r.sedeId === proposta.sedeId && r.chiavePattern === proposta.chiavePattern
      );
      if (esistente) {
        if (opzioni?.soloSeStato && esistente.stato !== opzioni.soloSeStato) {
          return null;
        }
        Object.assign(esistente, structuredClone(proposta), {
          id: esistente.id,
          createdAt: esistente.createdAt,
        });
        return structuredClone(esistente);
      }
      const nuova = { ...structuredClone(proposta), id: nextId++ };
      record.push(nuova);
      return structuredClone(nuova);
    },
    async lista(sedeId) {
      return record
        .filter(r => r.sedeId === sedeId)
        .sort((a, b) => b.ranking - a.ranking)
        .map(r => structuredClone(r));
    },
    async byId(sedeId, id) {
      return (
        structuredClone(
          record.find(r => r.sedeId === sedeId && r.id === id)
        ) ?? null
      );
    },
  };
}

function creaRepositoryMiglioramentiPostgres(): RepositoryMiglioramenti {
  const sql = kvSql!;
  let pronta = false;
  const assicura = async () => {
    if (pronta) return;
    await sql`CREATE TABLE IF NOT EXISTS tars_miglioramenti (
      id SERIAL PRIMARY KEY,
      sede_id INTEGER NOT NULL,
      chiave_pattern TEXT NOT NULL,
      payload JSONB NOT NULL,
      UNIQUE (sede_id, chiave_pattern)
    )`;
    pronta = true;
  };
  const daRiga = (riga: any): PropostaMiglioramento => {
    // Tolleranza alla doppia codifica jsonb (v. server/chat/store.ts): una
    // riga scritta come stringa arriva qui già spacchettata.
    const payload =
      typeof riga.payload === "string" ? JSON.parse(riga.payload) : riga.payload;
    return {
      ...payload,
      id: Number(riga.id),
      cooldownFinoA: payload.cooldownFinoA ? new Date(payload.cooldownFinoA) : null,
      decisione: payload.decisione
        ? { ...payload.decisione, at: new Date(payload.decisione.at) }
        : null,
      createdAt: new Date(payload.createdAt),
      aggiornataAt: new Date(payload.aggiornataAt),
    };
  };
  return {
    ensureSchema: assicura,
    async perChiave(sedeId, chiavePattern) {
      await assicura();
      const righe = await sql`SELECT * FROM tars_miglioramenti
        WHERE sede_id = ${sedeId} AND chiave_pattern = ${chiavePattern} LIMIT 1`;
      return righe.length ? daRiga(righe[0]) : null;
    },
    async salva(proposta, opzioni) {
      await assicura();
      // `sql.json`, mai `JSON.stringify(...)::jsonb` (doppia codifica
      // postgres-js, v. server/_core/persistence.ts).
      const payload = sql.json({ ...proposta, id: undefined } as any);
      if (opzioni?.soloSeStato) {
        const [riga] = await sql`UPDATE tars_miglioramenti
          SET payload = ${payload}
          WHERE sede_id = ${proposta.sedeId}
            AND chiave_pattern = ${proposta.chiavePattern}
            AND payload->>'stato' = ${opzioni.soloSeStato}
          RETURNING *`;
        return riga ? daRiga(riga) : null;
      }
      const [riga] = await sql`INSERT INTO tars_miglioramenti
          (sede_id, chiave_pattern, payload)
        VALUES (${proposta.sedeId}, ${proposta.chiavePattern}, ${payload})
        ON CONFLICT (sede_id, chiave_pattern)
        DO UPDATE SET payload = EXCLUDED.payload
        RETURNING *`;
      return daRiga(riga);
    },
    async lista(sedeId) {
      await assicura();
      const righe = await sql`SELECT * FROM tars_miglioramenti
        WHERE sede_id = ${sedeId}`;
      return righe
        .map(daRiga)
        .sort((a: PropostaMiglioramento, b: PropostaMiglioramento) => b.ranking - a.ranking);
    },
    async byId(sedeId, id) {
      await assicura();
      const righe = await sql`SELECT * FROM tars_miglioramenti
        WHERE sede_id = ${sedeId} AND id = ${id} LIMIT 1`;
      return righe.length ? daRiga(righe[0]) : null;
    },
  };
}

let singleton: RepositoryMiglioramenti | null = null;
let overrideTest: RepositoryMiglioramenti | null = null;

export function repositoryMiglioramentiCorrente(): RepositoryMiglioramenti {
  if (overrideTest) return overrideTest;
  if (singleton) return singleton;
  if (kvSql) return (singleton = creaRepositoryMiglioramentiPostgres());
  if (process.env.NODE_ENV === "test") {
    return (singleton = creaRepositoryMiglioramentiMemoriaPerTest());
  }
  throw new Error(
    "MIGLIORAMENTI_ASSENTI: senza DATABASE_URL le proposte di miglioramento sono fail-closed."
  );
}

export function impostaRepositoryMiglioramentiPerTest(
  repository: RepositoryMiglioramenti | null
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("MIGLIORAMENTI_TEST_ONLY: override riservato ai test.");
  }
  overrideTest = repository;
  if (!kvSql) singleton = null;
}

// ————— Derivazione, feedback, accettazione ————————————————————————————

export async function derivaMiglioramenti(input: {
  sedeId: number;
  now: Date;
  finestraGiorni?: number;
  repositoryOsservazioni?: RepositoryOsservazioni;
  repository?: RepositoryMiglioramenti;
}): Promise<{ proposte: PropostaMiglioramento[]; soppresse: string[] }> {
  const repository = input.repository ?? repositoryMiglioramentiCorrente();
  const panorama = await calcolaPatternAzienda({
    sedeId: input.sedeId,
    now: input.now,
    finestraGiorni: input.finestraGiorni,
    repository: input.repositoryOsservazioni,
  });
  const proposte: PropostaMiglioramento[] = [];
  const soppresse: string[] = [];

  for (const pattern of panorama.pattern) {
    const template = TEMPLATES[pattern.chiave];
    if (!template) continue; // nessuna generazione libera fuori dal set chiuso
    const fingerprint = fingerprintPattern(pattern);
    const esistente = await repository.perChiave(input.sedeId, pattern.chiave);

    if (esistente) {
      const inCooldown =
        esistente.cooldownFinoA != null &&
        esistente.cooldownFinoA.getTime() > input.now.getTime();
      // Una proposta SCARTATA torna in vita solo a cooldown scaduto E con
      // un pattern davvero diverso (revisione R2#2: il cooldown non è una
      // soppressione eterna). Una ACCETTATA resta permanente per scelta:
      // la decisione registrata non va rigenerata alle sue spalle.
      const resurrezione =
        esistente.stato === "scartata" &&
        !inCooldown &&
        esistente.fingerprintPattern !== fingerprint;
      if (!resurrezione && (inCooldown || esistente.stato !== "proposta")) {
        soppresse.push(
          `${pattern.chiave}: ${inCooldown ? "in cooldown dopo il feedback" : `già ${esistente.stato}`}`
        );
        continue;
      }
      if (
        esistente.stato === "proposta" &&
        esistente.fingerprintPattern === fingerprint
      ) {
        proposte.push(esistente);
        continue;
      }
      // Il feedback pesa in modo SIMMETRICO anche dopo il refresh (R2#6).
      const pesoFeedback =
        esistente.feedback === "non_utile"
          ? -30
          : esistente.feedback === "utile"
            ? 15
            : 0;
      const aggiornata = await repository.salva(
        {
          ...esistente,
          stato: "proposta",
          feedback: resurrezione ? null : esistente.feedback,
          cooldownFinoA: null,
          fingerprintPattern: fingerprint,
          problema: template.problema(pattern),
          evidenze: pattern.evidenze.map(evidenza => ({
            riferimento: evidenza.riferimento,
            descrizione: evidenza.descrizione,
          })),
          baseline: pattern.baseline,
          confidenza: pattern.confidenza,
          ranking: rankingBase(pattern) + (resurrezione ? 0 : pesoFeedback),
          aggiornataAt: input.now,
        },
        // La ri-derivazione non può MAI sovrascrivere una decisione
        // arrivata nel frattempo (revisione I4): vale solo se lo stato su
        // disco è ancora quello letto.
        { soloSeStato: esistente.stato }
      );
      if (aggiornata) proposte.push(aggiornata);
      else soppresse.push(`${pattern.chiave}: decisione concorrente, ri-derivazione saltata`);
      continue;
    }

    const nuova = await repository.salva({
      id: 0,
      sedeId: input.sedeId,
      chiavePattern: pattern.chiave,
      fingerprintPattern: fingerprint,
      titolo: template.titolo,
      problema: template.problema(pattern),
      evidenze: pattern.evidenze.map(evidenza => ({
        riferimento: evidenza.riferimento,
        descrizione: evidenza.descrizione,
      })),
      baseline: pattern.baseline,
      impatto: template.impatto,
      soluzione: template.soluzione,
      alternative: [...template.alternative],
      rischi: [...template.rischi],
      dipendenze: [...template.dipendenze],
      costoIndicativo: template.costoIndicativo,
      priorita: pattern.confidenza === "alta" ? "alta" : "normale",
      ranking: rankingBase(pattern),
      confidenza: pattern.confidenza,
      responsabileSuggerito: template.responsabileSuggerito,
      metrica: template.metrica,
      esperimento: template.esperimento,
      rollout: template.rollout,
      rollback: template.rollback,
      test: [...template.test],
      stato: "proposta",
      feedback: null,
      cooldownFinoA: null,
      decisione: null,
      createdAt: input.now,
      aggiornataAt: input.now,
    });
    if (nuova) proposte.push(nuova);
  }

  return {
    proposte: proposte.sort((a, b) => b.ranking - a.ranking),
    soppresse,
  };
}

/** Il feedback pesa su cooldown e ranking. MAI su policy, flag o codice. */
export async function registraFeedbackMiglioramento(input: {
  sedeId: number;
  id: number;
  feedback: FeedbackMiglioramento;
  utenteId: number;
  now: Date;
  repository?: RepositoryMiglioramenti;
}): Promise<PropostaMiglioramento> {
  const repository = input.repository ?? repositoryMiglioramentiCorrente();
  const proposta = await repository.byId(input.sedeId, input.id);
  if (!proposta) throw new Error("NOT_FOUND: proposta non trovata.");
  // Una decisione registrata non si degrada col feedback (revisione R2#7):
  // su una proposta accettata restano solo ranking e nota di feedback.
  const conCooldown =
    proposta.stato !== "accettata" &&
    (input.feedback === "gia_risolto" || input.feedback === "troppo_rumore");
  const salvata = await repository.salva({
    ...proposta,
    feedback: input.feedback,
    stato: conCooldown ? "scartata" : proposta.stato,
    cooldownFinoA: conCooldown
      ? new Date(input.now.getTime() + COOLDOWN_FEEDBACK_MS)
      : proposta.cooldownFinoA,
    ranking:
      input.feedback === "utile"
        ? proposta.ranking + 15
        : input.feedback === "non_utile"
          ? proposta.ranking - 30
          : proposta.ranking,
    aggiornataAt: input.now,
  });
  if (!salvata) throw new Error("CONFLICT: proposta cambiata, riprova.");
  return salvata;
}

/** «Accetta» registra una decisione. Non modifica il CRM, non avvia agenti. */
export async function accettaMiglioramento(input: {
  sedeId: number;
  id: number;
  utenteId: number;
  nota?: string | null;
  now: Date;
  repository?: RepositoryMiglioramenti;
}): Promise<PropostaMiglioramento> {
  const repository = input.repository ?? repositoryMiglioramentiCorrente();
  const proposta = await repository.byId(input.sedeId, input.id);
  if (!proposta) throw new Error("NOT_FOUND: proposta non trovata.");
  if (proposta.stato === "accettata") return proposta;
  const salvata = await repository.salva({
    ...proposta,
    stato: "accettata",
    decisione: {
      utenteId: input.utenteId,
      nota: input.nota ?? null,
      at: input.now,
    },
    aggiornataAt: input.now,
  });
  if (!salvata) throw new Error("CONFLICT: proposta cambiata, riprova.");
  return salvata;
}
