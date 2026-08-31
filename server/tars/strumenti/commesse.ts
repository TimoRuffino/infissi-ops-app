// Transizioni commessa per Tars (T3 del piano operativo).
//
// Il modello seleziona uno strumento, ma non possiede la state machine e non
// chiama tRPC: preview ed effetto usano lo stesso comando canonico del router.
// L'autorità di richiesta esplicita è derivata dal messaggio utente, poi
// legata lato server a entità e target. Non compare nello schema provider.

import { z } from "zod";
import type { TrpcContext } from "../../_core/context";
import {
  STATI_COMMESSA,
  eseguiTransizioneCommessa,
  firmaTransizioneCommessa,
  verificaTransizioneCommessa,
  versioneCommessa,
  type StatoCommessa,
} from "../../commesse/transizioni";
import {
  dipendenzeTransizioniCommesse,
  getCommessaById,
} from "../../routers/commesse";
import { tarsAttivo } from "../../platform/interruttori";
import type {
  ContestoRun,
  EsitoAzione,
  EsitoLettura,
  EvidenzaTars,
  StrumentoTars,
} from "./tipi";

const FONTE = "Servizio canonico transizioni commessa di Ruffino Flow";

const COMANDO_DIRETTO =
  /(?:(?:passa|porta|sposta|avanza|arretra|riporta)\s+(?:(?:la|questa|quella)\s+)?commess[ae]|cambia\s+(?:lo\s+)?stat[oa]\s+(?:della|alla)\s+commess[ae]|fai\s+(?:passare|avanzare|arretrare)\s+(?:(?:la|questa|quella)\s+)?commess[ae]|procedi\s+(?:allo|al|con\s+il)\s+stat[oa])\b/i;
const COMANDO_CORTESE_INIZIALE =
  /^(?:per\s+favore[,\s]+)?(?:puoi|potresti|vorrei\s+che|ti\s+chiedo\s+di)\s+(?:far(?:e)?\s+)?(?:passare|portare|spostare|avanzare|arretrare|riportare)\s+(?:(?:la|questa|quella)\s+)?commess[ae]\b/i;
const PREFISSO_DIRETTO_INIZIALE = /^(?:per\s+favore[,\s]+)?/i;
const CONNETTIVO_CATENA = /\b(?:e|poi|quindi)\s*,?\s*(?:se\s+[^,]{1,120},\s*)?$/i;
const SOLO_VALUTAZIONE_INIZIALE =
  /^(?:dimmi\s+se|verifica\s+se|controlla\s+se|(?:sai|sapresti|mi\s+dici|mi\s+puoi\s+dire)\s+se|posso|potrei|cosa\s+(?:succede|serve)|conviene|sarebbe\s+(?:possibile|meglio)|proponi|consiglia)\b/i;
const NEGAZIONE_COMANDO =
  /\b(?:non\s+(?:puoi|potresti|devi|dovresti|voglio\s+che|passare|portare|spostare|avanzare|arretrare|riportare|cambiare|modificare)|mai\s+(?:passare|portare|spostare|avanzare|arretrare|riportare|cambiare)|senza\s+(?:passare|portare|spostare|avanzare|arretrare|riportare|cambiare))\b/i;
// Esportata per il classificatore condizionale dell'archiviazione (T4): le
// condizioni fuori dal suo set chiuso restano non verificabili anche lì.
export const CONDIZIONE_NON_VERIFICABILE = /(?:^|[^\p{L}])(?:se|qualora|purché)(?=$|[^\p{L}])|(?:^|[^\p{L}])a\s+condizione\s+che(?=$|[^\p{L}])/iu;

