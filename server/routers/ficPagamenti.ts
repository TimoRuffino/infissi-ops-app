import { persistedStore } from "../_core/persistence";
import {
  fingerprintPagamento,
  normalizzaPagamentoLegacy,
  pagamentoCompatibile,
  ricalcolaImportoIncassato,
  type PagamentoCommessa,
} from "../_core/commessaPayments";
import { getCommesseStore, saveCommesseStore } from "./commesse";
import { ficFatture, type FatturaFic, type RataFic } from "./ficFatture";
import { DEFAULT_SEDE_ID } from "./sedi";

export type RiconciliazioneRataFic = {
  id: number;
  sedeId: number;
  ficDocumentoId: number;
  ficRataId: number | null;
  ficSourceKey: string;
  commessaId: number;
  pagamentoId: number;
  target: "manuale" | "fic";
  stato: "confermata" | "da_verificare" | "superata";
  createdAt: Date;
  updatedAt: Date;
};

export type FicPaymentPatch = {
  importo?: number;
  data?: string | null;
  stato?: "stornato";
};

export type FicPaymentIssue =
  | {
      tipo: "correggi_manuale";
      sedeId: number;
      commessaId: number;
      pagamentoId: number;
      ficDocumentoId: number;
      ficSourceKey: string;
      expectedFingerprint: string;
      patch: FicPaymentPatch;
    }
  | {
      tipo: "scegli_manuale";
      sedeId: number;
      commessaId: number;
      ficDocumentoId: number;
      ficSourceKey: string;
      candidati: Array<{
        pagamentoId: number;
        expectedFingerprint: string;
        patch: FicPaymentPatch;
      }>;
    }
  | {
      tipo: "verifica_spostamento";
      sedeId: number;
      commessaId: number;
      pagamentoId: number;
      ficDocumentoId: number;
      ficSourceKey: string;
    };

export type FicPaymentSyncStats = {
  pagamentiCreati: number;
  pagamentiAggiornati: number;
  pagamentiStornati: number;
  pagamentiRiattivati: number;
  manualiRiconciliati: number;
  correzioniProposte: number;
  ambiguita: number;
  proposteSuperate: number;
  pdfArchiviati: number;
  pdfFalliti: number;
};

export function emptyFicPaymentSyncStats(): FicPaymentSyncStats {
  return {
    pagamentiCreati: 0,
    pagamentiAggiornati: 0,
    pagamentiStornati: 0,
    pagamentiRiattivati: 0,
    manualiRiconciliati: 0,
    correzioniProposte: 0,
    ambiguita: 0,
    proposteSuperate: 0,
    pdfArchiviati: 0,
    pdfFalliti: 0,
  };
}

let nextLinkId = 1;
const _linksStore = persistedStore<RiconciliazioneRataFic>(
  "fic_pagamenti_links",
  items => {
    nextLinkId = items.length ? Math.max(...items.map(item => item.id)) + 1 : 1;
    for (const item of items) {
      if (item.sedeId === undefined) item.sedeId = DEFAULT_SEDE_ID;
      if (item.stato === undefined) item.stato = "confermata";
      if (!(item.createdAt instanceof Date))
        item.createdAt = new Date(item.createdAt);
      if (!(item.updatedAt instanceof Date))
        item.updatedAt = new Date(item.updatedAt);
    }
  }
);

export const ficPaymentLinks = _linksStore.items;
export const saveFicPaymentLinks = () => _linksStore.save();

export function confermaRiconciliazioneManuale(input: {
  sedeId: number;
  ficDocumentoId: number;
  ficSourceKey: string;
  commessaId: number;
  pagamentoId: number;
  now?: Date;
}): RiconciliazioneRataFic {
  const now = input.now ?? new Date();
  const existing = activeLink(
    input.sedeId,
    input.ficDocumentoId,
    input.ficSourceKey
  );
  if (existing) {
    existing.commessaId = input.commessaId;
    existing.pagamentoId = input.pagamentoId;
    existing.target = "manuale";
    existing.stato = "confermata";
    existing.updatedAt = now;
    saveFicPaymentLinks();
    return existing;
  }
  const rata = ficFatture
    .find(
      fattura =>
        fattura.sedeId === input.sedeId && fattura.id === input.ficDocumentoId
    )
    ?.rate.find(item => item.sourceKey === input.ficSourceKey);
  const link: RiconciliazioneRataFic = {
    id: nextLinkId++,
    sedeId: input.sedeId,
    ficDocumentoId: input.ficDocumentoId,
    ficRataId: rata?.id ?? null,
    ficSourceKey: input.ficSourceKey,
    commessaId: input.commessaId,
    pagamentoId: input.pagamentoId,
    target: "manuale",
    stato: "confermata",
    createdAt: now,
    updatedAt: now,
  };
  ficPaymentLinks.push(link);
  saveFicPaymentLinks();
  return link;
}

