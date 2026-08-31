// Archiviazione R1 degli allegati di comunicazione nel fascicolo (T4).
//
// Separato dai lettori R0 (`allegati.ts`): quel modulo non può importare
// effetti. Qui l'autorità nasce dal comando esplicito dell'utente, legata dal
// server alla commessa verificata del contesto; la corrispondenza certa
// richiede che l'allegato sia stato letto in questa conversazione e che i
// byte alla rilettura corrispondano al fingerprint verificato. L'effetto
// passa dal servizio canonico del fascicolo, che rilegge la fonte dentro la
// sezione serializzata e rifiuta la riassegnazione cross-commessa.

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  getLiveComunicazione,
  type Comunicazione,
} from "../../comunicazioni/comunicazioni";
import {
  leggiAllegatoRaw,
  type AllegatoRaw,
} from "../../comunicazioni/allegati";
import {
  estraiTestoDocumento,
  type EsitoParser,
} from "../../documenti/parserRegistry";
import {
  archiviaAllegatoComunicazione,
  findDocumentoComunicazione,
  type Documento,
} from "../../routers/preventiviContratti";
import { getCommessaById } from "../../routers/commesse";
import { tarsAttivo } from "../../platform/interruttori";
import {
  MAX_BYTE_ARCHIVIO_COMUNICAZIONE,
  fingerprintAllegatoComunicazione,
  statoArchiviazioneAllegato,
} from "../documenti/allegati";
import {
  classificaAllegatoComunicazione,
  type ClassificazioneAllegato,
} from "../documenti/classificazione";
import {
  CONDIZIONE_NON_VERIFICABILE,
  analizzaRichiestaTransizione,
  type RichiestaTransizioneEsplicita,
} from "./commesse";
import type {
  ContestoRun,
  EsitoAzione,
  EvidenzaTars,
  StrumentoTars,
} from "./tipi";

const NOME_TOOL = "archivia_allegato_comunicazione";
const FONTE = "Fascicolo documentale della commessa (servizio canonico)";

// ————— Autorità esplicita —————————————————————————————————————————————

export type CondizioniArchiviazione = {
  /** «se appartiene alla commessa» — verificata dal collegamento CRM. */
  appartenenza: boolean;
  /** «se non trovi problemi» — verificata dall'esito analisi/classificazione. */
  nessunProblema: boolean;
};

export type RichiestaArchiviazioneEsplicita = {
  condizioni: CondizioniArchiviazione;
};

const CONSULTIVA_INIZIALE =
  /^(?:dimmi\s+se|verifica\s+se|controlla\s+se|(?:sai|sapresti|mi\s+dici|mi\s+puoi\s+dire)\s+se|posso|potrei|cosa|che\b|quali|conviene|sarebbe|proponi|consiglia)/i;
const NEGAZIONE_ARCHIVIO =
  /\bnon\s+(?:archiviar|salvar|allegar|metter)|\bsenza\s+(?:archiviar|salvar)|\bmai\s+archiviar/i;
const COMANDO_ARCHIVIO =
  /\barchivi(?:a|al[oa]|ala|are|arl[oa])\b|\bsalv(?:a|al[oa]|are|arl[oa])\b[\s\S]{0,50}?\bfascicolo\b|\bmett(?:i|il[oa]|ere)\b[\s\S]{0,50}?\bfascicolo\b|\balleg(?:a|al[oa]|are|arl[oa])\b[\s\S]{0,50}?\b(?:commessa|fascicolo)\b/i;

