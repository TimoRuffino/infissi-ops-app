import type {
  ActionCaseDraft,
  ActionPriority,
  ActionSignal,
  ActionSignalInput,
} from "./types";

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

const STATO_DAILY_REMINDER = new Set([
  "aggiornamento_contratto",
  "fatture_pagamento",
  "da_ordinare",
]);

const ACTION_LABEL_BY_STATE: Record<string, string> = {
  aggiornamento_contratto: "Completa l'aggiornamento del contratto",
  fatture_pagamento: "Completa la verifica di fatture e pagamento",
  da_ordinare: "Completa l'ordine della commessa",
};

const FINAL_BALANCE_STATES = new Set([
  "attesa_posa",
  "finiture_saldo",
  "interventi_regolazioni",
]);

const INTERVENTION_LABEL: Record<string, string> = {
  rilievo: "Rilievo",
  posa: "Posa",
  assistenza: "Assistenza",
  altro: "Intervento",
};

const PRIORITY_RANK: Record<ActionPriority, number> = {
  normale: 0,
  alta: 1,
  critica: 2,
};

function daysBetween(now: Date, value: Date): number {
  return Math.floor(Math.max(0, now.getTime() - value.getTime()) / 86_400_000);
}

function ownerOf(commessa: ActionSignalInput["commesse"][number]): number | null {
  return commessa.assegnatoA ?? commessa.createdBy ?? null;
}

function fingerprint(parts: Array<string | number | null>): string {
  return parts.map(part => String(part ?? "-")).join("|");
}

