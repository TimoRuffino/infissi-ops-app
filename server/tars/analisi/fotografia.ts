// La fotografia deterministica dell'azienda: fatti letti dai servizi di
// dominio, sede-scoped, senza importi. È l'UNICA cosa che il modello vede;
// ogni entità che cita deve stare qui.

import { TZDate } from "@date-fns/tz";
import { getActionCaseRepository } from "../../actionCenter/repository";
import { OPEN_ACTION_STATUSES } from "../../actionCenter/service";
import { getProposteStore } from "../../proposte/gateway";
import { STATI_COMMESSA } from "../../commesse/transizioni";
import { getCommesseStore } from "../../routers/commesse";
import { ficFatture, statoFattura } from "../../routers/ficFatture";
import { getOrdiniFornitoriStore } from "../../routers/fornitori";
import { getInterventiStore } from "../../routers/interventi";
import {
  DOC_TIPO_LABEL,
  REQUIRED_DOC_TIPI_PER_STATO,
  getDocumentiDiCommessa,
  statoHasRequiredDoc,
} from "../../routers/preventiviContratti";
import {
  catenePerTipo,
  type DocumentoVersionabile,
} from "@shared/versioniDocumenti";
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
// La merce ordinata: senza questa sezione la fotografia non vedeva l'unica
// cosa che fa slittare le pose (punto 1 del piano 08/09/2026).
import { consegneInArrivo, type ConsegnaInArrivo } from "../../fornitori/archivio";
// Documento contro dato: la merce che arriva dopo la posa, la data e il
// costo che non coincidono con la conferma (punto 29 del piano).
import { discordanzeDiSede, type Discordanza } from "../../commesse/discordanze";
// Le soglie dalla storia dell'azienda, non inventate a mano (punto 17), e
// la posta in gioco che ordina le proposte (punti 8 e 22).
import {
  commesseLenteDiSede,
  type CommessaLenta,
  type MedianaStato,
} from "../../commesse/tempiDiAttraversamento";
import {
  postaPerEntita,
  postaInGiocoDiSede,
  sogliaMargine,
  type PostaCommessa,
} from "../../commesse/postaInGioco";
// Le fonti mute: l'unico difetto che mente in modo rassicurante (punto 7).
import { guastiDiSede, type GuastoIntegrazione } from "./guasti";
import { dipendenzeConfermeReali } from "../strumenti/ricerca";
import type {
  FattoAnalisi,
  FiduciaFatto,
  FotografiaAzienda,
  SezioneFotografia,
} from "./types";

const COMMESSE_FERME = 6;
const CASI_MASSIMI = 12;
const OSSERVAZIONI_MASSIME = 10;
const TICKET_MASSIMI = 6;
const GIORNI_INTERVENTI = 7;
const PREVENTIVI_MASSIMI = 10;
const GATE_MASSIMI = 8;
const FATTURE_MASSIME = 5;
const CONSEGNE_MASSIME = 8;
/** Oltre questa soglia una consegna prevista è «vicina», non futura. */
const GIORNI_CONSEGNA_VICINA = 14;
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

/** Il passo avanti secondo la macchina a stati: nessuna regola nuova qui. */
function statoSuccessivo(stato: string): string | null {
  const stati = STATI_COMMESSA as readonly string[];
  const i = stati.indexOf(stato);
  return i >= 0 ? stati[i + 1] ?? null : null;
}

/**
 * Nessun taglio silenzioso (punto 20 del piano 08/09/2026): la fotografia
 * mostra i primi N e DICE quanti restano fuori. Prima il modello vedeva
 * otto righe e non aveva modo di sapere che ce n'erano altre quattordici:
 * per quelle non poteva nascere nessuna proposta, mai.
 */
function conResto(
  fatti: FattoAnalisi[],
  totale: number,
  cosa: string,
  link: string | null = null
): FattoAnalisi[] {
  const fuori = totale - fatti.length;
  if (fuori <= 0) return fatti;
  return [
    ...fatti,
    {
      chiave: `resto:${cosa.replace(/\s+/g, "_")}`,
      testo: `E altre ${fuori} ${cosa} non elencate qui: chiedile prima di concludere che queste sono tutte.`,
      entita: [],
      link,
    },
  ];
}

