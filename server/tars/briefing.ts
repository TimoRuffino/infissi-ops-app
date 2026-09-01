// Briefing e situazioni (T4) — spec §22, decisioni 21-24.
//
// Derivazione DETERMINISTICA a richiesta: zero token, zero scritture di
// dominio, il modello non partecipa. La proattività qui è SHADOW: i due
// rilevatori (ordine in ritardo, conflitto consegna prevista/data
// confermata) non creano casi né notifiche; si limitano ad AGGANCIARE le
// segnalazioni ai casi aperti del Centro Azioni per commessa (solo un
// booleano: mai contenuti di casi altrui) e a registrare la telemetria
// del rumore come run `proattivita-shadow`.

import { getActionCaseRepository } from "../actionCenter/repository";
import { OPEN_ACTION_STATUSES, listActionCases } from "../actionCenter/service";
import { tarsAttivo } from "../platform/interruttori";
import { getCommessaById } from "../routers/commesse";
import { getOrdiniFornitoreDiSede } from "../routers/fornitori";
import { getReminderService } from "../reminders/service";
import { registraRun } from "./archivio";
import { formattaIstanteLocale, istanteComeLocale } from "./tempo";
import type { ContestoRun } from "./strumenti/tipi";
import { TZDate } from "@date-fns/tz";

export type SegnalazioneTars = {
  tipo: "ordine_in_ritardo" | "conflitto_consegna";
  titolo: string;
  dettaglio: string;
  commessaId: number | null;
  ordineId: number;
  link: string;
  /** true = c'è già un caso APERTO del Centro Azioni sulla commessa. */
  agganciataACasoAperto: boolean;
};

export type BriefingTars = {
  generatoIl: string;
  promemoriaOggi: Array<{
    id: number;
    testo: string;
    remindAtLocale: string;
    commessaId: number | null;
  }>;
  casiMiei: Array<{
    id: number;
    titolo: string;
    priorita: string;
    prossimaAzione: string;
    link: string;
  }>;
  /** null = FLAG_TARS_PROACTIVE spento: la sezione non esiste. */
  segnalazioni: SegnalazioneTars[] | null;
};

function fineGiornata(adesso: Date): Date {
  const locale = new TZDate(adesso, "Europe/Rome");
  return new Date(
    new TZDate(
      locale.getFullYear(),
      locale.getMonth(),
      locale.getDate() + 1,
      0,
      0,
      0,
      0,
      "Europe/Rome"
    ).getTime()
  );
}

const STATI_CASO_APERTO = OPEN_ACTION_STATUSES;

async function commesseConCasiAperti(sedeId: number): Promise<Set<number>> {
  const { items } = await getActionCaseRepository().list({
    sedeId,
    statuses: [...STATI_CASO_APERTO],
    limit: 200,
  });
  return new Set(
    items
      .map(caso => caso.commessaId)
      .filter((id): id is number => id != null)
  );
}

