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
    /**
     * Tars libero (02/09/2026 sera): true SOLO se l'utente ha chiesto
     * esplicitamente di arrivare a quello stato o di procedere comunque.
     * Scavalca un gate documentale come «Procedi comunque» dal board; resta
     * registrato e dichiarato nella risposta.
     */
    scavalcaGate: z.boolean().optional(),
  })
  .strict();

type StatoCommessaTars = (typeof STATI_COMMESSA)[number];

type InputTransizione = z.infer<typeof schemaTransizione> & {
  /** Allegati dal server dopo la preview; non appartengono allo schema provider. */
  __versioneAttesa?: string;
  __firmaAttesa?: string;
  __percorso?: StatoCommessaTars[];
};

/** Gli stati da attraversare, uno alla volta, dallo stato corrente a quello chiesto. */
export function percorsoStati(da: string, a: StatoCommessaTars): StatoCommessaTars[] {
  const i = STATI_COMMESSA.indexOf(da as StatoCommessaTars);
  const j = STATI_COMMESSA.indexOf(a);
  if (i < 0 || j < 0 || i === j) return [];
  const passo = j > i ? 1 : -1;
  const tappe: StatoCommessaTars[] = [];
  for (let k = i + passo; passo > 0 ? k <= j : k >= j; k += passo) {
    tappe.push(STATI_COMMESSA[k]);
  }
  return tappe;
}

function etichetteGate(richiesti: readonly string[]): string {
  const dipendenze = dipendenzeTransizioniCommesse();
  return richiesti.map(tipo => dipendenze.etichettaDocumento(tipo)).join(" o ");
}

function leggibile(stato: string): string {
  return stato.replace(/_/g, " ");
}

async function materializzaTransizione(
  contesto: ContestoRun,
  input: InputTransizione
): Promise<
  | { tipo: "input"; input: InputTransizione }
  | { tipo: "esito"; esito: EsitoAzione }
> {
  const nome = "transizione_adiacente_commessa";
  // Tars libero (02/09/2026): nessuna autorità derivata dal testo. La
  // commessa è quella indicata dal modello o quella attiva e verificata
  // nella conversazione; sede, capability, versione, state machine e gate
  // li verifica il dominio. Lo stato chiesto può non essere adiacente: lo
  // strumento fa i passaggi uno alla volta, ognuno registrato e annullabile.
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
  const id =
    input.commessaId ??
    (contesto.contestoConversazione?.verifiche.commessa === "verificato"
      ? contesto.contestoConversazione.commessaId
      : null);
  if (id == null) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "Non so quale commessa cambiare: indica il codice o il cliente."
      ),
    };
  }
  const commessa = commessaInSede(contesto, id);
  if (!commessa) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        "Commessa non trovata o operazione non autorizzata."
      ),
    };
  }
  if (commessa.stato === input.nuovoStato) {
    return {
      tipo: "esito",
      esito: nonEseguito(nome, "La commessa è già nello stato richiesto."),
    };
  }
  const percorso = percorsoStati(commessa.stato, input.nuovoStato);
  if (percorso.length === 0) {
    return {
      tipo: "esito",
      esito: nonEseguito(nome, "Stato non riconosciuto dalla state machine della commessa."),
    };
  }
  const dipendenze = dipendenzeTransizioniCommesse();
  const anteprima = verificaTransizioneCommessa({
    commessa,
    nuovoStato: percorso[0],
    haDocumentoRichiesto: dipendenze.haDocumentoRichiesto,
    documentiRichiesti: dipendenze.documentiRichiesti,
  });
  if (!anteprima.consentita && !(anteprima.gate.bloccante && input.scavalcaGate)) {
    return {
      tipo: "esito",
      esito: nonEseguito(
        nome,
        anteprima.gate.bloccante
          ? `Passaggio da «${leggibile(commessa.stato)}» a «${leggibile(percorso[0])}» bloccato dal gate documentale: manca «${etichetteGate(anteprima.gate.richiesti)}». Se l'utente vuole procedere comunque, richiama lo strumento con scavalcaGate: true (resta registrato).`
          : (anteprima.motivo ?? "La transizione non è consentita nello stato corrente.")
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
      __percorso: percorso,
    },
  };
}