const TARGET_STATO: readonly {
  stato: StatoCommessa;
  pattern: RegExp;
}[] = [
  { stato: "preventivo", pattern: /\bpreventiv[oa]\b/gi },
  { stato: "misure_esecutive", pattern: /\bmisure\s+esecutive\b/gi },
  {
    stato: "aggiornamento_contratto",
    pattern: /\baggiornamento\s+(?:del\s+)?contratto\b/gi,
  },
  {
    stato: "fatture_pagamento",
    pattern: /\bfatture?\s+(?:e\s+)?pagament[oi]\b/gi,
  },
  { stato: "da_ordinare", pattern: /\bda\s+ordinare\b/gi },
  { stato: "produzione", pattern: /\bproduzione\b/gi },
  {
    stato: "ordini_ultimazione",
    pattern: /\b(?:ordini?\s+ultimazione|richiesta\s+secondo\s+acconto)\b/gi,
  },
  { stato: "attesa_posa", pattern: /\battesa\s+posa\b/gi },
  { stato: "finiture_saldo", pattern: /\bfiniture\s+saldo\b/gi },
  {
    stato: "interventi_regolazioni",
    pattern: /\binterventi\s+regolazioni\b/gi,
  },
  { stato: "archiviata", pattern: /\barchiviat[oa]\b/gi },
];

export type RichiestaTransizioneEsplicita = {
  nuovoStato: StatoCommessa | null;
  direzione: "avanti" | "indietro" | null;
};

function segmentoComando(testo: string): string | null {
  if (SOLO_VALUTAZIONE_INIZIALE.test(testo) || NEGAZIONE_COMANDO.test(testo)) {
    return null;
  }

  const cortese = COMANDO_CORTESE_INIZIALE.exec(testo);
  if (cortese) return testo.slice(cortese.index);

  const prefisso = PREFISSO_DIRETTO_INIZIALE.exec(testo)?.[0].length ?? 0;
  const direttoIniziale = COMANDO_DIRETTO.exec(testo.slice(prefisso));
  if (direttoIniziale?.index === 0) return testo.slice(prefisso);

  // Una catena può autorizzare soltanto un secondo comando imperativo
  // esplicito ("..., poi passa..."). Forme cortesi/modali nel corpo di mail,
  // citazioni o discorso riportato non vengono mai interpretate come autorità.
  COMANDO_DIRETTO.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COMANDO_DIRETTO.exec(testo)) != null) {
    if (match.index > 0 && CONNETTIVO_CATENA.test(testo.slice(0, match.index))) {
      return testo.slice(match.index);
    }
    // Il pattern non è globale: non ci sono altri match da esaminare.
    break;
  }
  return null;
}

function statoRichiesto(segmento: string): StatoCommessa | null {
  let trovato: { stato: StatoCommessa; indice: number } | null = null;
  for (const candidato of TARGET_STATO) {
    candidato.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = candidato.pattern.exec(segmento)) != null) {
      if (!trovato || match.index >= trovato.indice) {
        trovato = { stato: candidato.stato, indice: match.index };
      }
    }
  }
  return trovato?.stato ?? null;
}

/**
 * Classificatore intenzionalmente chiuso: un falso negativo produce una
 * risposta senza effetto, un falso positivo una scrittura. Restituisce anche
 * il target/direzione da legare all'entità risolta dal server.
 */
export function analizzaRichiestaTransizione(
  messaggio: string
): RichiestaTransizioneEsplicita | null {
  const testo = messaggio.trim();
  if (!testo) return null;
  if (CONDIZIONE_NON_VERIFICABILE.test(testo)) return null;
  const segmento = segmentoComando(testo);
  if (!segmento) return null;
  const nuovoStato = statoRichiesto(segmento);
  if (nuovoStato) return { nuovoStato, direzione: null };
  if (/\b(?:stat[oa]|fase)\s+successiv[oa]\b|\b(?:avanti|avanza)\b/i.test(segmento)) {
    return { nuovoStato: null, direzione: "avanti" };
  }
  if (/\b(?:stat[oa]|fase)\s+precedente\b|\b(?:indietro|arretra)\b/i.test(segmento)) {
    return { nuovoStato: null, direzione: "indietro" };
  }
  return null;
}

/**
 * Classificatore ristretto: un falso negativo produce al massimo una risposta
 * senza effetto; un falso positivo produrrebbe una scrittura. Perciò le forme
 * consultive/negative vincono sempre e le formule accettate sono chiuse.
 */
export function richiestaEsplicitaTransizione(messaggio: string): boolean {
  return analizzaRichiestaTransizione(messaggio) != null;
}

