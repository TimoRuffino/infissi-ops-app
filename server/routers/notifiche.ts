import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommesseStore } from "./commesse";
import { getInterventiStore } from "./interventi";
import { getTicketStore } from "./ticket";
import { getGaranzieStore } from "./garanzie";
import { getClienteById } from "./clienti";

// ── Logic ───────────────────────────────────────────────────────────────────
//
// Notifications are computed on-demand for the current user. Personalization:
// "owner" = commessa.assegnatoA === userId (legacy fallback createdBy), plus
// role-based routing for the operational stati. Sources:
//
//   1. PRIORITY AGING (owner): commessa idle longer than its priority
//      threshold. Id embeds updatedAt → marking read silences it until the
//      commessa is touched again (then a fresh notification appears).
//   2. DAILY REMINDER (owner): bottleneck stati fire once per calendar day.
//      Id embeds the date → reading silences for today only.
//   3. STATO + ROLE: stato transitions route to users with matching roles.
//      Id is (commessa, stato) → reading silences until the stato changes.
//   4. CONSEGNA DA CONFERMARE (owner + direzione): in produzione without a
//      confirmed delivery date.
//   5. GARANZIE (amministrazione + direzione): expired → urgent; expiring
//      within 30 days → warning.
//   6. TICKET APERTI (owner of the linked commessa + direzione): open or
//      assigned tickets, severity follows ticket priority.
//   7. INTERVENTI SENZA SQUADRA (owner; direzione when unlinked): today's or
//      tomorrow's appointments still without a squadra.
//
// Read state is persisted per user ("notifiche_read"): list marks items
// read, count returns unread only. Ids are designed so that re-reading the
// same logical event stays silenced, while escalations re-notify.

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

// Stati that must generate a daily reminder to the owner regardless of
// priority aging — idle days in these states cost real money.
const STATO_DAILY_REMINDER = new Set([
  "aggiornamento_contratto",
  "fatture_pagamento",
  "da_ordinare",
]);

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

const TIPO_INTERVENTO_LABEL: Record<string, string> = {
  rilievo: "Rilievo",
  posa: "Posa",
  assistenza: "Assistenza",
  altro: "Intervento",
};

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Notifica = {
  id: string;
  commessaId: number | null;
  commessaCodice: string | null;
  cliente: string;
  stato: string;
  statoLabel: string;
  priorita: string;
  type:
    | "priority_aging"
    | "stato_role"
    | "stato_daily"
    | "consegna"
    | "garanzia"
    | "ticket"
    | "intervento";
  message: string;
  severity: "info" | "warning" | "urgent";
  // Where the client should navigate on click. Defaults to the commessa.
  link: string;
  createdAt: Date;
};

// ── Per-user read state ──────────────────────────────────────────────────────
// One row per user: { id, userId, readIds: string[] }. Capped so the row
// can't grow unbounded — old ids age out naturally because notification ids
// rotate (dates / updatedAt timestamps).
const MAX_READ_IDS = 800;
let nextReadId = 1;
const _readStore = persistedStore<any>("notifiche_read", (loaded) => {
  nextReadId = loaded.length
    ? Math.max(...loaded.map((x: any) => x.id)) + 1
    : 1;
});
const readRows = _readStore.items;

function readSetFor(userId: number): Set<string> {
  const row = readRows.find((r: any) => r.userId === userId);
  return new Set<string>(row?.readIds ?? []);
}

function markIdsRead(userId: number, ids: string[]): void {
  let row = readRows.find((r: any) => r.userId === userId);
  if (!row) {
    row = { id: nextReadId++, userId, readIds: [], updatedAt: new Date() };
    readRows.push(row);
  }
  const merged = new Set<string>(row.readIds ?? []);
  for (const id of ids) merged.add(id);
  // Keep the most recent MAX_READ_IDS (Set preserves insertion order).
  row.readIds = Array.from(merged).slice(-MAX_READ_IDS);
  row.updatedAt = new Date();
  _readStore.save();
}

// ── Engine ───────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<Notifica["severity"], number> = {
  urgent: 0,
  warning: 1,
  info: 2,
};

