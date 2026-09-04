// T5 — Follow-up commerciale sui preventivi (D3, 03/09/2026).
//
// Deterministico, niente modello: a 7 giorni di silenzio un promemoria di
// sollecito all'assegnatario con la bozza del messaggio; a 30 un caso del
// Centro Azioni propone di chiuderlo come perso. L'età è l'attività REALE
// (documenti, transizioni, timeline, comunicazioni), mai `updatedAt`; le
// dormienti (oltre giorniDormiente) restano fuori: non sono lavoro.
//
// Due binari esistenti, nessuno nuovo:
// - promemoria: reminders.createApproved, dedupe per canonicalKey
//   (`tars:sollecito-preventivo:<id>:<giorno ultima attività>` — un nuovo
//   giro di silenzio dopo nuova attività riapre il diritto al sollecito);
// - casi: ActionSignal fusi nello scheduler del Centro Azioni accanto a
//   segnaliSmistamento. MAI un reconcile separato: auto-risolverebbe i
//   casi degli altri detector.

import type { ActionSignal } from "../../actionCenter/types";
import { ultimaAttivitaCommessa } from "../../commesse/attivita";
import { ultimaComunicazionePerCommessa } from "../../comunicazioni/comunicazioni";
import { tarsAttivo } from "../../platform/interruttori";
import { getCommesseStore } from "../../routers/commesse";
import { getReminderService } from "../../reminders/service";
import { giorniDormiente } from "../analisi/fotografia";

export const GIORNI_SOLLECITO = 7;
export const GIORNI_PERSO = 30;

export type PreventivoFermo = {
  commessa: any;
  giorni: number;
  ultimaAttivita: Date;
};

export type DipendenzeFollowup = {
  commesse: () => any[];
  ultimeComunicazioni: (sedeId: number) => Promise<Map<number, Date>>;
  attivita: (
    commessa: { id: number; createdAt?: Date | string | null },
    ultimaComunicazione: Date | undefined,
    adesso: Date
  ) => { giorni: number; ultimaAttivita: Date };
  promemoria: Pick<ReturnType<typeof getReminderService>, "createApproved">;
};

export function dipendenzeFollowupReali(): DipendenzeFollowup {
  return {
    commesse: () => getCommesseStore() as any[],
    ultimeComunicazioni: sedeId => ultimaComunicazionePerCommessa(sedeId),
    attivita: (commessa, ultimaComunicazione, adesso) => {
      const a = ultimaAttivitaCommessa(commessa, ultimaComunicazione ?? null, adesso);
      return { giorni: a.giorni, ultimaAttivita: a.ultimaAttivita };
    },
    promemoria: getReminderService(),
  };
}

/** I preventivi della sede fermi da almeno GIORNI_SOLLECITO, dormienti esclusi. */
export async function preventiviFermiDiSede(
  sedeId: number,
  adesso: Date,
  deps: DipendenzeFollowup
): Promise<PreventivoFermo[]> {
  const commesse = deps
    .commesse()
    .filter(
      (c: any) =>
        c.sedeId === sedeId &&
        c.stato === "preventivo" &&
        !c.archivedAt
    );
  if (commesse.length === 0) return [];
  const ultime = await deps.ultimeComunicazioni(sedeId);
  return commesse
    .map((c: any) => {
      const a = deps.attivita(c, ultime.get(c.id), adesso);
      return { commessa: c, giorni: a.giorni, ultimaAttivita: a.ultimaAttivita };
    })
    .filter(x => x.giorni >= GIORNI_SOLLECITO && x.giorni <= giorniDormiente())
    .sort((a, b) => b.giorni - a.giorni);
}

/** La bozza del messaggio al cliente: deterministica, senza importi. */
export function bozzaSollecito(commessa: any): string {
  const cliente = String(commessa.cliente ?? "").trim() || "cliente";
  return `Buongiorno ${cliente}, vi scriviamo per il preventivo ${commessa.codice ?? ""}: possiamo esservi utili con un chiarimento o un sopralluogo? Restiamo a disposizione.`.replace(/\s+/g, " ");
}

function giornoIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * Promemoria di sollecito (7–29 giorni) all'assegnatario della commessa.
 * Il destinatario di default per le commesse senza assegnatario arriva con
 * T6/D4: qui, senza assegnatario, nessun promemoria personale (il caso dei
 * 30 giorni copre comunque).
 */
export async function giroSollecitiPreventivi(input: {
  sedeId: number;
  adesso: Date;
  deps?: DipendenzeFollowup;
}): Promise<{ creati: number; saltati: number; errori: number }> {
  const deps = input.deps ?? dipendenzeFollowupReali();
  const fermi = await preventiviFermiDiSede(input.sedeId, input.adesso, deps);
  let creati = 0;
  let saltati = 0;
  let errori = 0;
  for (const { commessa, giorni, ultimaAttivita } of fermi) {
    if (giorni >= GIORNI_PERSO) continue; // dai 30 in poi parla il caso «perso»
    const assegnatario = commessa.assegnatoA ?? null;
    if (assegnatario == null) {
      saltati += 1;
      continue;
    }
    // Un promemoria che non si crea non ferma gli altri: prima del 04/09 il
    // primo errore (42P18 sul promemoria già esistente) interrompeva il giro
    // e i preventivi successivi non venivano mai sollecitati.
    try {
      const esito = await deps.promemoria.createApproved({
        sedeId: input.sedeId,
        requestedByUserId: assegnatario,
        sourceProposalId: null,
        actionKey: `tars:sollecito-preventivo:${commessa.id}:${giornoIso(ultimaAttivita)}`,
        text: `Sollecito preventivo ${commessa.codice ?? commessa.id} — ${commessa.cliente ?? "cliente"}: fermo da ${giorni} giorni. Bozza: «${bozzaSollecito(commessa)}»`,
        remindAtIso: new Date(input.adesso.getTime() + 120_000).toISOString(),
        clienteId: commessa.clienteId ?? null,
        commessaId: commessa.id,
      });
      if ((esito as any)?.created === false) saltati += 1;
      else creati += 1;
    } catch (errore) {
      errori += 1;
      console.error(
        `[tars-followup] sollecito ${commessa.codice ?? commessa.id} non creato:`,
        errore instanceof Error ? errore.message.slice(0, 200) : errore
      );
    }
  }
  return { creati, saltati, errori };
}

/**
 * I segnali del Centro Azioni per i preventivi fermi da 30+ giorni:
 * «proporlo come perso?». Fingerprint a scaglioni di 15 giorni: il caso
 * non «cambia» ogni notte.
 */
export async function segnaliFollowupPreventivi(
  sedeId: number,
  now: Date,
  deps?: DipendenzeFollowup
): Promise<ActionSignal[]> {
  if (!deps && !tarsAttivo("tarsProactive")) return [];
  const reali = deps ?? dipendenzeFollowupReali();
  const fermi = await preventiviFermiDiSede(sedeId, now, reali);
  return fermi
    .filter(x => x.giorni >= GIORNI_PERSO)
    .map(({ commessa, giorni, ultimaAttivita }) => ({
      sourceKey: `followup:preventivo:${commessa.id}`,
      kind: "preventivo_followup" as const,
      sedeId,
      targetType: "commessa" as const,
      targetId: commessa.id,
      commessaId: commessa.id,
      clienteId: commessa.clienteId ?? null,
      title: `Preventivo fermo da ${giorni} giorni: proporlo come perso? — ${commessa.codice ?? commessa.id} ${commessa.cliente ?? ""}`.trim(),
      summary: `Nessun fatto nuovo (documenti, comunicazioni, timeline) da ${giorni} giorni. D3: a 30 giorni si propone la chiusura come perso, oppure un ultimo rilancio.`,
      actionLabel: "Chiudi come perso (archivia) o rilancia il cliente",
      priority: giorni >= 45 ? ("alta" as const) : ("normale" as const),
      priorityScore: Math.min(85, 40 + giorni),
      assigneeUserId: commessa.assegnatoA ?? null,
      targetRole: commessa.assegnatoA == null ? "direzione" : null,
      dueAt: null,
      occurredAt: ultimaAttivita,
      link: `/commesse/${commessa.id}`,
      fingerprint: `perso:${Math.floor(giorni / 15) * 15}`,
    }));
}
