// server/fatture/emissione.ts
// L'emissione della fattura su Fatture in Cloud: una sequenza di passi
// ripetibile senza danno. Ogni passo guarda lo stato salvato prima di
// agire — cliente già collegato, documento già creato, XML già
// archiviato — così una ripresa dopo un errore riparte dal primo passo
// mancante invece di rifare tutto. Su Fatture in Cloud non si cancella
// mai nulla: un documento creato resta, e il secondo giro lo rilegge.
//
// Cosa NON vive qui: le regole di dominio (validazioni, limiti, totali)
// stanno in `servizio.ts` e nel risolutore; il trasporto HTTP sta in
// `server/fic/emissione.ts`. Questo modulo è solo la coreografia, e ogni
// effetto che produce lascia un evento.
//
// Prefissi degli errori (il router li mappa su codici tRPC, Task 13):
//   NOT_FOUND:     la fattura non esiste — o è di un'altra sede
//   PRECONDIZIONE: la validazione non passa, o lo stato non è di partenza
//   CONFLITTO:     revisione superata (qualcuno ha modificato la bozza)
//   EMISSIONE:     un passo bloccante è fallito (`EMISSIONE: <passo>: …`)
import { DICITURE } from "@shared/fatturazione/diciture";
import { centToEuro } from "@shared/euroCent";
import type {
  ClienteSnapshot,
  Fattura,
  FatturazioneConfig,
  RigaFattura,
  TipoEvento,
} from "@shared/fatturazione/tipi";
import { putFile, sha256Hex } from "../_core/fileStorage";
import {
  creaClientFicEmissione,
  type ClienteFicInput,
  type ClientFicEmissione,
  type ContestoFic,
  type DocumentoFicCreato,
  type DocumentoFicInput,
} from "../fic/emissione";
import { getClienteById, saveClientiStore } from "../routers/clienti";
import { getCommessaById } from "../routers/commesse";
import { accessTokenFic, getCfg } from "../routers/fattureInCloud";
import { registraDocumentoFatturaCrm } from "../routers/preventiviContratti";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { allineaTimelineAlBoard } from "../routers/timeline";
import { getUtentiStore } from "../routers/utenti";
import { sdiDryRun } from "./dryRun";
import { getFattureRepository, type FattureRepository } from "./repository";
import { validaPerEmissione } from "./servizio";

export type PassoEmissione =
  | "validazione"
  | "cliente_fic"
  | "documento_fic"
  | "confronto_totali"
  | "xml"
  | "invio"
  | "archivio"
  | "documento_fascicolo"
  | "timeline";

export type EsitoPasso = {
  passo: PassoEmissione;
  esito: "fatto" | "saltato" | "errore";
  dettaglio: string | null;
};

/**
 * Tutto ciò che l'emissione tocca fuori da sé, iniettabile. `contesto` e
 * `timeline` non erano nel piano: senza il primo un test dovrebbe avere
 * un token FiC valido per sede, senza il secondo non si può provare che
 * la timeline è stata davvero allineata (in memoria le tappe non esistono
 * finché qualcuno non apre la commessa). Task 10 (sonda) riusa lo stesso
 * tipo per ritentare l'archivio mancante.
 */
export type DipendenzeEmissione = {
  client?: ClientFicEmissione;
  repository?: FattureRepository;
  now?: () => Date;
  dryRun?: () => boolean;
  storage?: { putFile: typeof putFile };
  salvaFicEntityId?: (clienteId: number, ficEntityId: number) => void;
  contesto?: (sedeId: number) => Promise<ContestoFic>;
  timeline?: typeof allineaTimelineAlBoard;
};

/** Gli stati da cui l'emissione può partire o ripartire. */
const STATI_DI_PARTENZA = new Set<Fattura["stato"]>([
  "bozza",
  "in_emissione",
  "emessa",
  "inviata",
]);

/** Scarto ammesso per campo nel confronto con i totali di Fatture in Cloud. */
const TOLLERANZA_CENT = 1;

function repo(dip?: DipendenzeEmissione): FattureRepository {
  return dip?.repository ?? getFattureRepository();
}

function messaggio(errore: unknown): string {
  const testo = String((errore as any)?.message ?? errore ?? "").trim();
  return testo || "errore sconosciuto";
}