function activeLink(
  sedeId: number,
  fatturaId: number,
  sourceKey: string
): RiconciliazioneRataFic | undefined {
  return ficPaymentLinks.find(
    link =>
      link.sedeId === sedeId &&
      link.ficDocumentoId === fatturaId &&
      link.ficSourceKey === sourceKey &&
      link.stato !== "superata"
  );
}

function nextPagamentoId(commessa: any): number {
  const pagamenti: any[] = Array.isArray(commessa.pagamenti)
    ? commessa.pagamenti
    : [];
  return pagamenti.length
    ? Math.max(...pagamenti.map(pagamento => Number(pagamento.id ?? 0))) + 1
    : 1;
}

function createLink(input: {
  sedeId: number;
  fattura: FatturaFic;
  rata: RataFic;
  commessaId: number;
  pagamentoId: number;
  target: "manuale" | "fic";
  stato: RiconciliazioneRataFic["stato"];
  now: Date;
}): RiconciliazioneRataFic {
  const link: RiconciliazioneRataFic = {
    id: nextLinkId++,
    sedeId: input.sedeId,
    ficDocumentoId: input.fattura.id,
    ficRataId: input.rata.id,
    ficSourceKey: input.rata.sourceKey,
    commessaId: input.commessaId,
    pagamentoId: input.pagamentoId,
    target: input.target,
    stato: input.stato,
    createdAt: input.now,
    updatedAt: input.now,
  };
  ficPaymentLinks.push(link);
  return link;
}

function patchForManual(
  pagamento: PagamentoCommessa,
  rata: RataFic
): FicPaymentPatch {
  const patch: FicPaymentPatch = {};
  if (Math.abs(pagamento.importo - rata.importo) >= 0.01) {
    patch.importo = rata.importo;
  }
  if (pagamento.data !== rata.dataPagamento) patch.data = rata.dataPagamento;
  return patch;
}

function issueForManual(input: {
  sedeId: number;
  fattura: FatturaFic;
  rata: RataFic;
  commessaId: number;
  pagamento: PagamentoCommessa;
}): FicPaymentIssue {
  return {
    tipo: "correggi_manuale",
    sedeId: input.sedeId,
    commessaId: input.commessaId,
    pagamentoId: input.pagamento.id,
    ficDocumentoId: input.fattura.id,
    ficSourceKey: input.rata.sourceKey,
    expectedFingerprint: fingerprintPagamento(input.pagamento),
    patch: patchForManual(input.pagamento, input.rata),
  };
}

function issueStornoManuale(input: {
  sedeId: number;
  link: RiconciliazioneRataFic;
  pagamento: PagamentoCommessa;
}): FicPaymentIssue {
  return {
    tipo: "correggi_manuale",
    sedeId: input.sedeId,
    commessaId: input.link.commessaId,
    pagamentoId: input.pagamento.id,
    ficDocumentoId: input.link.ficDocumentoId,
    ficSourceKey: input.link.ficSourceKey,
    expectedFingerprint: fingerprintPagamento(input.pagamento),
    patch: { stato: "stornato" },
  };
}

