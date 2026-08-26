import {
  fingerprintPagamento,
  normalizzaPagamentoLegacy,
  pagamentoCompatibile,
  type PagamentoCommessa,
} from "../_core/commessaPayments";
import { getCommesseStore } from "../routers/commesse";
import {
  correzionePagamentoFicValida,
  ficPaymentLinks,
  type FicPaymentIssue,
  type FicPaymentPatch,
} from "../routers/ficPagamenti";
import { ficFatture } from "../routers/ficFatture";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import {
  chiaveAzioneProposta,
  newPropostaId,
  propostaGiaGestita,
  propostaGiaInCoda,
  propostaGiaRifiutata,
  proposte,
  saveProposte,
  type Proposta,
} from "./stores";

function commessaInSede(commessaId: number, sedeId: number): any | null {
  return (
    getCommesseStore().find(
      commessa =>
        commessa.id === commessaId &&
        (commessa.sedeId ?? DEFAULT_SEDE_ID) === sedeId
    ) ?? null
  );
}

function pagamentoManuale(
  sedeId: number,
  commessaId: number,
  pagamentoId: number
): PagamentoCommessa | null {
  const commessa = commessaInSede(commessaId, sedeId);
  const pagamento = commessa?.pagamenti?.find(
    (item: any) => item.id === pagamentoId
  );
  if (!pagamento) return null;
  const normalized = normalizzaPagamentoLegacy(pagamento);
  return normalized.origine === "manuale" ? normalized : null;
}

function propostaDaIssue(
  issue: FicPaymentIssue,
  sedeId: number,
  now: Date
): Proposta | null {
  const fattura = ficFatture.find(
    item => item.sedeId === sedeId && item.id === issue.ficDocumentoId
  );
  const numero = fattura?.numero ?? String(issue.ficDocumentoId);
  let pagamentoId: number | null = null;
  let expectedFingerprint: string | null = null;
  let patch: FicPaymentPatch | null = null;
  let candidati:
    | Array<{
        pagamentoId: number;
        expectedFingerprint: string;
        patch: FicPaymentPatch;
      }>
    | undefined;

  if (issue.tipo === "correggi_manuale") {
    pagamentoId = issue.pagamentoId;
    expectedFingerprint = issue.expectedFingerprint;
    patch = issue.patch;
  } else if (issue.tipo === "scegli_manuale") {
    candidati = issue.candidati;
  } else {
    const pagamento = pagamentoManuale(
      sedeId,
      issue.commessaId,
      issue.pagamentoId
    );
    if (!pagamento) return null;
    pagamentoId = issue.pagamentoId;
    expectedFingerprint = fingerprintPagamento(pagamento);
    patch = { stato: "stornato" };
  }

  const payload = {
    commessaId: issue.commessaId,
    pagamentoId,
    ficDocumentoId: issue.ficDocumentoId,
    ficSourceKey: issue.ficSourceKey,
    expectedFingerprint,
    patch,
    ...(candidati ? { candidati } : {}),
  };
  const candidata = {
    tipo: "correzione_pagamento" as const,
    commessaId: issue.commessaId,
    clienteId: null,
    payload,
    titolo:
      issue.tipo === "scegli_manuale"
        ? `Scegli il pagamento CRM per la fattura ${numero}`
        : `Allinea il pagamento CRM alla fattura ${numero}`,
  };
  return {
    id: newPropostaId(),
    sedeId,
    ...candidata,
    motivazione:
      "Il registro CRM non coincide con la rata autorevole di Fatture in Cloud.",
    confidenza: issue.tipo === "scegli_manuale" ? "media" : "alta",
    opzioni: null,
    risposta: null,
    stato: "pendente",
    esito: null,
    motivoRifiuto: null,
    esecuzioneId: null,
    trigger: "fic_sync",
    createdAt: now,
    decisaAt: null,
    decisaDa: null,
    decisaDaNome: null,
    seguitoAt: null,
    seguitoEsecuzioneId: null,
    origineId: null,
    requestedByUserId: null,
    chiaveAzione: chiaveAzioneProposta(candidata),
    evidenceRefs: [
      {
        sourceType: "fattura_fic",
        sourceId: String(issue.ficDocumentoId),
        label: `Fattura FiC ${numero}`,
        version: issue.ficSourceKey,
      },
      {
        sourceType: "pagamento",
        sourceId: `${issue.commessaId}:${pagamentoId ?? "da_scegliere"}`,
        label: `Registro pagamenti commessa #${issue.commessaId}`,
        version: expectedFingerprint ?? issue.ficSourceKey,
      },
    ],
    correzioni: [],
  };
}

export function creaProposteCorrezionePagamento(
  issues: readonly FicPaymentIssue[],
  sedeId: number,
  now = new Date()
): { create: number; ambigue: number } {
  let create = 0;
  let ambigue = 0;
  for (const issue of issues) {
    if (issue.sedeId !== sedeId) continue;
    const proposta = propostaDaIssue(issue, sedeId, now);
    if (!proposta) continue;
    const candidata = {
      tipo: proposta.tipo,
      commessaId: proposta.commessaId,
      clienteId: proposta.clienteId,
      payload: proposta.payload,
      titolo: proposta.titolo,
    };
    if (
      propostaGiaRifiutata(candidata, sedeId) ||
      propostaGiaInCoda(candidata, sedeId) ||
      propostaGiaGestita(candidata, sedeId)
    ) {
      continue;
    }
    proposte.push(proposta);
    create++;
    if (issue.tipo === "scegli_manuale") ambigue++;
  }
  if (create > 0) saveProposte();
  return { create, ambigue };
}

