import { z } from "zod";
import type { Interruttore } from "../../platform/interruttori";
import { getReminderService } from "../../reminders/service";
import { getCommessaById } from "../../routers/commesse";
import { versioneCommessa } from "../../commesse/transizioni";
import { STRUMENTI_CASI } from "../strumenti/casi";
import { STRUMENTI_COMMESSE } from "../strumenti/commesse";
import { STRUMENTI_COMUNICAZIONI_R0 } from "../strumenti/allegati";
import { STRUMENTI_ARCHIVIO_COMUNICAZIONI } from "../strumenti/archivioAllegati";
import { findDocumentoComunicazione } from "../../routers/preventiviContratti";
import { STRUMENTI_DOCUMENTI } from "../strumenti/documenti";
import { STRUMENTI_CLIENTI } from "../strumenti/clienti";
import { STRUMENTI_L0 } from "../strumenti/letture";
import { STRUMENTI_MEMORIA } from "../strumenti/memorie";
import { STRUMENTI_PROMEMORIA } from "../strumenti/promemoria";
import { STRUMENTI_PROPOSTE } from "../strumenti/proposte";
import { STRUMENTI_PROATTIVITA } from "../strumenti/proattivita";
import { STRUMENTI_AGENDA } from "../strumenti/agenda";
import { STRUMENTI_RICERCA } from "../strumenti/ricerca";
import { STRUMENTI_TICKET } from "../strumenti/ticket";
import { STRUMENTI_SCRITTURA } from "../strumenti/scrittura";
import type {
  IntentoTars,
  StrumentoTars,
  SuperficieTars,
  TipoEntitaTars,
} from "../strumenti/tipi";
import type {
  DescrittoreAzioneTars,
  RischioAzioneTars,
  ScopeAzioneTars,
} from "./types";

export const VERSIONE_REGISTRO_AZIONI = "1.14.0";

const schemaLettura = z
  .object({
    dati: z.unknown(),
    evidenze: z.array(z.unknown()),
    freschezza: z.string(),
    fonteAutorevole: z.string(),
    omissioni: z.array(z.string()),
    versioniEntita: z.record(z.string(), z.string()),
  })
  .passthrough();

const schemaConferma = z
  .object({
    via: z.literal("proposte.approvaEApplica"),
    propostaId: z.number().int().positive(),
    etichetta: z.string(),
    effetto: z.string().nullable(),
    hashAnteprima: z.string().length(64).optional(),
  })
  .strict();

const schemaUndoVia = z.union([
  z
    .object({
      procedura: z.literal("promemoria.cancel"),
      id: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      procedura: z.literal("commesse.undoTransizione"),
      id: z.number().int().positive(),
    })
    .strict(),
]);

const schemaAzione = (nome: string) => z
  .object({
    tipo: z.literal("azione"),
    strumento: z.literal(nome),
    stato: z.string(),
    motivo: z.string().nullable(),
    azioneId: z.string().nullable(),
    auditId: z.string().nullable(),
    entitaToccate: z.array(z.string()),
    prima: z.record(z.string(), z.unknown()).nullable(),
    dopo: z.record(z.string(), z.unknown()).nullable(),
    undoDisponibile: z.boolean(),
    undoEntro: z.string().nullable(),
    undoVia: schemaUndoVia.nullable(),
    conferma: schemaConferma.nullable(),
    avvertenze: z.array(z.string()),
    assunzioni: z.array(z.string()),
    dati: z.unknown(),
    evidenze: z.array(z.unknown()),
    freschezza: z.string(),
  })
  .passthrough();

type Metadati = Pick<
  DescrittoreAzioneTars,
  "rischio" | "scope" | "prerequisiti" | "idempotenza" | "audit" | "compensazione" | "timeoutMs" | "costo" | "fallbackSicuro"
> & {
  interruttori: readonly Interruttore[];
  schemaRisultato: z.ZodType;
};

