// Fatture in Cloud → fatture emesse, dentro il CRM.
//
// Sola lettura verso FIC, come sempre. Le fatture entrano in uno store
// locale e da lì:
//   - alimentano la pagina Economia (fatturato, incassato, da incassare)
//   - generano PROPOSTE di riconciliazione: pattuito e rate arrivano
//     dalle fatture, ma li scrive un click di approvazione, mai il sync.
//     Sono soldi: un aggancio sbagliato sporca marginalità e residui.
//
// La riconciliazione è deterministica — niente LLM. Regole leggibili:
// match esatto → proposta; ambiguo → resta in coda «da riconciliare»
// finché un operatore non collega la fattura a mano.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import {
  assertSedeScope,
  requireDirezioneOAmministrazione,
} from "../_core/permissions";
import { getClientiStore } from "./clienti";
import { getCommesseStore, getCommessaById } from "./commesse";
import { DEFAULT_SEDE_ID } from "./sedi";
import {
  proposte,
  newPropostaId,
  propostaGiaRifiutata,
  saveProposte,
  type Proposta,
} from "../tars/stores";

// ── Store ───────────────────────────────────────────────────────────────────

export type RataFic = {
  importo: number;
  scadenza: string | null; // "YYYY-MM-DD"
  stato: "paid" | "not_paid" | "reversed" | string;
  dataPagamento: string | null;
};

export type FatturaFic = {
  id: number; // id FIC — chiave dell'upsert
  // La sede il cui token FIC ha letto questa fattura. Due sedi possono
  // fatturare da due aziende diverse: senza questo campo le fatture di una
  // comparirebbero nell'Economia dell'altra.
  sedeId: number;
  tipo: "invoice" | "credit_note";
  numero: string; // "12/A"
  data: string; // "YYYY-MM-DD"
  clienteNome: string;
  clienteVat: string | null;
  clienteCf: string | null;
  importoNetto: number;
  importoIva: number;
  importoLordo: number;
  rate: RataFic[];
  // Aggancio nel CRM. clienteId dal match sul nome; commessaId quando il
  // match è certo o l'operatore l'ha collegata a mano.
  clienteId: number | null;
  commessaId: number | null;
  collegataAMano: boolean;
  ignorata: boolean;
  // Già esaminata da Tars per il collegamento: una fattura ambigua si paga
  // una volta sola, come le mail.
  tarsAnalizzata: boolean;
  presenteInFic: boolean;
  ultimoSyncId: string | null;
  ultimoVistoAt: Date | null;
  aggiornataAt: Date;
};

const _fattureStore = persistedStore<FatturaFic>("fic_fatture", items => {
  for (const f of items) {
    if (f.tarsAnalizzata === undefined) f.tarsAnalizzata = false;
    // Tutto lo storico è stato letto col token dell'unica sede esistente.
    if (f.sedeId === undefined) f.sedeId = DEFAULT_SEDE_ID;
    if (f.tipo === undefined) f.tipo = "invoice";
    if (f.importoIva === undefined) {
      f.importoIva = Math.max(0, f.importoLordo - f.importoNetto);
    }
    if (f.presenteInFic === undefined) f.presenteInFic = true;
    if (f.ultimoSyncId === undefined) f.ultimoSyncId = null;
    if (f.ultimoVistoAt === undefined) f.ultimoVistoAt = null;
  }
});
export const ficFatture = _fattureStore.items;
export const saveFicFatture = () => _fattureStore.save();

let scaricaFatturaPdfForTests:
  | ((sedeId: number, ficId: number) => Promise<Buffer>)
  | null = null;
export function _setScaricaFatturaPdfForTests(
  fn: ((sedeId: number, ficId: number) => Promise<Buffer>) | null
): void {
  scaricaFatturaPdfForTests = fn;
}

// ── Normalizzazione nomi (stessa della migrazione clienti) ──────────────────