function buildNotifichePerUtente(
  userId: number,
  ruoli: string[],
  sedeId: number | null
): Notifica[] {
  const commesse = getCommesseStore();
  const interventi = getInterventiStore();
  const tickets = getTicketStore();
  const garanzie = getGaranzieStore();
  const now = new Date();
  const todayStr = toDateStr(now);
  const tomorrowStr = toDateStr(new Date(now.getTime() + 86400000));
  const isDirezione = ruoli.includes("direzione");
  const out: Notifica[] = [];

  const inSede = (x: any) => sedeId == null || x.sedeId === sedeId;
  const commessaById = new Map<number, any>();
  for (const c of commesse) commessaById.set(c.id, c);
  const isOwnerOf = (c: any) =>
    c.assegnatoA === userId || (c.assegnatoA == null && c.createdBy === userId);
  // Nome cliente per i ticket agganciati a un cliente ma senza commessa.
  const clienteLabel = (id: number): string | null => {
    const cl = getClienteById(id);
    return cl ? `${cl.cognome ?? ""} ${cl.nome ?? ""}`.trim() || null : null;
  };

  for (const c of commesse) {
    if (!inSede(c)) continue;
    // Skip both closed (stato === "archiviata") AND soft-archived
    // (archivedAt set when the client declined the job).
    if (c.stato === "archiviata") continue;
    if ((c as any).archivedAt) continue;

    const isOwner = isOwnerOf(c);
    const age = daysBetween(now, new Date(c.updatedAt));

    // 1. Priority aging (owner). Id embeds updatedAt so "segna come letta"
    // silences it until the commessa moves again.
    if (isOwner) {
      const threshold = PRIORITY_THRESHOLD_DAYS[c.priorita] ?? 5;
      if (age >= threshold) {
        const severity: Notifica["severity"] =
          c.priorita === "urgente"
            ? "urgent"
            : c.priorita === "alta"
            ? "warning"
            : "info";
        out.push({
          id: `aging-${c.id}-${new Date(c.updatedAt).getTime()}`,
          commessaId: c.id,
          commessaCodice: c.codice,
          cliente: c.cliente,
          stato: c.stato,
          statoLabel: STATO_LABEL[c.stato] ?? c.stato,
          priorita: c.priorita,
          type: "priority_aging",
          message: `Commessa ferma da ${age} giorni (priorità ${c.priorita}, soglia ${threshold}gg)`,
          severity,
          link: `/commesse/${c.id}`,
          createdAt: new Date(c.updatedAt),
        });
      }
    }

    // 2. Daily reminder on bottleneck stati (owner). Date in the id → read
    // silences for today, refires tomorrow. Severity escalates with age.
    if (isOwner && STATO_DAILY_REMINDER.has(c.stato) && age >= 1) {
      const severity: Notifica["severity"] =
        age >= 5 ? "urgent" : age >= 3 ? "warning" : "info";
      out.push({
        id: `daily-${c.id}-${c.stato}-${todayStr}`,
        commessaId: c.id,
        commessaCodice: c.codice,
        cliente: c.cliente,
        stato: c.stato,
        statoLabel: STATO_LABEL[c.stato] ?? c.stato,
        priorita: c.priorita,
        type: "stato_daily",
        message: `Promemoria giornaliero: commessa in "${STATO_LABEL[c.stato] ?? c.stato}" da ${age} giorn${age === 1 ? "o" : "i"}`,
        severity,
        link: `/commesse/${c.id}`,
        createdAt: new Date(c.updatedAt),
      });
    }

    // 3. Stato + role routing. Id is (commessa, stato): read once → silent
    // until the commessa enters a different routed stato.
    const targetRole = STATO_ROLE_ROUTING[c.stato];
    if (targetRole && ruoli.includes(targetRole)) {
      out.push({
        id: `stato-${c.id}-${c.stato}`,
        commessaId: c.id,
        commessaCodice: c.codice,
        cliente: c.cliente,
        stato: c.stato,
        statoLabel: STATO_LABEL[c.stato] ?? c.stato,
        priorita: c.priorita,
        type: "stato_role",
        message: `Commessa in stato "${STATO_LABEL[c.stato] ?? c.stato}" richiede la tua attenzione`,
        severity: "info",
        link: `/commesse/${c.id}`,
        createdAt: new Date(c.updatedAt),
      });
    }

    // 4. Consegna da confermare (owner + direzione): in produzione without a
    // confirmed date nothing downstream can be scheduled.
    if (
      c.stato === "produzione" &&
      !c.dataConsegnaConfermata &&
      (isOwner || isDirezione)
    ) {
      out.push({
        id: `consegna-${c.id}`,
        commessaId: c.id,
        commessaCodice: c.codice,
        cliente: c.cliente,
        stato: c.stato,
        statoLabel: STATO_LABEL[c.stato] ?? c.stato,
        priorita: c.priorita,
        type: "consegna",
        message: "Commessa in produzione senza data di consegna confermata",
        severity: "warning",
        link: `/commesse/${c.id}`,
        createdAt: new Date(c.updatedAt),
      });
    }
  }

  // 4b. Saldo residuo nelle fasi finali (owner + direzione + amministrazione):
  // soldi lasciati indietro sono la perdita più silenziosa.
  const FASI_SALDO = new Set(["attesa_posa", "finiture_saldo", "interventi_regolazioni"]);
  for (const c of commesse) {
    if (!inSede(c)) continue;
    if ((c as any).archivedAt || c.stato === "archiviata") continue;
    if (!FASI_SALDO.has(c.stato)) continue;
    const tot = (c as any).importoTotale;
    const residuo = (tot ?? 0) - ((c as any).importoIncassato ?? 0);
    if (!tot || residuo <= 0) continue;
    if (!(isOwnerOf(c) || isDirezione || ruoli.includes("amministrazione"))) continue;
    out.push({
      id: `saldo-${c.id}-${residuo}`,
      commessaId: c.id,
      commessaCodice: c.codice,
      cliente: c.cliente,
      stato: c.stato,
      statoLabel: STATO_LABEL[c.stato] ?? c.stato,
      priorita: c.priorita,
      type: "consegna",
      message: `Saldo residuo €${residuo.toLocaleString("it-IT")} su €${(tot as number).toLocaleString("it-IT")}`,
      severity: "warning",
      link: `/commesse/${c.id}`,
      createdAt: new Date(c.updatedAt),
    });
  }

  // 5. Garanzie (amministrazione + direzione): scadute → urgent, in scadenza
  // entro 30 giorni → warning.
  if (isDirezione || ruoli.includes("amministrazione")) {
    const soon = toDateStr(new Date(now.getTime() + 30 * 86400000));
    for (const g of garanzie) {
      if (!inSede(g)) continue;
      if (g.stato !== "attiva") continue;
      const cm = g.commessaId ? commessaById.get(g.commessaId) : null;
      if (cm?.archivedAt) continue;
      const scaduta = g.dataScadenza < todayStr;
      const inScadenza = !scaduta && g.dataScadenza <= soon;
      if (!scaduta && !inScadenza) continue;
      out.push({
        id: `gar-${g.id}-${scaduta ? "scaduta" : "scadenza"}`,
        commessaId: g.commessaId ?? null,
        commessaCodice: cm?.codice ?? "",
        cliente: cm?.cliente ?? g.descrizione ?? "Garanzia",
        stato: "garanzia",
        statoLabel: "Garanzia",
        priorita: scaduta ? "urgente" : "alta",
        type: "garanzia",
        message: scaduta
          ? `Garanzia "${g.descrizione}" scaduta il ${new Date(g.dataScadenza + "T12:00:00").toLocaleDateString("it-IT")}`
          : `Garanzia "${g.descrizione}" in scadenza il ${new Date(g.dataScadenza + "T12:00:00").toLocaleDateString("it-IT")}`,
        severity: scaduta ? "urgent" : "warning",
        link: "/garanzie",
        createdAt: new Date(g.dataScadenza + "T00:00:00"),
      });
    }
  }

  // 6. Ticket aperti sulle commesse di cui sono owner (direzione li vede
  // tutti). Id ruota con lo stato: riaprire un ticket ri-notifica.
  for (const t of tickets) {
    if (!inSede(t)) continue;
    if (t.stato !== "aperto" && t.stato !== "assegnato") continue;
    const cm = t.commessaId ? commessaById.get(t.commessaId) : null;
    if (cm?.archivedAt) continue;
    if (cm) {
      if (!isOwnerOf(cm) && !isDirezione) continue;
    } else {
      // Ticket senza commessa (chiamata arrivata prima che la commessa
      // esista): niente owner da cui dedurre i destinatari, quindi lo vedono
      // la direzione e chi lo ha aperto. Prima venivano scartati e nessuno
      // riceveva la notifica.
      if (!isDirezione && t.apertoBy !== userId) continue;
    }
    const severity: Notifica["severity"] =
      t.priorita === "urgente"
        ? "urgent"
        : t.priorita === "alta"
        ? "warning"
        : "info";
    out.push({
      id: `ticket-${t.id}-${t.stato}`,
      commessaId: cm?.id ?? null,
      commessaCodice: cm?.codice ?? null,
      cliente:
        cm?.cliente ??
        (t.clienteId ? clienteLabel(t.clienteId) : null) ??
        t.contatto ??
        "Senza commessa",
      stato: t.stato,
      statoLabel: `Ticket ${t.stato}`,
      priorita: t.priorita ?? "media",
      type: "ticket",
      message: `Ticket #${t.id} "${t.oggetto}" ${t.stato === "aperto" ? "aperto" : "assegnato"} (priorità ${t.priorita ?? "media"})`,
      severity,
      link: "/ticket",
      createdAt: new Date(t.updatedAt ?? t.createdAt),
    });
  }

  // 7. Interventi di oggi/domani ancora senza squadra: chi li ha pianificati
  // deve assegnarli. Owner della commessa collegata; direzione raccoglie
  // anche quelli non collegati.
  for (const i of interventi) {
    if (!inSede(i)) continue;
    if (i.stato !== "pianificato") continue;
    if (i.squadraId) continue;
    if (i.dataPianificata !== todayStr && i.dataPianificata !== tomorrowStr)
      continue;
    const cm = i.commessaId ? commessaById.get(i.commessaId) : null;
    if (cm?.archivedAt) continue;
    const mine = cm ? isOwnerOf(cm) || isDirezione : isDirezione;
    if (!mine) continue;
    const isToday = i.dataPianificata === todayStr;
    const tipoLabel = TIPO_INTERVENTO_LABEL[i.tipo] ?? "Intervento";
    out.push({
      id: `int-${i.id}-${i.dataPianificata}`,
      commessaId: cm?.id ?? null,
      commessaCodice: cm?.codice ?? "",
      cliente: cm?.cliente ?? i.indirizzo ?? tipoLabel,
      stato: "pianificato",
      statoLabel: tipoLabel,
      priorita: isToday ? "alta" : "media",
      type: "intervento",
      message: `${tipoLabel} di ${isToday ? "oggi" : "domani"}${i.oraInizio ? ` alle ${i.oraInizio}` : ""} senza squadra assegnata`,
      severity: isToday ? "warning" : "info",
      link: "/planning",
      createdAt: new Date(i.updatedAt ?? i.createdAt),
    });
  }

  return out;
}