const lettura = (
  scope: ScopeAzioneTars,
  superfici: readonly SuperficieTars[],
  entita: readonly TipoEntitaTars[],
  interruttori: readonly Interruttore[] = ["tars", "tarsReadTools"],
  fallbackSicuro = false
): Metadati => ({
  rischio: "R0",
  scope,
  schemaRisultato: schemaLettura,
  prerequisiti: {
    direzione: false,
    superfici,
    intenti: ["lettura", "analisi"],
    entita,
  },
  idempotenza: { strategia: "non_applicabile", fonte: "sola lettura" },
  audit: { richiesto: false, fonte: "run Tars" },
  compensazione: { disponibile: false, via: "nessuna" },
  interruttori,
  timeoutMs: 10_000,
  costo: { unita: "operazione", massimo: 1, classe: "basso" },
  fallbackSicuro,
});

const r1 = (
  nome: string,
  scope: ScopeAzioneTars,
  superfici: readonly SuperficieTars[],
  entita: readonly TipoEntitaTars[],
  interruttori: readonly Interruttore[],
  compensabile: boolean,
  direzione = false,
  esitoAncoraValido?: DescrittoreAzioneTars["idempotenza"]["esitoAncoraValido"]
): Metadati => ({
  rischio: "R1",
  scope,
  schemaRisultato: schemaAzione(nome),
  prerequisiti: {
    direzione,
    superfici,
    intenti: ["azione_esplicita"],
    entita,
  },
  idempotenza: {
    strategia: "dominio",
    fonte: "servizio canonico",
    esitoAncoraValido,
  },
  audit: { richiesto: true, fonte: "dominio + ledger R1" },
  compensazione: {
    disponibile: compensabile,
    via: compensabile ? "dominio" : "nessuna",
  },
  interruttori,
  timeoutMs: 15_000,
  costo: { unita: "operazione", massimo: 1, classe: "basso" },
  fallbackSicuro: false,
});

