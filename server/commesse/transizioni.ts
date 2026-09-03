import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import { persistedStore } from "../_core/persistence";
import { authorizeCoreOperation } from "../authz/enforcement";

/**
 * Unica sequenza autorevole della commessa. Router, timeline e Tars importano
 * questa costante: il modello non possiede né ricostruisce la state machine.
 */
export const STATI_COMMESSA = [
  "preventivo",
  "misure_esecutive",
  "aggiornamento_contratto",
  "fatture_pagamento",
  "da_ordinare",
  "produzione",
  "ordini_ultimazione",
  "attesa_posa",
  "finiture_saldo",
  "interventi_regolazioni",
  "archiviata",
] as const;

export type StatoCommessa = (typeof STATI_COMMESSA)[number];

export type CommessaTransizionabile = {
  id: number;
  sedeId: number;
  stato: string;
  updatedAt: Date | string;
  dataConsegnaConfermata?: string | null;
  dataChiusura?: string | null;
  [chiave: string]: unknown;
};

const TRANSIZIONI_VALIDE: Readonly<
  Record<StatoCommessa, readonly StatoCommessa[]>
> = Object.freeze({
  preventivo: ["misure_esecutive"],
  misure_esecutive: ["preventivo", "aggiornamento_contratto"],
  aggiornamento_contratto: ["misure_esecutive", "fatture_pagamento"],
  fatture_pagamento: ["aggiornamento_contratto", "da_ordinare"],
  da_ordinare: ["fatture_pagamento", "produzione"],
  produzione: ["da_ordinare", "ordini_ultimazione"],
  ordini_ultimazione: ["produzione", "attesa_posa"],
  attesa_posa: ["ordini_ultimazione", "finiture_saldo"],
  finiture_saldo: ["attesa_posa", "interventi_regolazioni"],
  interventi_regolazioni: ["finiture_saldo", "archiviata"],
  archiviata: ["interventi_regolazioni"],
});

type SnapshotTransizione = {
  stato: StatoCommessa;
  versione: string;
  dataConsegnaConfermata: string | null;
  dataChiusura: string | null;
};

type OrigineTransizione = "router" | "tars" | "undo";

type RegistroTransizione = {
  id: number;
  sedeId: number;
  commessaId: number;
  origine: OrigineTransizione;
  attoreUtenteId: number;
  prima: SnapshotTransizione;
  dopo: SnapshotTransizione;
  bypassGateDocumentale: boolean;
  /**
   * Quale gate è stato scavalcato con «Procedi comunque» (03/09/2026).
   * `null` quando non c'era gate o la transizione era consentita.
   */
  gateScavalcato: "documentale" | "computo" | null;
  compensaTransizioneId: number | null;
  compensataDaId: number | null;
  createdAt: Date;
};

let nextTransizioneId = 1;
export const storeTransizioniCommessa = persistedStore<RegistroTransizione>(
  "commesse_transizioni",
  righe => {
    nextTransizioneId = righe.length
      ? Math.max(...righe.map(riga => Number(riga.id) || 0)) + 1
      : 1;
    for (const riga of righe) {
      if ((riga as any).compensaTransizioneId === undefined) {
        (riga as any).compensaTransizioneId = null;
      }
      if ((riga as any).compensataDaId === undefined) {
        (riga as any).compensataDaId = null;
      }
      if ((riga as any).gateScavalcato === undefined) {
        (riga as any).gateScavalcato = null;
      }
    }
  }
);
const transizioni = storeTransizioniCommessa.items;

export type DipendenzeTransizioneCommessa = {
  trovaCommessa(id: number): CommessaTransizionabile | null;
  eseguiStatoEAuditAtomico<T>(
    operazione: (commit: () => Promise<void>) => Promise<T>
  ): Promise<T>;
  haDocumentoRichiesto(commessaId: number, stato: string): boolean;
  documentiRichiesti(stato: StatoCommessa): readonly string[];
  etichettaDocumento(tipo: string): string;
  allineaTimeline(
    commessaId: number,
    stato: StatoCommessa,
    attoreNome: string | null
  ): void | Promise<void>;
  /**
   * Gate computo limiti (03/09/2026): true se l'ultimo computo copre le
   * righe e i parametri correnti del contratto. Assente = gate non
   * attivo (flag spento o dipendenze legacy).
   */
  computoValido?: (commessaId: number) => Promise<boolean> | boolean;
  ora?: () => Date;
};