// Set CHIUSO delle condizioni verificabili in-run dal server. Ogni altro
// «se/qualora/purché» lascia il messaggio senza autorità (falso negativo
// sicuro): la valutazione della condizione non spetta mai al modello.
const COND_APPARTENENZA =
  /\bse\s+(?:l'allegato\s+|il\s+documento\s+|il\s+file\s+)?(?:appartiene|risulta(?:\s+appartenere)?|è)\s+(?:alla|della|a\s+questa|di\s+questa)\s+commessa\s*,?\s*/gi;
const COND_NESSUN_PROBLEMA =
  /\bse\s+non\s+(?:trovi|ci\s+sono|risultano|emergono)\s+(?:problemi|incongruenze|anomalie)\s*,?\s*/gi;

function condizioniRiconosciute(testo: string): {
  condizioni: CondizioniArchiviazione;
  spogliato: string;
} {
  COND_APPARTENENZA.lastIndex = 0;
  COND_NESSUN_PROBLEMA.lastIndex = 0;
  const appartenenza = COND_APPARTENENZA.test(testo);
  COND_APPARTENENZA.lastIndex = 0;
  const nessunProblema = COND_NESSUN_PROBLEMA.test(testo);
  COND_NESSUN_PROBLEMA.lastIndex = 0;
  const spogliato = testo
    .replace(COND_APPARTENENZA, "")
    .replace(COND_NESSUN_PROBLEMA, "");
  return { condizioni: { appartenenza, nessunProblema }, spogliato };
}

/**
 * Classificatore chiuso del comando di archiviazione: un falso negativo
 * produce una risposta senza effetto, un falso positivo una scrittura —
 * perciò forme consultive, negazioni e condizioni fuori set vincono sempre.
 */
export function analizzaRichiestaArchiviazione(
  messaggio: string
): RichiestaArchiviazioneEsplicita | null {
  const testo = messaggio.trim();
  if (!testo) return null;
  if (CONSULTIVA_INIZIALE.test(testo)) return null;
  if (NEGAZIONE_ARCHIVIO.test(testo)) return null;
  const { condizioni, spogliato } = condizioniRiconosciute(testo);
  if (CONDIZIONE_NON_VERIFICABILE.test(spogliato)) return null;
  if (!COMANDO_ARCHIVIO.test(spogliato)) return null;
  return { condizioni };
}

export type RichiestaTransizioneCondizionata = {
  richiesta: RichiestaTransizioneEsplicita;
  condizioni: CondizioniArchiviazione;
};

/**
 * Comando di transizione subordinato SOLO alle condizioni verificabili del
 * flusso di archiviazione («se appartiene alla commessa», «se non trovi
 * problemi») e SOLO in presenza del comando di archiviazione nello stesso
 * messaggio. Il classificatore base continua a rifiutare ogni condizione:
 * l'autorità nasce dopo, quando l'orchestratore verifica le condizioni
 * sull'esito reale — mai dal testo da solo.
 */
export function analizzaRichiestaTransizioneCondizionata(
  messaggio: string
): RichiestaTransizioneCondizionata | null {
  if (analizzaRichiestaTransizione(messaggio) != null) return null;
  const archivio = analizzaRichiestaArchiviazione(messaggio);
  if (!archivio) return null;
  const { appartenenza, nessunProblema } = archivio.condizioni;
  if (!appartenenza && !nessunProblema) return null;
  const { spogliato } = condizioniRiconosciute(messaggio.trim());
  const richiesta = analizzaRichiestaTransizione(spogliato);
  if (!richiesta) return null;
  return { richiesta, condizioni: archivio.condizioni };
}

/**
 * Valutazione DETERMINISTICA delle condizioni sull'esito dell'archiviazione.
 * «Nessun problema» richiede un'archiviazione appena riuscita con testo
 * estratto e classificazione non incerta; un `gia_archiviato` senza nuova
 * analisi soddisfa solo l'appartenenza.
 */
export function condizioniTransizioneSoddisfatte(
  condizioni: CondizioniArchiviazione,
  esito: EsitoAzione<any>
): boolean {
  const archiviato =
    esito.strumento === NOME_TOOL &&
    (esito.stato === "archiviato" || esito.stato === "gia_archiviato");
  if (condizioni.appartenenza && !archiviato) return false;
  if (condizioni.nessunProblema) {
    if (esito.stato !== "archiviato") return false;
    const dati = esito.dati as
      | {
          analisi?: { parserStato?: string };
          classificazione?: ClassificazioneAllegato;
        }
      | null
      | undefined;
    if (dati?.analisi?.parserStato !== "estratto") return false;
    if (!dati?.classificazione || dati.classificazione.confidenza === "bassa") {
      return false;
    }
  }
  return archiviato;
}

// ————— Tool R1 ————————————————————————————————————————————————————————

export type DipendenzeArchivioAllegatiTars = {
  getCommessa: (id: number) => any | null;
  getLiveComunicazione: (
    id: number,
    sedeId: number
  ) => Promise<Comunicazione | null>;
  leggiRaw: (
    comunicazione: Comunicazione,
    allegatoIndex: number
  ) => Promise<AllegatoRaw>;
  estraiDocumento: typeof estraiTestoDocumento;
  archivia: typeof archiviaAllegatoComunicazione;
  trovaDocumentoEsistente: (
    sedeId: number,
    comunicazioneId: number,
    allegatoIndex: number
  ) => Documento | null;
  now: () => Date;
};

const DIPENDENZE_DEFAULT: DipendenzeArchivioAllegatiTars = {
  getCommessa: getCommessaById,
  getLiveComunicazione,
  leggiRaw: leggiAllegatoRaw,
  estraiDocumento: estraiTestoDocumento,
  archivia: archiviaAllegatoComunicazione,
  trovaDocumentoEsistente: findDocumentoComunicazione,
  now: () => new Date(),
};

const schemaInput = z
  .object({
    commessaId: z.number().int().positive().optional(),
    comunicazioneId: z.number().int().positive(),
    allegatoIndex: z.number().int().min(0),
  })
  .strict();

type InputArchivio = z.infer<typeof schemaInput> & {
  /** Allegato dal server dopo la verifica; non nello schema provider. */
  __fingerprintAtteso?: string;
};

function baseAzione(now: () => Date) {
  return {
    tipo: "azione" as const,
    strumento: NOME_TOOL,
    azioneId: null as string | null,
    auditId: null as string | null,
    entitaToccate: [] as string[],
    prima: null as Record<string, unknown> | null,
    dopo: null as Record<string, unknown> | null,
    undoDisponibile: false,
    undoEntro: null as string | null,
    undoVia: null,
    conferma: null,
    avvertenze: [] as string[],
    assunzioni: [] as string[],
    evidenze: [] as EvidenzaTars[],
    freschezza: now().toISOString(),
  };
}

function nonEseguito(
  now: () => Date,
  motivo: string
): EsitoAzione<null> {
  return {
    ...baseAzione(now),
    stato: "non_eseguito",
    motivo,
    dati: null,
  };
}

const MOTIVO_NON_AUTORIZZATO =
  "Allegato non trovato o operazione non autorizzata.";

type VerificaCorrispondenza =
  | {
      tipo: "ok";
      commessa: any;
      comunicazione: Comunicazione;
      fingerprintAtteso: string;
    }
  | { tipo: "esito"; esito: EsitoAzione<null> };

async function verificaCorrispondenzaCerta(
  deps: DipendenzeArchivioAllegatiTars,
  contesto: ContestoRun,
  input: InputArchivio
): Promise<VerificaCorrispondenza> {
  const autorizzazione = contesto.autorizzazioneArchiviazione;
  if (!autorizzazione) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        deps.now,
        "L'archiviazione non è stata richiesta esplicitamente: nessun documento salvato."
      ),
    };
  }
  if (
    !tarsAttivo("tarsL2Actions") ||
    !tarsAttivo("tarsCommunications") ||
    !contesto.capability.has("commessa.read") ||
    !contesto.capability.has("commessa.manage_documents")
  ) {
    return {
      tipo: "esito",
      esito: nonEseguito(deps.now, MOTIVO_NON_AUTORIZZATO),
    };
  }
  if (
    input.commessaId != null &&
    input.commessaId !== autorizzazione.commessaId
  ) {
    return {
      tipo: "esito",
      esito: nonEseguito(deps.now, MOTIVO_NON_AUTORIZZATO),
    };
  }
  const commessa = deps.getCommessa(autorizzazione.commessaId);
  if (!commessa || commessa.sedeId !== contesto.sedeId) {
    return {
      tipo: "esito",
      esito: nonEseguito(deps.now, MOTIVO_NON_AUTORIZZATO),
    };
  }
  const comunicazione = await deps.getLiveComunicazione(
    input.comunicazioneId,
    contesto.sedeId
  );
  if (!comunicazione || !comunicazione.allegati[input.allegatoIndex]) {
    return {
      tipo: "esito",
      esito: nonEseguito(deps.now, MOTIVO_NON_AUTORIZZATO),
    };
  }
  if (comunicazione.commessaId !== commessa.id) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        deps.now,
        "La comunicazione non è collegata alla commessa autorizzata: nessun documento salvato. Collega prima la comunicazione dal modulo Messaggi."
      ),
    };
  }
  const persistito = contesto.contestoConversazione;
  const fingerprintAtteso =
    persistito &&
    persistito.comunicazioneId === comunicazione.id &&
    persistito.allegatoIndex === input.allegatoIndex &&
    persistito.verifiche.allegato === "verificato"
      ? persistito.versioniEntita[
          `allegato:${comunicazione.id}:${input.allegatoIndex}`
        ]
      : undefined;
  if (!fingerprintAtteso) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        deps.now,
        "L'allegato non risulta letto e verificato in questa conversazione: usa prima la lettura dell'allegato, poi archivia."
      ),
    };
  }
  return { tipo: "ok", commessa, comunicazione, fingerprintAtteso };
}