const METADATI: Record<string, Metadati> = {
  cerca_commesse: lettura("sede", ["generale", "commessa"], ["commessa"], undefined, true),
  // Ricerche T1 (03/09/2026): ciò che si tocca tutto il giorno diventa
  // trovabile — comunicazioni anche per numero, fatture, documenti.
  cerca_comunicazioni: lettura("sede", ["generale", "comunicazioni"], ["commessa", "cliente"], ["tars", "tarsReadTools", "tarsCommunications"]),
  cerca_fatture: lettura("sede", ["generale", "economia", "commessa"], ["commessa", "cliente"]),
  cerca_documenti: lettura("sede", ["generale", "commessa", "documenti-ordini"], ["commessa", "documento"]),
  // Caccia alle conferme d'ordine mancanti (direzione 03/09/2026).
  cerca_conferme_ordine_mancanti: lettura("sede", ["generale", "commessa", "documenti-ordini"], ["commessa", "documento"]),
  // Clienti (01/09/2026): entità «commessa» inclusa perché dal fascicolo
  // di una commessa si chiede legittimamente del suo cliente.
  cerca_clienti: lettura(
    "sede",
    ["generale", "commessa", "comunicazioni", "economia"],
    ["cliente", "commessa"],
    undefined,
    true
  ),
  leggi_cliente: lettura(
    "entita",
    ["generale", "commessa", "comunicazioni", "economia"],
    ["cliente", "commessa"]
  ),
  leggi_commessa: lettura("entita", ["commessa"], ["commessa"]),
  verifica_gate_commessa: lettura("entita", ["commessa", "documenti-ordini"], ["commessa"]),
  verifica_transizione_commessa: lettura(
    "entita",
    ["commessa", "comunicazioni"],
    ["commessa"]
  ),
  // Superficie «comunicazioni» inclusa: dopo la lettura di un allegato il
  // contesto persiste quella superficie, e la catena Maccari divisa su due
  // messaggi deve poter completare la transizione (revisione, rilievo I3).
  transizione_adiacente_commessa: r1(
    "transizione_adiacente_commessa",
    "entita",
    ["commessa", "comunicazioni"],
    ["commessa"],
    ["tars", "tarsL2Actions"],
    true,
    false,
    async (contesto, argomenti, esito) => {
      if (esito.stato !== "transizione_eseguita") return false;
      const input = argomenti && typeof argomenti === "object"
        ? argomenti as { commessaId?: unknown; nuovoStato?: unknown }
        : {};
      if (!Number.isInteger(input.commessaId)) return false;
      const commessa: any = getCommessaById(Number(input.commessaId));
      if (!commessa || commessa.sedeId !== contesto.sedeId) return false;
      const versioneDopo = esito.dopo?.versione;
      return (
        commessa.stato === input.nuovoStato &&
        typeof versioneDopo === "string" &&
        versioneCommessa(commessa) === versioneDopo
      );
    }
  ),
  leggi_ordini_fornitore: lettura("entita", ["commessa", "documenti-ordini"], ["commessa", "ordine_fornitore"]),
  leggi_analisi_ordine: {
    ...lettura("entita", ["documenti-ordini", "direzione"], ["ordine_fornitore", "documento"], ["tars", "tarsReadTools", "documentIntelligence"]),
    prerequisiti: {
      direzione: true,
      superfici: ["documenti-ordini", "direzione"],
      intenti: ["lettura", "analisi"],
      entita: ["ordine_fornitore", "documento"],
    },
  },
  leggi_centro_azioni: lettura("sede", ["generale", "commessa"], ["caso", "commessa"]),
  leggi_comunicazioni: lettura("entita", ["comunicazioni", "commessa"], ["commessa", "cliente"], ["tars", "tarsReadTools", "tarsCommunications"]),
  leggi_thread_comunicazioni: lettura("entita", ["comunicazioni", "commessa"], ["commessa"], ["tars", "tarsReadTools", "tarsCommunications"]),
  leggi_allegato_comunicazione: {
    ...lettura("entita", ["comunicazioni", "commessa"], ["commessa", "documento"], ["tars", "tarsReadTools", "tarsCommunications"]),
    // Il PDF può richiedere l'OCR locale; 10 secondi descriverebbero un
    // contratto falso anche se il tool non effettua chiamate a pagamento.
    // NOTA: timeoutMs è oggi un metadato DESCRITTIVO del registro (nessun
    // wrapper a runtime): il tempo del run è governato da TARS_MAX_RUN_MS.
    timeoutMs: 120_000,
    costo: { unita: "operazione", massimo: 1, classe: "medio" },
  },
  leggi_fascicolo_commessa: lettura("entita", ["commessa", "documenti-ordini"], ["commessa", "documento"]),
  leggi_promemoria_in_scadenza: lettura("personale", ["generale", "promemoria"], ["promemoria"]),
  leggi_promemoria: lettura("personale", ["promemoria"], ["promemoria"]),
  // Scrittura «Tars libero» (02/09/2026): stesse procedure dei router,
  // contesto server dell'utente, esito nel ledger R1.
  crea_cliente: r1("crea_cliente", "sede", ["generale", "commessa", "comunicazioni"], ["cliente", "commessa"], ["tars", "tarsL2Actions"], false),
  aggiorna_cliente: r1("aggiorna_cliente", "entita", ["generale", "commessa", "comunicazioni"], ["cliente", "commessa"], ["tars", "tarsL2Actions"], false),
  crea_commessa: r1("crea_commessa", "sede", ["generale", "commessa", "comunicazioni"], ["cliente", "commessa"], ["tars", "tarsL2Actions"], false),
  aggiorna_commessa: r1("aggiorna_commessa", "entita", ["generale", "commessa", "comunicazioni", "documenti-ordini"], ["commessa", "cliente"], ["tars", "tarsL2Actions"], false),
  archivia_commessa: r1("archivia_commessa", "entita", ["generale", "commessa"], ["commessa"], ["tars", "tarsL2Actions"], false),
  ripristina_commessa: r1("ripristina_commessa", "entita", ["generale", "commessa"], ["commessa"], ["tars", "tarsL2Actions"], false),
  aggiorna_ticket: r1("aggiorna_ticket", "entita", ["generale", "commessa", "post-vendita"], ["commessa", "cliente"], ["tars", "tarsL2Actions"], false),
  chiudi_ticket: r1("chiudi_ticket", "entita", ["generale", "commessa", "post-vendita"], ["commessa", "cliente"], ["tars", "tarsL2Actions"], false),
  pianifica_intervento: r1("pianifica_intervento", "entita", ["generale", "commessa", "post-vendita"], ["commessa"], ["tars", "tarsL2Actions"], false),
  // Agenda T4 (03/09/2026): il calendario dentro il CRM.
  leggi_agenda: lettura("sede", ["generale", "commessa", "post-vendita"], ["commessa"]),
  sposta_intervento: r1("sposta_intervento", "entita", ["generale", "commessa", "post-vendita"], ["commessa"], ["tars", "tarsL2Actions"], false),
  segna_intervento_fatto: r1("segna_intervento_fatto", "entita", ["generale", "commessa", "post-vendita"], ["commessa"], ["tars", "tarsL2Actions"], false),
  // Migrazione D2 (mandato 03/09 sera): una tantum rilanciabile, direzione.
  migra_calendario_google: r1("migra_calendario_google", "sede", ["generale", "direzione"], ["commessa"], ["tars", "tarsL2Actions"], false, true),
  collega_comunicazione: r1("collega_comunicazione", "entita", ["generale", "commessa", "comunicazioni"], ["commessa", "cliente"], ["tars", "tarsL2Actions", "tarsCommunications"], false),
  classifica_comunicazione: r1("classifica_comunicazione", "entita", ["generale", "comunicazioni"], ["commessa", "cliente"], ["tars", "tarsL2Actions", "tarsCommunications"], false),
  segna_gestita_comunicazione: r1("segna_gestita_comunicazione", "entita", ["generale", "comunicazioni"], ["commessa", "cliente"], ["tars", "tarsL2Actions", "tarsCommunications"], false),
  risolvi_caso: r1("risolvi_caso", "entita", ["generale", "commessa", "post-vendita"], ["commessa", "caso"], ["tars", "tarsL2Actions"], false),
  collega_fattura_commessa: r1("collega_fattura_commessa", "entita", ["generale", "economia", "commessa"], ["commessa", "cliente"], ["tars", "tarsL2Actions"], false),
  sposta_documento: r1("sposta_documento", "entita", ["generale", "commessa", "documenti-ordini"], ["commessa", "documento"], ["tars", "tarsL2Actions"], false),
  // Ticket di post-vendita (02/09/2026): dalla chat, dal fascicolo o da
  // una comunicazione; entità cliente inclusa per i ticket senza commessa.
  crea_ticket: r1(
    "crea_ticket",
    "entita",
    ["generale", "commessa", "post-vendita", "comunicazioni"],
    ["commessa", "cliente"],
    ["tars", "tarsL2Actions"],
    false
  ),
  crea_promemoria: r1(
    "crea_promemoria",
    "personale",
    ["generale", "promemoria", "commessa"],
    ["promemoria", "commessa", "cliente"],
    ["tars", "tarsReminders"],
    true,
    false,
    async (contesto, argomenti, esito) => {
      if (esito.stato === "non_eseguito") return false;
      const id = esito.undoVia?.procedura === "promemoria.cancel"
        ? esito.undoVia.id
        : null;
      if (id == null) return false;
      const promemoria = await getReminderService().get({
        sedeId: contesto.sedeId,
        recipientUserId: contesto.utenteId,
        id,
      });
      if (!promemoria) return false;
      const input = argomenti && typeof argomenti === "object"
        ? argomenti as { commessaId?: unknown; clienteId?: unknown }
        : {};
      const stessaEntita =
        promemoria.commessaId ===
          (Number.isInteger(input.commessaId) ? input.commessaId : null) &&
        promemoria.clienteId ===
          (Number.isInteger(input.clienteId) ? input.clienteId : null);
      return stessaEntita &&
        (promemoria.status === "scheduled" || promemoria.status === "due");
    }
  ),
  sposta_promemoria: r1("sposta_promemoria", "personale", ["promemoria"], ["promemoria"], ["tars", "tarsReminders"], false),
  annulla_promemoria: r1("annulla_promemoria", "personale", ["promemoria"], ["promemoria"], ["tars", "tarsReminders"], false),
  completa_promemoria: r1("completa_promemoria", "personale", ["promemoria"], ["promemoria"], ["tars", "tarsReminders"], false),
  archivia_allegato_comunicazione: r1(
    "archivia_allegato_comunicazione",
    "entita",
    ["comunicazioni", "commessa"],
    ["commessa", "documento"],
    ["tars", "tarsL2Actions", "tarsCommunications"],
    false,
    false,
    async (contesto, argomenti, esito) => {
      if (esito.stato !== "archiviato" && esito.stato !== "gia_archiviato") {
        return false;
      }
      const input = argomenti && typeof argomenti === "object"
        ? argomenti as { comunicazioneId?: unknown; allegatoIndex?: unknown }
        : {};
      if (
        !Number.isInteger(input.comunicazioneId) ||
        !Number.isInteger(input.allegatoIndex)
      ) {
        return false;
      }
      const documento = findDocumentoComunicazione(
        contesto.sedeId,
        Number(input.comunicazioneId),
        Number(input.allegatoIndex)
      );
      const dati = esito.dati as
        | { documentoId?: unknown }
        | null;
      const dopo = esito.dopo as { commessaId?: unknown } | null;
      return (
        documento != null &&
        Number.isInteger(dati?.documentoId) &&
        documento.id === dati?.documentoId &&
        // Se il flusso manuale ha spostato il documento su un'altra
        // commessa, il riuso dell'esito sarebbe disonesto (revisione M2).
        (!Number.isInteger(dopo?.commessaId) ||
          documento.commessaId === dopo?.commessaId)
      );
    }
  ),
  prendi_in_carico_caso: r1("prendi_in_carico_caso", "entita", ["generale", "commessa"], ["caso", "commessa"], ["tars", "tarsL2Actions"], false),
  rinvia_caso: r1("rinvia_caso", "entita", ["generale", "commessa"], ["caso", "commessa"], ["tars", "tarsL2Actions"], false),
  analizza_conferma_ordine: {
    ...lettura("entita", ["documenti-ordini", "direzione"], ["ordine_fornitore", "documento"], ["tars", "tarsL2Actions", "documentIntelligence"]),
    schemaRisultato: schemaAzione("analizza_conferma_ordine"),
    prerequisiti: {
      direzione: true,
      superfici: ["documenti-ordini", "direzione"],
      intenti: ["analisi"],
      entita: ["ordine_fornitore", "documento"],
    },
    idempotenza: { strategia: "dominio", fonte: "firma del run documentale" },
    audit: { richiesto: true, fonte: "run documentale append-only" },
    timeoutMs: 120_000,
    costo: { unita: "operazione", massimo: 1, classe: "medio" },
  },
  proponi_data_consegna: {
    rischio: "R3",
    scope: "entita",
    schemaRisultato: schemaAzione("proponi_data_consegna"),
    prerequisiti: {
      direzione: true,
      superfici: ["documenti-ordini", "direzione"],
      intenti: ["proposta"],
      entita: ["ordine_fornitore"],
    },
    idempotenza: { strategia: "dominio", fonte: "gateway proposte" },
    audit: { richiesto: true, fonte: "proposte_eventi" },
    compensazione: { disponibile: true, via: "gateway" },
    interruttori: ["tars", "tarsProposals", "documentIntelligence", "proposte"],
    timeoutMs: 20_000,
    costo: { unita: "operazione", massimo: 1, classe: "basso" },
    fallbackSicuro: false,
  },
  ricorda: r1("ricorda", "sede", ["generale"], ["memoria"], ["tars", "tarsMemory"], false),
  dimentica: r1("dimentica", "sede", ["generale"], ["memoria"], ["tars", "tarsMemory"], false),
  leggi_memorie: lettura("sede", ["generale"], ["memoria"], ["tars", "tarsMemory"]),
  panorama_azienda: {
    ...lettura(
      "sede",
      ["generale", "direzione"],
      ["commessa"],
      ["tars", "tarsProactive", "tarsPatterns"]
    ),
    prerequisiti: {
      direzione: true,
      superfici: ["generale", "direzione"],
      intenti: ["lettura", "analisi"],
      entita: ["commessa"],
    },
  },
  leggi_miglioramenti: {
    ...lettura(
      "sede",
      ["generale", "direzione"],
      ["commessa"],
      ["tars", "tarsProactive", "tarsImprovements"]
    ),
    prerequisiti: {
      direzione: true,
      superfici: ["generale", "direzione"],
      intenti: ["lettura", "analisi"],
      entita: ["commessa"],
    },
  },
};

