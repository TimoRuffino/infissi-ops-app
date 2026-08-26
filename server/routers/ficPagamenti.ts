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

function samePatchValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const left = Number(a);
    const right = Number(b);
    return (
      Number.isFinite(left) &&
      Number.isFinite(right) &&
      Math.abs(left - right) < 0.01
    );
  }
  return (a ?? null) === (b ?? null);
}

function samePaymentPatch(
  actual: FicPaymentPatch,
  expected: FicPaymentPatch
): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every(
      (key, index) =>
        key === expectedKeys[index] &&
        samePatchValue(
          actual[key as keyof FicPaymentPatch],
          expected[key as keyof FicPaymentPatch]
        )
    )
  );
}

function manualRateRank(
  pagamento: PagamentoCommessa,
  rata: RataFic
): number {
  const compatibility = pagamentoCompatibile(pagamento, rata);
  if (
    compatibility === "esatto" &&
    Object.keys(patchForManual(pagamento, rata)).length === 0
  ) {
    return 2;
  }
  return compatibility === "nessuno" ? 0 : 1;
}

function activeManualLinksForPayment(input: {
  sedeId: number;
  commessaId: number;
  pagamentoId: number;
}): RiconciliazioneRataFic[] {
  return ficPaymentLinks.filter(
    link =>
      link.sedeId === input.sedeId &&
      link.commessaId === input.commessaId &&
      link.pagamentoId === input.pagamentoId &&
      link.target === "manuale" &&
      link.stato !== "superata"
  );
}

export function esisteLinkManualeSuperato(input: {
  sedeId: number;
  ficDocumentoId: number;
  ficSourceKey: string;
  commessaId: number;
  pagamentoId: number;
}): boolean {
  return ficPaymentLinks.some(
    link =>
      link.sedeId === input.sedeId &&
      link.ficDocumentoId === input.ficDocumentoId &&
      link.ficSourceKey === input.ficSourceKey &&
      link.commessaId === input.commessaId &&
      link.pagamentoId === input.pagamentoId &&
      link.target === "manuale" &&
      link.stato === "superata"
  );
}

export function trovaConflittoRiconciliazioneManuale(input: {
  sedeId: number;
  ficDocumentoId: number;
  ficSourceKey: string;
  commessaId: number;
  pagamentoId: number;
}): RiconciliazioneRataFic | undefined {
  const sourceLink = activeLink(
    input.sedeId,
    input.ficDocumentoId,
    input.ficSourceKey
  );
  if (
    sourceLink &&
    (sourceLink.target !== "manuale" ||
      sourceLink.commessaId !== input.commessaId ||
      sourceLink.pagamentoId !== input.pagamentoId)
  ) {
    return sourceLink;
  }
  return activeManualLinksForPayment(input).find(
    link =>
      link.ficDocumentoId !== input.ficDocumentoId ||
      link.ficSourceKey !== input.ficSourceKey
  );
}

/**
 * Rilegge la rata autorevole FiC al momento dell'approvazione. La proposta e
 * valida solo se richiede ancora esattamente la stessa correzione.
 */
export function correzionePagamentoFicValida(input: {
  sedeId: number;
  ficDocumentoId: number;
  ficSourceKey: string;
  commessaId: number;
  pagamento: PagamentoCommessa;
  patch: FicPaymentPatch;
}): boolean {
  const fattura = ficFatture.find(
    item =>
      item.sedeId === input.sedeId && item.id === input.ficDocumentoId
  );
  if (!fattura || fattura.commessaId !== input.commessaId) return false;

  const rata = fattura.rate.find(
    item => item.sourceKey === input.ficSourceKey
  );
  if (rata?.stato === "paid" && rata.importo > 0) {
    return samePaymentPatch(
      input.patch,
      patchForManual(input.pagamento, rata)
    );
  }

  const link = activeLink(
    input.sedeId,
    input.ficDocumentoId,
    input.ficSourceKey
  );
  return (
    link?.target === "manuale" &&
    link.commessaId === input.commessaId &&
    link.pagamentoId === input.pagamento.id &&
    samePaymentPatch(input.patch, { stato: "stornato" })
  );
}

function canonicalManualLink(input: {
  links: RiconciliazioneRataFic[];
  pagamento: PagamentoCommessa;
}): RiconciliazioneRataFic {
  return [...input.links].sort((a, b) => {
    const rank = (link: RiconciliazioneRataFic) => {
      const rata = ficFatture
        .find(
          fattura =>
            fattura.sedeId === link.sedeId &&
            fattura.id === link.ficDocumentoId
        )
        ?.rate.find(item => item.sourceKey === link.ficSourceKey);
      if (!rata) return 0;
      return manualRateRank(input.pagamento, rata);
    };
    return rank(b) - rank(a) || a.id - b.id;
  })[0];
}

