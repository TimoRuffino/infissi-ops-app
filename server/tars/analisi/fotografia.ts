// La fotografia deterministica dell'azienda: fatti letti dai servizi di
// dominio, sede-scoped, senza importi. È l'UNICA cosa che il modello vede;
// ogni entità che cita deve stare qui.

import { TZDate } from "@date-fns/tz";
import { getActionCaseRepository } from "../../actionCenter/repository";
import { OPEN_ACTION_STATUSES } from "../../actionCenter/service";
import { getProposteStore } from "../../proposte/gateway";
import { getCommesseStore } from "../../routers/commesse";
import { ficFatture, statoFattura } from "../../routers/ficFatture";
import { getOrdiniFornitoriStore } from "../../routers/fornitori";
import { getInterventiStore } from "../../routers/interventi";
import {
  DOC_TIPO_LABEL,
  REQUIRED_DOC_TIPI_PER_STATO,
  statoHasRequiredDoc,
} from "../../routers/preventiviContratti";
import { getTicketStore } from "../../routers/ticket";
import { sezioneSmistamento } from "../briefing";
import { calcolaPatternAzienda } from "../proattivita/patterns";
import { repositoryOsservazioniCorrente } from "../proattivita/repository";
import { smistamentoAttivo } from "../smistamento/worker";
import { tarsAttivo } from "../../platform/interruttori";
import { ultimaComunicazionePerCommessa } from "../../comunicazioni/comunicazioni";
import { ultimaAttivitaCommessa } from "../../commesse/attivita";
import {
  confermeOrdineMancanti,

  type CommessaSenzaConferma,
} from "../documenti/confermeMancanti";
// Il costo che nasce dalla conferma è regola di dominio, non di Tars: qui
// si legge solo dove NON è nato, per dirlo.
import { confermeSenzaCostoLeggibileDiSede } from "../../commesse/costoDaConferma";
import { dipendenzeConfermeReali } from "../strumenti/ricerca";
import type { FattoAnalisi, FotografiaAzienda, SezioneFotografia } from "./types";

const COMMESSE_FERME = 6;
const CASI_MASSIMI = 12;
const OSSERVAZIONI_MASSIME = 10;
const TICKET_MASSIMI = 6;
const GIORNI_INTERVENTI = 7;
const PREVENTIVI_MASSIMI = 10;
const GATE_MASSIMI = 8;
const FATTURE_MASSIME = 5;
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
  /** Fatture FiC (tutte le sedi: il filtro sede è della fotografia). */
  fatture: () => any[];
  /** Stato di riconciliazione di una fattura collegata (dominio FiC). */
  statoFattura: (fattura: any) => string;
  /** Il gate documentale dello stato corrente: passa? cosa manca? */
  gate: (commessaId: number, stato: string) => { ok: boolean; mancano: string[] };
  /** Ordini fornitore: servono solo a dichiarare il modulo vuoto. */
  ordini: () => any[];
  /** Commesse senza conferma d'ordine nel fascicolo, con i file candidati. */
  confermeMancanti: (sedeId: number) => Promise<CommessaSenzaConferma[]>;
  /**
   * Conferme NEL fascicolo da cui il costo del margine non è nato (imponibile
   * non dichiarato, scansione illeggibile): il costo va scritto a mano.
   */
  confermeSenzaCosto?: (sedeId: number) => Promise<ConfermaSenzaCostoFotografia[]>;
};

type ConfermaSenzaCostoFotografia = ReturnType<
  typeof confermeSenzaCostoLeggibileDiSede