function sameValue(current: unknown, expected: unknown): boolean {
  if (typeof current === "number" || typeof expected === "number") {
    const a = Number(current);
    const b = Number(expected);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.01;
  }
  return (current ?? null) === (expected ?? null);
}

function patchSoddisfatta(
  pagamento: PagamentoCommessa,
  patch: FicPaymentPatch | null | undefined
): boolean {
  if (!patch || Object.keys(patch).length === 0) return false;
  return Object.entries(patch).every(([key, value]) =>
    sameValue((pagamento as any)[key], value)
  );
}

function correzioneObsoleta(proposta: Proposta, sedeId: number): boolean {
  const payload = proposta.payload ?? {};
  const link = ficPaymentLinks.find(
    item =>
      item.sedeId === sedeId &&
      item.ficDocumentoId === payload.ficDocumentoId &&
      item.ficSourceKey === payload.ficSourceKey &&
      item.stato !== "superata"
  );
  if (payload.pagamentoId == null) {
    if (link) return true;
    const candidati = Array.isArray(payload.candidati) ? payload.candidati : [];
    return !candidati.some((candidate: any) => {
      const pagamento = pagamentoManuale(
        sedeId,
        proposta.commessaId!,
        Number(candidate.pagamentoId)
      );
      return (
        pagamento != null &&
        fingerprintPagamento(pagamento) === candidate.expectedFingerprint
      );
    });
  }

  const pagamento = pagamentoManuale(
    sedeId,
    proposta.commessaId!,
    Number(payload.pagamentoId)
  );
  if (!pagamento) return true;
  if (
    link &&
    (link.commessaId !== proposta.commessaId ||
      link.pagamentoId !== pagamento.id ||
      link.target !== "manuale")
  ) {
    return true;
  }
  if (
    !correzionePagamentoFicValida({
      sedeId,
      ficDocumentoId: Number(payload.ficDocumentoId),
      ficSourceKey: String(payload.ficSourceKey ?? ""),
      commessaId: proposta.commessaId!,
      pagamento,
      patch: payload.patch ?? {},
    })
  ) {
    return true;
  }
  if (patchSoddisfatta(pagamento, payload.patch)) return true;
  return fingerprintPagamento(pagamento) !== payload.expectedFingerprint;
}

function pagamentoGiaPresente(proposta: Proposta, sedeId: number): boolean {
  const commessa = commessaInSede(proposta.commessaId!, sedeId);
  if (!commessa) return true;
  const payload = proposta.payload ?? {};
  return (commessa.pagamenti ?? []).map(normalizzaPagamentoLegacy).some(
    (pagamento: PagamentoCommessa) =>
      pagamentoCompatibile(pagamento, {
        importo: Number(payload.importo),
        dataPagamento: payload.data ?? null,
      }) !== "nessuno"
  );
}

function modificaGiaApplicata(proposta: Proposta, sedeId: number): boolean {
  const commessa = commessaInSede(proposta.commessaId!, sedeId);
  if (!commessa) return true;
  const campi = proposta.payload?.campi;
  return (
    campi != null &&
    Object.keys(campi).length > 0 &&
    Object.entries(campi).every(([key, value]) =>
      sameValue(commessa[key], value)
    )
  );
}

function marcaSuperata(proposta: Proposta, now: Date): void {
  proposta.stato = "superata";
  proposta.esito =
    "Azione gia soddisfatta o sostituita dalla riconciliazione FiC.";
  proposta.decisaAt = now;
  proposta.decisaDa = null;
  proposta.decisaDaNome = null;
}

export function superaProposteFicObsolete(
  sedeId: number,
  now = new Date()
): number {
  let count = 0;
  const pending = proposte
    .filter(
      proposta =>
        proposta.sedeId === sedeId &&
        (proposta.stato === "pendente" ||
          (proposta.stato === "errore" &&
            proposta.tipo === "correzione_pagamento"))
    )
    .sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
    );
  const oldestByKey = new Map<string, Proposta>();

  for (const proposta of pending) {
    const key = proposta.chiaveAzione ?? chiaveAzioneProposta(proposta);
    if (proposta.stato === "pendente") {
      const oldest = oldestByKey.get(key);
      if (oldest) {
        marcaSuperata(proposta, now);
        count++;
        continue;
      }
      oldestByKey.set(key, proposta);
    }

    const obsolete =
      (proposta.tipo === "correzione_pagamento" &&
        correzioneObsoleta(proposta, sedeId)) ||
      (proposta.tipo === "pagamento" &&
        pagamentoGiaPresente(proposta, sedeId)) ||
      (proposta.tipo === "modifica_commessa" &&
        modificaGiaApplicata(proposta, sedeId));
    if (!obsolete) continue;
    marcaSuperata(proposta, now);
    count++;
  }

  if (count > 0) saveProposte();
  return count;
}