export function creaStrumentoArchivioAllegato(
  deps: DipendenzeArchivioAllegatiTars = DIPENDENZE_DEFAULT
): StrumentoTars<InputArchivio, EsitoAzione> {
  return {
    nome: NOME_TOOL,
    versione: "1.0.0",
    categoria: "comunicazioni",
    livello: "L2",
    effetto: "interno",
    reversibile: false,
    capability: ["commessa.read", "commessa.manage_documents"],
    interruttore: ["tarsL2Actions", "tarsCommunications"],
    descrizione:
      "Archivia nel fascicolo della commessa UN allegato di una comunicazione già collegata, quando l'utente lo ordina esplicitamente e l'allegato è stato letto in questa conversazione. Rilegge la fonte prima dell'effetto, classifica in modo deterministico e rifiuta ogni riassegnazione tra commesse.",
    schemaInput,
    async materializzaInput(contesto, input) {
      const verifica = await verificaCorrispondenzaCerta(deps, contesto, input);
      if (verifica.tipo === "esito") {
        return { tipo: "esito", esito: verifica.esito };
      }
      const esistente = deps.trovaDocumentoEsistente(
        contesto.sedeId,
        verifica.comunicazione.id,
        input.allegatoIndex
      );
      if (esistente && esistente.commessaId !== verifica.commessa.id) {
        return {
          tipo: "esito",
          esito: nonEseguito(
            deps.now,
            "Questo allegato risulta già archiviato nel fascicolo di un'altra commessa: nessuna riassegnazione automatica. Gestiscilo dal modulo Messaggi."
          ),
        };
      }
      if (esistente) {
        return {
          tipo: "esito",
          esito: {
            ...baseAzione(deps.now),
            stato: "gia_archiviato",
            motivo: null,
            azioneId: `${NOME_TOOL}:documento:${esistente.id}`,
            auditId: `preventivi_documenti:${esistente.id}`,
            entitaToccate: [
              `commessa:${verifica.commessa.id}`,
              `documento:${esistente.id}`,
            ],
            dati: {
              documentoId: esistente.id,
              tipo: esistente.tipo,
              nome: esistente.nome,
            },
            evidenze: [
              {
                tipo: "documento",
                riferimento: `documento:${esistente.id}`,
                descrizione: `Già nel fascicolo: ${esistente.nome}`,
              },
            ],
          } as EsitoAzione,
        };
      }
      return {
        tipo: "input",
        input: {
          ...input,
          commessaId: verifica.commessa.id,
          __fingerprintAtteso: verifica.fingerprintAtteso,
        },
      };
    },
    async esegui(contesto, input): Promise<EsitoAzione> {
      const verifica = await verificaCorrispondenzaCerta(deps, contesto, input);
      if (verifica.tipo === "esito") return verifica.esito;
      const { commessa, comunicazione } = verifica;
      const fingerprintAtteso =
        input.__fingerprintAtteso ?? verifica.fingerprintAtteso;

      const fingerprintDi = (raw: AllegatoRaw) =>
        fingerprintAllegatoComunicazione({
          comunicazione,
          allegatoIndex: input.allegatoIndex,
          nome: raw.nome,
          mimeType: raw.mimeType,
          sizeEffettiva: raw.buffer.length,
          checksumSha256: createHash("sha256")
            .update(raw.buffer)
            .digest("hex"),
        });

      // Pre-verifica: i byte correnti devono essere ESATTAMENTE quelli letti
      // e verificati in conversazione. La fonte viene poi riletta una seconda
      // volta dentro la sezione serializzata del servizio canonico.
      let raw: AllegatoRaw;
      try {
        raw = await deps.leggiRaw(comunicazione, input.allegatoIndex);
      } catch {
        return nonEseguito(
          deps.now,
          "L'allegato non è più disponibile dalla fonte: nessun documento salvato."
        );
      }
      if (fingerprintDi(raw) !== fingerprintAtteso) {
        return nonEseguito(
          deps.now,
          "La fonte è cambiata dopo la lettura verificata (nome, formato o contenuto diversi): rileggi l'allegato prima di archiviare."
        );
      }
      const archiviabilita = statoArchiviazioneAllegato(
        raw.mimeType,
        raw.buffer.length
      );
      if (archiviabilita.stato !== "archiviabile") {
        return nonEseguito(
          deps.now,
          archiviabilita.blocco ??
            "L'allegato non è archiviabile nel fascicolo."
        );
      }

      // Analisi leggera per la classificazione: solo parser nativi, nessun
      // OCR — l'esito «scansione_senza_testo» resta un dato onesto.
      let analisi: EsitoParser;
      try {
        analisi = await deps.estraiDocumento(
          raw.buffer,
          raw.mimeType,
          raw.nome,
          { ocr: false }
        );
      } catch {
        analisi = {
          esito: "illeggibile",
          parser: "registro-parser",
          versione: "corrente",
          motivo: "Errore parser sanitizzato.",
        };
      }
      const classificazione = classificaAllegatoComunicazione({
        nome: raw.nome,
        mimeType: raw.mimeType,
        oggetto: comunicazione.oggetto,
        testo:
          analisi.esito === "estratto" ? analisi.pagine.join("\n") : null,
      });

      let documento: Documento;
      try {
        documento = await deps.archivia({
          sedeId: contesto.sedeId,
          comunicazioneId: comunicazione.id,
          allegatoIndex: input.allegatoIndex,
          commessaId: commessa.id,
          nome: raw.nome,
          tipo: classificazione.tipo,
          note: `Archiviato da Tars su comando esplicito dell'utente ${contesto.utenteId}.`,
          mimeType: raw.mimeType,
          vietaRiassegnazione: true,
          buffer: async () => {
            const rilettura = await deps.leggiRaw(
              comunicazione,
              input.allegatoIndex
            );
            if (fingerprintDi(rilettura) !== fingerprintAtteso) {
              throw new Error(
                "FONTE_CAMBIATA: l'allegato è cambiato durante l'archiviazione."
              );
            }
            return rilettura.buffer;
          },
          createdBy: contesto.utenteId,
        });
      } catch (errore) {
        const testo = errore instanceof Error ? errore.message : "";
        if (testo.includes("FONTE_CAMBIATA")) {
          return nonEseguito(
            deps.now,
            "La fonte è cambiata durante l'archiviazione: nessun documento salvato. Rileggi l'allegato e riprova."
          );
        }
        if (testo.includes("SOURCE_REF_OCCUPATO")) {
          return nonEseguito(
            deps.now,
            "Questo allegato risulta già archiviato nel fascicolo di un'altra commessa: nessuna riassegnazione automatica."
          );
        }
        return nonEseguito(
          deps.now,
          "Lo storage documenti non è disponibile in questo momento: nessun documento salvato. Riprova tra poco."
        );
      }

      const avvertenze: string[] = [];
      if (classificazione.confidenza === "bassa") {
        avvertenze.push(
          "Classificazione incerta: verifica il tipo assegnato nel fascicolo."
        );
      }
      if (analisi.esito !== "estratto") {
        avvertenze.push(
          "Il contenuto non è stato letto in questa fase (documento senza testo nativo): la classificazione usa nome file e oggetto."
        );
      }
      return {
        ...baseAzione(deps.now),
        stato: "archiviato",
        motivo: null,
        azioneId: `${NOME_TOOL}:documento:${documento.id}`,
        auditId: `preventivi_documenti:${documento.id}`,
        entitaToccate: [
          `commessa:${commessa.id}`,
          `documento:${documento.id}`,
        ],
        prima: null,
        dopo: {
          documentoId: documento.id,
          commessaId: commessa.id,
          tipo: documento.tipo,
          nome: documento.nome,
          checksum: documento.checksum ?? null,
        },
        avvertenze,
        dati: {
          documentoId: documento.id,
          tipo: documento.tipo,
          nome: documento.nome,
          classificazione,
          analisi: {
            parserStato: analisi.esito,
            parserNome:
              analisi.esito === "estratto" ? analisi.parser : null,
          },
          appartenenzaVerificata: true,
        },
        evidenze: [
          {
            tipo: "entita",
            riferimento: `commessa:${commessa.id}`,
            descrizione: `${commessa.codice ?? `Commessa ${commessa.id}`} — ${commessa.cliente ?? "cliente non indicato"}`,
          },
          {
            tipo: "entita",
            riferimento: `comunicazione:${comunicazione.id}`,
            descrizione: `${comunicazione.canale} — ${comunicazione.oggetto || "senza oggetto"}`,
          },
          {
            tipo: "documento",
            riferimento: `documento:${documento.id}`,
            descrizione: `Archiviato nel fascicolo: ${documento.nome} (${documento.tipo})`,
          },
        ],
        freschezza: deps.now().toISOString(),
      } as EsitoAzione;
    },
  };
}

export const STRUMENTI_ARCHIVIO_COMUNICAZIONI: readonly StrumentoTars[] = [
  creaStrumentoArchivioAllegato(),
];

export { FONTE as FONTE_ARCHIVIO_COMUNICAZIONI };