/**
 * I contatori che vale la pena confrontare con l'analisi precedente, con
 * il nome che il modello deve usare. Non tutti: un elenco di variazioni
 * lungo trenta righe è rumore quanto nessuna variazione.
 */
const CONTATORI_CONFRONTATI: ReadonlyArray<readonly [string, string]> = [
  ["commesseAttive", "Commesse attive"],
  ["preventiviFermi7", "Preventivi fermi da oltre 7 giorni"],
  ["gateMancanti", "Gate documentali scoperti"],
  ["pronteAlPassoSuccessivo", "Commesse pronte al passo successivo"],
  ["confermeOrdineMancanti", "Conferme d'ordine mancanti"],
  ["merceInRitardo", "Consegne in ritardo"],
  ["fattureNonCollegate", "Fatture non collegate"],
  ["fattureDaRiconciliare", "Fatture incassate ma non a registro"],
  ["ticketAperti", "Ticket post-vendita aperti"],
  ["casiAperti", "Casi aperti del Centro Azioni"],
  ["comunicazioniSenzaRisposta24h", "Messaggi senza risposta da oltre 24 ore"],
  ["fontiCieche", "Fonti mute"],
];

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
  /** Merce ordinata e non ancora arrivata, con i giorni di ritardo. */
  consegne?: (sedeId: number, adesso: Date) => ConsegnaInArrivo[];
  /** Le fonti mute o in errore: posta, WhatsApp, Fatture in Cloud. */
  guasti?: (sedeId: number, adesso: Date) => GuastoIntegrazione[];
  /** Dove il documento e il dato non dicono la stessa cosa. */
  discordanze?: (sedeId: number, adesso: Date) => Discordanza[];
  /** I documenti di una commessa: servono a vedere quale versione vale. */
  documentiDi?: (commessaId: number) => DocumentoVersionabile[];
  /** Quanto dura di solito ogni stato, e chi sfora (dalla storia vera). */
  tempi?: (
    sedeId: number,
    adesso: Date
  ) => { mediane: Map<string, MedianaStato>; lente: CommessaLenta[] };
  /** Residuo e margine per commessa: le cifre restano fuori dal prompt. */
  posta?: (sedeId: number) => Map<number, PostaCommessa>;
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
    // La fotografia legge anche DENTRO i file candidati (poche letture per
    // giro, con il modello per le scansioni, utente di sistema): così dice
    // se la conferma cita la commessa e la proposta «archivia» è eseguibile.
    confermeMancanti: sedeId =>
      confermeOrdineMancanti({
        sedeId,
        deps: dipendenzeConfermeReali({ visione: { sedeId, utenteId: 0 }, massimoLetture: 6 }),
        limite: 25,
      }),
    confermeSenzaCosto: async sedeId => confermeSenzaCostoLeggibileDiSede(sedeId, 20),
    consegne: (sedeId, adesso) => consegneInArrivo({ sedeId, adesso }),
    guasti: (sedeId, adesso) => guastiDiSede({ sedeId, adesso }),
    discordanze: (sedeId, adesso) => discordanzeDiSede({ sedeId, adesso }),
    documentiDi: commessaId => getDocumentiDiCommessa(commessaId),
    tempi: (sedeId, adesso) => commesseLenteDiSede({ sedeId, adesso }),
    posta: sedeId => postaInGiocoDiSede({ sedeId }),
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
  /**
   * I contatori dell'ultima analisi: senza confronto un numero non dice
   * niente. «12 preventivi fermi» è muto, «12, ieri erano 8» no
   * (punto 16 del piano 08/09/2026).
   */
  contatoriPrecedenti?: Record<string, number> | null;
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
    fatti: conResto(
      preventiviFermi.slice(0, PREVENTIVI_MASSIMI).map(({ c, giorni }) => ({
      chiave: `commessa:${c.id}:preventivo_fermo`,
      testo: `${etichettaCommessa(c)}: preventivo senza fatti nuovi da ${giorni} giorni${
        giorni >= 30 ? " — da proporre come perso" : " — da sollecitare"
      }.`,
      entita: [`commessa:${c.id}`],
      link: `/commesse/${c.id}`,
      })),
      preventiviFermi.length,
      "commesse col preventivo fermo",
      "/commesse"
    ),
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
    fatti: conResto(
      [...gateMancanti]
        .sort((a, b) => a.giorni - b.giorni)
        .slice(0, GATE_MASSIMI)
        .map(({ c, gate }) => ({
          chiave: `commessa:${c.id}:gate`,
          testo: `${etichettaCommessa(c)}: in «${c.stato}» manca il documento del gate (serve: ${gate.mancano.join(" o ") || "documento di fase"}).`,
          entita: [`commessa:${c.id}`],
          link: `/commesse/${c.id}`,
        })),
      gateMancanti.length,
      "commesse con un gate documentale scoperto",
      "/commesse"
    ),
  });

  // 1-ter-ter. Il contrario del gate mancante: le commesse che il documento
  // ce l'hanno già e possono andare avanti (direzione 08/09/2026: «se c'è
  // già una fattura collegata a una commessa, perché Tars non propone di
  // mandarla avanti? le commesse vanno tenute aggiornate»). Prima la
  // fotografia diceva soltanto che cosa manca, quindi Tars non aveva modo
  // di accorgersi che un passaggio era già dovuto.
  const pronte = commesse
    .map(c => ({
      c,
      giorni: giorniFermi(c.id),
      gate: deps.gate(c.id, c.stato),
      successivo: statoSuccessivo(c.stato),
    }))
    .filter(
      x =>
        x.giorni <= giorniDormiente() &&
        x.gate.ok &&
        // Solo dove il gate chiede davvero un documento: negli stati senza
        // gate «pronta» non vorrebbe dire niente.
        x.gate.mancano.length > 0 &&
        x.successivo != null &&
        // Archiviare è un'altra decisione, non un passo di avanzamento.
        x.successivo !== "archiviata"
    );
  contatori.pronteAlPassoSuccessivo = pronte.length;
  sezioni.push({
    chiave: "pronte",
    titolo: "Pronte per il passo successivo (il documento c'è già)",
    fatti: conResto(
      [...pronte]
        .sort((a, b) => b.giorni - a.giorni)
        .slice(0, GATE_MASSIMI)
        .map(({ c, giorni, gate, successivo }) => ({
        chiave: `commessa:${c.id}:pronta`,
        testo: `${etichettaCommessa(c)}: in «${c.stato}» il documento del gate c'è (${gate.mancano.join(" o ")}) — può passare a «${successivo}»${
          giorni >= 1 ? `, ferma da ${giorni} giorni` : ""
        }.`,
        entita: [`commessa:${c.id}`],
        link: `/commesse/${c.id}`,
        })),
      pronte.length,
      "commesse già pronte al passo successivo",
      "/commesse"
    ),
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
    // Il costo non si è letto: qualunque cosa si dica su questa conferma va
    // verificata aprendo il file.
    fiducia: "da_verificare" as FiduciaFatto,
  }));
  sezioni.push({
    chiave: "conferme_ordine",
    titolo: "Conferme d'ordine mancanti o senza costo leggibile (gate documentale e costo del margine)",
    fatti: [...fattiSenzaCosto, ...conferme.slice(0, GATE_MASSIMI).map(riga => {
      const certo = riga.candidati.find(c => c.certezza === "certa");
      const primo = certo ?? riga.candidati[0] ?? null;
      return {
        chiave: `commessa:${riga.commessaId}:conferma_ordine`,
        // comunicazione e allegatoIndex nel testo: sono i parametri
        // dell'azione «archivia con un click» che il modello compila.
        testo: `${riga.codice ?? `Commessa ${riga.commessaId}`} — ${riga.cliente ?? "cliente non indicato"}: in «${riga.stato}» senza conferma d'ordine nel fascicolo${
          primo
            ? `; il file «${primo.nomeFile}» è arrivato da ${primo.mittente} (comunicazione ${primo.comunicazioneId}, allegatoIndex ${primo.allegatoIndex})${
                certo ? " e si può archiviare subito" : ` ma va confermato: ${primo.motivo}`
              }`
            : "; nessun allegato candidato trovato nelle mail"
        }.`,
        entita: [
          `commessa:${riga.commessaId}`,
          ...(primo ? [`comunicazione:${primo.comunicazioneId}`] : []),
        ],
        link: primo?.link ?? `/commesse/${riga.commessaId}`,
        // Un file letto da una macchina: col riscontro sulla commessa è una
        // lettura affidabile, senza riscontro va guardata da una persona.
        fiducia: (certo ? "letta" : "da_verificare") as FiduciaFatto,
      };
    })],
  });

  // 1-quinquies. Merce ordinata: quella in ritardo e quella che arriva
  // adesso. È il dato che fa slittare le pose, e fino all'08/09/2026 la
  // fotografia non lo guardava affatto (punto 1 del piano).
  const consegne = deps.consegne ? deps.consegne(sedeId, adesso) : [];
  const inRitardo = consegne
    .filter(c => c.giorniDiRitardo > 0)
    .sort((a, b) => b.giorniDiRitardo - a.giorniDiRitardo);
  const limiteVicino = new Date(adesso.getTime() + GIORNI_CONSEGNA_VICINA * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const inArrivoVicine = consegne.filter(
    c => c.giorniDiRitardo === 0 && c.dataConsegna != null && c.dataConsegna <= limiteVicino
  );
  const senzaData = consegne.filter(c => c.dataConsegna == null);
  contatori.merceAttesa = consegne.length;
  contatori.merceInRitardo = inRitardo.length;
  contatori.merceSenzaDataConsegna = senzaData.length;
  const fattiMagazzino: FattoAnalisi[] = conResto(
    inRitardo.slice(0, CONSEGNE_MASSIME).map(c => ({
      chiave: `consegna:${c.prodottoId}:ritardo`,
      testo: `${c.fornitore}: «${c.nome}» per ${
        c.commessa ? `${c.commessa.codice ?? `commessa ${c.commessa.id}`} — ${c.commessa.cliente ?? "cliente non indicato"} (in «${c.commessa.stato}»)` : "nessuna commessa collegata"
      } doveva arrivare il ${c.dataConsegna} — ${c.giorniDiRitardo} giorni di ritardo${
        c.numeroOrdine ? ` (ordine ${c.numeroOrdine})` : ""
      }.`,
      entita: c.commessa ? [`commessa:${c.commessa.id}`] : [],
      link: c.commessa ? `/commesse/${c.commessa.id}` : "/fornitori",
    })),
    inRitardo.length,
    "consegne in ritardo",
    "/fornitori"
  );
  if (inArrivoVicine.length > 0) {
    fattiMagazzino.push({
      chiave: "consegne:vicine",
      testo: `${inArrivoVicine.length} consegne previste entro ${GIORNI_CONSEGNA_VICINA} giorni${
        inArrivoVicine.length <= 4
          ? `: ${inArrivoVicine.map(c => `${c.fornitore} il ${c.dataConsegna}`).join("; ")}`
          : ""
      }.`,
      entita: inArrivoVicine
        .filter(c => c.commessa)
        .slice(0, 8)
        .map(c => `commessa:${c.commessa!.id}`),
      link: "/fornitori",
    });
  }
  if (senzaData.length > 0) {
    fattiMagazzino.push({
      chiave: "consegne:senza_data",
      testo: `${senzaData.length} righe di merce attesa senza data di consegna: non si può sapere se sono in ritardo.`,
      entita: [],
      link: "/fornitori",
    });
  }
  sezioni.push({
    chiave: "magazzino",
    titolo: "Merce ordinata: in ritardo e in arrivo (fa slittare le pose)",
    fatti: fattiMagazzino,
  });

  // 1-sexies. Documento contro dato: due verità che non coincidono. La
  // prima della lista è sempre la stessa — la merce arriva dopo la posa.
  const discordanze = deps.discordanze ? deps.discordanze(sedeId, adesso) : [];
  contatori.discordanze = discordanze.length;
  contatori.discordanzeCritiche = discordanze.filter(d => d.gravita === "critica").length;
  sezioni.push({
    chiave: "discordanze",
    titolo: "Documento e dato non coincidono (due verità, una sbagliata)",
    fatti: discordanze.slice(0, GATE_MASSIMI).map(d => ({
      chiave: d.chiave,
      testo: d.testo,
      entita: [`commessa:${d.commessaId}`],
      link: d.link,
      // Nasce dal confronto con un documento letto: chi decide apra il file.
      fiducia: "letta" as FiduciaFatto,
    })),
  });

  // 1-septies. Due versioni della stessa cosa nel fascicolo: chi apre può
  // prendere quella vecchia (punto 26 del piano 08/09/2026).
  const catene: FattoAnalisi[] = [];
  if (deps.documentiDi) {
    for (const c of commesse) {
      for (const catena of catenePerTipo(deps.documentiDi(c.id))) {
        catene.push({
          chiave: `commessa:${c.id}:versioni:${catena.tipo}`,
          testo: `${etichettaCommessa(c)}: nel fascicolo ci sono ${catena.superate.length + 1} documenti «${DOC_TIPO_LABEL[catena.tipo as keyof typeof DOC_TIPO_LABEL] ?? catena.tipo}» diversi fra loro. Vale l'ultimo, «${catena.vigente.nome}»: chi apre il fascicolo può prendere quello superato.`,
          entita: [`commessa:${c.id}`],
          link: `/commesse/${c.id}`,
        });
      }
    }
  }
  contatori.documentiConPiuVersioni = catene.length;
  sezioni.push({
    chiave: "versioni",
    titolo: "Documenti con più versioni (vale l'ultimo)",
    fatti: conResto(catene.slice(0, GATE_MASSIMI), catene.length, "commesse con documenti in più versioni", "/commesse"),
  });

  // 1-octies. Più lente del solito: la soglia non è inventata, è la mediana
  // di questa azienda su questo stato (punto 17 del piano 08/09/2026).
  const tempi = deps.tempi ? deps.tempi(sedeId, adesso) : null;
  const lente = tempi?.lente ?? [];
  contatori.piuLenteDelSolito = lente.length;
  sezioni.push({
    chiave: "lentezza",
    titolo: "Più lente del solito (mediana di questa azienda, non una soglia inventata)",
    fatti: conResto(
      lente.slice(0, GATE_MASSIMI).map(l => {
        const c = commesse.find(x => x.id === l.commessaId);
        return {
          chiave: `commessa:${l.commessaId}:lenta`,
          testo: `${c ? etichettaCommessa(c) : `Commessa ${l.commessaId}`}: in «${l.stato}» da ${l.giorni} giorni, la mediana di questa azienda è ${l.mediana} (su ${l.campione} passaggi osservati).`,
          entita: [`commessa:${l.commessaId}`],
          link: `/commesse/${l.commessaId}`,
        };
      }),
      lente.length,
      "commesse più lente del solito",
      "/commesse"
    ),
  });

  // 1-nonies. Margine sotto la soglia: SOLO il segnale. Le cifre non
  // entrano nel prompt — le mette il codice accanto alla proposta, e le
  // vede la sola direzione (decisione 08/09/2026).
  const posta = deps.posta ? deps.posta(sedeId) : new Map<number, PostaCommessa>();
  const sotto = [...posta.values()].filter(p => p.sottoMargine);
  contatori.commesseSottoMargine = sotto.length;
  contatori.margineNonCalcolabile = [...posta.values()].filter(p => p.datiIncompleti).length;
  sezioni.push({
    chiave: "margine",
    titolo: `Margine sotto la soglia del ${Math.round(sogliaMargine() * 100)}% (segnale, senza cifre)`,
    fatti: conResto(
      sotto.slice(0, GATE_MASSIMI).map(p => {
        const c = commesse.find(x => x.id === p.commessaId);
        return {
          chiave: `commessa:${p.commessaId}:margine`,
          testo: `${c ? etichettaCommessa(c) : `Commessa ${p.commessaId}`}: il margine è sotto la soglia. Le cifre sono nella scheda, qui non si scrivono.`,
          entita: [`commessa:${p.commessaId}`],
          link: `/commesse/${p.commessaId}`,
        };
      }),
      sotto.length,
      "commesse sotto la soglia di margine",
      "/commesse"
    ),
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
  const fattiFatture: FattoAnalisi[] = conResto(
    fattureNonCollegate.slice(0, FATTURE_MASSIME).map(f => ({
      chiave: `fattura:${f.id}:non_collegata`,
      testo: `Fattura n. ${f.numero} del ${f.data} — ${f.clienteNome}: non collegata a nessuna commessa.`,
      entita: [`fattura:${f.id}`],
      link: "/economia",
    })),
    fattureNonCollegate.length,
    "fatture non collegate",
    "/economia"
  );
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
            // Punto 18: agenda e magazzino non si parlavano. Per ogni posa
            // della settimana, se la merce c'è o no — è la domanda che si
            // fa il capo squadra la sera prima.
            ...interventi
              .filter(i => i.tipo === "posa")
              .slice(0, 6)
              .map(i => {
                const c = commesse.find(x => x.id === i.commessaId);
                const attese = consegne.filter(x => x.commessa?.id === i.commessaId);
                const mancanti = attese.length;
                return {
                  chiave: `intervento:${i.id}:merce`,
                  testo: `Posa del ${i.dataPianificata} — ${c ? etichettaCommessa(c) : `commessa ${i.commessaId}`}: ${
                    mancanti === 0
                      ? "la merce attesa risulta tutta arrivata"
                      : `${mancanti} ${mancanti === 1 ? "riga" : "righe"} di merce non ancora arrivata${
                          attese.some(x => x.giorniDiRitardo > 0) ? ", e almeno una è già in ritardo" : ""
                        }`
                  }.`,
                  entita: [`intervento:${i.id}`, ...(c ? [`commessa:${c.id}`] : [])],
                  link: c ? `/commesse/${c.id}` : "/planning",
                };
              }),
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

  // ── In testa: prima di tutto, cosa non vedo e cosa è cambiato ────────
  //
  // 0-bis. Le fonti mute. Se la posta è ferma da tre giorni non entra
  // niente, e una fotografia che conta solo ciò che è entrato scrive
  // «tutto calmo»: l'unico difetto che mente in modo rassicurante.
  const guasti = deps.guasti ? deps.guasti(sedeId, adesso) : [];
  contatori.fontiCieche = guasti.filter(g => g.gravita === "ferma").length;
  contatori.fontiRallentate = guasti.filter(g => g.gravita === "rallentata").length;

  // 0-ter. La derivata: un numero da solo non dice niente.
  const derivata: FattoAnalisi[] = [];
  if (input.contatoriPrecedenti) {
    const ieri = input.contatoriPrecedenti;
    for (const [chiave, etichetta] of CONTATORI_CONFRONTATI) {
      const oggi = contatori[chiave];
      const prima = ieri[chiave];
      if (typeof oggi !== "number" || typeof prima !== "number") continue;
      const delta = oggi - prima;
      if (delta === 0) continue;
      derivata.push({
        chiave: `derivata:${chiave}`,
        testo: `${etichetta}: ${oggi} (${delta > 0 ? "+" : ""}${delta} rispetto all'ultima analisi, erano ${prima}).`,
        entita: [],
        link: null,
      });
    }
  }

  const testa: SezioneFotografia[] = [];
  if (guasti.length > 0) {
    testa.push({
      chiave: "guasti",
      titolo: "Occhi chiusi: fonti mute o in errore (leggere PRIMA di dire che va tutto bene)",
      fatti: guasti.map(g => ({
        chiave: g.chiave,
        testo: g.testo,
        entita: [],
        link: g.link,
      })),
    });
  }
  if (derivata.length > 0) {
    testa.push({
      chiave: "derivata",
      titolo: "Cosa è cambiato dall'ultima analisi (la variazione, non il livello)",
      fatti: derivata,
    });
  }
  sezioni.unshift(...testa);

  return {
    sedeId,
    generataIl: adesso.toISOString(),
    contatori,
    sezioni,
    postaInGioco: postaPerEntita(posta),
  };
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

/**
 * Quanto è solido ogni riferimento: la fiducia PIÙ DEBOLE fra i fatti che
 * lo citano. Una commessa che compare sia in un fatto certo sia in una
 * lettura da verificare resta da verificare (punto 23 del piano).
 */
export function fiduciaDellaFotografia(
  fotografia: FotografiaAzienda
): Map<string, FiduciaFatto> {
  const peso: Record<FiduciaFatto, number> = { certa: 0, letta: 1, da_verificare: 2 };
  const mappa = new Map<string, FiduciaFatto>();
  for (const sezione of fotografia.sezioni) {
    for (const fatto of sezione.fatti) {
      const fiducia = fatto.fiducia ?? "certa";
      for (const rif of fatto.entita) {
        const attuale = mappa.get(rif) ?? "certa";
        if (peso[fiducia] > peso[attuale]) mappa.set(rif, fiducia);
        else if (!mappa.has(rif)) mappa.set(rif, attuale);
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
    // La chiave accanto al titolo: è quella che una proposta dichiara come
    // `fonte`, e senza vederla il modello non potrebbe citarla (punto 12).
    righe.push(`## [${sezione.chiave}] ${sezione.titolo}`);
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