function creaPagamentoFic(
  fattura: FatturaFic,
  rata: RataFic,
  commessa: any,
  now: Date
): PagamentoCommessa {
  const pagamento = normalizzaPagamentoLegacy({
    id: nextPagamentoId(commessa),
    importo: rata.importo,
    data: rata.dataPagamento,
    metodo: null,
    tipo: null,
    note: `Fattura FIC ${fattura.numero}${
      rata.dataPagamento ? ` — incasso del ${rata.dataPagamento}` : ""
    }`,
    origine: "fic",
    stato: "attivo",
    ficDocumentoId: fattura.id,
    ficRataId: rata.id,
    ficSourceKey: rata.sourceKey,
    ficStato: rata.stato,
    ficUltimoSyncAt: now,
    stornatoAt: null,
    createdAt: now,
    updatedAt: null,
  });
  commessa.pagamenti.push(pagamento);
  return pagamento;
}

function manualCandidates(
  fattura: FatturaFic,
  rata: RataFic,
  commessa: any
): PagamentoCommessa[] {
  const pagamenti = (
    Array.isArray(commessa.pagamenti) ? commessa.pagamenti : []
  ).map(normalizzaPagamentoLegacy) as PagamentoCommessa[];
  const manuali = pagamenti.filter(
    pagamento => pagamento.origine === "manuale" && pagamento.stato === "attivo"
  );
  const espliciti = manuali.filter(
    pagamento =>
      typeof pagamento.note === "string" &&
      pagamento.note.includes(`FIC ${fattura.numero}`)
  );
  if (espliciti.length > 0) return espliciti;
  return manuali.filter(
    pagamento => pagamentoCompatibile(pagamento, rata) !== "nessuno"
  );
}

function reconcilePaidRate(input: {
  sedeId: number;
  fattura: FatturaFic;
  rata: RataFic;
  commessa: any;
  now: Date;
  stats: FicPaymentSyncStats;
  issues: FicPaymentIssue[];
}): { commesseChanged: boolean; linksChanged: boolean } {
  let linksChanged = false;
  let existing = activeLink(
    input.sedeId,
    input.fattura.id,
    input.rata.sourceKey
  );
  if (existing) {
    const existingPagamentoId = existing.pagamentoId;
    const pagamento = (input.commessa.pagamenti ?? []).find(
      (item: any) => item.id === existingPagamentoId
    );
    if (!pagamento) {
      existing.stato = "superata";
      existing.updatedAt = input.now;
      linksChanged = true;
      existing = undefined;
    }
    if (existing?.target === "manuale") {
      const normalized = normalizzaPagamentoLegacy(pagamento);
      const patch = patchForManual(normalized, input.rata);
      if (Object.keys(patch).length > 0) {
        input.issues.push(
          issueForManual({
            sedeId: input.sedeId,
            fattura: input.fattura,
            rata: input.rata,
            commessaId: input.commessa.id,
            pagamento: normalized,
          })
        );
        input.stats.correzioniProposte++;
      }
      return { commesseChanged: false, linksChanged };
    }
    if (!existing) {
      // Il target del collegamento non esiste piu: la rata viene riconciliata
      // nuovamente senza perdere l'audit del collegamento superato.
    } else {
      const normalized = normalizzaPagamentoLegacy(pagamento);
      const changed =
        normalized.importo !== input.rata.importo ||
        normalized.data !== input.rata.dataPagamento ||
        normalized.stato !== "attivo" ||
        normalized.ficStato !== input.rata.stato;
      if (!changed) return { commesseChanged: false, linksChanged };
      const wasStornato = normalized.stato === "stornato";
      Object.assign(pagamento, {
        importo: input.rata.importo,
        data: input.rata.dataPagamento,
        stato: "attivo",
        ficStato: input.rata.stato,
        ficUltimoSyncAt: input.now,
        stornatoAt: null,
        updatedAt: input.now,
      });
      if (wasStornato) input.stats.pagamentiRiattivati++;
      else input.stats.pagamentiAggiornati++;
      return { commesseChanged: true, linksChanged };
    }
  }

  const candidates = manualCandidates(
    input.fattura,
    input.rata,
    input.commessa
  );
  if (candidates.length === 1) {
    const pagamento = candidates[0];
    const compatibility = pagamentoCompatibile(pagamento, input.rata);
    const patch = patchForManual(pagamento, input.rata);
    createLink({
      sedeId: input.sedeId,
      fattura: input.fattura,
      rata: input.rata,
      commessaId: input.commessa.id,
      pagamentoId: pagamento.id,
      target: "manuale",
      stato:
        compatibility === "esatto" && Object.keys(patch).length === 0
          ? "confermata"
          : "da_verificare",
      now: input.now,
    });
    input.stats.manualiRiconciliati++;
    if (Object.keys(patch).length > 0) {
      input.issues.push(
        issueForManual({
          sedeId: input.sedeId,
          fattura: input.fattura,
          rata: input.rata,
          commessaId: input.commessa.id,
          pagamento,
        })
      );
      input.stats.correzioniProposte++;
    }
    return { commesseChanged: false, linksChanged: true };
  }
  if (candidates.length > 1) {
    input.stats.ambiguita++;
    input.issues.push({
      tipo: "scegli_manuale",
      sedeId: input.sedeId,
      commessaId: input.commessa.id,
      ficDocumentoId: input.fattura.id,
      ficSourceKey: input.rata.sourceKey,
      candidati: candidates.map(pagamento => ({
        pagamentoId: pagamento.id,
        expectedFingerprint: fingerprintPagamento(pagamento),
        patch: patchForManual(pagamento, input.rata),
      })),
    });
    return { commesseChanged: false, linksChanged: false };
  }

  const pagamento = creaPagamentoFic(
    input.fattura,
    input.rata,
    input.commessa,
    input.now
  );
  createLink({
    sedeId: input.sedeId,
    fattura: input.fattura,
    rata: input.rata,
    commessaId: input.commessa.id,
    pagamentoId: pagamento.id,
    target: "fic",
    stato: "confermata",
    now: input.now,
  });
  input.stats.pagamentiCreati++;
  return { commesseChanged: true, linksChanged: true };
}