/** Il giorno di calendario in ISO, per la data della fattura senza `data`. */
function isoDi(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Un numero come «127/2026» non può diventare un nome di file. */
function numeroPerFile(numero: string | null, ficDocumentId: number): string {
  const pulito = (numero ?? "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return pulito || `fattura-${ficDocumentId}`;
}

/** Ogni effetto lascia un evento: qui la forma, sempre la stessa. */
function appendiEvento(
  repository: FattureRepository,
  sedeId: number,
  fatturaId: number,
  actorUserId: number | null,
  tipo: TipoEvento,
  payload: Record<string, unknown>
): Promise<unknown> {
  return repository.appendEvento({
    fatturaId,
    sedeId,
    tipo,
    payload,
    actorUserId,
  });
}

const normalizza = (v: string | null | undefined): string =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();

/**
 * Azienda e token di Fatture in Cloud per la sede. Il token non compare
 * mai nei log né negli eventi: viaggia solo dentro il `ContestoFic`.
 */
export async function contestoFicPerSede(sedeId: number): Promise<ContestoFic> {
  const cfg = getCfg(sedeId);
  const token = cfg.companyId ? await accessTokenFic(cfg) : null;
  if (!token || !cfg.companyId) {
    throw new Error(
      "PRECONDIZIONE: Fatture in Cloud non è collegato per questa sede: collega l'account e seleziona l'azienda."
    );
  }
  return { companyId: cfg.companyId, token };
}

// ── Costruzione del payload FiC ─────────────────────────────────────────

/**
 * Il cliente come lo vuole Fatture in Cloud. I privati sono `person` e
 * pretendono nome e cognome separati: lo snapshot li tiene uniti nella
 * convenzione del CRM («Cognome Nome»), quindi si divide al primo spazio
 * — cognome la prima parola, nome tutto il resto. Aziende, condomini ed
 * enti restano `company` con la denominazione indivisa.
 */
export function costruisciClienteFic(s: ClienteSnapshot): ClienteFicInput {
  const base = {
    name: s.nome,
    tax_code: s.codiceFiscale,
    address_street: s.indirizzo,
    address_postal_code: s.cap,
    address_city: s.citta,
    address_province: s.provincia,
    country: "Italia",
    email: s.email,
    certified_email: s.pec,
    ei_code: s.codiceDestinatario,
    e_invoice: true,
  } satisfies Omit<ClienteFicInput, "type">;

  const parti = s.nome.trim().split(/\s+/).filter(Boolean);
  if (s.tipo === "privato" && parti.length >= 2) {
    return {
      ...base,
      type: "person",
      last_name: parti[0],
      first_name: parti.slice(1).join(" "),
      vat_number: s.partitaIva,
    };
  }
  // Un privato registrato con una parola sola non si può spezzare: FiC
  // rifiuta una `person` senza nome proprio, e un'anagrafica indivisa
  // vale più di una creazione respinta a metà emissione.
  return { ...base, type: "company", vat_number: s.partitaIva };
}

/**
 * Le note stampate in fattura: le diciture scelte, l'indirizzo del
 * cantiere (obbligatorio con la detrazione), le righe `nota` della bozza
 * — il calcolo del limite di spesa, che in fattura è testo e non una voce
 * — le note libere di chi fattura e il footer della sede.
 */
export function noteFattura(f: Fattura, config: FatturazioneConfig): string {
  const blocchi: Array<string | null> = [
    ...f.diciture.map(
      chiave => (DICITURE as Record<string, string>)[chiave] ?? null
    ),
    f.intestazioneCantiere,
    ...f.righe.filter(r => r.tipo === "nota").map(r => r.descrizione),
    f.note,
    config.dicituraFooter,
  ];
  return blocchi
    .map(b => (b ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Una riga della bozza diventa una voce FiC. Le intestazioni non hanno
 * importo né aliquota, ma Fatture in Cloud non conosce righe senza IVA:
 * diventano voci a zero con l'aliquota ordinaria, come nelle fatture
 * reali dove compaiono come righe descrittive. La prima riga della
 * descrizione fa da `name`, il resto da `description`.
 */
function voceDaRiga(
  r: RigaFattura,
  config: FatturazioneConfig
): DocumentoFicInput["items_list"][number] {
  const aliquota = r.aliquota ?? 22;
  const vatId = config.vatIdsFic[aliquota];
  if (vatId == null) {
    throw new Error(
      `Aliquota IVA ${aliquota} % non configurata su Fatture in Cloud: completa Impostazioni → Fatturazione.`
    );
  }
  const righe = r.descrizione.split("\n");
  const voce: DocumentoFicInput["items_list"][number] = {
    name: righe[0] ?? "",
    qty: 1,
    net_price: centToEuro(r.importoCent),
    vat: { id: vatId },
  };
  const resto = righe.slice(1).join("\n").trim();
  if (resto) voce.description = resto;
  return voce;
}

export function costruisciDocumentoFic(
  f: Fattura,
  config: FatturazioneConfig,
  ficEntityId: number,
  commessaCodice: string,
  oggi?: string
): DocumentoFicInput {
  const documento: DocumentoFicInput = {
    type: f.tipo === "nota_credito" ? "credit_note" : "invoice",
    entity: { id: ficEntityId },
    date: f.data ?? oggi ?? isoDi(new Date()),
    visible_subject: commessaCodice,
    notes: noteFattura(f, config),
    items_list: f.righe
      .filter(r => r.tipo !== "nota")
      .map(r => voceDaRiga(r, config)),
    payments_list: f.scadenze.map(s => ({
      amount: centToEuro(s.importoCent),
      due_date: s.data,
      status: "not_paid" as const,
      ...(config.paymentAccountIdFic != null
        ? { payment_account: { id: config.paymentAccountIdFic } }
        : {}),
    })),
    e_invoice: true,
    ei_data: {
      payment_method: config.metodoPagamento,
      ...(config.iban ? { bank_iban: config.iban } : {}),
      ...(config.banca ? { bank_name: config.banca } : {}),
      ...(config.intestatario ? { bank_beneficiary: config.intestatario } : {}),
    },
    show_payments: true,
    show_payment_method: true,
  };
  if (config.numerazioneFic) documento.numeration = config.numerazioneFic;
  return documento;
}

/**
 * Appaia i pagamenti FiC alle scadenze del CRM per indice: `fix_payments`
 * può ricalcolare gli importi, non riordinare la lista che gli abbiamo
 * mandato. Tocca solo le scadenze ancora senza `ficPaymentId`, così una
 * ripresa ripara quello che manca invece di riscrivere quello che c'è.
 *
 * Se i due elenchi non hanno la stessa lunghezza il collegamento resta
 * parziale: non è un errore che ferma l'emissione (la fattura su FiC è
 * quella giusta), ma va detto, o i pagamenti registrati su FiC non
 * torneranno mai su tutte le scadenze del CRM.
 */
async function appaiaPagamenti(
  repository: FattureRepository,
  sedeId: number,
  fattura: Fattura,
  pagamenti: DocumentoFicCreato["payments_list"]
): Promise<{ fattura: Fattura; appaiate: number; problema: string | null }> {
  let appaiate = 0;
  for (const [i, pagamento] of pagamenti.entries()) {
    const scadenza = fattura.scadenze[i];
    if (!scadenza) break;
    if (scadenza.ficPaymentId != null) continue;
    await repository.aggiornaScadenza({
      sedeId,
      fatturaId: fattura.id,
      numero: scadenza.numero,
      patch: { ficPaymentId: pagamento.id },
    });
    appaiate++;
  }
  const problema =
    pagamenti.length === fattura.scadenze.length
      ? null
      : `FiC ha restituito ${pagamenti.length} scadenze, il CRM ne ha ${fattura.scadenze.length}: verifica il piano di pagamento.`;
  return {
    fattura:
      appaiate > 0 ? (await repository.perId(sedeId, fattura.id))! : fattura,
    appaiate,
    problema,
  };
}

/** «127» + «/2026» dalla numerazione FiC, o «127/2026» dall'anno della data. */
function numeroDocumento(doc: DocumentoFicCreato, now: Date): string {
  if (doc.numeration) return `${doc.number}${doc.numeration}`;
  const anno = /^\d{4}/.test(doc.date)
    ? doc.date.slice(0, 4)
    : String(now.getFullYear());
  return `${doc.number}/${anno}`;
}

// ── La pipeline ─────────────────────────────────────────────────────────

export async function emettiFattura(
  input: {
    sedeId: number;
    id: number;
    actorUserId: number | null;
    revisione: number;
  } & DipendenzeEmissione
): Promise<{ fattura: Fattura; passi: EsitoPasso[] }> {
  const repository = repo(input);
  const now = input.now?.() ?? new Date();
  const dryRun = input.dryRun ?? sdiDryRun;
  const client = input.client ?? creaClientFicEmissione();
  const allineaTimeline = input.timeline ?? allineaTimelineAlBoard;
  const passi: EsitoPasso[] = [];
  // Quello che non ferma l'emissione ma va detto: finisce in `eiErrore`
  // a fine giro e nei messaggi di stop dei passi 4 e 5.
  const problemi: string[] = [];
  const segna = (
    passo: PassoEmissione,
    esito: EsitoPasso["esito"],
    dettaglio: string | null = null
  ) => {
    passi.push({ passo, esito, dettaglio });
  };

  const eventoDi = (
    fatturaId: number,
    tipo: TipoEvento,
    payload: Record<string, unknown>
  ) =>
    appendiEvento(
      repository,
      input.sedeId,
      fatturaId,
      input.actorUserId,
      tipo,
      payload
    );

  // ── 1. validazione ────────────────────────────────────────────────────
  // `validaPerEmissione` filtra già per sede: una fattura di un'altra
  // sede non esiste, e non si deve poter dedurre il contrario.
  const validazione = await validaPerEmissione(input.sedeId, input.id, {
    repository,
    now: () => now,
  });
  let fattura = validazione.fattura;

  if (!STATI_DI_PARTENZA.has(fattura.stato)) {
    throw new Error(
      `PRECONDIZIONE: la fattura #${fattura.id} è in stato «${fattura.stato}»: l'emissione non riparte da qui.`
    );
  }
  if (!validazione.emettibile) {
    const primo = validazione.controlli.find(c => c.esito === "errore")!;
    throw new Error(`PRECONDIZIONE: ${primo.messaggio}`);
  }
  // `validaPerEmissione` lo dichiara già errore, ma il tipo resta
  // nullable: senza snapshot non c'è cliente da collegare a FiC.
  if (!fattura.clienteSnapshot) {
    throw new Error(
      "PRECONDIZIONE: Fattura senza anagrafica cliente: rigenera la bozza."
    );
  }

  const commessa: any = getCommessaById(fattura.commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== input.sedeId) {
    throw new Error("NOT_FOUND: Commessa non trovata.");
  }
  const config = await repository.config(input.sedeId);

  // Blocco ottimistico solo alla partenza: da `in_emissione` in poi i
  // passi sono idempotenti per stato e una ripresa non deve pretendere di
  // nuovo la revisione (Ruling R1). Prima del contesto FiC: una richiesta
  // già superata non deve nemmeno far rinnovare un token.
  if (fattura.stato === "bozza" && fattura.revisione !== input.revisione) {
    throw new Error(
      "CONFLITTO: la fattura è stata modificata da un'altra sessione, ricarica."
    );
  }

  // Azienda e token prima di toccare lo stato: senza collegamento FiC la
  // fattura non deve nemmeno passare a «in_emissione».
  const ctx = await (input.contesto ?? contestoFicPerSede)(input.sedeId);

  if (fattura.stato === "bozza") {
    fattura = await repository.aggiornaStato({
      sedeId: input.sedeId,
      id: fattura.id,
      patch: {
        stato: "in_emissione",
        emessaDa: input.actorUserId,
        revisione: fattura.revisione + 1,
        eiErrore: null,
      },
      now,
    });
    await eventoDi(fattura.id, "emissione_avviata", {
      revisione: fattura.revisione,
    });
    segna("validazione", "fatto");
  } else {
    segna("validazione", "saltato", `ripresa da «${fattura.stato}»`);
  }

  /** Un passo bloccante: l'errore diventa `EMISSIONE: <passo>: …`. */
  const bloccante = async <T>(
    passo: PassoEmissione,
    azione: () => Promise<T>
  ): Promise<T> => {
    try {
      return await azione();
    } catch (errore) {
      const testo = messaggio(errore);
      segna(passo, "errore", testo);
      try {
        fattura = await repository.aggiornaStato({
          sedeId: input.sedeId,
          id: fattura.id,
          patch: { eiErrore: `${passo}: ${testo}` },
          now,
        });
      } catch {
        // Se anche la scrittura dell'errore fallisce, resta l'eccezione
        // originale: è quella che descrive il guasto.
      }
      throw new Error(`EMISSIONE: ${passo}: ${testo}`);
    }
  };

  // ── 2. cliente su Fatture in Cloud ────────────────────────────────────
  let ficEntityId = fattura.clienteSnapshot?.ficEntityId ?? null;
  if (ficEntityId != null) {
    segna("cliente_fic", "saltato", `già collegato (#${ficEntityId})`);
  } else {
    ficEntityId = await bloccante("cliente_fic", async () => {
      const snapshot = fattura.clienteSnapshot!;
      const cf = normalizza(snapshot.codiceFiscale);
      const piva = normalizza(snapshot.partitaIva);
      const q = snapshot.tipo === "privato" ? cf || piva : piva || cf;
      let trovato: number | null = null;
      if (q) {
        const candidati = await client.cercaClienti(ctx, q);
        const uguale = candidati.find(
          c =>
            (cf && normalizza(c.tax_code) === cf) ||
            (piva && normalizza(c.vat_number) === piva)
        );
        trovato = uguale ? uguale.id : null;
      }
      const creato = trovato == null;
      const id = creato
        ? (await client.creaCliente(ctx, costruisciClienteFic(snapshot))).id
        : trovato!;

      fattura = await repository.aggiornaStato({
        sedeId: input.sedeId,
        id: fattura.id,
        patch: { clienteSnapshot: { ...snapshot, ficEntityId: id } },
        now,
      });
      if (snapshot.clienteId != null) {
        (input.salvaFicEntityId ?? salvaFicEntityIdSulCliente)(
          snapshot.clienteId,
          id
        );
      }
      await eventoDi(fattura.id, "cliente_fic", {
        ficEntityId: id,
        creato,
      });
      segna("cliente_fic", "fatto", creato ? "creato" : "trovato");
      return id;
    });
  }

  // ── 3. documento su Fatture in Cloud ──────────────────────────────────
  // Il documento si crea una volta sola. Si rilegge quando serve al
  // confronto dei totali (finché la fattura è «in_emissione») oppure
  // quando c'è un appaiamento di scadenze da riparare (Ruling R12).
  const confrontoDaFare = fattura.stato === "in_emissione";
  let documento: DocumentoFicCreato | null = null;
  let creato: DocumentoFicCreato | null = null;

  if (fattura.ficDocumentId == null) {
    creato = await bloccante("documento_fic", async () => {
      const nuovo = await client.creaDocumento(
        ctx,
        costruisciDocumentoFic(
          fattura,
          config,
          ficEntityId!,
          String(commessa.codice ?? ""),
          isoDi(now)
        ),
        { fix_payments: true }
      );
      fattura = await repository.aggiornaStato({
        sedeId: input.sedeId,
        id: fattura.id,
        patch: {
          ficDocumentId: nuovo.id,
          numero: numeroDocumento(nuovo, now),
          data: nuovo.date || fattura.data,
          eiStatusFic: nuovo.ei_status,
        },
        now,
      });
      return nuovo;
    });
    documento = creato;
  } else if (confrontoDaFare) {
    // La rilettura sta dentro `bloccante`: se fallisce, l'errore è già
    // segnato e non deve restare anche un secondo esito per lo stesso
    // passo — per questo l'esito «saltato» si scrive più in basso.
    documento = await bloccante("documento_fic", () =>
      client.leggiDocumento(ctx, fattura.ficDocumentId!)
    );
  }

  // Appaiamento delle scadenze ai pagamenti FiC: si tenta a OGNI giro
  // finché resta una scadenza scollegata, non solo finché la fattura è
  // «in_emissione» (Ruling R12). Un'interruzione fra la creazione del
  // documento e la scrittura degli id lascerebbe altrimenti le scadenze
  // orfane per sempre, e il disallineamento sparirebbe da `eiErrore` al
  // primo giro di archivio riuscito. Se sono già tutte appaiate non si
  // rilegge niente: nessuna chiamata a FiC in più.
  let appaiate = 0;
  let problemaScadenze: string | null = null;
  const daRiappaiare = fattura.scadenze.some(s => s.ficPaymentId == null);
  if (fattura.ficDocumentId != null && daRiappaiare) {
    if (!documento) {
      documento = await bloccante("documento_fic", () =>
        client.leggiDocumento(ctx, fattura.ficDocumentId!)
      );
    }
    const appaiamento = await appaiaPagamenti(
      repository,
      input.sedeId,
      fattura,
      documento.payments_list
    );
    fattura = appaiamento.fattura;
    appaiate = appaiamento.appaiate;
    problemaScadenze = appaiamento.problema;
    if (problemaScadenze) problemi.push(problemaScadenze);
  }

  if (creato) {
    await eventoDi(fattura.id, "creata_fic", {
      ficDocumentId: creato.id,
      numero: fattura.numero,
      amount_gross: creato.amount_gross,
      scadenzeAppaiate: appaiate,
    });
    segna(
      "documento_fic",
      "fatto",
      [fattura.numero, problemaScadenze].filter(Boolean).join(" · ")
    );
  } else {
    segna(
      "documento_fic",
      "saltato",
      [
        `già creato (#${fattura.ficDocumentId})`,
        daRiappaiare
          ? appaiate > 0
            ? `${appaiate} scadenze riappaiate`
            : "riappaiamento tentato"
          : null,
        problemaScadenze,
      ]
        .filter(Boolean)
        .join(" · ")
    );
  }

  // ── 4. confronto dei totali ───────────────────────────────────────────
  if (!confrontoDaFare) {
    segna("confronto_totali", "saltato", `stato «${fattura.stato}»`);
  } else {
    const doc = documento!;
    const fic = {
      imponibileCent: Math.round(doc.amount_net * 100),
      ivaCent: Math.round(doc.amount_vat * 100),
      totaleCent: Math.round(doc.amount_gross * 100),
    };
    const nostri = {
      imponibileCent: fattura.imponibileCent,
      ivaCent: fattura.ivaCent,
      totaleCent: fattura.totaleCent,
    };
    const scarto = (a: number, b: number) => Math.abs(a - b) > TOLLERANZA_CENT;
    if (
      scarto(fic.imponibileCent, nostri.imponibileCent) ||
      scarto(fic.ivaCent, nostri.ivaCent) ||
      scarto(fic.totaleCent, nostri.totaleCent)
    ) {
      const testo =
        `Totali FiC diversi dai nostri: imponibile ${centToEuro(fic.imponibileCent)} ` +
        `contro ${centToEuro(nostri.imponibileCent)}, IVA ${centToEuro(fic.ivaCent)} ` +
        `contro ${centToEuro(nostri.ivaCent)}, totale ${centToEuro(fic.totaleCent)} ` +
        `contro ${centToEuro(nostri.totaleCent)}.`;
      fattura = await repository.aggiornaStato({
        sedeId: input.sedeId,
        id: fattura.id,
        patch: { eiErrore: [...problemi, testo].join(" ") },
        now,
      });
      await eventoDi(fattura.id, "errore_totali", { nostri, fic });
      segna("confronto_totali", "errore", testo);
      // Ci si ferma qui: il documento su FiC esiste già e alla ripresa
      // verrà riletto, non ricreato.
      return { fattura, passi };
    }
    fattura = await repository.aggiornaStato({
      sedeId: input.sedeId,
      id: fattura.id,
      patch: { stato: "emessa", emessaAt: now, eiErrore: null },
      now,
    });
    segna("confronto_totali", "fatto");
  }

  const ficDocumentId = fattura.ficDocumentId!;

  // ── 5. verifica dell'XML ──────────────────────────────────────────────
  // Si salta solo dopo l'invio vero: dopo un giro in dry-run l'XML si
  // riverifica: è una GET senza effetti, e all'accensione dell'invio
  // reale il documento potrebbe non essere più quello di allora.
  if (fattura.stato === "inviata") {
    segna("xml", "saltato", "già inviata allo SdI");
  } else {
    const verifica = await bloccante("xml", () =>
      client.verificaXml(ctx, ficDocumentId)
    );
    if (!verifica.success) {
      const testo = `XML non valido: ${verifica.errori.join(" · ")}`;
      fattura = await repository.aggiornaStato({
        sedeId: input.sedeId,
        id: fattura.id,
        patch: { eiErrore: [...problemi, testo].join(" ") },
        now,
      });
      await eventoDi(fattura.id, "xml_errore", { errori: verifica.errori });
      segna("xml", "errore", testo);
      // Niente invio con un XML che lo SdI scarterebbe.
      return { fattura, passi };
    }
    await eventoDi(fattura.id, "xml_ok", {});
    segna("xml", "fatto");
  }

  // ── 6. invio allo SdI ─────────────────────────────────────────────────
  const inProva = dryRun();
  if (fattura.stato === "inviata") {
    segna("invio", "saltato", "già inviata allo SdI");
  } else if (fattura.inviataDryRun && inProva) {
    segna("invio", "saltato", "già inviata in prova");
  } else {
    await bloccante("invio", async () => {
      const esito = await client.inviaEInvoice(ctx, ficDocumentId, {
        dry_run: inProva,
      });
      fattura = await repository.aggiornaStato({
        sedeId: input.sedeId,
        id: fattura.id,
        patch: inProva
          ? { inviataDryRun: true, eiErrore: null }
          : { stato: "inviata", inviataDryRun: false, eiErrore: null },
        now,
      });
      await eventoDi(fattura.id, "inviata", {
        dryRun: inProva,
        date: esito.date,
      });
      segna("invio", "fatto", inProva ? "prova (dry-run)" : "inviata allo SdI");
    });
  }

  // ── 7 e 8. archivio XML/PDF e documento nel fascicolo ─────────────────
  const archivio = await archiviaFattura({
    ...input,
    fattura,
    ctx,
    repository,
    client,
    now: () => now,
  });
  fattura = archivio.fattura;
  problemi.push(...archivio.problemi);
  passi.push(...archivio.passi);

  // ── 9. timeline ───────────────────────────────────────────────────────
  try {
    const completate = allineaTimeline(
      fattura.commessaId,
      String(commessa.stato ?? ""),
      nomeUtente(input.actorUserId)
    );
    segna("timeline", "fatto", `${completate} tappe completate`);
  } catch (errore) {
    segna("timeline", "errore", messaggio(errore));
  }

  // Sempre scritto, anche quando non c'è niente da dire: un archivio
  // ritentato con successo deve cancellare l'errore del giro precedente,
  // non lasciarlo lì a spaventare chi legge la fattura.
  fattura = await repository.aggiornaStato({
    sedeId: input.sedeId,
    id: fattura.id,
    patch: { eiErrore: problemi.length > 0 ? problemi.join(" ") : null },
    now,
  });

  return { fattura, passi };
}

/**
 * Passi 7 e 8: XML e PDF nello storage, PDF nel fascicolo della commessa.
 * Vive fuori da `emettiFattura` perché la sonda (Task 10) li ritenta da
 * sola quando trova una fattura emessa senza archivio, con le stesse
 * dipendenze e la stessa idempotenza (quello che c'è già non si riscarica).
 *
 * Niente qui è bloccante: la fattura è già su Fatture in Cloud, e far
 * fallire la chiamata direbbe all'utente il contrario. I guasti tornano
 * in `problemi` (che il chiamante mette in `eiErrore`) e negli eventi.
 */
export async function archiviaFattura(
  input: {
    sedeId: number;
    fattura: Fattura;
    actorUserId: number | null;
    ctx?: ContestoFic;
  } & DipendenzeEmissione
): Promise<{ fattura: Fattura; passi: EsitoPasso[]; problemi: string[] }> {
  const repository = repo(input);
  const now = input.now?.() ?? new Date();
  const client = input.client ?? creaClientFicEmissione();
  const archivia = input.storage?.putFile ?? putFile;
  const ctx =
    input.ctx ?? (await (input.contesto ?? contestoFicPerSede)(input.sedeId));

  let fattura = input.fattura;
  const passi: EsitoPasso[] = [];
  const problemi: string[] = [];
  const ficDocumentId = fattura.ficDocumentId;
  if (ficDocumentId == null) {
    return {
      fattura,
      passi: [
        {
          passo: "archivio",
          esito: "saltato",
          dettaglio: "nessun documento FiC",
        },
        { passo: "documento_fascicolo", esito: "saltato", dettaglio: null },
      ],
      problemi,
    };
  }
  const eventoDi = (tipo: TipoEvento, payload: Record<string, unknown>) =>
    appendiEvento(
      repository,
      input.sedeId,
      fattura.id,
      input.actorUserId,
      tipo,
      payload
    );
  const nomeFile = numeroPerFile(fattura.numero, ficDocumentId);
  let pdf: Buffer | null = null;
  /** Quanti file sono finiti davvero nello storage in questo giro. */
  let scritti = 0;

  if (!fattura.xmlStorageKey) {
    try {
      const bytes = await client.scaricaXml(ctx, ficDocumentId);
      const salvato = await archivia(
        "fatture_xml",
        fattura.commessaId,
        fattura.id,
        `${nomeFile}.xml`,
        bytes,
        "application/xml"
      );
      fattura = await repository.aggiornaStato({
        sedeId: input.sedeId,
        id: fattura.id,
        patch: {
          xmlStorageKey: salvato.storageKey,
          xmlSha256: sha256Hex(bytes),
        },
        now,
      });
      scritti++;
      await eventoDi("xml_archiviato", {
        storageKey: salvato.storageKey,
        sha256: fattura.xmlSha256,
      });
    } catch (errore) {
      const testo = messaggio(errore);
      problemi.push(`XML non archiviato: ${testo}`);
      await eventoDi("xml_archiviato", { errore: testo });
    }
  }

  // Il PDF serve anche al fascicolo: si riscarica se manca l'archivio
  // oppure il documento della commessa.
  if (!fattura.pdfStorageKey || !fattura.documentoId) {
    try {
      pdf = await client.scaricaPdf(ctx, ficDocumentId);
      if (!fattura.pdfStorageKey) {
        const salvato = await archivia(
          "fatture_pdf",
          fattura.commessaId,
          fattura.id,
          `${nomeFile}.pdf`,
          pdf,
          "application/pdf"
        );
        fattura = await repository.aggiornaStato({
          sedeId: input.sedeId,
          id: fattura.id,
          patch: { pdfStorageKey: salvato.storageKey },
          now,
        });
        scritti++;
        await eventoDi("pdf_archiviato", { storageKey: salvato.storageKey });
      }
    } catch (errore) {
      const testo = messaggio(errore);
      problemi.push(`PDF non archiviato: ${testo}`);
      await eventoDi("pdf_archiviato", { errore: testo });
    }
  }

  if (problemi.length > 0) {
    passi.push({
      passo: "archivio",
      esito: "errore",
      dettaglio: problemi.join(" "),
    });
  } else if (scritti > 0) {
    passi.push({
      passo: "archivio",
      esito: "fatto",
      dettaglio: `${scritti} file archiviati`,
    });
  } else {
    passi.push({
      passo: "archivio",
      esito: "saltato",
      dettaglio: "archivio già completo",
    });
  }

  // È il PDF che soddisfa il gate documentale «fattura» di
  // `fatture_pagamento`: senza, la commessa non avanza.
  if (fattura.documentoId != null) {
    passi.push({
      passo: "documento_fascicolo",
      esito: "saltato",
      dettaglio: "già nel fascicolo",
    });
  } else if (!pdf) {
    const testo =
      "PDF non disponibile: il documento non è entrato nel fascicolo.";
    problemi.push(testo);
    passi.push({
      passo: "documento_fascicolo",
      esito: "errore",
      dettaglio: testo,
    });
  } else {
    try {
      const doc = await registraDocumentoFatturaCrm({
        sedeId: input.sedeId,
        commessaId: fattura.commessaId,
        fatturaId: fattura.id,
        numero: fattura.numero ?? nomeFile,
        tipo: fattura.tipo,
        pdf,
        createdBy: input.actorUserId,
      });
      fattura = await repository.aggiornaStato({
        sedeId: input.sedeId,
        id: fattura.id,
        patch: { documentoId: doc.id },
        now,
      });
      passi.push({
        passo: "documento_fascicolo",
        esito: "fatto",
        dettaglio: doc.nome,
      });
    } catch (errore) {
      const testo = messaggio(errore);
      problemi.push(`Documento non archiviato nel fascicolo: ${testo}`);
      passi.push({
        passo: "documento_fascicolo",
        esito: "errore",
        dettaglio: testo,
      });
    }
  }

  return { fattura, passi, problemi };
}

/** Il nome dell'attore per la timeline, come nel registro delle conferme. */
function nomeUtente(id: number | null): string | null {
  if (id == null) return null;
  const u = (getUtentiStore() as any[]).find(x => x.id === id);
  return u ? `${u.nome ?? ""} ${u.cognome ?? ""}`.trim() || null : null;
}

/**
 * L'id del cliente su Fatture in Cloud finisce anche sull'anagrafica CRM:
 * la prossima fattura dello stesso cliente non lo cerca più.
 */
function salvaFicEntityIdSulCliente(
  clienteId: number,
  ficEntityId: number
): void {
  const cliente: any = getClienteById(clienteId);
  if (!cliente || cliente.ficEntityId === ficEntityId) return;
  cliente.ficEntityId = ficEntityId;
  cliente.updatedAt = new Date();
  saveClientiStore();
}
