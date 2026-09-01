// Strumenti L0 clienti (accesso ampliato, decisione direzione 01/09/2026):
// ricerca e scheda cliente. Stesse regole delle altre letture: sede-scoped
// (cross-sede ⇒ NOT_FOUND), economia solo con `economia.read`/
// `pagamento.read` e omissione dichiarata, archiviati (clienti e commesse)
// fuori dai quadri operativi salvo richiesta esplicita. Riusa gli store
// esistenti del CRM, nessuna query parallela.

import { z } from "zod";
import { getClienteById, getClientiStore } from "../../routers/clienti";
import { getCommesseStore } from "../../routers/commesse";
import type {
  ContestoRun,
  EsitoLettura,
  EvidenzaTars,
  StrumentoTars,
} from "./tipi";

const FONTE_CRM =
  "CRM Ruffino Flow (memoria viva; senza DATABASE_URL i dati locali sono volatili)";

function lettura<T>(input: {
  dati: T;
  evidenze?: EvidenzaTars[];
  omissioni?: string[];
  versioniEntita?: Record<string, string>;
}): EsitoLettura<T> {
  return {
    dati: input.dati,
    evidenze: input.evidenze ?? [],
    freschezza: new Date().toISOString(),
    fonteAutorevole: FONTE_CRM,
    omissioni: input.omissioni ?? [],
    versioniEntita: input.versioniEntita ?? {},
  };
}

function conEconomia(contesto: ContestoRun): boolean {
  return (
    contesto.capability.has("economia.read") ||
    contesto.capability.has("pagamento.read")
  );
}

