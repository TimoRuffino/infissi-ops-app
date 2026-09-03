// La fotografia deterministica dell'azienda: fatti letti dai servizi di
// dominio, sede-scoped, senza importi. È l'UNICA cosa che il modello vede;
// ogni entità che cita deve stare qui.

import { TZDate } from "@date-fns/tz";
import { getActionCaseRepository } from "../../actionCenter/repository";
import { OPEN_ACTION_STATUSES } from "../../actionCenter/service";
import { getProposteStore } from "../../proposte/gateway";
import { getCommesseStore } from "../../routers/commesse";
import { getInterventiStore } from "../../routers/interventi";
import { getTicketStore } from "../../routers/ticket";
import { sezioneSmistamento } from "../briefing";
import { calcolaPatternAzienda } from "../proattivita/patterns";
import { repositoryOsservazioniCorrente } from "../proattivita/repository";
import { smistamentoAttivo } from "../smistamento/worker";
import { tarsAttivo } from "../../platform/interruttori";
import { ultimaComunicazionePerCommessa } from "../../comunicazioni/comunicazioni";
import { ultimaAttivitaCommessa } from "../../commesse/attivita";
import type { FattoAnalisi, FotografiaAzienda, SezioneFotografia } from "./types";

const COMMESSE_FERME = 6;
const CASI_MASSIMI = 12;
const OSSERVAZIONI_MASSIME = 10;
const TICKET_MASSIMI = 6;
const GIORNI_INTERVENTI = 7;
/**
 * Una commessa senza FATTI reali da così tanto è dormiente: non lavoro da
 * proporre, al più da archiviare. Era 120 giorni misurati su `updatedAt`,
 * che i lavori di fondo riscrivono: nessuna commessa risultava mai ferma
 * (direzione 03/09: «continua a fare proposte di commesse vecchie mesi»).
 */
export function giorniDormiente(): number {
  const n = Number.parseInt(process.env.TARS_GIORNI_DORMIENTE ?? "", 10);
  return Number.isFinite(n) && n >= 7 ? n : 60;
}

function giorniDa(data: Date | string | null | undefined, adesso: Date): number | null {
  if (!data) return null;
  const t = new Date(data).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((adesso.getTime() - t) / 86_400_000));
}

function giornoLocale(istante: Date): string {
  const locale = new TZDate(istante, "Europe/Rome");
  const mm = String(locale.getMonth() + 1).padStart(2, "0");
  const dd = String(locale.getDate()).padStart(2, "0");
  return `${locale.getFullYear()}-${mm}-${dd}`;
}

function etichettaCommessa(c: any): string {
  return `${c.codice ?? `Commessa ${c.id}`} — ${c.cliente ?? "cliente non indicato"}`;
}

export type DipendenzeFotografia = {
  commesse: () => any[];
  ticket: () => any[];
  interventi: () => any[];
  casiAperti: (sedeId: number) => Promise<any[]>;
  osservazioniAperte: (sedeId: number) => Promise<any[]>;
  pattern: (sedeId: number, adesso: Date) => Promise<{ pattern: any[] } | null>;
  smistamento: (sedeId: number, adesso: Date) => Promise<any | null>;
  proposteGateway: () => readonly any[];
  /** Ultima comunicazione collegata per commessa: data l'attività vera. */
  ultimeComunicazioni: (sedeId: number) => Promise<Map<number, Date>>;
  /** Ultimo fatto reale della commessa (documenti, transizioni, timeline…). */
  attivita: (
    commessa: { id: number; createdAt?: Date | string | null },
    ultimaComunicazione: Date | undefined,
    adesso: Date
  ) => { giorni: number; fonte: string };
};

export function dipendenzeFotografiaReali(): DipendenzeFotografia {
  return {
    commesse: () => getCommesseStore() as any[],
    ticket: () => getTicketStore() as any[],
    interventi: () => getInterventiStore() as any[],
    casiAperti: async sedeId =>
      (
        await getActionCaseRepository().list({
          sedeId,
          statuses: [...OPEN_ACTION_STATUSES],
          limit: 60,
        })
      ).items,
    osservazioniAperte: sedeId =>
      repositoryOsservazioniCorrente().lista({ sedeId, stato: "aperta", limite: 40 }),
    pattern: async (sedeId, adesso) =>
      tarsAttivo("tarsPatterns")
        ? await calcolaPatternAzienda({ sedeId, now: adesso })
        : null,
    smistamento: async (sedeId, adesso) =>
      smistamentoAttivo() ? await sezioneSmistamento(sedeId, adesso) : null,
    proposteGateway: () => getProposteStore(),
    ultimeComunicazioni: sedeId => ultimaComunicazionePerCommessa(sedeId),
    attivita: (commessa, ultimaComunicazione, adesso) =>
      ultimaAttivitaCommessa(commessa, ultimaComunicazione ?? null, adesso),
  };
}