function stripAcc(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
export function normKey(s: string): string {
  return stripAcc(s)
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

// ── Ingestione (chiamata dal sync FIC) ──────────────────────────────────────

/**
 * Upsert delle fatture lette dall'API. Idempotente per id FIC: rilanciare
 * il sync aggiorna stati di pagamento e importi, non duplica. Il match del
 * cliente si rifà a ogni giro (l'anagrafica nel frattempo può essere
 * cresciuta); il commessaId collegato A MANO non si tocca mai.
 */
export type DocumentoEmessoFicInput = Pick<
  FatturaFic,
  | "id"
  | "tipo"
  | "numero"
  | "data"
  | "clienteNome"
  | "clienteVat"
  | "clienteCf"
  | "importoNetto"
  | "importoIva"
  | "importoLordo"
  | "rate"
>;

export function upsertDocumentiEmessi(
  rows: DocumentoEmessoFicInput[],
  sedeId: number,
  syncId: string | null = null
): { nuove: number; aggiornate: number; idsVariati: number[] } {
  // Il match del cliente resta dentro la sede: un omonimo altrove non deve
  // agganciare la fattura al cliente sbagliato.
  const clienti = getClientiStore().filter(
    (c: any) => (c.sedeId ?? DEFAULT_SEDE_ID) === sedeId
  );
  const perNome = new Map<string, number[]>();
  for (const c of clienti) {
    const k = normKey(`${c.cognome ?? ""} ${c.nome ?? ""}`);
    if (!k) continue;
    perNome.set(k, [...(perNome.get(k) ?? []), c.id]);
  }

  let nuove = 0;
  let aggiornate = 0;
  const idsVariati: number[] = [];
  for (const r of rows) {
    const k = normKey(r.clienteNome);
    const match = perNome.get(k);
    const clienteId = match && match.length === 1 ? match[0] : null;

    const esistente = ficFatture.find(
      f => f.id === r.id && f.sedeId === sedeId
    );
    if (esistente) {
      const firmaPrima = JSON.stringify({
        tipo: esistente.tipo,
        data: esistente.data,
        netto: esistente.importoNetto,
        iva: esistente.importoIva,
        lordo: esistente.importoLordo,
        rate: esistente.rate,
      });
      esistente.tipo = r.tipo;
      esistente.numero = r.numero;
      esistente.data = r.data;
      esistente.clienteNome = r.clienteNome;
      esistente.clienteVat = r.clienteVat;
      esistente.clienteCf = r.clienteCf;
      esistente.importoNetto = r.importoNetto;
      esistente.importoIva = r.importoIva;
      esistente.importoLordo = r.importoLordo;
      esistente.rate = r.rate;
      if (!esistente.collegataAMano) {
        esistente.clienteId = clienteId ?? esistente.clienteId;
      }
      esistente.presenteInFic = true;
      esistente.ultimoSyncId = syncId;
      esistente.ultimoVistoAt = new Date();
      esistente.aggiornataAt = new Date();
      const firmaDopo = JSON.stringify({
        tipo: esistente.tipo,
        data: esistente.data,
        netto: esistente.importoNetto,
        iva: esistente.importoIva,
        lordo: esistente.importoLordo,
        rate: esistente.rate,
      });
      if (firmaPrima !== firmaDopo) idsVariati.push(r.id);
      aggiornate++;
    } else {
      ficFatture.push({
        ...r,
        sedeId,
        clienteId,
        commessaId: null,
        collegataAMano: false,
        ignorata: false,
        tarsAnalizzata: false,
        presenteInFic: true,
        ultimoSyncId: syncId,
        ultimoVistoAt: new Date(),
        aggiornataAt: new Date(),
      });
      idsVariati.push(r.id);
      nuove++;
    }
  }
  if (rows.length > 0) saveFicFatture();
  return { nuove, aggiornate, idsVariati };
}

export function upsertFatture(
  rows: Array<
    Omit<DocumentoEmessoFicInput, "tipo" | "importoIva"> & {
      importoIva?: number;
    }
  >,
  sedeId: number
): { nuove: number; aggiornate: number } {
  const { nuove, aggiornate } = upsertDocumentiEmessi(
    rows.map(row => ({
      ...row,
      tipo: "invoice" as const,
      importoIva:
        row.importoIva ?? Math.max(0, row.importoLordo - row.importoNetto),
    })),
    sedeId
  );
  return { nuove, aggiornate };
}

export function finalizzaSnapshotDocumentiEmessi(args: {
  sedeId: number;
  tipo: FatturaFic["tipo"];
  periodoDa: string;
  periodoA: string;
  syncId: string;
  completo: boolean;
}): number {
  if (!args.completo) return 0;
  let rimossi = 0;
  for (const documento of ficFatture) {
    if (
      documento.sedeId !== args.sedeId ||
      documento.tipo !== args.tipo ||
      documento.data < args.periodoDa ||
      documento.data > args.periodoA ||
      documento.ultimoSyncId === args.syncId ||
      !documento.presenteInFic
    ) {
      continue;
    }
    documento.presenteInFic = false;
    documento.aggiornataAt = new Date();
    rimossi++;
  }
  if (rimossi > 0) saveFicFatture();
  return rimossi;
}

// ── Riconciliazione ─────────────────────────────────────────────────────────

const MAX_PROPOSTE_PER_GIRO = 15;
const MAX_PENDENTI_PER_COMMESSA = 3;

/**
 * La commessa giusta per una fattura, solo quando è indiscutibile:
 *   1. collegata a mano → quella
 *   2. cliente con UNA sola commessa attiva → quella
 *   3. cliente con più commesse: una sola col pattuito ≈ lordo (±1€) → quella
 * Tutto il resto → null, e la fattura resta «da riconciliare».
 */
export function commessaPerFattura(
  f: FatturaFic,
  commesse: any[]
): { commessa: any | null; motivo: string } {
  if (f.commessaId != null) {
    const c = commesse.find(x => x.id === f.commessaId);
    return { commessa: c ?? null, motivo: "Collegata dall'operatore." };
  }
  if (f.clienteId == null) {
    return {
      commessa: null,
      motivo: "Cliente non riconosciuto in anagrafica.",
    };
  }
  const sue = commesse.filter(
    c => c.clienteId === f.clienteId && !c.archivedAt
  );
  if (sue.length === 1) {
    return {
      commessa: sue[0],
      motivo: `Il cliente ha una sola commessa attiva (${sue[0].codice}).`,
    };
  }
  if (sue.length > 1) {
    const perImporto = sue.filter(
      c =>
        c.importoTotale != null &&
        Math.abs(c.importoTotale - f.importoLordo) <= 1
    );
    if (perImporto.length === 1) {
      return {
        commessa: perImporto[0],
        motivo: `L'importo della fattura coincide col pattuito di ${perImporto[0].codice}.`,
      };
    }
    return {
      commessa: null,
      motivo: `Il cliente ha ${sue.length} commesse attive: ambigua.`,
    };
  }
  return { commessa: null, motivo: "Il cliente non ha commesse attive." };
}

function esisteRataInCommessa(
  commessa: any,
  rata: RataFic,
  numero: string
): boolean {
  const pagamenti: any[] = Array.isArray(commessa.pagamenti)
    ? commessa.pagamenti
    : [];
  return pagamenti.some(
    p =>
      // Già registrata con riferimento esplicito alla fattura…
      (typeof p.note === "string" && p.note.includes(`FIC ${numero}`)) ||
      // …o stessa cifra nello stesso giorno (registrata a mano).
      (Math.abs((p.importo ?? 0) - rata.importo) < 0.01 &&
        p.data === rata.dataPagamento)
  );
}

function esisteProposta(
  tipo: string,
  commessaId: number,
  marker: string
): boolean {
  return proposte.some(
    p =>
      p.tipo === tipo &&
      p.commessaId === commessaId &&
      p.stato === "pendente" &&
      JSON.stringify(p.payload).includes(marker)
  );
}

function creaPropostaDiretta(args: {
  tipo: Proposta["tipo"];
  sedeId: number;
  commessaId: number;
  titolo: string;
  motivazione: string;
  payload: any;
}): Proposta | null {
  const pendenti = proposte.filter(
    p => p.commessaId === args.commessaId && p.stato === "pendente"
  ).length;
  if (pendenti >= MAX_PENDENTI_PER_COMMESSA) return null;
  // Anche la riconciliazione deterministica rispetta un rifiuto: se un
  // operatore ha detto no a questa rata, ripresentarla a ogni sync sarebbe
  // il rumore peggiore — automatico e inarrestabile.
  if (propostaGiaRifiutata(args, args.sedeId)) return null;
  const p: Proposta = {
    id: newPropostaId(),
    sedeId: args.sedeId,
    tipo: args.tipo,
    titolo: args.titolo,
    motivazione: args.motivazione,
    // Deterministica: il dato viene dritto dalla fattura, senza inferenze.
    confidenza: "alta",
    payload: args.payload,
    commessaId: args.commessaId,
    clienteId: null,
    opzioni: null,
    risposta: null,
    stato: "pendente",
    esito: null,
    motivoRifiuto: null,
    esecuzioneId: null,
    trigger: "riconciliazione_fic",
    createdAt: new Date(),
    decisaAt: null,
    decisaDa: null,
    decisaDaNome: null,
    seguitoAt: null,
    seguitoEsecuzioneId: null,
    origineId: null,
    requestedByUserId: null,
    evidenceRefs: [
      {
        sourceType: "fattura_fic",
        sourceId: String(
          args.payload?.fatturaId ?? args.payload?.ficId ?? args.commessaId
        ),
        label: String(
          args.payload?.fatturaNumero ?? args.payload?.numero ?? "Fattura FIC"
        ),
        version: String(args.payload?.data ?? new Date().toISOString()),
      },
    ],
    correzioni: [],
  };
  proposte.push(p);
  return p;
}

/**
 * Genera le proposte di riconciliazione. Deterministica e rilanciabile:
 * il dedupe è triplo — rata già in commessa, proposta già pendente, cap
 * per commessa. Ritorna quante proposte ha creato.
 */
export function generaProposteRiconciliazione(sedeId: number): number {
  const commesse = getCommesseStore().filter(
    (c: any) => (c.sedeId ?? DEFAULT_SEDE_ID) === sedeId
  );
  const fatture = ficFatture.filter(
    f => f.sedeId === sedeId && f.tipo === "invoice" && f.presenteInFic
  );
  let create = 0;

  for (const f of fatture) {
    if (create >= MAX_PROPOSTE_PER_GIRO) break;
    if (f.ignorata) continue;
    const { commessa, motivo } = commessaPerFattura(f, commesse);
    if (!commessa) continue;
    const sedeId = commessa.sedeId ?? 1;
    const etichettaCliente = `${commessa.codice} (${commessa.cliente})`;

    // Pattuito: solo se la commessa non ce l'ha, e solo da QUESTA fattura
    // se è l'unica del cliente sulla commessa — mai sommare per conto suo.
    const fattureStessaCommessa = fatture.filter(x => {
      if (x.ignorata) return false;
      const m = commessaPerFattura(x, commesse);
      return m.commessa?.id === commessa.id;
    });
    if (
      (commessa.importoTotale == null || commessa.importoTotale === 0) &&
      fattureStessaCommessa.length === 1 &&
      f.importoLordo > 0 &&
      !esisteProposta(
        "modifica_commessa",
        commessa.id,
        `"importoTotale":${f.importoLordo}`
      )
    ) {
      const p = creaPropostaDiretta({
        tipo: "modifica_commessa",
        sedeId,
        commessaId: commessa.id,
        titolo: `Imposta il pattuito a € ${f.importoLordo.toLocaleString("it-IT")} su ${etichettaCliente}`,
        motivazione: `La fattura FIC ${f.numero} del ${f.data} ammonta a € ${f.importoLordo.toLocaleString("it-IT")} e la commessa non ha un pattuito. ${motivo}`,
        payload: {
          commessaId: commessa.id,
          campi: { importoTotale: f.importoLordo },
        },
      });
      if (p) create++;
    }

    // Rate pagate su FIC che il registro acconti non conosce.
    for (const rata of f.rate) {
      if (create >= MAX_PROPOSTE_PER_GIRO) break;
      if (rata.stato !== "paid" || !rata.dataPagamento || rata.importo <= 0) {
        continue;
      }
      if (esisteRataInCommessa(commessa, rata, f.numero)) continue;
      const marker = `Fattura FIC ${f.numero}`;
      if (esisteProposta("pagamento", commessa.id, marker)) continue;

      const p = creaPropostaDiretta({
        tipo: "pagamento",
        sedeId,
        commessaId: commessa.id,
        titolo: `Registra incasso € ${rata.importo.toLocaleString("it-IT")} su ${etichettaCliente}`,
        motivazione: `La fattura FIC ${f.numero} risulta incassata il ${rata.dataPagamento} su Fatture in Cloud, ma il registro acconti della commessa non la riporta. ${motivo}`,
        payload: {
          commessaId: commessa.id,
          importo: rata.importo,
          data: rata.dataPagamento,
          metodo: null,
          tipo: null,
          note: `${marker} — incasso del ${rata.dataPagamento}`,
        },
      });
      if (p) create++;
    }
  }

  if (create > 0) saveProposte();
  return create;
}

// ── Stato riconciliazione (derivato, mai scritto) ───────────────────────────

export type StatoRiconciliazione =
  | "riconciliata" // ogni rata pagata ha il suo pagamento in commessa
  | "proposta" // c'è una proposta pendente che la riguarda
  | "da_riconciliare"
  | "non_abbinabile" // cliente/commessa non individuabili
  | "ignorata";

export function statoFattura(
  f: FatturaFic,
  commesse: any[]
): { stato: StatoRiconciliazione; commessa: any | null; motivo: string } {
  if (f.ignorata) return { stato: "ignorata", commessa: null, motivo: "" };
  const { commessa, motivo } = commessaPerFattura(f, commesse);
  if (!commessa) return { stato: "non_abbinabile", commessa: null, motivo };

  // L'incasso comanda: con tutte le rate pagate già a registro la fattura
  // è riconciliata, anche se resta pendente una proposta accessoria (es.
  // il pattuito). "Riconciliata" parla di soldi, non di proposte.
  const ratePagate = f.rate.filter(r => r.stato === "paid" && r.importo > 0);
  const tutte =
    ratePagate.length > 0 &&
    ratePagate.every(r => esisteRataInCommessa(commessa, r, f.numero));
  if (tutte) return { stato: "riconciliata", commessa, motivo };

  const marker = `Fattura FIC ${f.numero}`;
  if (
    esisteProposta("pagamento", commessa.id, marker) ||
    esisteProposta(
      "modifica_commessa",
      commessa.id,
      `"importoTotale":${f.importoLordo}`
    )
  ) {
    return { stato: "proposta", commessa, motivo };
  }

  return { stato: "da_riconciliare", commessa, motivo };
}

// Una fattura di QUESTA sede. Come per le commesse: fuori sede è NOT_FOUND,
// non FORBIDDEN — un id non deve poter confermare l'esistenza di un dato
// altrui.
function trovaFattura(ficId: number, sedeId: number | null): FatturaFic {
  const sede = sedeId ?? DEFAULT_SEDE_ID;
  const f = ficFatture.find(x => x.id === ficId && x.sedeId === sede);
  if (!f) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Fattura non trovata." });
  }
  return f;
}

// ── Router ──────────────────────────────────────────────────────────────────

export const ficFattureRouter = router({
  list: protectedProcedure
    .input(z.object({ anno: z.number().int().optional() }).optional())
    .query(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const anno = input?.anno ?? new Date().getFullYear();
      const sede = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const commesse = getCommesseStore();
      const proposteCollegamento = new Map(
        proposte
          .filter(
            p =>
              p.sedeId === sede &&
              p.tipo === "collega_fattura" &&
              p.stato === "pendente" &&
              typeof p.payload?.ficId === "number"
          )
          .map(p => [p.payload.ficId as number, p])
      );
      return ficFatture
        .filter(
          f =>
            f.sedeId === sede &&
            f.tipo === "invoice" &&
            f.presenteInFic &&
            f.data.startsWith(String(anno))
        )
        .map(f => {
          const s = statoFattura(f, commesse);
          const propostaCollegamento = proposteCollegamento.get(f.id);
          const commessaProposta = propostaCollegamento
            ? commesse.find(c => c.id === propostaCollegamento.commessaId)
            : null;
          const incassato = f.rate
            .filter(r => r.stato === "paid")
            .reduce((sum, r) => sum + r.importo, 0);
          return {
            id: f.id,
            numero: f.numero,
            data: f.data,
            clienteNome: f.clienteNome,
            importoLordo: f.importoLordo,
            incassato,
            stato: propostaCollegamento ? ("proposta" as const) : s.stato,
            motivo: propostaCollegamento
              ? "Tars ha individuato una possibile commessa."
              : s.motivo,
            commessaId: s.commessa?.id ?? null,
            commessaCodice: s.commessa?.codice ?? null,
            commessaCliente: s.commessa?.cliente ?? null,
            collegataAMano: f.collegataAMano,
            propostaTars: propostaCollegamento
              ? {
                  ...propostaCollegamento,
                  commessaCodice:
                    propostaCollegamento.payload?.commessaCodice ??
                    commessaProposta?.codice ??
                    null,
                  commessaCliente: commessaProposta?.cliente ?? null,
                }
              : null,
          };
        })
        .sort((a, b) => b.data.localeCompare(a.data));
    }),

  // Collegamento manuale: l'operatore decide, la riconciliazione riparte
  // subito e produce le proposte per quella commessa.
  collega: protectedProcedure
    .input(z.object({ ficId: z.number(), commessaId: z.number().nullable() }))
    .mutation(async ({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const f = trovaFattura(input.ficId, ctx.sedeId);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      let documentoId: number | null = null;
      if (input.commessaId != null) {
        const commessa = getCommessaById(input.commessaId);
        assertSedeScope(commessa ?? null, ctx.sedeId);
        const [{ scaricaFatturaPdf }, { upsertDocumentoFic }] =
          await Promise.all([
            import("./fattureInCloud"),
            import("./preventiviContratti"),
          ]);
        const pdf = await (scaricaFatturaPdfForTests ?? scaricaFatturaPdf)(
          sedeId,
          f.id
        );
        const documento = await upsertDocumentoFic({
          sedeId,
          ficId: f.id,
          commessaId: input.commessaId,
          numero: f.numero,
          data: f.data,
          pdf,
          createdBy: ctx.user?.id ?? null,
        });
        documentoId = documento.id;
        f.commessaId = input.commessaId;
        f.collegataAMano = true;
        f.ignorata = false;
      } else {
        const { deleteDocumentoFic } = await import("./preventiviContratti");
        deleteDocumentoFic(sedeId, f.id);
        f.commessaId = null;
        f.collegataAMano = false;
      }
      f.aggiornataAt = new Date();
      saveFicFatture();
      const proposteCreate = generaProposteRiconciliazione(
        ctx.sedeId ?? DEFAULT_SEDE_ID
      );
      return { success: true as const, proposteCreate, documentoId };
    }),

  ignora: protectedProcedure
    .input(z.object({ ficId: z.number(), ignorata: z.boolean() }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const f = trovaFattura(input.ficId, ctx.sedeId);
      f.ignorata = input.ignorata;
      f.aggiornataAt = new Date();
      saveFicFatture();
      return { success: true as const };
    }),

  riconciliaOra: adminProcedure.mutation(({ ctx }) => {
    return {
      proposteCreate: generaProposteRiconciliazione(
        ctx.sedeId ?? DEFAULT_SEDE_ID
      ),
    };
  }),
});