function denominazione(cliente: any): string {
  return [cliente.cognome, cliente.nome]
    .map(parte => String(parte ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

// ── cerca_clienti ────────────────────────────────────────────────────────

const cercaClienti: StrumentoTars = {
  nome: "cerca_clienti",
  versione: "1.0.0",
  categoria: "clienti",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["cliente.read"],
  interruttore: "tarsReadTools",
  descrizione:
    "Cerca i clienti della sede per nome, città o contatto; gli archiviati sono esclusi e compaiono solo con archiviati=true. Restituisce righe anagrafiche senza importi (per la scheda completa usa leggi_cliente).",
  schemaInput: z
    .object({
      testo: z.string().max(80).optional(),
      tipo: z
        .enum(["privato", "azienda", "condominio", "ente_pubblico"])
        .optional(),
      archiviati: z.boolean().default(false),
      limite: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  async esegui(contesto, input) {
    const filtro = (input.testo ?? "").trim().toLowerCase();
    const righe = (getClientiStore() as any[])
      .filter(c => c.sedeId === contesto.sedeId)
      .filter(c => (input.archiviati ? true : !c.archivedAt))
      .filter(c => !input.tipo || c.tipo === input.tipo)
      .filter(
        c =>
          !filtro ||
          denominazione(c).toLowerCase().includes(filtro) ||
          String(c.citta ?? "").toLowerCase().includes(filtro) ||
          String(c.email ?? "").toLowerCase().includes(filtro) ||
          String(c.telefono ?? "").toLowerCase().includes(filtro)
      )
      .slice(0, input.limite)
      .map(c => ({
        id: c.id,
        denominazione: denominazione(c),
        tipo: c.tipo ?? "privato",
        citta: c.citta ?? null,
        archiviato: Boolean(c.archivedAt),
        commesseCollegate: Array.isArray(c.commesseIds)
          ? c.commesseIds.length
          : 0,
      }));
    return lettura({
      dati: { clienti: righe, totaleTrovati: righe.length },
      evidenze: righe.slice(0, 10).map(r => ({
        tipo: "entita" as const,
        riferimento: `cliente:${r.id}`,
        descrizione: r.denominazione,
      })),
      omissioni: input.archiviati
        ? []
        : [
            "I clienti archiviati sono esclusi: ripeti la ricerca con archiviati=true per consultare l'archivio.",
          ],
      versioniEntita: { clienti: "volatile" },
    });
  },
};

// ── leggi_cliente ────────────────────────────────────────────────────────

const leggiCliente: StrumentoTars = {
  nome: "leggi_cliente",
  versione: "1.0.0",
  categoria: "clienti",
  livello: "L0",
  effetto: "nessuno",
  reversibile: true,
  capability: ["cliente.read"],
  interruttore: "tarsReadTools",
  descrizione:
    "La scheda completa di un cliente della sede: anagrafica, contatti, referenti, pratiche (detrazione/edilizia) e le commesse ATTIVE collegate; le archiviate compaiono solo come conteggio (per consultarle usa cerca_commesse con stato «archiviata»). L'economia aggregata richiede le capability economiche.",
  schemaInput: z
    .object({ clienteId: z.number().int().positive() })
    .strict(),
  async esegui(contesto, input) {
    const cliente: any = getClienteById(input.clienteId);
    if (!cliente || cliente.sedeId !== contesto.sedeId) {
      throw new Error("NOT_FOUND: cliente non trovato.");
    }
    const collegate = (getCommesseStore() as any[]).filter(
      c => c.sedeId === contesto.sedeId && c.clienteId === cliente.id
    );
    const archiviate = collegate.filter(
      c => c.stato === "archiviata" || c.archivedAt
    );
    const attive = collegate
      .filter(c => c.stato !== "archiviata" && !c.archivedAt)
      .map(c => ({
        id: c.id,
        codice: c.codice,
        stato: c.stato,
        priorita: c.priorita ?? "media",
        dataConsegnaConfermata: c.dataConsegnaConfermata ?? null,
        daSaldare:
          (c.importoTotale ?? 0) > 0 &&
          (c.importoTotale ?? 0) - (c.importoIncassato ?? 0) > 0,
      }));
    // Economia aggregata sulle sole commesse ATTIVE: il perimetro
    // archiviate resta consultabile a parte, mai sommato di nascosto.
    const economia = conEconomia(contesto)
      ? attive.reduce(
          (somma, riga) => {
            const c = collegate.find(x => x.id === riga.id);
            const totale = c?.importoTotale ?? 0;
            const incassato = c?.importoIncassato ?? 0;
            return {
              importoTotaleAttive:
                Math.round((somma.importoTotaleAttive + totale) * 100) / 100,
              importoIncassatoAttive:
                Math.round((somma.importoIncassatoAttive + incassato) * 100) /
                100,
              residuoAttive:
                Math.round(
                  (somma.residuoAttive + Math.max(0, totale - incassato)) * 100
                ) / 100,
            };
          },
          {
            importoTotaleAttive: 0,
            importoIncassatoAttive: 0,
            residuoAttive: 0,
          }
        )
      : null;
    return lettura({
      dati: {
        anagrafica: {
          id: cliente.id,
          denominazione: denominazione(cliente),
          nome: cliente.nome ?? null,
          cognome: cliente.cognome ?? null,
          tipo: cliente.tipo ?? "privato",
          codiceFiscale: cliente.codiceFiscale ?? null,
          partitaIva: cliente.partitaIva ?? null,
          telefono: cliente.telefono ?? null,
          email: cliente.email ?? null,
          referenti: Array.isArray(cliente.referenti)
            ? cliente.referenti.map((r: any) => ({
                nome: r.nome ?? null,
                ruolo: r.ruolo ?? null,
                telefono: r.telefono ?? null,
                email: r.email ?? null,
              }))
            : [],
          archiviato: Boolean(cliente.archivedAt),
        },
        indirizzi: {
          residenza: {
            indirizzo: cliente.indirizzo ?? null,
            citta: cliente.citta ?? null,
            cap: cliente.cap ?? null,
          },
          sedeLavori: {
            indirizzo: cliente.indirizzoLavoro ?? null,
            citta: cliente.cittaLavoro ?? null,
            cap: cliente.capLavoro ?? null,
          },
        },
        pratiche: {
          detrazione: cliente.detrazione ?? null,
          tipoDetrazione: cliente.tipoDetrazione ?? null,
          praticaEdilizia: cliente.praticaEdilizia ?? null,
          interesseFinanziamento: cliente.interesseFinanziamento ?? null,
        },
        note: cliente.note ?? null,
        commesse: {
          attive,
          archiviateTotale: archiviate.length,
        },
        economia,
      },
      evidenze: [
        {
          tipo: "entita" as const,
          riferimento: `cliente:${cliente.id}`,
          descrizione: denominazione(cliente),
        },
        ...attive.slice(0, 8).map(c => ({
          tipo: "entita" as const,
          riferimento: `commessa:${c.id}`,
          descrizione: `${c.codice} — ${c.stato}`,
        })),
      ],
      omissioni: [
        ...(archiviate.length > 0
          ? [
              `${archiviate.length} commesse archiviate collegate: sono lavoro concluso, consultale con cerca_commesse stato «archiviata».`,
            ]
          : []),
        ...(economia
          ? []
          : [
              "economia (importi, incassato, residuo): richiede pagamento.read/economia.read",
            ]),
      ],
      versioniEntita: {
        [`cliente:${cliente.id}`]: String(
          new Date(cliente.updatedAt ?? 0).getTime() || "-"
        ),
      },
    });
  },
};

export const STRUMENTI_CLIENTI: readonly StrumentoTars[] = [
  cercaClienti,
  leggiCliente,
];