>[number];

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
    fatture: () => ficFatture as any[],
    statoFattura: f => statoFattura(f, getCommesseStore() as any[]).stato,
    gate: (commessaId, stato) => ({
      ok: statoHasRequiredDoc(commessaId, stato),
      mancano: (REQUIRED_DOC_TIPI_PER_STATO[stato] ?? []).map(t => DOC_TIPO_LABEL[t]),
    }),
    ordini: () => getOrdiniFornitoriStore() as any[],
    confermeMancanti: sedeId =>
      confermeOrdineMancanti({
        sedeId,
        deps: dipendenzeConfermeReali(),
        limite: 25,
      }),
    confermeSenzaCosto: async sedeId => confermeSenzaCostoLeggibileDiSede(sedeId, 20),
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
  // I preventivi hanno la loro sezione (1-bis): qui le altre fasi.
  const ferme = [...commesse]
    .filter(c => c.stato !== "preventivo")
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

  // 1-bis. Preventivi: il collo di bottiglia commerciale (D3: 7 giorni
  // sollecito, 30 perso). Età = attività reale, non updatedAt.
  const preventivi = commesse.filter(c => c.stato === "preventivo");
  const preventiviFermi = preventivi
    .map(c => ({ c, giorni: giorniFermi(c.id) }))
    .filter(x => x.giorni >= 7 && x.giorni <= giorniDormiente())
    .sort((a, b) => b.giorni - a.giorni);
  contatori.preventiviAttivi = preventivi.length;
  contatori.preventiviFermi7 = preventiviFermi.length;
  contatori.preventiviFermi30 = preventiviFermi.filter(x => x.giorni >= 30).length;
  sezioni.push({
    chiave: "preventivi",
    titolo: "Preventivi fermi (sollecito a 7 giorni, perso a 30)",
    fatti: preventiviFermi.slice(0, PREVENTIVI_MASSIMI).map(({ c, giorni }) => ({
      chiave: `commessa:${c.id}:preventivo_fermo`,
      testo: `${etichettaCommessa(c)}: preventivo senza fatti nuovi da ${giorni} giorni${
        giorni >= 30 ? " — da proporre come perso" : " — da sollecitare"
      }.`,
      entita: [`commessa:${c.id}`],
      link: `/commesse/${c.id}`,
    })),
  });

  // 1-ter. Gate documentali mancanti sulle commesse vive: il documento che
  // blocca il passo successivo. Le più attive prima: è lì che si lavora.
  const gateMancanti = commesse
    .map(c => ({ c, giorni: giorniFermi(c.id), gate: deps.gate(c.id, c.stato) }))
    .filter(x => x.giorni <= giorniDormiente() && !x.gate.ok);
  contatori.gateMancanti = gateMancanti.length;
  sezioni.push({
    chiave: "gate",
    titolo: "Gate documentali mancanti (il documento che blocca l'avanzamento)",
    fatti: [...gateMancanti]
      .sort((a, b) => a.giorni - b.giorni)
      .slice(0, GATE_MASSIMI)
      .map(({ c, gate }) => ({
        chiave: `commessa:${c.id}:gate`,
        testo: `${etichettaCommessa(c)}: in «${c.stato}» manca il documento del gate (serve: ${gate.mancano.join(" o ") || "documento di fase"}).`,
        entita: [`commessa:${c.id}`],
        link: `/commesse/${c.id}`,
      })),
  });

  // 1-ter-bis. Conferme d'ordine mancanti: il documento che blocca il gate
  // e che porta il costo imponibile del margine. Se il file è già arrivato
  // per mail, il lavoro è un clic (direzione 03/09: «è essenziale che Tars
  // vada alla ricerca delle conf. ordine dove mancano»).
  const conferme = await tenta(
    () => deps.confermeMancanti(sedeId),
    [] as CommessaSenzaConferma[]
  );
  const confermeConFile = conferme.filter(r => r.candidati.length > 0);
  contatori.confermeOrdineMancanti = conferme.length;
  contatori.confermeOrdineConFileInCasa = confermeConFile.length;
  contatori.confermeOrdineDaArchiviareSubito = confermeConFile.filter(r =>
    r.candidati.some(c => c.certezza === "certa")
  ).length;
  // Conferme già nel fascicolo da cui il costo non è nato da solo: qui non
  // si cerca niente, si registra a mano (regola del costo, 03/09 sera).
  const senzaCosto = deps.confermeSenzaCosto
    ? await tenta(() => deps.confermeSenzaCosto!(sedeId), [] as ConfermaSenzaCostoFotografia[])
    : [];
  contatori.confermeOrdineSenzaCostoLeggibile = senzaCosto.length;
  const fattiSenzaCosto = senzaCosto.slice(0, GATE_MASSIMI).map(riga => ({
    chiave: `commessa:${riga.commessaId}:conferma_senza_costo`,
    testo: `${riga.codice ?? `Commessa ${riga.commessaId}`} — ${riga.cliente ?? "cliente non indicato"}: la conferma «${riga.nomeFile}» è nel fascicolo ma il costo del margine non si legge da sola (${
      riga.esito === "senza_imponibile" ? "imponibile non dichiarato" : "documento non leggibile"
    }): il costo va registrato a mano dalla scheda commessa.`,
    entita: [`commessa:${riga.commessaId}`, `documento:${riga.documentoId}`],
    link: riga.link,
  }));
  sezioni.push({
    chiave: "conferme_ordine",
    titolo: "Conferme d'ordine mancanti o senza costo leggibile (gate documentale e costo del margine)",
    fatti: [...fattiSenzaCosto, ...conferme.slice(0, GATE_MASSIMI).map(riga => {
      const certo = riga.candidati.find(c => c.certezza === "certa");
      const primo = certo ?? riga.candidati[0] ?? null;
      return {
        chiave: `commessa:${riga.commessaId}:conferma_ordine`,
        testo: `${riga.codice ?? `Commessa ${riga.commessaId}`} — ${riga.cliente ?? "cliente non indicato"}: in «${riga.stato}» senza conferma d'ordine nel fascicolo${
          primo
            ? `; il file «${primo.nomeFile}» è arrivato da ${primo.mittente}${
                certo ? " e si può archiviare subito" : " ma va confermato"
              }`
            : "; nessun allegato candidato trovato nelle mail"
        }.`,
        entita: [
          `commessa:${riga.commessaId}`,
          ...(primo ? [`comunicazione:${primo.comunicazioneId}`] : []),
        ],
        link: primo?.link ?? `/commesse/${riga.commessaId}`,
      };
    })],
  });

  // 1-quater. Fatture FiC: non collegate o incassate ma non a registro.
  // Mai importi. «attesa_incasso» è il corso normale: solo contatore.
  const fatture = deps.fatture().filter(f => f.sedeId === sedeId);
  const fattureNonCollegate = fatture.filter(f => f.commessaId == null && !f.ignorata);
  const statiFatture = fatture
    .filter(f => f.commessaId != null && !f.ignorata)
    .map(f => deps.statoFattura(f));
  contatori.fattureNonCollegate = fattureNonCollegate.length;
  contatori.fattureDaRiconciliare = statiFatture.filter(s => s === "da_riconciliare").length;
  contatori.fattureAttesaIncasso = statiFatture.filter(s => s === "attesa_incasso").length;
  const fattiFatture: FattoAnalisi[] = fattureNonCollegate
    .slice(0, FATTURE_MASSIME)
    .map(f => ({
      chiave: `fattura:${f.id}:non_collegata`,
      testo: `Fattura n. ${f.numero} del ${f.data} — ${f.clienteNome}: non collegata a nessuna commessa.`,
      entita: [`fattura:${f.id}`],
      link: "/economia",
    }));
  if (contatori.fattureDaRiconciliare > 0) {
    fattiFatture.push({
      chiave: "fatture:da_riconciliare",
      testo: `${contatori.fattureDaRiconciliare} fatture risultano incassate ma senza gli incassi a registro sulla commessa.`,
      entita: [],
      link: "/economia",
    });
  }
  sezioni.push({ chiave: "fatture", titolo: "Fatture (FiC)", fatti: fattiFatture });

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
    titolo: `Commesse dormienti (ferme da oltre ${giorniDormiente()} giorni): niente lavoro da proporre, al più archiviarle in blocco`,
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

  // 4. Pattern azienda (correlazioni, mai cause). Un pattern calcolato su
  // un modulo vuoto è rumore: con zero ordini a sistema «ritardi_fornitore»
  // non entra (03/09: l'analisi citava ritardi fornitore su dati inesistenti).
  const ordiniSede = deps
    .ordini()
    .filter((o: any) => (o.sedeId ?? sedeId) === sedeId);
  const pattern = await tenta(() => deps.pattern(sedeId, adesso), null);
  const listaPattern = (pattern?.pattern ?? []).filter(
    p => ordiniSede.length > 0 || p.chiave !== "ritardi_fornitore"
  );
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
    const senzaRisposta24h = (smistamento.daRispondere ?? []).filter((v: any) => {
      const t = new Date(v.ricevutaIl ?? 0).getTime();
      return Number.isFinite(t) && t > 0 && adesso.getTime() - t >= 86_400_000;
    });
    contatori.comunicazioniSenzaRisposta24h = senzaRisposta24h.length;
    if (senzaRisposta24h.length > 0) {
      fattiComunicazioni.push({
        chiave: "comunicazioni:senza_risposta_24h",
        testo: `${senzaRisposta24h.length} comunicazioni attendono una risposta da oltre 24 ore.`,
        entita: senzaRisposta24h.slice(0, 5).map((v: any) => `comunicazione:${v.comunicazioneId}`),
        link: "/messaggi/email",
      });
    }
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
  contatori.ticketSenzaAssegnatario = ticket.filter(t => t.assegnatoA == null).length;
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
  // Il dominio scrive `dataPianificata` (routers/interventi): leggere
  // `i.data` lasciava la sezione SEMPRE vuota sui dati veri (fix T4).
  const dataIntervento = (i: any): string | null =>
    typeof i.dataPianificata === "string"
      ? i.dataPianificata
      : typeof i.data === "string"
        ? i.data
        : null;
  const interventi = deps
    .interventi()
    .filter(i => {
      const data = dataIntervento(i);
      return (
        (i.sedeId ?? sedeId) === sedeId &&
        data != null &&
        data >= oggi &&
        data <= limite &&
        i.stato !== "annullato"
      );
    });
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

  // 9. Perimetro: i moduli senza dati esistono nel CRM ma non in questa
  // azienda. Dichiararli evita al modello di inventarci sopra rischi.
  const moduliVuoti: string[] = [];
  if (ordiniSede.length === 0) moduliVuoti.push("Ordini fornitore: 0 record");
  sezioni.push({
    chiave: "perimetro",
    titolo: "Perimetro (moduli senza dati: non trarne conclusioni)",
    fatti:
      moduliVuoti.length > 0
        ? [
            {
              chiave: "perimetro:moduli_vuoti",
              testo: `Moduli non usati in questa azienda: ${moduliVuoti.join("; ")}. Nessuna analisi o proposta deve riguardarli.`,
              entita: [],
              link: null,
            },
          ]
        : [],
  });

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