/** Fissa il solo target consentito all'inizio del run, prima del provider. */
export function concretizzaRichiestaTransizione(
  richiesta: RichiestaTransizioneEsplicita,
  commessa: any
): StatoCommessa | null {
  if (richiesta.nuovoStato) return richiesta.nuovoStato;
  const anteprima = verificaTransizioneCommessa({
    commessa,
    haDocumentoRichiesto: dipendenzeTransizioniCommesse().haDocumentoRichiesto,
    documentiRichiesti: dipendenzeTransizioniCommesse().documentiRichiesti,
  });
  return richiesta.direzione === "avanti"
    ? anteprima.successivo
    : richiesta.direzione === "indietro"
      ? anteprima.precedente
      : null;
}

function idCommessa(
  contesto: ContestoRun,
  esplicito: number | undefined
): number | null {
  if (Number.isInteger(esplicito) && Number(esplicito) > 0) {
    return Number(esplicito);
  }
  if (
    contesto.entitaAttiva?.tipo === "commessa" &&
    Number.isInteger(contesto.entitaAttiva.id)
  ) {
    return contesto.entitaAttiva.id;
  }
  const persistito = contesto.contestoConversazione?.commessaId;
  return Number.isInteger(persistito) && Number(persistito) > 0
    ? Number(persistito)
    : null;
}

function haCapability(
  contesto: ContestoRun,
  richieste: readonly ("commessa.read" | "commessa.update_operational" | "commessa.change_state")[]
): boolean {
  return richieste.every(capability => contesto.capability.has(capability));
}

function commessaInSede(contesto: ContestoRun, id: number): any | null {
  const commessa: any = getCommessaById(id);
  return commessa?.sedeId === contesto.sedeId ? commessa : null;
}

function versionePersistitaCoerente(
  contesto: ContestoRun,
  commessa: any
): boolean {
  const persistito = contesto.contestoConversazione;
  if (!persistito || persistito.commessaId !== commessa.id) return true;
  const attesa = persistito.versioniEntita[`commessa:${commessa.id}`];
  return (
    persistito.verifiche.commessa === "verificato" &&
    typeof attesa === "string" &&
    attesa === versioneCommessa(commessa)
  );
}

function contestoAutorizzazione(
  contesto: ContestoRun
): Pick<TrpcContext, "user" | "sedeId" | "sediIds"> {
  return {
    user: {
      id: contesto.utenteId,
      role: contesto.direzione ? "admin" : "user",
      ruolo: contesto.ruoli[0] ?? null,
      ruoli: [...contesto.ruoli],
      name: `Tars — utente ${contesto.utenteId}`,
    } as any,
    sedeId: contesto.sedeId,
    sediIds: [contesto.sedeId],
  };
}

function evidenzaCommessa(commessa: any): EvidenzaTars {
  return {
    tipo: "entita",
    riferimento: `commessa:${commessa.id}`,
    descrizione: `${commessa.codice ?? `Commessa ${commessa.id}`} — ${commessa.cliente ?? "cliente non indicato"}`,
  };
}

function baseAzione(strumento: string) {
  return {
    tipo: "azione" as const,
    strumento,
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
    freschezza: new Date().toISOString(),
  };
}

function nonEseguito(
  strumento: string,
  motivo: string
): EsitoAzione<null> {
  return {
    ...baseAzione(strumento),
    stato: "non_eseguito",
    motivo,
    dati: null,
  };
}

const schemaVerifica = z
  .object({
    commessaId: z.number().int().positive().optional(),
    nuovoStato: z.enum(STATI_COMMESSA).optional(),
  })
  .strict();

const verifica: StrumentoTars = {
  nome: "verifica_transizione_commessa",
  versione: "1.0.0",
  categoria: "commesse",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["commessa.read"],
  interruttore: "tarsReadTools",
  descrizione:
    "Verifica, senza modificare nulla, stato/versione, passaggi adiacenti e gate documentale della commessa attiva o indicata. È la preview autorevole da usare prima di descrivere un avanzamento.",
  schemaInput: schemaVerifica,
  async esegui(contesto, input): Promise<EsitoLettura<unknown>> {
    if (!tarsAttivo("tarsReadTools") || !haCapability(contesto, ["commessa.read"])) {
      throw new Error("NOT_FOUND: commessa non trovata o non autorizzata.");
    }
    const id = idCommessa(contesto, input.commessaId);
    const commessa = id == null ? null : commessaInSede(contesto, id);
    if (!commessa) {
      throw new Error("NOT_FOUND: commessa non trovata o non autorizzata.");
    }
    const dipendenze = dipendenzeTransizioniCommesse();
    const dati = verificaTransizioneCommessa({
      commessa,
      nuovoStato: input.nuovoStato as StatoCommessa | undefined,
      haDocumentoRichiesto: dipendenze.haDocumentoRichiesto,
      documentiRichiesti: dipendenze.documentiRichiesti,
    });
    return {
      dati,
      evidenze: [evidenzaCommessa(commessa)],
      freschezza: new Date().toISOString(),
      fonteAutorevole: FONTE,
      omissioni: [],
      versioniEntita: {
        [`commessa:${commessa.id}`]: versioneCommessa(commessa),
      },
    };
  },
};