const STRUMENTI_CORRENTI: readonly StrumentoTars[] = [
  ...STRUMENTI_L0,
  ...STRUMENTI_CLIENTI,
  ...STRUMENTI_COMUNICAZIONI_R0,
  ...STRUMENTI_ARCHIVIO_COMUNICAZIONI,
  ...STRUMENTI_COMMESSE,
  ...STRUMENTI_PROMEMORIA,
  ...STRUMENTI_CASI,
  ...STRUMENTI_DOCUMENTI,
  ...STRUMENTI_PROPOSTE,
  ...STRUMENTI_MEMORIA,
  ...STRUMENTI_PROATTIVITA,
  ...STRUMENTI_TICKET,
  ...STRUMENTI_SCRITTURA,
  ...STRUMENTI_RICERCA,
  ...STRUMENTI_AGENDA,
];

function costruisciRegistro(): DescrittoreAzioneTars[] {
  const strumentiUnici = new Map<string, StrumentoTars>();
  for (const strumento of STRUMENTI_CORRENTI) {
    if (strumentiUnici.has(strumento.nome)) {
      throw new Error(`registro Tars: tool duplicato ${strumento.nome}`);
    }
    strumentiUnici.set(strumento.nome, strumento);
  }
  const metadatiOrfani = Object.keys(METADATI).filter(nome => !strumentiUnici.has(nome));
  if (metadatiOrfani.length) {
    throw new Error(`registro Tars: metadati senza tool: ${metadatiOrfani.join(", ")}`);
  }
  return [...strumentiUnici.values()].map(strumento => {
    const metadati = METADATI[strumento.nome];
    if (!metadati) throw new Error(`registro Tars: metadati mancanti per ${strumento.nome}`);
    return {
      nome: strumento.nome,
      versioneRegistro: VERSIONE_REGISTRO_AZIONI,
      versioneStrumento: strumento.versione,
      livello: strumento.livello,
      capability: [...strumento.capability],
      ...metadati,
      strumento,
    };
  });
}