export type VerificaTransizioneCommessa = {
  commessaId: number;
  statoAttuale: StatoCommessa;
  nuovoStato: StatoCommessa | null;
  versione: string;
  precedente: StatoCommessa | null;
  successivo: StatoCommessa | null;
  consentita: boolean;
  direzione: "avanti" | "indietro" | "nessuna";
  gate: {
    richiesti: string[];
    soddisfatto: boolean;
    bloccante: boolean;
    computo: { richiesto: boolean; valido: boolean | null };
  };
  motivo: string | null;
};

export type EsitoTransizioneCommessa = {
  transizioneId: number | null;
  commessa: CommessaTransizionabile;
  da: StatoCommessa;
  a: StatoCommessa;
  versionePrima: string;
  versioneDopo: string;
  riusata: boolean;
  compensaTransizioneId: number | null;
};

function statoValido(stato: string): stato is StatoCommessa {
  return (STATI_COMMESSA as readonly string[]).includes(stato);
}

export function versioneCommessa(commessa: Pick<CommessaTransizionabile, "updatedAt">): string {
  const data =
    commessa.updatedAt instanceof Date
      ? commessa.updatedAt
      : new Date(commessa.updatedAt);
  return Number.isNaN(data.getTime()) ? "-" : String(data.getTime());
}

/**
 * Compare-and-swap in-process più forte del solo millisecondo `updatedAt`:
 * due mutation nello stesso tick devono comunque rendere stale la preview.
 * Non esce nel contratto provider; è un metadato server-only del comando.
 */