/** Un errore in una fonte non azzera la fotografia: la sezione manca e lo si dichiara. */
async function tenta<T>(fn: () => Promise<T>, altrimenti: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return altrimenti;
  }
}

export async function costruisciFotografia(input: {
  sedeId: number;
  adesso: Date;
  deps?: DipendenzeFotografia;
}): Promise<FotografiaAzienda> {
  const deps = input.deps ?? dipendenzeFotografiaReali();
  const { sedeId, adesso } = input;
  const contatori: Record<string, number> = {};
  const sezioni: SezioneFotografia[] = [];

  // 1. Commesse attive: quante per stato, quali sono ferme da più tempo.
  const commesse = deps
    .commesse()
    .filter(c => c.sedeId === sedeId && c.stato !== "archiviata" && !c.archivedAt);
  const perStato = new Map<string, number>();
  for (const c of commesse) perStato.set(c.stato, (perStato.get(c.stato) ?? 0) + 1);
  contatori.commesseAttive = commesse.length;
  contatori.commesseUrgenti = commesse.filter(c => c.priorita === "urgente").length;
  const fattiCommesse: FattoAnalisi[] = [];
  if (commesse.length > 0) {
    fattiCommesse.push({
      chiave: "commesse:per_stato",
      testo: `Commesse attive per stato: ${[...perStato.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([stato, n]) => `${stato} ${n}`)
        .join(", ")}.`,
      entita: [],
      link: "/commesse",
    });
  }
  const ultimeComunicazioni = await tenta(
    () => deps.ultimeComunicazioni(sedeId),
    new Map<number, Date>()
  );
  const attivita = new Map<number, { giorni: number; fonte: string }>();
  for (const c of deps.commesse()) {
    if (c.sedeId !== sedeId) continue;
    attivita.set(
      c.id,
      deps.attivita(c, ultimeComunicazioni.get(c.id), adesso)
    );
  }
  const giorniFermi = (id: number) => attivita.get(id)?.giorni ?? 0;
  const ferme = [...commesse]
    .map(c => ({ c, giorni: giorniFermi(c.id) }))
    .filter(x => x.giorni <= giorniDormiente())
    .sort((a, b) => b.giorni - a.giorni)
    .slice(0, COMMESSE_FERME);
  for (const { c, giorni } of ferme) {
    if (giorni < 7) continue;
    fattiCommesse.push({
      chiave: `commessa:${c.id}:ferma`,
      testo: `${etichettaCommessa(c)}: in stato «${c.stato}» senza fatti nuovi da ${giorni} giorni${c.priorita === "urgente" ? " (priorità urgente)" : ""}.`,
      entita: [`commessa:${c.id}`],
      link: `/commesse/${c.id}`,
    });
  }
  sezioni.push({ chiave: "commesse", titolo: "Commesse", fatti: fattiCommesse });

  // 2. Casi aperti del Centro Azioni (già deterministici e prioritizzati).
  // I casi su commesse DORMIENTI (ferme da oltre 120 giorni) vanno a parte:
  // non sono lavoro da proporre, al più roba da archiviare in blocco
  // (direzione, 02/09 notte: «proposte su commesse vecchie mesi»).
  const tuttiICasi = await tenta(() => deps.casiAperti(sedeId), [] as any[]);
  // Solo commesse di QUESTA sede (anche archiviate: servono a dare il nome
  // a un ticket o a un caso che le cita).
  const perCommessa = new Map<number, any>(
    deps
      .commesse()
      .filter(c => c.sedeId === sedeId)
      .map(c => [c.id, c])
  );
  const dormiente = (commessaId: number | null | undefined) => {
    if (commessaId == null) return false;
    if (!perCommessa.get(commessaId)) return false;
    return giorniFermi(commessaId) > giorniDormiente();
  };
  const casi = tuttiICasi.filter(k => !dormiente(k.commessaId));
  const casiDormienti = tuttiICasi.filter(k => dormiente(k.commessaId));
  contatori.casiAperti = casi.length;
  contatori.casiCritici = casi.filter(k => k.priority === "critica").length;
  contatori.casiSuCommesseDormienti = casiDormienti.length;
  sezioni.push({
    chiave: "casi",
    titolo: "Casi aperti del Centro Azioni",
    fatti: [...casi]
      .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
      .slice(0, CASI_MASSIMI)
      .map(k => ({
        chiave: `caso:${k.id}`,
        testo: `[${k.priority}] ${k.title}${
          k.commessaId && perCommessa.get(k.commessaId)
            ? ` — ${etichettaCommessa(perCommessa.get(k.commessaId))}`
            : ""
        }${k.nextAction?.label ? ` — prossima azione: ${k.nextAction.label}` : ""}${k.assigneeUserId == null ? " (nessun assegnatario)" : ""}.`,
        entita: [`caso:${k.id}`, ...(k.commessaId ? [`commessa:${k.commessaId}`] : [])],
        link: k.link ?? (k.commessaId ? `/commesse/${k.commessaId}` : null),
      })),
  });

  const commesseDormienti = commesse.filter(c => dormiente(c.id));
  contatori.commesseDormienti = commesseDormienti.length;
  sezioni.push({
    chiave: "dormienti",
    titolo: "Commesse dormienti (ferme da oltre 120 giorni): niente lavoro da proporre, al più archiviarle in blocco",
    fatti:
      commesseDormienti.length > 0
        ? [
            {
              chiave: "dormienti:elenco",
              testo: `${commesseDormienti.length} commesse ferme da oltre ${giorniDormiente()} giorni: ${commesseDormienti
                .slice(0, 10)
                .map(c => `${etichettaCommessa(c)} (${c.stato}, ferma da ${giorniFermi(c.id)} gg)`)
                .join("; ")}${commesseDormienti.length > 10 ? "; …" : ""}. ${casiDormienti.length} casi aperti le riguardano.`,
              entita: commesseDormienti.slice(0, 10).map(c => `commessa:${c.id}`),
              link: "/commesse",
            },
          ]
        : [],
  });

  // 3. Osservazioni aperte dell'osservatore.
  const osservazioni = await tenta(() => deps.osservazioniAperte(sedeId), [] as any[]);
  contatori.osservazioniAperte = osservazioni.length;
  sezioni.push({
    chiave: "osservazioni",
    titolo: "Osservazioni aperte",
    fatti: osservazioni.slice(0, OSSERVAZIONI_MASSIME).map(o => ({
      chiave: `osservazione:${o.id}`,
      testo: `[${o.priorita}, materialità ${o.materialita}] ${o.titolo}${
        o.commessaId && perCommessa.get(o.commessaId)
          ? ` — ${etichettaCommessa(perCommessa.get(o.commessaId))}`
          : ""
      }: ${o.sintesi}`,
      entita: [`osservazione:${o.id}`, ...(o.commessaId ? [`commessa:${o.commessaId}`] : [])],
      link: o.commessaId ? `/commesse/${o.commessaId}` : null,
    })),
  });

  // 4. Pattern azienda (correlazioni, mai cause).
  const pattern = await tenta(() => deps.pattern(sedeId, adesso), null);
  const listaPattern = pattern?.pattern ?? [];
  contatori.pattern = listaPattern.length;
  sezioni.push({
    chiave: "pattern",
    titolo: "Pattern del periodo (correlazioni osservate, non cause)",
    fatti: listaPattern.map(p => ({
      chiave: `pattern:${p.chiave}`,
      testo: `${p.titolo}: ${p.misura} (baseline: ${p.baseline}; campione ${p.campione?.commesse ?? "?"} commesse).`,
      entita: [`pattern:${p.chiave}`],
      link: null,
    })),
  });

  // 5. Smistamento comunicazioni: urgenti, da rispondere, da decidere.
  const smistamento = await tenta(() => deps.smistamento(sedeId, adesso), null);
  const fattiComunicazioni: FattoAnalisi[] = [];
  if (smistamento) {
    const c = smistamento.contatori ?? {};
    // Il contatore del registro, non la lista (che il briefing tronca a poche voci):
    // la prima analisi reale chiedeva perché 29 proposte aperte e 8 «da decidere».
    contatori.comunicazioniDaDecidere = c.proposteAperte ?? smistamento.daDecidere?.length ?? 0;
    contatori.comunicazioniDaRispondere = smistamento.daRispondere?.length ?? 0;
    contatori.comunicazioniUrgenti = smistamento.urgenti?.length ?? 0;
    fattiComunicazioni.push({
      chiave: "comunicazioni:oggi",
      testo: `Oggi: ${c.smistateOggi ?? 0} comunicazioni smistate, ${c.collegateOggi ?? 0} collegate a commesse, ${c.archiviatiOggi ?? 0} allegati archiviati, ${c.proposteAperte ?? 0} proposte da decidere.`,
      entita: [],
      link: "/messaggi/email",
    });
    for (const [gruppo, etichetta] of [
      ["urgenti", "Urgente"],
      ["daRispondere", "Da rispondere"],
      ["daDecidere", "Da decidere"],
    ] as const) {
      for (const voce of (smistamento[gruppo] ?? []).slice(0, 5)) {
        fattiComunicazioni.push({
          chiave: `comunicazione:${voce.comunicazioneId}`,
          testo: `${etichetta}: «${voce.oggetto || voce.mittente}» da ${voce.mittente} — ${voce.riepilogo}`,
          entita: [`comunicazione:${voce.comunicazioneId}`],
          link: voce.link ?? null,
        });
      }
    }
  }
  sezioni.push({ chiave: "comunicazioni", titolo: "Comunicazioni", fatti: fattiComunicazioni });

  // 6. Ticket post-vendita aperti.
  const ticket = deps
    .ticket()
    .filter(t => (t.sedeId ?? sedeId) === sedeId && t.stato !== "chiuso" && !t.deletedAt);
  contatori.ticketAperti = ticket.length;
  contatori.ticketUrgenti = ticket.filter(t => t.priorita === "urgente" || t.priorita === "alta").length;
  sezioni.push({
    chiave: "ticket",
    titolo: "Ticket post-vendita aperti",
    fatti: [...ticket]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, TICKET_MASSIMI)
      .map(t => ({
        chiave: `ticket:${t.id}`,
        testo: `[${t.priorita ?? "media"}] «${t.oggetto ?? t.categoria ?? "ticket"}»${
          t.commessaId && perCommessa.get(t.commessaId)
            ? ` su ${etichettaCommessa(perCommessa.get(t.commessaId))}`
            : ""
        } — aperto da ${giorniDa(t.createdAt, adesso) ?? "?"} giorni, stato «${t.stato}»${t.assegnatoA == null ? ", non assegnato" : ""}.`,
        entita: [`ticket:${t.id}`, ...(t.commessaId ? [`commessa:${t.commessaId}`] : [])],
        link: "/ticket",
      })),
  });

  // 7. Interventi dei prossimi sette giorni.
  const oggi = giornoLocale(adesso);
  const limite = giornoLocale(new Date(adesso.getTime() + GIORNI_INTERVENTI * 86_400_000));
  const interventi = deps
    .interventi()
    .filter(
      i =>
        (i.sedeId ?? sedeId) === sedeId &&
        typeof i.data === "string" &&
        i.data >= oggi &&
        i.data <= limite &&
        i.stato !== "annullato"
    );
  contatori.interventiSettimana = interventi.length;
  contatori.interventiSenzaSquadra = interventi.filter(i => i.squadraId == null).length;
  const perTipo = new Map<string, number>();
  for (const i of interventi) perTipo.set(i.tipo, (perTipo.get(i.tipo) ?? 0) + 1);
  sezioni.push({
    chiave: "interventi",
    titolo: "Interventi dei prossimi sette giorni",
    fatti:
      interventi.length > 0
        ? [
            {
              chiave: "interventi:settimana",
              testo: `${interventi.length} interventi in calendario (${[...perTipo.entries()].map(([t, n]) => `${t} ${n}`).join(", ")}), ${contatori.interventiSenzaSquadra} senza squadra assegnata.`,
              entita: interventi.slice(0, 12).map(i => `intervento:${i.id}`),
              link: "/planning",
            },
          ]
        : [],
  });

  // 8. Proposte in attesa (gateway documentale).
  const proposte = deps
    .proposteGateway()
    .filter(p => p.sedeId === sedeId && (p.stato === "proposta" || p.stato === "approvata"));
  contatori.proposteDocumentali = proposte.length;

  return { sedeId, generataIl: adesso.toISOString(), contatori, sezioni };
}