const CAMPI_OBBLIGATORI = [
  "nome", "versioneRegistro", "versioneStrumento", "livello", "rischio",
  "capability", "scope", "schemaRisultato", "prerequisiti", "idempotenza",
  "audit", "compensazione", "interruttori", "timeoutMs", "costo",
  "fallbackSicuro", "strumento",
] as const;

export function validaRegistroAzioni(
  registro: readonly DescrittoreAzioneTars[]
): void {
  const nomi = new Set<string>();
  for (const azione of registro) {
    for (const campo of CAMPI_OBBLIGATORI) {
      if (!(campo in (azione as object)) || (azione as any)[campo] == null) {
        throw new Error(`registro Tars: campo ${campo} mancante`);
      }
    }
    if (azione.rischio === "R4") {
      throw new Error(`registro Tars: R4 vietato per ${azione.nome}`);
    }
    if (!/^R[0-3]$/.test(azione.rischio)) {
      throw new Error(`registro Tars: rischio non valido per ${azione.nome}`);
    }
    if (nomi.has(azione.nome)) throw new Error(`registro Tars: tool duplicato ${azione.nome}`);
    nomi.add(azione.nome);
    if (azione.strumento.nome !== azione.nome) throw new Error(`registro Tars: nome incoerente ${azione.nome}`);
    if (azione.strumento.livello !== azione.livello) throw new Error(`registro Tars: livello incoerente ${azione.nome}`);
    if (
      azione.capability.length !== azione.strumento.capability.length ||
      !azione.capability.every(c => azione.strumento.capability.includes(c))
    ) {
      throw new Error(`registro Tars: capability incoerenti per ${azione.nome}`);
    }
    const flagTool = Array.isArray(azione.strumento.interruttore)
      ? azione.strumento.interruttore
      : azione.strumento.interruttore
        ? [azione.strumento.interruttore]
        : [];
    if (!flagTool.every(flag => azione.interruttori.includes(flag))) {
      throw new Error(`registro Tars: flag incoerenti per ${azione.nome}`);
    }
    if (azione.timeoutMs <= 0) throw new Error(`registro Tars: timeoutMs non valido per ${azione.nome}`);
    if (azione.costo.massimo < 0) throw new Error(`registro Tars: costo non valido per ${azione.nome}`);
    if (!azione.interruttori.includes("tars")) throw new Error(`registro Tars: flag master mancante per ${azione.nome}`);
    if (AZIONI_DICHIARATE_INDISPONIBILI.some(voce => voce.nome === azione.nome)) {
      throw new Error(
        `registro Tars: «${azione.nome}» è dichiarata indisponibile; costruisci il servizio canonico e rimuovi la voce prima di registrarla.`
      );
    }
  }
}