function toDateString(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAtNoon(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function commessaBase(
  commessa: ActionSignalInput["commesse"][number]
) {
  return {
    sedeId: commessa.sedeId,
    targetType: "commessa" as const,
    targetId: commessa.id,
    commessaId: commessa.id,
    clienteId: commessa.clienteId,
    title: `${commessa.codice} - ${commessa.cliente}`,
    assigneeUserId: ownerOf(commessa),
    link: `/commesse/${commessa.id}`,
  };
}

export function collectActionSignals(input: ActionSignalInput): ActionSignal[] {
  const signals: ActionSignal[] = [];
  const commessaById = new Map(
    input.commesse.map(commessa => [commessa.id, commessa] as const)
  );

  for (const commessa of input.commesse) {
    if (commessa.sedeId !== input.sedeId) continue;
    if (commessa.stato === "archiviata" || commessa.archivedAt) continue;

    const age = daysBetween(input.now, new Date(commessa.updatedAt));
    const assigneeUserId = ownerOf(commessa);
    const base = {
      ...commessaBase(commessa),
      occurredAt: new Date(commessa.updatedAt),
    };

    const threshold = PRIORITY_THRESHOLD_DAYS[commessa.priorita] ?? 5;
    if (age >= threshold) {
      const priority: ActionPriority =
        commessa.priorita === "urgente"
          ? "critica"
          : commessa.priorita === "alta"
            ? "alta"
            : "normale";
      signals.push({
        ...base,
        sourceKey: `aging:${commessa.id}`,
        kind: "priority_aging",
        summary: `Commessa ferma da ${age} giorni`,
        actionLabel: "Verifica il prossimo passo della commessa",
        priority,
        priorityScore: priority === "critica" ? 95 : priority === "alta" ? 75 : 45,
        targetRole: null,
        dueAt: priority === "normale" ? null : input.now,
        fingerprint: fingerprint([
          "aging",
          commessa.id,
          commessa.stato,
          commessa.priorita,
          new Date(commessa.updatedAt).getTime(),
        ]),
      });
    }

    if (STATO_DAILY_REMINDER.has(commessa.stato) && age >= 1) {
      const priority: ActionPriority =
        age >= 5 ? "critica" : age >= 3 ? "alta" : "normale";
      signals.push({
        ...base,
        sourceKey: `bottleneck:${commessa.id}:${commessa.stato}`,
        kind: "stato_daily",
        summary: `Commessa in ${commessa.stato} da ${age} giorni`,
        actionLabel:
          ACTION_LABEL_BY_STATE[commessa.stato] ??
          "Completa il passaggio operativo della commessa",
        priority,
        priorityScore: priority === "critica" ? 100 : priority === "alta" ? 80 : 55,
        targetRole: STATO_ROLE_ROUTING[commessa.stato] ?? null,
        dueAt: input.now,
        fingerprint: fingerprint([
          "bottleneck",
          commessa.id,
          commessa.stato,
          new Date(commessa.updatedAt).getTime(),
        ]),
      });
    }

    const targetRole = STATO_ROLE_ROUTING[commessa.stato];
    if (targetRole) {
      signals.push({
        ...base,
        sourceKey: `state-role:${commessa.id}:${commessa.stato}`,
        kind: "stato_role",
        summary: `Lo stato ${commessa.stato} richiede il ruolo ${targetRole}`,
        actionLabel:
          ACTION_LABEL_BY_STATE[commessa.stato] ??
          "Prendi in carico il passaggio di stato",
        priority: "normale",
        priorityScore: 40,
        targetRole,
        dueAt: null,
        fingerprint: fingerprint(["state-role", commessa.id, commessa.stato]),
      });
    }

    if (commessa.stato === "produzione" && !commessa.dataConsegnaConfermata) {
      signals.push({
        ...base,
        sourceKey: `delivery:${commessa.id}`,
        kind: "consegna",
        summary: "Produzione senza data di consegna confermata",
        actionLabel: "Conferma la data di consegna",
        priority: "alta",
        priorityScore: 74,
        targetRole: null,
        dueAt: input.now,
        fingerprint: fingerprint(["delivery", commessa.id, commessa.stato, "missing"]),
      });
    }

    const total = commessa.importoTotale ?? 0;
    const residual = total - commessa.importoIncassato;
    if (FINAL_BALANCE_STATES.has(commessa.stato) && total > 0 && residual > 0) {
      // Il caso è condiviso e può raggiungere utenti senza `pagamento.read`:
      // niente cifre nel testo, e il fingerprint usa la versione del registro
      // (conteggio+timestamp) invece del residuo — un incasso parziale
      // risveglia comunque il caso, ma dall'oggetto serializzato non si
      // ricostruisce alcun importo (slice 2).
      signals.push({
        ...base,
        sourceKey: `balance:${commessa.id}`,
        kind: "saldo",
        summary: "La commessa ha un saldo residuo da incassare",
        actionLabel: "Verifica e incassa il saldo residuo",
        priority: "alta",
        priorityScore: 78,
        targetRole: "amministrazione",
        dueAt: input.now,
        fingerprint: fingerprint([
          "balance",
          commessa.id,
          commessa.stato,
          commessa.registroVersione ?? "-",
        ]),
      });
    }
  }

  for (const ticket of input.tickets) {
    if (ticket.sedeId !== input.sedeId) continue;
    if (ticket.stato !== "aperto" && ticket.stato !== "assegnato") continue;
    const commessa = ticket.commessaId == null
      ? null
      : commessaById.get(ticket.commessaId) ?? null;
    if (commessa?.stato === "archiviata" || commessa?.archivedAt) continue;
    const priority: ActionPriority =
      ticket.priorita === "urgente"
        ? "critica"
        : ticket.priorita === "alta"
          ? "alta"
          : "normale";
    const label = ticket.contatto?.trim() || "Senza commessa";
    signals.push({
      sourceKey: `ticket:${ticket.id}`,
      kind: "ticket",
      sedeId: ticket.sedeId,
      targetType: "ticket",
      targetId: ticket.id,
      commessaId: commessa?.id ?? null,
      clienteId: commessa?.clienteId ?? ticket.clienteId,
      title: commessa
        ? `${commessa.codice} - ${commessa.cliente}`
        : `Ticket #${ticket.id} - ${label}`,
      summary: `Ticket #${ticket.id}: ${ticket.oggetto}`,
      actionLabel:
        priority === "critica" ? "Gestisci il ticket urgente" : "Gestisci il ticket aperto",
      priority,
      priorityScore: priority === "critica" ? 110 : priority === "alta" ? 85 : 50,
      assigneeUserId: ticket.assegnatoA ?? (commessa ? ownerOf(commessa) : ticket.apertoBy),
      targetRole: null,
      dueAt: priority === "normale" ? null : input.now,
      occurredAt: new Date(ticket.updatedAt),
      link: "/ticket",
      fingerprint: fingerprint([
        "ticket",
        ticket.id,
        ticket.stato,
        ticket.priorita,
        ticket.assegnatoA,
        ticket.commessaId,
      ]),
    });
  }

  const today = toDateString(input.now);
  const inThirtyDays = toDateString(new Date(input.now.getTime() + 30 * 86_400_000));
  for (const warranty of input.garanzie) {
    if (warranty.sedeId !== input.sedeId || warranty.stato !== "attiva") continue;
    const commessa = warranty.commessaId == null
      ? null
      : commessaById.get(warranty.commessaId) ?? null;
    if (commessa?.stato === "archiviata" || commessa?.archivedAt) continue;
    const expired = warranty.dataScadenza < today;
    const expiring = !expired && warranty.dataScadenza <= inThirtyDays;
    if (!expired && !expiring) continue;
    signals.push({
      sourceKey: `warranty:${warranty.id}`,
      kind: "garanzia",
      sedeId: warranty.sedeId,
      targetType: "garanzia",
      targetId: warranty.id,
      commessaId: commessa?.id ?? null,
      clienteId: commessa?.clienteId ?? null,
      title: commessa
        ? `${commessa.codice} - ${commessa.cliente}`
        : `Garanzia - ${warranty.descrizione}`,
      summary: expired
        ? `Garanzia scaduta il ${warranty.dataScadenza}`
        : `Garanzia in scadenza il ${warranty.dataScadenza}`,
      actionLabel: expired ? "Gestisci la garanzia scaduta" : "Verifica la garanzia in scadenza",
      priority: expired ? "critica" : "alta",
      priorityScore: expired ? 92 : 70,
      assigneeUserId: commessa ? ownerOf(commessa) : null,
      targetRole: "amministrazione",
      dueAt: dateAtNoon(warranty.dataScadenza),
      occurredAt: dateAtNoon(warranty.dataScadenza),
      link: "/garanzie",
      fingerprint: fingerprint([
        "warranty",
        warranty.id,
        warranty.stato,
        warranty.dataScadenza,
        warranty.commessaId,
      ]),
    });
  }

  const tomorrow = toDateString(new Date(input.now.getTime() + 86_400_000));
  for (const intervention of input.interventi) {
    if (intervention.sedeId !== input.sedeId) continue;
    if (intervention.stato !== "pianificato" || intervention.squadraId != null) continue;
    if (intervention.dataPianificata !== today && intervention.dataPianificata !== tomorrow) continue;
    const commessa = intervention.commessaId == null
      ? null
      : commessaById.get(intervention.commessaId) ?? null;
    if (commessa?.stato === "archiviata" || commessa?.archivedAt) continue;
    const isToday = intervention.dataPianificata === today;
    const typeLabel = INTERVENTION_LABEL[intervention.tipo] ?? "Intervento";
    signals.push({
      sourceKey: `intervention:${intervention.id}`,
      kind: "intervento",
      sedeId: intervention.sedeId,
      targetType: "intervento",
      targetId: intervention.id,
      commessaId: commessa?.id ?? null,
      clienteId: commessa?.clienteId ?? null,
      title: commessa
        ? `${commessa.codice} - ${commessa.cliente}`
        : `${typeLabel} - ${intervention.indirizzo || "Senza commessa"}`,
      summary: `${typeLabel} ${isToday ? "di oggi" : "di domani"} senza squadra`,
      actionLabel: "Assegna una squadra all'intervento",
      priority: isToday ? "critica" : "alta",
      priorityScore: isToday ? 96 : 72,
      assigneeUserId: commessa ? ownerOf(commessa) : null,
      targetRole: "cantiere",
      dueAt: intervention.dataPianificata
        ? dateAtNoon(intervention.dataPianificata)
        : input.now,
      occurredAt: new Date(intervention.updatedAt),
      link: "/planning",
      fingerprint: fingerprint([
        "intervention",
        intervention.id,
        intervention.stato,
        intervention.dataPianificata,
        intervention.squadraId,
        intervention.commessaId,
      ]),
    });
  }

  // Conflitto consegna fornitore ↔ posa pianificata (D7 slice 3): quando
  // una proposta documentale APPLICATA ha spostato la consegna prevista di
  // un ordine oltre una posa pianificata della stessa commessa, il caso
  // chiede di rivedere la pianificazione — NON la esegue. Solo date e
  // riferimenti nel testo; il segnale si spegne da solo quando la posa
  // viene ripianificata o la consegna cambia di nuovo (auto_risolta).
  const ordiniFornitoreById = new Map(
    (input.ordiniFornitore ?? []).map(ordine => [ordine.id, ordine] as const)
  );
  const inSevenDays = toDateString(new Date(input.now.getTime() + 7 * 86_400_000));
  const ordiniSegnalati = new Set<number>();
  const applicateRecentiPrima = [...(input.proposteApplicate ?? [])].sort(
    (a, b) => b.applicataAt.getTime() - a.applicataAt.getTime()
  );
  for (const proposta of applicateRecentiPrima) {
    if (proposta.sedeId !== input.sedeId) continue;
    if (ordiniSegnalati.has(proposta.ordineId)) continue;
    const ordine = ordiniFornitoreById.get(proposta.ordineId);
    if (!ordine || ordine.sedeId !== input.sedeId) continue;
    // Il conflitto esiste solo se la data applicata è ancora quella
    // corrente dell'ordine e la merce non è già arrivata.
    if (ordine.dataConsegnaPrevista !== proposta.valoreApplicato) continue;
    if (ordine.stato === "ricevuto") continue;
    const commessa = ordine.commessaId == null
      ? null
      : commessaById.get(ordine.commessaId) ?? null;
    if (!commessa || commessa.stato === "archiviata" || commessa.archivedAt) continue;
    const posa =
      ordine.commessaId == null
        ? null
        : primaPosaInConflitto(
            input.interventi,
            input.sedeId,
            ordine.commessaId,
            proposta.valoreApplicato
          );
    if (!posa) continue;
    ordiniSegnalati.add(proposta.ordineId);
    const imminente = posa.dataPianificata <= inSevenDays;
    signals.push({
      ...commessaBase(commessa),
      occurredAt: proposta.applicataAt,
      sourceKey: `supplier-delivery:${ordine.id}`,
      kind: "consegna_fornitore",
      summary: `La consegna confermata dell'ordine ${ordine.codiceOrdine} (${proposta.valoreApplicato}) arriva dopo la posa pianificata del ${posa.dataPianificata} — conferma: ${proposta.documentoNome}`,
      actionLabel: "Rivedi la pianificazione della posa",
      priority: imminente ? "critica" : "alta",
      priorityScore: imminente ? 97 : 88,
      targetRole: null,
      dueAt: dateAtNoon(posa.dataPianificata),
      fingerprint: fingerprint([
        "supplier-delivery",
        ordine.id,
        proposta.valoreApplicato,
        posa.id,
        posa.dataPianificata,
        proposta.id,
      ]),
    });
  }

  return signals;
}

/**
 * La prima posa pianificata della commessa che cade PRIMA della consegna:
 * l'unico predicato del conflitto consegna/posa, condiviso fra il segnale
 * del Centro Azioni e l'avviso post-applicazione delle proposte
 * (revisione: due copie erano già divergenti).
 */
export function primaPosaInConflitto(
  interventi: ReadonlyArray<{
    id: number;
    sedeId: number;
    commessaId: number | null;
    tipo: string;
    stato: string;
    dataPianificata: string | null;
  }>,
  sedeId: number,
  commessaId: number,
  dataConsegna: string
): { id: number; dataPianificata: string } | null {
  const posa = interventi
    .filter(
      intervento =>
        intervento.sedeId === sedeId &&
        intervento.commessaId === commessaId &&
        intervento.tipo === "posa" &&
        intervento.stato === "pianificato" &&
        intervento.dataPianificata != null &&
        intervento.dataPianificata < dataConsegna
    )
    .sort((a, b) =>
      (a.dataPianificata ?? "").localeCompare(b.dataPianificata ?? "")
    )[0];
  return posa?.dataPianificata
    ? { id: posa.id, dataPianificata: posa.dataPianificata }
    : null;
}

function canonicalKeyFor(signal: ActionSignal): string {
  return signal.commessaId != null
    ? `commessa:${signal.commessaId}`
    : `${signal.targetType}:${signal.targetId}`;
}

export function groupSignals(
  signals: ActionSignal[],
  _now: Date
): ActionCaseDraft[] {
  const groups = new Map<string, ActionSignal[]>();
  for (const signal of signals) {
    const key = canonicalKeyFor(signal);
    const current = groups.get(key) ?? [];
    current.push(signal);
    groups.set(key, current);
  }

  return Array.from(groups.entries())
    .map(([canonicalKey, grouped]) => {
      const ordered = [...grouped].sort((a, b) => {
        const priority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        if (priority !== 0) return priority;
        const score = b.priorityScore - a.priorityScore;
        if (score !== 0) return score;
        return a.sourceKey.localeCompare(b.sourceKey);
      });
      const primary = ordered[0];
      const fingerprints = [...grouped]
        .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
        .map(signal => `${signal.sourceKey}:${signal.fingerprint}`)
        .join("||");

      return {
        canonicalKey,
        sedeId: primary.sedeId,
        targetType: primary.targetType,
        targetId: primary.targetId,
        commessaId: primary.commessaId,
        clienteId: primary.clienteId,
        title: primary.title,
        priority: primary.priority,
        priorityScore: primary.priorityScore,
        assigneeUserId:
          primary.assigneeUserId ??
          grouped.find(signal => signal.assigneeUserId != null)?.assigneeUserId ??
          null,
        dueAt: primary.dueAt,
        link: primary.link,
        signals: [...grouped].sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
        signalFingerprint: fingerprints,
        nextAction: {
          sourceKind: primary.kind,
          label: primary.actionLabel,
        },
      };
    })
    .sort((a, b) => {
      const priority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      if (priority !== 0) return priority;
      const score = b.priorityScore - a.priorityScore;
      if (score !== 0) return score;
      return a.canonicalKey.localeCompare(b.canonicalKey);
    });
}
