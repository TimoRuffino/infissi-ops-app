import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getCommesseStore } from "./commesse";

// ── Logic ───────────────────────────────────────────────────────────────────
//
// Notifications are computed on-demand for the current user based on:
//   1. PRIORITY AGING: creator of a commessa gets notified when days since
//      last update exceeds a priority-based threshold. After threshold, the
//      notification shows every day (still present in list until updatedAt
//      changes).
//   2. STATO + ROLE: certain stato transitions route notifications to users
//      with matching roles, in addition to the creator.
//
// Thresholds:
//   bassa  → 7 giorni
//   media  → 5 giorni
//   alta   → 3 giorni
//   urgente→ 1 giorno
//
// Role routing:
//   stato="da_ordinare"                        → role "ordini"
//   stato="misure_esecutive"                   → role "tecnico_rilievi"
//   stato∈{"fatture_pagamento","finiture_saldo"} → role "amministrazione"

const PRIORITY_THRESHOLD_DAYS: Record<string, number> = {
  bassa: 7,
  media: 5,
  alta: 3,
  urgente: 1,
};

const STATO_ROLE_ROUTING: Record<string, string> = {
  da_ordinare: "ordini",
  misure_esecutive: "tecnico_rilievi",
  fatture_pagamento: "amministrazione",
  finiture_saldo: "amministrazione",
};

const STATO_LABEL: Record<string, string> = {
  preventivo: "Preventivo",
  misure_esecutive: "Misure Esecutive",
  aggiornamento_contratto: "Aggiornamento Contratto",
  fatture_pagamento: "Fatture / Pagamento",
  da_ordinare: "Da Ordinare",
  produzione: "Produzione",
  ordini_ultimazione: "Richiesta Secondo Acconto",
  attesa_posa: "Attesa Posa",
  finiture_saldo: "Finiture / Saldo",
  interventi_regolazioni: "Interventi / Regolazioni",
  archiviata: "Archiviata",
};

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

type Notifica = {
  id: string;
  commessaId: number;
  commessaCodice: string;
  cliente: string;
  stato: string;
  statoLabel: string;
  priorita: string;
  type: "priority_aging" | "stato_role";
  message: string;
  severity: "info" | "warning" | "urgent";
  createdAt: Date;
};

function buildNotifichePerUtente(userId: number, ruoli: string[]): Notifica[] {
  const commesse = getCommesseStore();
  const now = new Date();
  const out: Notifica[] = [];

  for (const c of commesse) {
    if (c.stato === "archiviata") continue;

    const isCreator = c.createdBy === userId;

    // 1. Priority aging (only for creator)
    if (isCreator) {
      const threshold = PRIORITY_THRESHOLD_DAYS[c.priorita] ?? 5;
      const age = daysBetween(now, new Date(c.updatedAt));
      if (age >= threshold) {
        const severity: Notifica["severity"] =
          c.priorita === "urgente" ? "urgent" : c.priorita === "alta" ? "warning" : "info";
        out.push({
          id: `aging-${c.id}-${age}`,
          commessaId: c.id,
          commessaCodice: c.codice,
          cliente: c.cliente,
          stato: c.stato,
          statoLabel: STATO_LABEL[c.stato] ?? c.stato,
          priorita: c.priorita,
          type: "priority_aging",
          message: `Commessa ferma da ${age} giorni (priorità ${c.priorita}, soglia ${threshold}gg)`,
          severity,
          createdAt: new Date(c.updatedAt),
        });
      }
    }

    // 2. Stato + role routing
    const targetRole = STATO_ROLE_ROUTING[c.stato];
    if (targetRole && ruoli.includes(targetRole)) {
      out.push({
        id: `stato-${c.id}-${c.stato}-${targetRole}`,
        commessaId: c.id,
        commessaCodice: c.codice,
        cliente: c.cliente,
        stato: c.stato,
        statoLabel: STATO_LABEL[c.stato] ?? c.stato,
        priorita: c.priorita,
        type: "stato_role",
        message: `Commessa in stato "${STATO_LABEL[c.stato] ?? c.stato}" richiede la tua attenzione`,
        severity: "info",
        createdAt: new Date(c.updatedAt),
      });
    }
  }

  // Newest first
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export const notificheRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return [] as Notifica[];
    const ruoli: string[] = Array.isArray((ctx.user as any).ruoli)
      ? (ctx.user as any).ruoli
      : (ctx.user as any).ruolo
      ? [(ctx.user as any).ruolo]
      : [];
    return buildNotifichePerUtente(ctx.user.id as number, ruoli);
  }),

  count: publicProcedure.query(({ ctx }) => {
    if (!ctx.user) return 0;
    const ruoli: string[] = Array.isArray((ctx.user as any).ruoli)
      ? (ctx.user as any).ruoli
      : (ctx.user as any).ruolo
      ? [(ctx.user as any).ruolo]
      : [];
    return buildNotifichePerUtente(ctx.user.id as number, ruoli).length;
  }),
});