function commessaDelLink(input: {
  commesse: any[];
  sedeId: number;
  link: RiconciliazioneRataFic;
}): any | undefined {
  return input.commesse.find(
    commessa =>
      commessa.id === input.link.commessaId &&
      (commessa.sedeId ?? DEFAULT_SEDE_ID) === input.sedeId
  );
}

function neutralizzaLink(input: {
  sedeId: number;
  link: RiconciliazioneRataFic;
  statoFic: string;
  commesse: any[];
  now: Date;
  stats: FicPaymentSyncStats;
  issues: FicPaymentIssue[];
}): { commesseChanged: boolean; linksChanged: boolean } {
  const commessa = commessaDelLink(input);
  const pagamento = commessa?.pagamenti?.find(
    (item: any) => item.id === input.link.pagamentoId
  );
  if (!commessa || !pagamento) {
    input.link.stato = "superata";
    input.link.updatedAt = input.now;
    return { commesseChanged: false, linksChanged: true };
  }

  const normalized = normalizzaPagamentoLegacy(pagamento);
  if (input.link.target === "manuale") {
    if (normalized.stato === "attivo") {
      input.issues.push(
        issueStornoManuale({
          sedeId: input.sedeId,
          link: input.link,
          pagamento: normalized,
        })
      );
      input.stats.correzioniProposte++;
    }
    return { commesseChanged: false, linksChanged: false };
  }

  const changed =
    normalized.stato !== "stornato" || normalized.ficStato !== input.statoFic;
  if (!changed) return { commesseChanged: false, linksChanged: false };

  Object.assign(pagamento, {
    stato: "stornato",
    ficStato: input.statoFic,
    ficUltimoSyncAt: input.now,
    stornatoAt: normalized.stornatoAt ?? input.now,
    updatedAt: input.now,
  });
  ricalcolaImportoIncassato(commessa);
  if (normalized.stato !== "stornato") input.stats.pagamentiStornati++;
  else input.stats.pagamentiAggiornati++;
  return { commesseChanged: true, linksChanged: false };
}