function sortNotifiche(items: Array<Notifica & { read: boolean }>) {
  return items.sort((a, b) => {
    if (a.read !== b.read) return a.read ? 1 : -1;
    const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sr !== 0) return sr;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

function ruoliOf(user: any): string[] {
  return Array.isArray(user?.ruoli)
    ? user.ruoli
    : user?.ruolo
    ? [user.ruolo]
    : [];
}

export const notificheRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    if (!ctx.user) return [];
    const userId = ctx.user.id as number;
    const all = buildNotifichePerUtente(userId, ruoliOf(ctx.user), ctx.sedeId);
    const readSet = readSetFor(userId);
    return sortNotifiche(
      all.map((n) => ({ ...n, read: readSet.has(n.id) }))
    ).slice(0, 100);
  }),

  // Unread only — drives the bell badge.
  count: protectedProcedure.query(({ ctx }) => {
    if (!ctx.user) return 0;
    const userId = ctx.user.id as number;
    const all = buildNotifichePerUtente(userId, ruoliOf(ctx.user), ctx.sedeId);
    const readSet = readSetFor(userId);
    return all.filter((n) => !readSet.has(n.id)).length;
  }),

  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(200) }))
    .mutation(({ input, ctx }) => {
      markIdsRead(ctx.user.id as number, input.ids);
      return { success: true } as const;
    }),

  markAllRead: protectedProcedure.mutation(({ ctx }) => {
    const userId = ctx.user.id as number;
    const all = buildNotifichePerUtente(userId, ruoliOf(ctx.user), ctx.sedeId);
    markIdsRead(
      userId,
      all.map((n) => n.id)
    );
    return { success: true, count: all.length } as const;
  }),
});