function duplicateSourceLinkLosers(input: {
  sedeId: number;
  fattura: FatturaFic;
  rata: RataFic;
  commessa: any;
  commesse: any[];
}): RiconciliazioneRataFic[] {
  const links = ficPaymentLinks.filter(
    link =>
      link.sedeId === input.sedeId &&
      link.ficDocumentoId === input.fattura.id &&
      link.ficSourceKey === input.rata.sourceKey &&
      link.stato !== "superata"
  );
  if (links.length <= 1) return [];

  const rank = (link: RiconciliazioneRataFic): number => {
    const owner = input.commesse.find(
      commessa =>
        commessa.id === link.commessaId &&
        (commessa.sedeId ?? DEFAULT_SEDE_ID) === input.sedeId
    );
    const raw = owner?.pagamenti?.find(
      (pagamento: any) => pagamento.id === link.pagamentoId
    );
    const currentCommessaBonus = link.commessaId === input.commessa.id ? 100 : 0;
    if (!raw) return currentCommessaBonus + 1;
    const pagamento = normalizzaPagamentoLegacy(raw);
    if (link.target === "manuale" && pagamento.origine === "manuale") {
      return currentCommessaBonus + 50 + manualRateRank(pagamento, input.rata);
    }
    if (
      link.target === "fic" &&
      pagamento.origine === "fic" &&
      pagamento.ficDocumentoId === input.fattura.id &&
      pagamento.ficSourceKey === input.rata.sourceKey
    ) {
      return currentCommessaBonus + 40;
    }
    return currentCommessaBonus + 2;
  };
  const canonical = [...links].sort(
    (a, b) => rank(b) - rank(a) || a.id - b.id
  )[0];
  return links.filter(link => link.id !== canonical.id);
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
  sedeId: number,
  fattura: FatturaFic,
  rata: RataFic,
  commessa: any
): PagamentoCommessa[] {
  const pagamenti = (
    Array.isArray(commessa.pagamenti) ? commessa.pagamenti : []
  ).map(normalizzaPagamentoLegacy) as PagamentoCommessa[];
  const manuali = pagamenti.filter(
    pagamento =>
      pagamento.origine === "manuale" &&
      pagamento.stato === "attivo" &&
      !trovaConflittoRiconciliazioneManuale({
        sedeId,
        ficDocumentoId: fattura.id,
        ficSourceKey: rata.sourceKey,
        commessaId: commessa.id,
        pagamentoId: pagamento.id,
      })
  );
  const espliciti = manuali.filter(
    pagamento => {
      if (
        typeof pagamento.note !== "string" ||
        !pagamento.note.includes(`FIC ${fattura.numero}`)
      ) {
        return false;
      }
      const paidRates = fattura.rate.filter(
        item => item.stato === "paid" && item.importo > 0
      );
      if (paidRates.length <= 1) return true;
      const best = [...paidRates].sort(
        (a, b) =>
          manualRateRank(pagamento, b) - manualRateRank(pagamento, a) ||
          a.sourceKey.localeCompare(b.sourceKey)
      )[0];
      return (
        manualRateRank(pagamento, best) > 0 &&
        best.sourceKey === rata.sourceKey
      );
    }
  );
  if (espliciti.length > 0) return espliciti;
  return manuali.filter(
    pagamento => pagamentoCompatibile(pagamento, rata) !== "nessuno"
  );
}

function bloccaFatturaMultirataEsplicitaDiscordante(input: {
  sedeId: number;
  fattura: FatturaFic;
  commessa: any;
  now: Date;
  stats: FicPaymentSyncStats;
  issues: FicPaymentIssue[];
}): boolean {
  const paidRates = input.fattura.rate.filter(
    rata => rata.stato === "paid" && rata.importo > 0
  );
  if (paidRates.length <= 1) return false;

  const explicitManuals: PagamentoCommessa[] = (input.commessa.pagamenti ?? [])
    .map(normalizzaPagamentoLegacy)
    .filter(
      (pagamento: PagamentoCommessa) =>
        pagamento.origine === "manuale" &&
        pagamento.stato === "attivo" &&
        typeof pagamento.note === "string" &&
        pagamento.note.includes(`FIC ${input.fattura.numero}`) &&
        paidRates.every(rata => manualRateRank(pagamento, rata) === 0)
    );
  if (explicitManuals.length === 0) return false;

  const closestRate = [...paidRates].sort((a, b) => {
    const distanceA = Math.min(
      ...explicitManuals.map(pagamento =>
        Math.abs(pagamento.importo - a.importo)
      )
    );
    const distanceB = Math.min(
      ...explicitManuals.map(pagamento =>
        Math.abs(pagamento.importo - b.importo)
      )
    );
    return distanceA - distanceB || a.sourceKey.localeCompare(b.sourceKey);
  })[0];

  if (explicitManuals.length > 1) {
    input.issues.push({
      tipo: "scegli_manuale",
      sedeId: input.sedeId,
      commessaId: input.commessa.id,
      ficDocumentoId: input.fattura.id,
      ficSourceKey: closestRate.sourceKey,
      candidati: explicitManuals.map(pagamento => ({
        pagamentoId: pagamento.id,
        expectedFingerprint: fingerprintPagamento(pagamento),
        patch: patchForManual(pagamento, closestRate),
      })),
    });
    input.stats.ambiguita++;
    return true;
  }

  const pagamento = explicitManuals[0];
  const existingLink = activeManualLinksForPayment({
    sedeId: input.sedeId,
    commessaId: input.commessa.id,
    pagamentoId: pagamento.id,
  }).find(link => link.ficDocumentoId === input.fattura.id);
  const targetRate = existingLink
    ? paidRates.find(rata => rata.sourceKey === existingLink.ficSourceKey) ??
      closestRate
    : closestRate;
  if (
    !existingLink &&
    trovaConflittoRiconciliazioneManuale({
      sedeId: input.sedeId,
      ficDocumentoId: input.fattura.id,
      ficSourceKey: targetRate.sourceKey,
      commessaId: input.commessa.id,
      pagamentoId: pagamento.id,
    })
  ) {
    return false;
  }
  if (!existingLink) {
    createLink({
      sedeId: input.sedeId,
      fattura: input.fattura,
      rata: targetRate,
      commessaId: input.commessa.id,
      pagamentoId: pagamento.id,
      target: "manuale",
      stato: "da_verificare",
      now: input.now,
    });
  }
  return true;
}

