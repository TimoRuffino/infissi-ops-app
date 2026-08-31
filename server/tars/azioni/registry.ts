import { z } from "zod";
import type { Interruttore } from "../../platform/interruttori";
import { getReminderService } from "../../reminders/service";
import { STRUMENTI_CASI } from "../strumenti/casi";
import { STRUMENTI_DOCUMENTI } from "../strumenti/documenti";
import { STRUMENTI_L0 } from "../strumenti/letture";
import { STRUMENTI_MEMORIA } from "../strumenti/memorie";
import { STRUMENTI_PROMEMORIA } from "../strumenti/promemoria";
import { STRUMENTI_PROPOSTE } from "../strumenti/proposte";
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

export const VERSIONE_REGISTRO_AZIONI = "1.3.0";

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
  })
  .strict();

const schemaUndoVia = z
  .object({
    procedura: z.literal("promemoria.cancel"),
    id: z.number().int().positive(),
  })
  .strict();

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
  leggi_commessa: lettura("entita", ["commessa"], ["commessa"]),
  verifica_gate_commessa: lettura("entita", ["commessa", "documenti-ordini"], ["commessa"]),
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
  leggi_fascicolo_commessa: lettura("entita", ["commessa", "documenti-ordini"], ["commessa", "documento"]),
  leggi_promemoria_in_scadenza: lettura("personale", ["generale", "promemoria"], ["promemoria"]),
  leggi_promemoria: lettura("personale", ["promemoria"], ["promemoria"]),
  crea_promemoria: r1(
    "crea_promemoria",
    "personale",
    ["generale", "promemoria", "commessa"],
    ["promemoria", "commessa", "cliente"],
    ["tars", "tarsReminders"],
    true,
    false,
    async (contesto, argomenti, esito) => {
      const id = esito.undoVia?.procedura === "promemoria.cancel"
        ? esito.undoVia.id
        : null;
      if (id == null) return true;
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
};

const STRUMENTI_CORRENTI: readonly StrumentoTars[] = [
  ...STRUMENTI_L0,
  ...STRUMENTI_PROMEMORIA,
  ...STRUMENTI_CASI,
  ...STRUMENTI_DOCUMENTI,
  ...STRUMENTI_PROPOSTE,
  ...STRUMENTI_MEMORIA,
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
  }
}

const registro = costruisciRegistro().sort((a, b) => a.nome.localeCompare(b.nome));
validaRegistroAzioni(registro);

export const REGISTRO_AZIONI: readonly DescrittoreAzioneTars[] = Object.freeze(registro);
const PER_NOME = new Map(REGISTRO_AZIONI.map(a => [a.nome, a] as const));

export function descrittoreAzione(nome: string): DescrittoreAzioneTars | undefined {
  return PER_NOME.get(nome);
}
