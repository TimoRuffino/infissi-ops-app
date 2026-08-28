import { versioneRegistroPagamenti } from "../_core/commessaPayments";
import { getCommesseStore } from "../routers/commesse";
import { getGaranzieStore } from "../routers/garanzie";
import { getInterventiStore } from "../routers/interventi";
import { getTicketStore } from "../routers/ticket";
import { collectActionSignals, groupSignals } from "./signals";
import type { ActionCaseDraft, ActionSignal } from "./types";

function asDate(value: unknown, fallback: Date): Date {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function collectCurrentSignals(
  sedeId: number,
  now = new Date()
): ActionSignal[] {
  return collectActionSignals({
    sedeId,
    now,
    commesse: getCommesseStore().map((item: any) => ({
      id: item.id,
      sedeId: item.sedeId,
      codice: item.codice,
      clienteId: item.clienteId ?? null,
      cliente: item.cliente ?? "Cliente",
      stato: item.stato,
      priorita: item.priorita ?? "media",
      assegnatoA: item.assegnatoA ?? null,
      createdBy: item.createdBy ?? null,
      updatedAt: asDate(item.updatedAt, now),
      archivedAt: item.archivedAt ?? null,
      dataConsegnaConfermata: item.dataConsegnaConfermata ?? null,
      importoTotale: item.importoTotale ?? null,
      importoIncassato: item.importoIncassato ?? 0,
      registroVersione: versioneRegistroPagamenti(item.pagamenti),
    })),
    tickets: getTicketStore().map((item: any) => ({
      id: item.id,
      sedeId: item.sedeId,
      commessaId: item.commessaId ?? null,
      clienteId: item.clienteId ?? null,
      contatto: item.contatto ?? null,
      oggetto: item.oggetto ?? "Ticket",
      stato: item.stato,
      priorita: item.priorita ?? "media",
      assegnatoA: item.assegnatoA ?? null,
      apertoBy: item.apertoBy ?? null,
      createdAt: asDate(item.createdAt, now),
      updatedAt: asDate(item.updatedAt, now),
    })),
    garanzie: getGaranzieStore().map((item: any) => ({
      id: item.id,
      sedeId: item.sedeId,
      commessaId: item.commessaId ?? null,
      descrizione: item.descrizione ?? "Garanzia",
      stato: item.stato,
      dataScadenza: item.dataScadenza,
      updatedAt: asDate(item.updatedAt, now),
    })),
    interventi: getInterventiStore().map((item: any) => ({
      id: item.id,
      sedeId: item.sedeId,
      commessaId: item.commessaId ?? null,
      tipo: item.tipo ?? "altro",
      stato: item.stato,
      squadraId: item.squadraId ?? null,
      dataPianificata: item.dataPianificata ?? null,
      oraInizio: item.oraInizio ?? null,
      indirizzo: item.indirizzo ?? null,
      createdAt: asDate(item.createdAt, now),
      updatedAt: asDate(item.updatedAt, now),
    })),
  });
}

export function collectCurrentDrafts(
  sedeId: number,
  now = new Date()
): { signals: ActionSignal[]; drafts: ActionCaseDraft[] } {
  const signals = collectCurrentSignals(sedeId, now);
  return { signals, drafts: groupSignals(signals, now) };
}