/**
 * Azioni chieste dallo spec ma SENZA servizio canonico nel CRM: dichiarate
 * indisponibili con il blocco reale, mai simulate (ruling registrato).
 * Registrare un tool con uno di questi nomi richiede prima di costruire il
 * servizio canonico e rimuovere la voce da qui: il validatore lo impone.
 */
export const AZIONI_DICHIARATE_INDISPONIBILI: readonly {
  nome: string;
  motivo: string;
}[] = [
  {
    nome: "invia_email_cliente",
    motivo:
      "Il CRM non ha un servizio canonico di invio email: le caselle IMAP sono in sola lettura e nessun canale SMTP è configurato. L'invio resta un'operazione umana.",
  },
  {
    nome: "invia_whatsapp_cliente",
    motivo:
      "Il canale WhatsApp registra i messaggi ricevuti e gli echi in uscita dal webhook, ma il CRM non espone alcun comando canonico di invio. Nessun invio viene simulato.",
  },
  {
    nome: "registra_pagamento",
    motivo:
      "Le scritture economiche (pagamenti, importi, FiC) restano fuori dal catalogo Tars per decisione di sicurezza: passano solo dal flusso pagamenti con le capability dedicate.",
  },
];

const registro = costruisciRegistro().sort((a, b) => a.nome.localeCompare(b.nome));
validaRegistroAzioni(registro);

export const REGISTRO_AZIONI: readonly DescrittoreAzioneTars[] = Object.freeze(registro);
const PER_NOME = new Map(REGISTRO_AZIONI.map(a => [a.nome, a] as const));

export function descrittoreAzione(nome: string): DescrittoreAzioneTars | undefined {
  return PER_NOME.get(nome);
}
