// Strumenti memoria di Tars (T7) — spec §25. `ricorda` vale SOLO su
// richiesta esplicita dell'utente (regola nel prompt: mai ipotesi del
// modello); perimetro sede riservato alla direzione; `dimentica`
// INVALIDA e non cancella. Richiesta esplicita personale = zero
// conferme, con invalidazione a un passo come undo.

import { z } from "zod";
import { tarsAttivo } from "../../platform/interruttori";
import {
  creaMemoria,
  invalidaMemoria,
  memoriaById,
  memorieValide,
  TIPI_MEMORIA,
} from "../memoria";
import type { EsitoAzione, StrumentoTars } from "./tipi";

function assicuraMemoria(): void {
  if (!tarsAttivo("tarsMemory")) {
    throw new Error(
      "FORBIDDEN: la memoria di Tars è disattivata (kill switch)."
    );
  }
}

function base(strumento: string) {
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
    evidenze: [] as Array<{
      tipo: "entita";
      riferimento: string;
      descrizione: string;
    }>,
    freschezza: new Date().toISOString(),
  };
}

const ricorda: StrumentoTars = {
  nome: "ricorda",
  versione: "1.0.0",
  categoria: "memoria",
  livello: "L1",
  effetto: "interno",
  reversibile: true,
  capability: [],
  interruttore: "tarsMemory",
  descrizione:
    "Registra una memoria SOLO quando l'utente lo chiede esplicitamente («ricordati che…»). Contenuto breve e fattuale, mai ipotesi tue. Perimetro «sede» (convenzioni condivise) solo per la direzione.",
  schemaInput: z
    .object({
      contenuto: z.string().min(3).max(200),
      tipo: z.enum(TIPI_MEMORIA).default("preferenza"),
      perimetro: z.enum(["utente", "sede"]).default("utente"),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraMemoria();
    const nome = "ricorda";
    if (input.perimetro === "sede" && !contesto.direzione) {
      return {
        ...base(nome),
        stato: "non_eseguito",
        motivo:
          "Le memorie di sede (convenzioni condivise) le registra solo la direzione: posso salvarla come preferenza personale.",
        dati: null,
      };
    }
    const memoria = creaMemoria({
      sedeId: contesto.sedeId,
      perimetro: input.perimetro,
      utenteId: contesto.utenteId,
      tipo: input.tipo,
      contenuto: input.contenuto,
    });
    return {
      ...base(nome),
      stato: "ricordato",
      motivo: null,
      azioneId: `${nome}:memoria:${memoria.id}`,
      auditId: `tars_memoria:${memoria.id}`,
      entitaToccate: [`memoria:${memoria.id}`],
      dopo: {
        memoriaId: memoria.id,
        tipo: memoria.tipo,
        perimetro: memoria.perimetro,
        contenuto: memoria.contenuto,
      },
      undoDisponibile: false,
      undoEntro: null,
      undoVia: null,
      avvertenze: [
        `Per rimuoverla: «dimentica la memoria ${memoria.id}».`,
      ],
      dati: { memoriaId: memoria.id },
      evidenze: [
        {
          tipo: "entita",
          riferimento: `memoria:${memoria.id}`,
          descrizione: `${memoria.tipo} — ${memoria.contenuto}`,
        },
      ],
    };
  },
};

const dimentica: StrumentoTars = {
  nome: "dimentica",
  versione: "1.0.0",
  categoria: "memoria",
  livello: "L1",
  effetto: "interno",
  reversibile: false,
  capability: [],
  interruttore: "tarsMemory",
  descrizione:
    "Invalida una memoria registrata (non la cancella: la storia resta). Le proprie sempre; quelle di sede solo la direzione.",
  schemaInput: z
    .object({
      memoriaId: z.number().int().positive(),
      motivo: z.string().max(200).default("richiesta dell'utente"),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    assicuraMemoria();
    const nome = "dimentica";
    const memoria = memoriaById(contesto.sedeId, input.memoriaId);
    if (
      !memoria ||
      (memoria.perimetro === "utente" && memoria.utenteId !== contesto.utenteId)
    ) {
      return {
        ...base(nome),
        stato: "non_eseguito",
        motivo: "Memoria non trovata.",
        dati: null,
      };
    }
    if (memoria.perimetro === "sede" && !contesto.direzione) {
      return {
        ...base(nome),
        stato: "non_eseguito",
        motivo: "Le memorie di sede le invalida solo la direzione.",
        dati: null,
      };
    }
    const giaInvalida = !memoria.valida;
    const aggiornata = invalidaMemoria({
      sedeId: contesto.sedeId,
      id: input.memoriaId,
      motivo: input.motivo,
    })!;
    return {
      ...base(nome),
      stato: giaInvalida ? "gia_dimenticata" : "dimenticata",
      motivo: null,
      azioneId: `${nome}:memoria:${aggiornata.id}`,
      auditId: `tars_memoria:${aggiornata.id}`,
      entitaToccate: [`memoria:${aggiornata.id}`],
      prima: { valida: !giaInvalida },
      dopo: { valida: false, motivo: aggiornata.motivoInvalidazione },
      avvertenze: [
        "L'invalidazione non si annulla: se serve di nuovo, registrala di nuovo.",
      ],
      dati: { memoriaId: aggiornata.id },
      evidenze: [
        {
          tipo: "entita",
          riferimento: `memoria:${aggiornata.id}`,
          descrizione: aggiornata.contenuto,
        },
      ],
    };
  },
};

const leggiMemorie: StrumentoTars = {
  nome: "leggi_memorie",
  versione: "1.0.0",
  categoria: "memoria",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: [],
  interruttore: "tarsMemory",
  descrizione:
    "Le memorie valide che valgono per l'utente corrente (personali + di sede), con id per poterle invalidare.",
  schemaInput: z.object({}).strict(),
  async esegui(contesto) {
    assicuraMemoria();
    const valide = memorieValide(contesto.sedeId, contesto.utenteId);
    return {
      dati: {
        memorie: valide.map(m => ({
          id: m.id,
          tipo: m.tipo,
          perimetro: m.perimetro,
          contenuto: m.contenuto,
          creataIl: m.creataIl,
        })),
      },
      evidenze: valide.slice(0, 10).map(m => ({
        tipo: "entita" as const,
        riferimento: `memoria:${m.id}`,
        descrizione: `${m.tipo} — ${m.contenuto}`,
      })),
      freschezza: new Date().toISOString(),
      fonteAutorevole:
        "Memoria di Tars (registrata su richiesta esplicita): i dati correnti del CRM prevalgono.",
      omissioni: [],
      versioniEntita: { "memorie-personali": "volatile" },
    };
  },
};

export const STRUMENTI_MEMORIA: readonly StrumentoTars[] = [
  ricorda,
  dimentica,
  leggiMemorie,
];