function reconcilePaidRate(input: {
  sedeId: number;
  fattura: FatturaFic;
  rata: RataFic;
  commessa: any;
  now: Date;
  stats: FicPaymentSyncStats;
  issues: FicPaymentIssue[];
  allowCreate: boolean;
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
      const competingLinks = activeManualLinksForPayment({
        sedeId: input.sedeId,
        commessaId: input.commessa.id,
        pagamentoId: normalized.id,
      });
      if (competingLinks.length > 1) {
        const canonical = canonicalManualLink({
          links: competingLinks,
          pagamento: normalized,
        });
        for (const link of competingLinks) {
          if (link.id === canonical.id) continue;
          link.stato = "superata";
          link.updatedAt = input.now;
          linksChanged = true;
        }
        if (existing.id !== canonical.id) existing = undefined;
      }
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

  const pagamentoFicPersistito = (input.commessa.pagamenti ?? []).find(
    (item: any) => {
      const pagamento = normalizzaPagamentoLegacy(item);
      return (
        pagamento.origine === "fic" &&
        pagamento.ficDocumentoId === input.fattura.id &&
        pagamento.ficSourceKey === input.rata.sourceKey
      );
    }
  );
  if (pagamentoFicPersistito) {
    const normalized = normalizzaPagamentoLegacy(pagamentoFicPersistito);
    const changed =
      normalized.importo !== input.rata.importo ||
      normalized.data !== input.rata.dataPagamento ||
      normalized.stato !== "attivo" ||
      normalized.ficStato !== input.rata.stato;
    const wasStornato = normalized.stato === "stornato";
    if (changed) {
      Object.assign(pagamentoFicPersistito, {
        importo: input.rata.importo,
        data: input.rata.dataPagamento,
        stato: "attivo",
        ficDocumentoId: input.fattura.id,
        ficRataId: input.rata.id,
        ficSourceKey: input.rata.sourceKey,
        ficStato: input.rata.stato,
        ficUltimoSyncAt: input.now,
        stornatoAt: null,
        updatedAt: input.now,
      });
      if (wasStornato) input.stats.pagamentiRiattivati++;
      else input.stats.pagamentiAggiornati++;
    }
    createLink({
      sedeId: input.sedeId,
      fattura: input.fattura,
      rata: input.rata,
      commessaId: input.commessa.id,
      pagamentoId: normalized.id,
      target: "fic",
      stato: "confermata",
      now: input.now,
    });
    return { commesseChanged: changed, linksChanged: true };
  }

  const candidates = manualCandidates(
    input.sedeId,
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

  if (!input.allowCreate) {
    return { commesseChanged: false, linksChanged };
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

    const bloccaNuoviMovimenti =
      fattura.presenteInFic &&
      bloccaFatturaMultirataEsplicitaDiscordante({
        sedeId: input.sedeId,
        fattura,
        commessa,
        now,
        stats,
        issues,
      });
    linksChanged ||= bloccaNuoviMovimenti;

    if (fattura.presenteInFic) {
      for (const rata of fattura.rate) {
        const duplicateLosers = duplicateSourceLinkLosers({
          sedeId: input.sedeId,
          fattura,
          rata,
          commessa,
          commesse,
        });
        for (const duplicate of duplicateLosers) {
          const cleanup = superaLinkSpostato({
            sedeId: input.sedeId,
            link: duplicate,
            commesse,
            now,
            stats,
            issues,
          });
          commesseChanged ||= cleanup.commesseChanged;
          linksChanged ||= cleanup.linksChanged;
        }
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
            allowCreate: !bloccaNuoviMovimenti,
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