function motivoSicuro(errore: unknown): string {
  const testo = errore instanceof Error ? errore.message : "";
  if (testo.includes("VERSIONE_COMMESSA_OBSOLETA")) {
    return "La commessa è cambiata durante il passaggio: fermato qui. Rileggila e riprova.";
  }
  if (testo.includes("DOC_GATE_BLOCKED")) {
    // Lo stesso prefisso copre due gate diversi: dire «documentale» quando a
    // mancare è il computo manderebbe l'utente a cercare un file inesistente.
    return testo.includes("computo dei limiti")
      ? "Il computo dei limiti manca o non è aggiornato: fermato qui."
      : "Il gate documentale ha bloccato il passaggio: fermato qui.";
  }
  if (testo.includes("Transizione non consentita")) {
    return "Lo stato è cambiato e il passaggio richiesto non è più valido: fermato qui.";
  }
  return "Commessa non trovata o operazione non autorizzata.";
}

type PassoTransizione = {
  da: string;
  a: string;
  transizioneId: number;
  gateScavalcato: boolean;
  versionePrima: string;
  versioneDopo: string;
};

const transizione: StrumentoTars<InputTransizione, EsitoAzione> = {
  nome: "transizione_adiacente_commessa",
  versione: "1.1.0",
  categoria: "commesse",
  livello: "L2",
  effetto: "interno",
  reversibile: true,
  capability: ["commessa.update_operational", "commessa.change_state"],
  interruttore: "tarsL2Actions",
  descrizione:
    "Porta UNA commessa allo stato chiesto (commessa indicata o quella attiva nella conversazione), anche non adiacente: fa i passaggi uno alla volta con la state machine del CRM, ognuno registrato e annullabile. Se un gate documentale blocca, si ferma e dice cosa manca; con scavalcaGate: true — SOLO quando l'utente ha chiesto esplicitamente di arrivare a quello stato o di procedere comunque — scavalca il gate come «Procedi comunque» dal board (registrato). Sinonimi: «finita / lavori finiti» → finiture_saldo; «interventi» → interventi_regolazioni; «chiusa / archiviata» → archiviata.",
  schemaInput: schemaTransizione,
  materializzaInput: materializzaTransizione,
  async esegui(contesto, input): Promise<EsitoAzione> {
    const nome = "transizione_adiacente_commessa";
    if (
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
    if (!Number.isInteger(input.commessaId)) {
      return nonEseguito(
        nome,
        "La commessa non è stata verificata: nessuna modifica applicata."
      );
    }
    const commessaId = input.commessaId!;
    if (!commessaInSede(contesto, commessaId)) {
      return nonEseguito(
        nome,
        "Commessa non trovata o operazione non autorizzata."
      );
    }
    if (
      !input.__versioneAttesa ||
      !input.__firmaAttesa ||
      !input.__percorso?.length
    ) {
      return nonEseguito(
        nome,
        "La commessa non è stata verificata: nessuna modifica applicata."
      );
    }
    const dipendenze = dipendenzeTransizioniCommesse();
    const passi: PassoTransizione[] = [];
    const avvertenze: string[] = [];
    let versioneAttesa: string = input.__versioneAttesa;
    let firmaAttesa: string = input.__firmaAttesa;
    let blocco: string | null = null;

    for (const tappa of input.__percorso) {
      const corrente = commessaInSede(contesto, commessaId);
      if (!corrente) {
        blocco = "Commessa non trovata o operazione non autorizzata.";
        break;
      }
      const verifica = verificaTransizioneCommessa({
        commessa: corrente,
        nuovoStato: tappa,
        haDocumentoRichiesto: dipendenze.haDocumentoRichiesto,
        documentiRichiesti: dipendenze.documentiRichiesti,
      });
      let bypass = false;
      if (!verifica.consentita) {
        if (verifica.gate.bloccante && input.scavalcaGate) {
          bypass = true;
          avvertenze.push(
            `Gate documentale scavalcato su richiesta: mancava «${etichetteGate(verifica.gate.richiesti)}» per lo stato «${leggibile(corrente.stato)}».`
          );
        } else if (verifica.gate.bloccante) {
          blocco = `Fermato a «${leggibile(corrente.stato)}»: il passaggio a «${leggibile(tappa)}» è bloccato dal gate documentale, manca «${etichetteGate(verifica.gate.richiesti)}». Se l'utente vuole procedere comunque, richiama lo strumento con scavalcaGate: true (resta registrato).`;
          break;
        } else {
          blocco = verifica.motivo ?? "La transizione non è consentita nello stato corrente.";
          break;
        }
      }
      try {
        const esito = await eseguiTransizioneCommessa(
          {
            ctx: contestoAutorizzazione(contesto),
            commessaId,
            nuovoStato: tappa,
            origine: "tars",
            versioneAttesa,
            firmaAttesa,
            bypassGateDocumentale: bypass,
            attoreNome: `Tars — utente ${contesto.utenteId}`,
          },
          dipendenze
        );
        if (esito.riusata || esito.transizioneId == null) {
          blocco = "La commessa è già nello stato richiesto.";
          break;
        }
        passi.push({
          da: esito.da,
          a: esito.a,
          transizioneId: esito.transizioneId,
          gateScavalcato: bypass,
          versionePrima: esito.versionePrima,
          versioneDopo: esito.versioneDopo,
        });
        versioneAttesa = esito.versioneDopo;
        const rilettura = commessaInSede(contesto, commessaId);
        if (!rilettura) {
          blocco = "Commessa non trovata o operazione non autorizzata.";
          break;
        }
        firmaAttesa = firmaTransizioneCommessa(rilettura);
      } catch (errore) {
        blocco = motivoSicuro(errore);
        break;
      }
    }

    if (passi.length === 0) {
      return nonEseguito(nome, blocco ?? "Nessun passaggio eseguito.");
    }
    const ultimo = passi[passi.length - 1];
    const commessa: any = commessaInSede(contesto, commessaId) ?? { id: commessaId };
    const arrivata = ultimo.a === input.nuovoStato;
    return {
      ...baseAzione(nome),
      stato: arrivata ? "transizione_eseguita" : "transizione_parziale",
      motivo: arrivata ? null : blocco,
      azioneId: `${nome}:commessa:${commessaId}:${ultimo.transizioneId}`,
      auditId: `commesse_transizioni:${ultimo.transizioneId}`,
      entitaToccate: [`commessa:${commessaId}`],
      prima: { stato: passi[0].da, versione: passi[0].versionePrima },
      dopo: { stato: ultimo.a, versione: ultimo.versioneDopo },
      undoDisponibile: true,
      undoEntro:
        "finché stato e versione della commessa restano quelli prodotti dall'ultimo passaggio; i passaggi si annullano uno alla volta, dall'ultimo",
      undoVia: {
        procedura: "commesse.undoTransizione",
        id: ultimo.transizioneId,
      },
      avvertenze,
      dati: {
        commessaId,
        da: passi[0].da,
        a: ultimo.a,
        statoChiesto: input.nuovoStato,
        arrivata,
        passi,
        versione: ultimo.versioneDopo,
      },
      evidenze: [evidenzaCommessa(commessa)],
      freschezza: new Date().toISOString(),
      versioniEntita: {
        [`commessa:${commessaId}`]: ultimo.versioneDopo,
      },
    } as EsitoAzione;
  },
};

export const STRUMENTI_COMMESSE: readonly StrumentoTars[] = [
  verifica,
  transizione,
];