function superaLinkSpostato(input: {
  sedeId: number;
  link: RiconciliazioneRataFic;
  commesse: any[];
  now: Date;
  stats: FicPaymentSyncStats;
  issues: FicPaymentIssue[];
}): { commesseChanged: boolean; linksChanged: boolean } {
  const commessa = commessaDelLink(input);
  const pagamento = commessa?.pagamenti?.find(
    (item: any) => item.id === input.link.pagamentoId
  );
  let commesseChanged = false;

  if (commessa && pagamento) {
    const normalized = normalizzaPagamentoLegacy(pagamento);
    if (input.link.target === "fic" && normalized.stato !== "stornato") {
      Object.assign(pagamento, {
        stato: "stornato",
        ficStato: "moved",
        ficUltimoSyncAt: input.now,
        stornatoAt: input.now,
        updatedAt: input.now,
      });
      ricalcolaImportoIncassato(commessa);
      input.stats.pagamentiStornati++;
      commesseChanged = true;
    } else if (input.link.target === "manuale") {
      input.issues.push({
        tipo: "verifica_spostamento",
        sedeId: input.sedeId,
        commessaId: input.link.commessaId,
        pagamentoId: input.link.pagamentoId,
        ficDocumentoId: input.link.ficDocumentoId,
        ficSourceKey: input.link.ficSourceKey,
      });
      input.stats.correzioniProposte++;
    }
  }

  input.link.stato = "superata";
  input.link.updatedAt = input.now;
  return { commesseChanged, linksChanged: true };
}

export function riconciliaPagamentiFic(input: {
  sedeId: number;
  snapshotCompleto: boolean;
  now?: Date;
}): { stats: FicPaymentSyncStats; issues: FicPaymentIssue[] } {
  const now = input.now ?? new Date();
  const stats = emptyFicPaymentSyncStats();
  const issues: FicPaymentIssue[] = [];
  const commesse = getCommesseStore();
  let commesseChanged = false;
  let linksChanged = false;

  for (const fattura of ficFatture) {
    if (
      fattura.sedeId !== input.sedeId ||
      fattura.tipo !== "invoice" ||
      fattura.commessaId == null
    ) {
      continue;
    }
    const commessa = commesse.find(
      item =>
        item.id === fattura.commessaId &&
        (item.sedeId ?? DEFAULT_SEDE_ID) === input.sedeId
    );
    if (!commessa) continue;
    if (!Array.isArray(commessa.pagamenti)) commessa.pagamenti = [];

    const currentSourceKeys = new Set(
      fattura.presenteInFic ? fattura.rate.map(rata => rata.sourceKey) : []
    );

    if (fattura.presenteInFic) {
      for (const rata of fattura.rate) {
        const existing = activeLink(input.sedeId, fattura.id, rata.sourceKey);
        if (existing && existing.commessaId !== commessa.id) {
          const moved = superaLinkSpostato({
            sedeId: input.sedeId,
            link: existing,
            commesse,
            now,
            stats,
            issues,
          });
          commesseChanged ||= moved.commesseChanged;
          linksChanged ||= moved.linksChanged;
        }

        if (rata.stato === "paid" && rata.importo > 0) {
          const result = reconcilePaidRate({
            sedeId: input.sedeId,
            fattura,
            rata,
            commessa,
            now,
            stats,
            issues,
          });
          commesseChanged ||= result.commesseChanged;
          linksChanged ||= result.linksChanged;
          continue;
        }

        const link = activeLink(input.sedeId, fattura.id, rata.sourceKey);
        if (!link) continue;
        const result = neutralizzaLink({
          sedeId: input.sedeId,
          link,
          statoFic: rata.stato,
          commesse,
          now,
          stats,
          issues,
        });
        commesseChanged ||= result.commesseChanged;
        linksChanged ||= result.linksChanged;
      }
    }

    if (input.snapshotCompleto) {
      const missingLinks = ficPaymentLinks.filter(
        link =>
          link.sedeId === input.sedeId &&
          link.ficDocumentoId === fattura.id &&
          link.stato !== "superata" &&
          !currentSourceKeys.has(link.ficSourceKey)
      );
      for (const link of missingLinks) {
        const result = neutralizzaLink({
          sedeId: input.sedeId,
          link,
          statoFic: "removed",
          commesse,
          now,
          stats,
          issues,
        });
        commesseChanged ||= result.commesseChanged;
        linksChanged ||= result.linksChanged;
      }
    }
    ricalcolaImportoIncassato(commessa);
  }

  if (commesseChanged) saveCommesseStore();
  if (linksChanged) saveFicPaymentLinks();
  return { stats, issues };
}