const schemaTransizione = z
  .object({
    commessaId: z.number().int().positive().optional(),
    nuovoStato: z.enum(STATI_COMMESSA),
  })
  .strict();

type InputTransizione = z.infer<typeof schemaTransizione> & {
  /** Allegato dal server dopo la preview; non appartiene allo schema provider. */
  __versioneAttesa?: string;
  __firmaAttesa?: string;
};

async function materializzaTransizione(
  contesto: ContestoRun,
  input: InputTransizione
): Promise<
  | { tipo: "input"; input: InputTransizione }
  | { tipo: "esito"; esito: EsitoAzione }
> {
  const nome = "transizione_adiacente_commessa";
  const autorizzazione = contesto.autorizzazioneTransizione;
  if (!autorizzazione) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "La transizione non è stata richiesta esplicitamente: nessuna modifica applicata."
      ),
    };
  }
  if (
    !tarsAttivo("tarsL2Actions") ||
    !haCapability(contesto, [
      "commessa.update_operational",
      "commessa.change_state",
    ])
  ) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "Commessa non trovata o operazione non autorizzata."
      ),
    };
  }
  if (
    input.commessaId != null &&
    input.commessaId !== autorizzazione.commessaId
  ) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "Commessa non trovata o operazione non autorizzata."
      ),
    };
  }
  const id = autorizzazione.commessaId;
  const commessa = id == null ? null : commessaInSede(contesto, id);
  if (!commessa) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "Commessa non trovata o operazione non autorizzata."
      ),
    };
  }
  if (!versionePersistitaCoerente(contesto, commessa)) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "La commessa è cambiata dall'ultima lettura: rileggila prima di modificare lo stato."
      ),
    };
  }
  const dipendenze = dipendenzeTransizioniCommesse();
  const anteprima = verificaTransizioneCommessa({
    commessa,
    nuovoStato: input.nuovoStato,
    haDocumentoRichiesto: dipendenze.haDocumentoRichiesto,
    documentiRichiesti: dipendenze.documentiRichiesti,
  });
  if (input.nuovoStato !== autorizzazione.nuovoStato) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "Il passaggio richiesto non coincide con il comando esplicito dell'utente: nessuna modifica applicata."
      ),
    };
  }
  if (versioneCommessa(commessa) !== autorizzazione.versione) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "La commessa è cambiata dall'ultima lettura: rileggila prima di modificare lo stato."
      ),
    };
  }
  if (!anteprima.consentita) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        anteprima.motivo ?? "La transizione non è consentita nello stato corrente."
      ),
    };
  }
  return {
    tipo: "input",
    input: {
      ...input,
      commessaId: commessa.id,
      __versioneAttesa: anteprima.versione,
      __firmaAttesa: firmaTransizioneCommessa(commessa),
    },
  };
}

function motivoSicuro(errore: unknown): string {
  const testo = errore instanceof Error ? errore.message : "";
  if (testo.includes("VERSIONE_COMMESSA_OBSOLETA")) {
    return "La commessa è cambiata dopo la verifica: nessuna transizione applicata. Rileggila e riprova.";
  }
  if (testo.includes("DOC_GATE_BLOCKED")) {
    return "Il gate documentale corrente non è più soddisfatto: nessuna transizione applicata.";
  }
  if (testo.includes("Transizione non consentita")) {
    return "Lo stato è cambiato e il passaggio richiesto non è più adiacente: nessuna transizione applicata.";
  }
  return "Commessa non trovata o operazione non autorizzata.";
}