export function firmaTransizioneCommessa(
  commessa: CommessaTransizionabile
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(commessa))
    .digest("hex")}`;
}

function snapshot(commessa: CommessaTransizionabile): SnapshotTransizione {
  if (!statoValido(commessa.stato)) {
    throw new Error(`STATO_COMMESSA_NON_VALIDO: ${commessa.stato}`);
  }
  return {
    stato: commessa.stato,
    versione: versioneCommessa(commessa),
    dataConsegnaConfermata: commessa.dataConsegnaConfermata ?? null,
    dataChiusura: commessa.dataChiusura ?? null,
  };
}

function notFound(): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message: "Commessa non trovata.",
  });
}

function assertSede(
  commessa: CommessaTransizionabile | null,
  sedeId: number | null | undefined
): asserts commessa is CommessaTransizionabile {
  if (!commessa || sedeId == null || commessa.sedeId !== sedeId) {
    throw notFound();
  }
}

function indice(stato: StatoCommessa): number {
  return STATI_COMMESSA.indexOf(stato);
}

export function verificaTransizioneCommessa(input: {
  commessa: CommessaTransizionabile;
  nuovoStato?: StatoCommessa | null;
  haDocumentoRichiesto: (commessaId: number, stato: string) => boolean;
  documentiRichiesti: (stato: StatoCommessa) => readonly string[];
  computoValido?: boolean | null;
}): VerificaTransizioneCommessa {
  const { commessa } = input;
  if (!statoValido(commessa.stato)) {
    throw new Error(`STATO_COMMESSA_NON_VALIDO: ${commessa.stato}`);
  }
  const currentIdx = indice(commessa.stato);
  const precedente = currentIdx > 0 ? STATI_COMMESSA[currentIdx - 1] : null;
  const successivo = STATI_COMMESSA[currentIdx + 1] ?? null;
  const nuovoStato = input.nuovoStato ?? null;
  const richiesti = [...input.documentiRichiesti(commessa.stato)];
  const gateSoddisfatto =
    richiesti.length === 0 ||
    input.haDocumentoRichiesto(commessa.id, commessa.stato);
  // Gate computo: vale SOLO per il passo in avanti da «Aggiornamento
  // contratto» a «Fatture pagamento». null = non verificato (flag spento,
  // lettura senza dipendenza): non blocca, ma la UI lo mostra come ignoto.
  const computoRichiesto =
    commessa.stato === "aggiornamento_contratto" &&
    input.nuovoStato === "fatture_pagamento";
  const computoValido = computoRichiesto ? (input.computoValido ?? null) : null;
  const computoBloccante = computoRichiesto && computoValido === false;
  const gateComputo = { richiesto: computoRichiesto, valido: computoValido };

  if (nuovoStato == null) {
    return {
      commessaId: commessa.id,
      statoAttuale: commessa.stato,
      nuovoStato,
      versione: versioneCommessa(commessa),
      precedente,
      successivo,
      consentita: true,
      direzione: "nessuna",
      gate: {
        richiesti,
        soddisfatto: gateSoddisfatto,
        bloccante: Boolean(successivo && richiesti.length > 0 && !gateSoddisfatto),
        computo: gateComputo,
      },
      motivo: null,
    };
  }

  if (nuovoStato === commessa.stato) {
    return {
      commessaId: commessa.id,
      statoAttuale: commessa.stato,
      nuovoStato,
      versione: versioneCommessa(commessa),
      precedente,
      successivo,
      consentita: false,
      direzione: "nessuna",
      gate: {
        richiesti,
        soddisfatto: gateSoddisfatto,
        bloccante: false,
        computo: gateComputo,
      },
      motivo: "La commessa è già nello stato richiesto.",
    };
  }

  const allowed = TRANSIZIONI_VALIDE[commessa.stato];
  if (!allowed.includes(nuovoStato)) {
    return {
      commessaId: commessa.id,
      statoAttuale: commessa.stato,
      nuovoStato,
      versione: versioneCommessa(commessa),
      precedente,
      successivo,
      consentita: false,
      direzione: indice(nuovoStato) > currentIdx ? "avanti" : "indietro",
      gate: {
        richiesti,
        soddisfatto: gateSoddisfatto,
        bloccante: false,
        computo: gateComputo,
      },
      motivo:
        `Transizione non consentita: ${commessa.stato} → ${nuovoStato}. ` +
        `Transizioni valide da "${commessa.stato}": ${allowed.join(", ") || "nessuna"}`,
    };
  }

  const avanti = indice(nuovoStato) > currentIdx;
  const gateDocumentaleBloccante =
    avanti && richiesti.length > 0 && !gateSoddisfatto;
  const gateBloccante = gateDocumentaleBloccante || computoBloccante;
  return {
    commessaId: commessa.id,
    statoAttuale: commessa.stato,
    nuovoStato,
    versione: versioneCommessa(commessa),
    precedente,
    successivo,
    consentita: !gateBloccante,
    direzione: avanti ? "avanti" : "indietro",
    gate: {
      richiesti,
      soddisfatto: gateSoddisfatto,
      bloccante: gateBloccante,
      computo: gateComputo,
    },
    motivo: gateBloccante
      ? [
          gateDocumentaleBloccante ? `Manca ${richiesti.join(" o ")}.` : null,
          computoBloccante
            ? "Il computo dei limiti non è aggiornato: ricalcolalo dalla tab Limiti."
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null,
  };
}

async function autorizza(
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">,
  commessa: CommessaTransizionabile,
  origine: OrigineTransizione
): Promise<void> {
  const capabilityObbligatoria = origine !== "router";
  await authorizeCoreOperation({
    ctx,
    endpoint:
      origine === "router"
        ? "commesse.update"
        : origine === "undo"
          ? "commesse.undoTransizione"
          : "tars.transizione_adiacente_commessa",
    capability: "commessa.update_operational",
    resourceType: "commessa",
    resource: commessa,
    legacyAllowed: capabilityObbligatoria ? "capability" : true,
  });
  await authorizeCoreOperation({
    ctx,
    endpoint:
      origine === "router"
        ? "commesse.changeState"
        : origine === "undo"
          ? "commesse.undoTransizione"
          : "tars.transizione_adiacente_commessa",
    capability: "commessa.change_state",
    resourceType: "commessa",
    resource: commessa,
    legacyAllowed: capabilityObbligatoria ? "capability" : true,
  });
}

function updatedAtMonotono(
  commessa: CommessaTransizionabile,
  ora: Date
): Date {
  const precedente = Number(versioneCommessa(commessa));
  const adesso = ora.getTime();
  return new Date(Number.isFinite(precedente) && adesso <= precedente ? precedente + 1 : adesso);
}

const CAMPI_PATCH_VIETATI = new Set([
  "id",
  "sedeId",
  "stato",
  "updatedAt",
  "force",
  "dataChiusura",
]);

function patchSicura(
  patch: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!patch) return {};
  for (const chiave of Object.keys(patch)) {
    if (CAMPI_PATCH_VIETATI.has(chiave)) {
      throw new Error(`PATCH_TRANSIZIONE_NON_VALIDO: ${chiave}`);
    }
  }
  return patch;
}

async function applicaTransizioneCommessa(
  input: {
    ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">;
    commessaId: number;
    nuovoStato: StatoCommessa;
    origine: OrigineTransizione;
    versioneAttesa?: string | null;
    firmaAttesa?: string | null;
    bypassGateDocumentale?: boolean;
    attoreNome?: string | null;
    /** Solo il router legacy passa campi già validati/autorizzati. */
    patchAutorizzata?: Record<string, unknown>;
    /** Solo annullaTransizioneCommessa può ripristinare campi di cleanup. */
    ripristinaSnapshot?: SnapshotTransizione;
    compensaTransizioneId?: number | null;
    segnaCompensata?: RegistroTransizione;
  },
  dipendenze: DipendenzeTransizioneCommessa
): Promise<EsitoTransizioneCommessa> {
  // Tars libero (02/09/2026 sera): Tars scavalca un gate documentale come
  // farebbe l'utente dal board («Procedi comunque»), con la stessa
  // autorizzazione e SOLO su richiesta esplicita (lo decide lo strumento);
  // resta registrato in `bypassGateDocumentale`. L'Undo non forza mai.
  if (input.origine === "undo" && input.bypassGateDocumentale) {
    throw new Error("BYPASS_GATE_VIETATO: l'Undo non accetta force.");
  }
  if (
    input.origine !== "router" &&
    input.patchAutorizzata &&
    Object.keys(input.patchAutorizzata).length > 0
  ) {
    throw new Error(
      "PATCH_TRANSIZIONE_VIETATA: Tars e Undo possono cambiare soltanto lo stato e i cleanup canonici."
    );
  }
  if (input.origine !== "undo" && input.ripristinaSnapshot) {
    throw new Error("RIPRISTINO_SNAPSHOT_VIETATO");
  }

  const primaLettura = dipendenze.trovaCommessa(input.commessaId);
  assertSede(primaLettura, input.ctx.sedeId);
  await autorizza(input.ctx, primaLettura, input.origine);

  return dipendenze.eseguiStatoEAuditAtomico(async commit => {
    // TOCTOU: autorizzazione e preview non congelano il record. Rileggiamo
    // stato, sede e versione mentre il commit multi-store è bloccato.
    const commessa = dipendenze.trovaCommessa(input.commessaId);
  assertSede(commessa, input.ctx.sedeId);
  if (
    input.versioneAttesa != null &&
    versioneCommessa(commessa) !== input.versioneAttesa
  ) {
    throw new Error(
      `VERSIONE_COMMESSA_OBSOLETA: attesa ${input.versioneAttesa}, corrente ${versioneCommessa(commessa)}.`
    );
  }
  if (
    input.firmaAttesa != null &&
    firmaTransizioneCommessa(commessa) !== input.firmaAttesa
  ) {
    throw new Error(
      "VERSIONE_COMMESSA_OBSOLETA: il contenuto della commessa è cambiato dopo la verifica."
    );
  }
  if (!statoValido(commessa.stato)) {
    throw new Error(`STATO_COMMESSA_NON_VALIDO: ${commessa.stato}`);
  }
  if (commessa.stato === input.nuovoStato) {
    return {
      transizioneId: null,
      commessa,
      da: commessa.stato,
      a: input.nuovoStato,
      versionePrima: versioneCommessa(commessa),
      versioneDopo: versioneCommessa(commessa),
      riusata: true,
      compensaTransizioneId: input.compensaTransizioneId ?? null,
    };
  }

  // La domanda al servizio computo costa una lettura: la si fa solo sul
  // passo che il gate governa. Dipendenza assente = gate non valutato.
  const computoOk =
    dipendenze.computoValido &&
    commessa.stato === "aggiornamento_contratto" &&
    input.nuovoStato === "fatture_pagamento"
      ? await dipendenze.computoValido(commessa.id)
      : null;
  const verifica = verificaTransizioneCommessa({
    commessa,
    nuovoStato: input.nuovoStato,
    haDocumentoRichiesto: dipendenze.haDocumentoRichiesto,
    documentiRichiesti: dipendenze.documentiRichiesti,
    computoValido: computoOk,
  });
  if (!verifica.consentita) {
    if (verifica.gate.bloccante && input.bypassGateDocumentale) {
      // «Procedi comunque»: dal board (router) o da Tars su richiesta
      // esplicita dell'utente; il registro conserva il flag.
    } else if (verifica.gate.bloccante) {
      // Il prefisso resta `DOC_GATE_BLOCKED:` anche per il computo: board e
      // timeline riusano lo stesso dialog «Procedi comunque».
      const soloComputo =
        verifica.gate.computo.valido === false && verifica.gate.soddisfatto;
      const labels = verifica.gate.richiesti
        .map(tipo => dipendenze.etichettaDocumento(tipo))
        .join(" o ");
      throw new Error(
        soloComputo
          ? `DOC_GATE_BLOCKED: Il computo dei limiti non è aggiornato per lo stato "${commessa.stato.replace(/_/g, " ")}". Procedere comunque?`
          : `DOC_GATE_BLOCKED: Non è stato caricato il file "${labels}" per lo stato "${commessa.stato.replace(/_/g, " ")}". Procedere comunque?`
      );
    } else {
      throw new Error(verifica.motivo ?? "TRANSIZIONE_NON_CONSENTITA");
    }
  }

  const prima = snapshot(commessa);
  const recordPrima = { ...commessa };
  Object.assign(commessa, patchSicura(input.patchAutorizzata));
  commessa.stato = input.nuovoStato;
  const isForward = indice(input.nuovoStato) > indice(prima.stato);
  if (!isForward) {
    if (prima.stato === "produzione") commessa.dataConsegnaConfermata = null;
    if (prima.stato === "archiviata") commessa.dataChiusura = null;
  }
  if (input.nuovoStato === "archiviata") {
    commessa.dataChiusura = (dipendenze.ora?.() ?? new Date())
      .toISOString()
      .split("T")[0];
  }
  if (input.ripristinaSnapshot) {
    commessa.dataConsegnaConfermata =
      input.ripristinaSnapshot.dataConsegnaConfermata;
    commessa.dataChiusura = input.ripristinaSnapshot.dataChiusura;
  }
  commessa.updatedAt = updatedAtMonotono(
    commessa,
    dipendenze.ora?.() ?? new Date()
  );
  const dopo = snapshot(commessa);
  const registro: RegistroTransizione = {
    id: nextTransizioneId++,
    sedeId: commessa.sedeId,
    commessaId: commessa.id,
    origine: input.origine,
    attoreUtenteId: input.ctx.user!.id,
    prima,
    dopo,
    bypassGateDocumentale: Boolean(input.bypassGateDocumentale),
    gateScavalcato:
      verifica.gate.bloccante && input.bypassGateDocumentale
        ? verifica.gate.computo.valido === false
          ? "computo"
          : "documentale"
        : null,
    compensaTransizioneId: input.compensaTransizioneId ?? null,
    compensataDaId: null,
    createdAt: dipendenze.ora?.() ?? new Date(),
  };
  transizioni.push(registro);
  if (input.segnaCompensata) {
    input.segnaCompensata.compensataDaId = registro.id;
  }
  try {
    // Stato commessa e audit sono un singolo commit; nessuna risposta riesce
    // prima di questa barriera di persistenza.
    await commit();
  } catch (errore) {
    for (const chiave of Object.keys(commessa)) {
      if (!(chiave in recordPrima)) delete (commessa as any)[chiave];
    }
    Object.assign(commessa, recordPrima);
    const indiceRegistro = transizioni.findIndex(riga => riga.id === registro.id);
    if (indiceRegistro >= 0) transizioni.splice(indiceRegistro, 1);
    // Un id non confermato resta un buco: riutilizzarlo potrebbe collidere con
    // un'altra transizione concorrente già arrivata alla barriera di commit.
    if (input.segnaCompensata) input.segnaCompensata.compensataDaId = null;
    throw errore;
  }

  try {
    await dipendenze.allineaTimeline(
      commessa.id,
      input.nuovoStato,
      input.attoreNome ?? null
    );
  } catch (errore: any) {
    // Contratto storico: la timeline è una proiezione; un suo guasto non
    // annulla una transizione già salvata.
    console.error(
      `[timeline] allineamento commessa ${commessa.id} fallito:`,
      errore?.message ?? errore
    );
  }

  return {
    transizioneId: registro.id,
    commessa,
    da: prima.stato,
    a: dopo.stato,
    versionePrima: prima.versione,
    versioneDopo: dopo.versione,
    riusata: false,
    compensaTransizioneId: registro.compensaTransizioneId,
  };
  });
}

/**
 * Comando pubblico: router e Tars possono chiedere una transizione; i campi
 * di compensazione restano inaccessibili e vengono costruiti soltanto da
 * annullaTransizioneCommessa dopo aver riletto l'audit.
 */
export async function eseguiTransizioneCommessa(
  input: {
    ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">;
    commessaId: number;
    nuovoStato: StatoCommessa;
    origine: Exclude<OrigineTransizione, "undo">;
    versioneAttesa?: string | null;
    firmaAttesa?: string | null;
    bypassGateDocumentale?: boolean;
    attoreNome?: string | null;
    /** Ammessa a runtime soltanto per origine router. */
    patchAutorizzata?: Record<string, unknown>;
  },
  dipendenze: DipendenzeTransizioneCommessa
): Promise<EsitoTransizioneCommessa> {
  return applicaTransizioneCommessa(input, dipendenze);
}

export async function annullaTransizioneCommessa(
  input: {
    ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">;
    transizioneId: number;
    attoreNome?: string | null;
  },
  dipendenze: DipendenzeTransizioneCommessa
): Promise<EsitoTransizioneCommessa> {
  const originale = transizioni.find(riga => riga.id === input.transizioneId);
  if (
    !originale ||
    originale.sedeId !== input.ctx.sedeId ||
    originale.origine !== "tars"
  ) {
    throw notFound();
  }
  const ruoli = Array.isArray((input.ctx.user as any)?.ruoli)
    ? (input.ctx.user as any).ruoli as string[]
    : [(input.ctx.user as any)?.ruolo].filter(Boolean);
  const direzione =
    ruoli.includes("direzione") || (input.ctx.user as any)?.role === "admin";
  if (originale.attoreUtenteId !== input.ctx.user?.id && !direzione) {
    // Un id sequenziale non deve permettere di enumerare né compensare le
    // azioni di un collega: stesso messaggio del record inesistente.
    throw notFound();
  }
  if (
    originale.compensataDaId != null ||
    transizioni.some(riga => riga.compensaTransizioneId === originale.id)
  ) {
    throw new Error(
      "UNDO_TRANSIZIONE_NON_DISPONIBILE: la transizione è già stata annullata."
    );
  }
  const commessa = dipendenze.trovaCommessa(originale.commessaId);
  assertSede(commessa, input.ctx.sedeId);
  if (
    commessa.stato !== originale.dopo.stato ||
    versioneCommessa(commessa) !== originale.dopo.versione
  ) {
    throw new Error(
      "VERSIONE_COMMESSA_OBSOLETA: stato o versione sono cambiati dopo la transizione; Undo non applicato."
    );
  }

  const compensazione = await applicaTransizioneCommessa(
    {
      ctx: input.ctx,
      commessaId: originale.commessaId,
      nuovoStato: originale.prima.stato,
      origine: "undo",
      versioneAttesa: originale.dopo.versione,
      attoreNome: input.attoreNome ?? null,
      ripristinaSnapshot: originale.prima,
      compensaTransizioneId: originale.id,
      segnaCompensata: originale,
    },
    dipendenze
  );
  return compensazione;
}