function rilevaSegnalazioni(
  sedeId: number,
  seguite: Set<number>,
  adesso: Date
): SegnalazioneTars[] {
  // «Oggi» nel fuso del dominio (Europe/Rome), non in UTC.
  const oggi = istanteComeLocale(adesso).slice(0, 10);
  const segnalazioni: SegnalazioneTars[] = [];
  for (const { ordine, fornitoreNome } of getOrdiniFornitoreDiSede(sedeId)) {
    const chiusa = ordine.stato === "ricevuto";
    // Una commessa archiviata è lavoro concluso: nessuna segnalazione
    // proattiva sui suoi ordini (stesso filtro dei detector del Centro
    // Azioni; segnalazione della direzione, 01/09).
    const commessaCollegata: any = ordine.commessaId
      ? getCommessaById(ordine.commessaId)
      : null;
    if (
      commessaCollegata &&
      (commessaCollegata.stato === "archiviata" || commessaCollegata.archivedAt)
    ) {
      continue;
    }
    if (
      !chiusa &&
      ordine.dataConsegnaPrevista &&
      !ordine.dataConsegnaEffettiva &&
      ordine.dataConsegnaPrevista < oggi
    ) {
      segnalazioni.push({
        tipo: "ordine_in_ritardo",
        titolo: `Ordine ${ordine.codiceOrdine} in ritardo`,
        dettaglio: `Consegna prevista ${ordine.dataConsegnaPrevista} (${fornitoreNome ?? "fornitore ?"}) superata senza consegna effettiva.`,
        commessaId: ordine.commessaId ?? null,
        ordineId: ordine.id,
        link: ordine.commessaId ? `/commesse/${ordine.commessaId}` : "/fornitori",
        agganciataACasoAperto:
          ordine.commessaId != null && seguite.has(ordine.commessaId),
      });
    }
    const commessa: any = commessaCollegata;
    if (
      !chiusa &&
      commessa &&
      commessa.sedeId === sedeId &&
      ordine.dataConsegnaPrevista &&
      commessa.dataConsegnaConfermata &&
      ordine.dataConsegnaPrevista > commessa.dataConsegnaConfermata
    ) {
      segnalazioni.push({
        tipo: "conflitto_consegna",
        titolo: `Consegna ${ordine.codiceOrdine} dopo la data confermata`,
        dettaglio: `Prevista ${ordine.dataConsegnaPrevista}, ma al cliente è confermato ${commessa.dataConsegnaConfermata} (${commessa.codice}).`,
        commessaId: commessa.id,
        ordineId: ordine.id,
        link: `/commesse/${commessa.id}`,
        agganciataACasoAperto: seguite.has(commessa.id),
      });
    }
  }
  return segnalazioni.sort(
    (a, b) => a.titolo.localeCompare(b.titolo) || a.ordineId - b.ordineId
  );
}

export async function costruisciBriefing(
  contesto: ContestoRun
): Promise<BriefingTars> {
  const adesso = new Date();

  const promemoria = await getReminderService().listPersonal(
    { sedeId: contesto.sedeId, recipientUserId: contesto.utenteId },
    {
      stati: ["scheduled", "due"],
      daRemindAt: new Date(0), // anche gli scaduti non gestiti: sono di oggi
      aRemindAt: fineGiornata(adesso),
      ordina: "remindAt",
      limit: 15,
    }
  );

  const casi = await listActionCases({
    repository: getActionCaseRepository(),
    sedeId: contesto.sedeId,
    userId: contesto.utenteId,
    roles: contesto.ruoli,
    scope: "mine",
    now: adesso,
    // SOLO casi aperti: senza questo filtro i casi risolti (compresi gli
    // auto-risolti delle commesse archiviate) restavano per sempre nella
    // «Situazione di oggi», ordinati per priorità (segnalazione della
    // direzione, 01/09: COM archiviate ancora proposte come critiche).
    statuses: [...STATI_CASO_APERTO],
    limit: 10,
  });

  let segnalazioni: SegnalazioneTars[] | null = null;
  // Stesso pavimento degli strumenti L0 gemelli: senza commessa.read
  // (deny override incluso) la sezione di sede non esiste (revisione).
  if (tarsAttivo("tarsProactive") && contesto.capability.has("commessa.read")) {
    const seguite = await commesseConCasiAperti(contesto.sedeId);
    segnalazioni = rilevaSegnalazioni(contesto.sedeId, seguite, adesso);
  }

  const briefing: BriefingTars = {
    generatoIl: adesso.toISOString(),
    promemoriaOggi: promemoria.map(r => ({
      id: r.id,
      testo: r.text,
      remindAtLocale: formattaIstanteLocale(r.remindAt),
      commessaId: r.commessaId,
    })),
    casiMiei: casi.items.map(caso => ({
      id: caso.id,
      titolo: caso.title,
      priorita: caso.priority,
      prossimaAzione: caso.nextAction.label,
      link: caso.link,
    })),
    segnalazioni,
  };

  // Telemetria del rumore (shadow): quante segnalazioni PRODURREBBE la
  // proattività, quante sono già seguite da un caso aperto.
  await registraRun({
    sedeId: contesto.sedeId,
    utenteId: contesto.utenteId,
    conversazioneId: null,
    stato: "ok",
    provider: "proattivita-shadow",
    modello: "-",
    versioni: {},
    contatori: {
      promemoria: briefing.promemoriaOggi.length,
      casi: briefing.casiMiei.length,
      segnalazioni: segnalazioni?.length ?? 0,
      agganciate: segnalazioni?.filter(s => s.agganciataACasoAperto).length ?? 0,
      modelCallEvitate: 1,
    },
    errore: null,
  });

  return briefing;
}