const transizione: StrumentoTars<InputTransizione, EsitoAzione> = {
  nome: "transizione_adiacente_commessa",
  versione: "1.0.0",
  categoria: "commesse",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.update_operational", "commessa.change_state"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Cambia lo stato di UNA commessa di un solo passaggio adiacente quando l'utente lo ordina esplicitamente. Usa la state machine e i gate del CRM, non accetta force, rilegge la versione prima dell'effetto e restituisce Undo sicuro.",
  schemaInput: schemaTransizione,
  materializzaInput: materializzaTransizione,
  async esegui(contesto, input): Promise<EsitoAzione> {
    const nome = "transizione_adiacente_commessa";
    const autorizzazione = contesto.autorizzazioneTransizione;
    if (
      !autorizzazione ||
      !tarsAttivo("tarsL2Actions") ||
      !haCapability(contesto, [
        "commessa.update_operational",
        "commessa.change_state",
      ])
    ) {
      return nonEseguito(
        nome,
        "Commessa non trovata o operazione non autorizzata."
      );
    }
    if (
      !Number.isInteger(input.commessaId) ||
      input.commessaId !== autorizzazione.commessaId ||
      !input.__versioneAttesa ||
      !input.__firmaAttesa
    ) {
      return nonEseguito(
        nome,
        "La commessa non è stata verificata: nessuna modifica applicata."
      );
    }
    const commessa = commessaInSede(contesto, input.commessaId!);
    if (!commessa) {
      return nonEseguito(
        nome,
        "Commessa non trovata o operazione non autorizzata."
      );
    }
    const anteprima = verificaTransizioneCommessa({
      commessa,
      nuovoStato: input.nuovoStato,
      haDocumentoRichiesto:
        dipendenzeTransizioniCommesse().haDocumentoRichiesto,
      documentiRichiesti:
        dipendenzeTransizioniCommesse().documentiRichiesti,
    });
    if (input.nuovoStato !== autorizzazione.nuovoStato) {
      return nonEseguito(
        nome,
        "Il passaggio richiesto non coincide con il comando esplicito dell'utente: nessuna modifica applicata."
      );
    }
    if (versioneCommessa(commessa) !== autorizzazione.versione) {
      return nonEseguito(
        nome,
        "La commessa è cambiata dall'ultima lettura: rileggila prima di modificare lo stato."
      );
    }
    try {
      const esito = await eseguiTransizioneCommessa(
        {
          ctx: contestoAutorizzazione(contesto),
          commessaId: input.commessaId!,
          nuovoStato: input.nuovoStato,
          origine: "tars",
          versioneAttesa: input.__versioneAttesa,
          firmaAttesa: input.__firmaAttesa,
          attoreNome: `Tars — utente ${contesto.utenteId}`,
        },
        dipendenzeTransizioniCommesse()
      );
      if (esito.riusata || esito.transizioneId == null) {
        return nonEseguito(
          nome,
          "La commessa è già nello stato richiesto: nessuna modifica applicata."
        );
      }
      const commessa: any = esito.commessa;
      return {
        ...baseAzione(nome),
        stato: "transizione_eseguita",
        motivo: null,
        azioneId: `${nome}:commessa:${commessa.id}:${esito.transizioneId}`,
        auditId: `commesse_transizioni:${esito.transizioneId}`,
        entitaToccate: [`commessa:${commessa.id}`],
        prima: { stato: esito.da, versione: esito.versionePrima },
        dopo: { stato: esito.a, versione: esito.versioneDopo },
        undoDisponibile: true,
        undoEntro:
          "finché stato e versione della commessa restano quelli prodotti da questa transizione",
        undoVia: {
          procedura: "commesse.undoTransizione",
          id: esito.transizioneId,
        },
        dati: {
          commessaId: commessa.id,
          da: esito.da,
          a: esito.a,
          versione: esito.versioneDopo,
        },
        evidenze: [evidenzaCommessa(commessa)],
        freschezza: new Date().toISOString(),
        versioniEntita: {
          [`commessa:${commessa.id}`]: esito.versioneDopo,
        },
      } as EsitoAzione;
    } catch (errore) {
      return nonEseguito(nome, motivoSicuro(errore));
    }
  },
};

export const STRUMENTI_COMMESSE: readonly StrumentoTars[] = [
  verifica,
  transizione,
];