/** Tutti i riferimenti di entità presenti nella fotografia (per la verifica). */
export function entitaDellaFotografia(fotografia: FotografiaAzienda): Map<string, string | null> {
  const mappa = new Map<string, string | null>();
  for (const sezione of fotografia.sezioni) {
    for (const fatto of sezione.fatti) {
      for (const rif of fatto.entita) {
        if (!mappa.has(rif)) mappa.set(rif, fatto.link);
      }
    }
  }
  return mappa;
}

/** Il testo che il modello legge: sezioni fisse, fatti numerati con i riferimenti. */
export function testoFotografia(fotografia: FotografiaAzienda): string {
  const righe: string[] = [];
  righe.push(`Sede ${fotografia.sedeId}, fotografia del ${fotografia.generataIl}.`);
  righe.push(
    `Contatori: ${Object.entries(fotografia.contatori)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}.`
  );
  for (const sezione of fotografia.sezioni) {
    righe.push("");
    righe.push(`## ${sezione.titolo}`);
    if (sezione.fatti.length === 0) {
      righe.push("(nessun fatto)");
      continue;
    }
    for (const fatto of sezione.fatti) {
      const rif = fatto.entita.length > 0 ? ` [${fatto.entita.join(", ")}]` : "";
      righe.push(`- ${fatto.testo}${rif}`);
    }
  }
  return righe.join("\n");
}

export { giornoLocale };
