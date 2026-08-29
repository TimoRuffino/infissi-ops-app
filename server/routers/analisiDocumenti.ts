// Analisi delle conferme d'ordine fornitore (D7, slice 1 — PRD §54.6).
//
// Il punto d'ingresso vive nella scheda ordine (area Fornitori, direzione):
// l'operatore SCEGLIE l'ordine e il documento del fascicolo da analizzare —
// il collegamento assistito con candidati è la slice 2 del piano. Il router
// non scrive mai su dati autorevoli: restituisce campi con evidenza e
// differenze da rivedere. Ogni procedura NASCE dietro l'interruttore
// FLAG_DOCUMENT_INTELLIGENCE: la base procedure guardata (release
// hardening) copre anche gli endpoint futuri di questo router.

import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedureConInterruttore, router } from "../_core/trpc";
import { requireDirezione } from "../_core/permissions";
import {
  authorizeCoreOperation,
  effectiveCapabilitySet,
} from "../authz/enforcement";
import { getCommessaById } from "./commesse";
import {
  getOrdineFornitoreInSede,
  getOrdiniFornitoreDiSede,
} from "./fornitori";
import { getDocumentoRecordById } from "./preventiviContratti";
import {
  analisiPerOrdine,
  eseguiAnalisiConferma,
  leggiByteDocumento,
  type DocumentoDaAnalizzare,
} from "../documenti/analisi";
import { estraiTestoDocumento } from "../documenti/parserRegistry";
import { estraiConfermaOrdine } from "../documenti/estrazioneConferma";
import {
  generaCandidatiOrdine,
  type OrdinePerCandidatura,
} from "../documenti/candidatiOrdine";
import {
  annullaCollegamento,
  collegamentoAttivo,
  collegamentoDuplicatoPerChecksum,
  confermaCollegamento,
  ordiniRifiutatiPerDocumento,
  rifiutaCandidato,
} from "../documenti/collegamenti";
import { DEFAULT_SEDE_ID } from "./sedi";

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

function documentoInSede(documentoId: number, sedeId: number) {
  const documento = getDocumentoRecordById(documentoId);
  const commessa = documento ? getCommessaById(documento.commessaId) : null;
  if (!documento || !commessa || (commessa as any).sedeId !== sedeId) {
    return null;
  }
  return { documento, commessa };
}

/**
 * Autorizzazione del collegamento assistito: la capability che governa i
 * documenti della commessa (`commessa.manage_documents`), decisa dal motore
 * in ogni policyMode — direzione dal ruolo, gli altri sulla commessa che
 * possiedono o a cui sono assegnati, override individuali inclusi. Nessun
 * ruolo hardcoded nuovo.
 */
async function autorizzaCollegamento(
  ctx: Parameters<typeof authorizeCoreOperation>[0]["ctx"],
  endpoint: string,
  commessa: any
) {
  await authorizeCoreOperation({
    ctx,
    endpoint,
    capability: "commessa.manage_documents",
    resourceType: "documento",
    resource: {
      sedeId: commessa.sedeId,
      createdBy: commessa.createdBy ?? null,
      assegnatoA: commessa.assegnatoA ?? null,
    },
    legacyAllowed: "capability",
  });
}

/** Il bacino dei candidati: gli ordini della sede in forma confrontabile. */
function ordiniCandidabili(sedeId: number): OrdinePerCandidatura[] {
  return getOrdiniFornitoreDiSede(sedeId).map(({ ordine, fornitoreNome }) => ({
    id: ordine.id,
    sedeId,
    codiceOrdine: ordine.codiceOrdine,
    commessaId: ordine.commessaId,
    commessaCodice:
      (getCommessaById(ordine.commessaId) as any)?.codice ?? null,
    fornitoreNome,
    dataConsegnaPrevista: ordine.dataConsegnaPrevista ?? null,
    importoTotale: ordine.importoTotale ?? null,
    codiciArticolo: ordine.righe
      .map(riga => (riga.codiceArticolo ?? "").trim())
      .filter(codice => codice.length >= 3),
  }));
}

function comeDocumentoDaAnalizzare(documento: any): DocumentoDaAnalizzare {
  return {
    id: documento.id,
    commessaId: documento.commessaId,
    nome: documento.nome,
    mimeType: documento.mimeType,
    storageKey: documento.storageKey ?? null,
    dataBase64: documento.dataBase64 ?? null,
  };
}

// I messaggi di leggiByteDocumento sono pensati per l'operatore; qualunque
// altro errore (storage, parsing) NON deve arrivare grezzo al client
// (revisione: può contenere dettagli d'infrastruttura).
const MESSAGGI_OPERATORE = [
  "File non disponibile nello storage.",
  "Il documento non ha byte leggibili (né storage né inline).",
];

function comePreconditionSanificata(errore: any): never {
  const messaggio = String(errore?.message ?? "");
  if (!MESSAGGI_OPERATORE.includes(messaggio)) {
    console.error("[analisiDocumenti] errore non previsto:", errore);
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: MESSAGGI_OPERATORE.includes(messaggio)
      ? messaggio
      : "Documento non analizzabile in questo momento.",
  });
}

/**
 * La pipeline dei candidati, UNICA per la query `candidati` e per la
 * fotografia al momento della conferma (revisione: due copie divergevano
 * facilmente). `segnaliEconomici` governa il segnale sul totale: la sua
 * presenza è un oracolo sugli importi, riservato a chi ha `economia.read`.
 */
async function candidatiPerDocumento(input: {
  documento: any;
  sedeId: number;
  ordiniRifiutati: ReadonlySet<number>;
  segnaliEconomici: boolean;
}) {
  const bytes = await leggiByteDocumento(
    comeDocumentoDaAnalizzare(input.documento)
  );
  const byteChecksum = createHash("sha256").update(bytes).digest("hex");
  const esitoParser = await estraiTestoDocumento(
    bytes,
    input.documento.mimeType,
    input.documento.nome
  );
  if (esitoParser.esito !== "estratto") {
    return { byteChecksum, esitoParser, esito: null } as const;
  }
  const estrazione = estraiConfermaOrdine(esitoParser.pagine, {
    codiceOrdine: null,
    fornitoreNome: null,
    righeOrdine: [],
  });
  const esito = generaCandidatiOrdine({
    pagine: esitoParser.pagine,
    estrazione,
    ordini: ordiniCandidabili(input.sedeId),
    documentoCommessaId: input.documento.commessaId,
    ordiniRifiutati: input.ordiniRifiutati,
    segnaliEconomici: input.segnaliEconomici,
  });
  return { byteChecksum, esitoParser, esito } as const;
}

async function conSegnaliEconomici(
  ctx: Parameters<typeof effectiveCapabilitySet>[0]
): Promise<boolean> {
  const caps = await effectiveCapabilitySet(ctx, ["economia.read"]);
  return caps.has("economia.read");
}

const procedura = procedureConInterruttore("documentIntelligence");

export const analisiDocumentiRouter = router({
  /** I run già eseguiti su un ordine, dal più recente. */
  perOrdine: procedura
    .input(z.object({ ordineId: z.number() }))
    .query(({ input, ctx }) => {
      requireDirezione(ctx.user);
      const sedeId = sedeCorrente(ctx);
      if (!getOrdineFornitoreInSede(input.ordineId, sedeId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordine non trovato." });
      }
      return analisiPerOrdine(sedeId, input.ordineId);
    }),

  /**
   * Analizza un documento del fascicolo come conferma di QUESTO ordine.
   * Idempotente: stesso file + stesse versioni → stesso run; `forza`
   * rielabora conservando i run precedenti.
   */
  analizzaConferma: procedura
    .input(
      z.object({
        ordineId: z.number(),
        documentoId: z.number(),
        forza: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireDirezione(ctx.user);
      const sedeId = sedeCorrente(ctx);

      const trovato = getOrdineFornitoreInSede(input.ordineId, sedeId);
      if (!trovato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordine non trovato." });
      }
      const { ordine, fornitoreNome } = trovato;

      const trovatoDoc = documentoInSede(input.documentoId, sedeId);
      if (!trovatoDoc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento non trovato.",
        });
      }
      const { documento } = trovatoDoc;
      // Coerenza del fascicolo: si analizzano documenti della stessa
      // commessa dell'ordine, OPPURE documenti che un umano ha già
      // collegato a questo ordine (slice 2): il collegamento confermato è
      // una decisione esplicita e prevale sulla posizione del file.
      const collegato = collegamentoAttivo(sedeId, documento.id);
      if (
        documento.commessaId !== ordine.commessaId &&
        collegato?.ordineId !== ordine.id
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Il documento appartiene a un'altra commessa: seleziona un file dal fascicolo della commessa dell'ordine, oppure collegalo prima a questo ordine.",
        });
      }

      const commessaOrdine = getCommessaById(ordine.commessaId);
      try {
        return await eseguiAnalisiConferma({
          sedeId,
          documento: comeDocumentoDaAnalizzare(documento),
          ordine: {
            id: ordine.id,
            codiceOrdine: ordine.codiceOrdine,
            commessaCodice: (commessaOrdine as any)?.codice ?? null,
            dataConsegnaPrevista: ordine.dataConsegnaPrevista ?? null,
            importoTotale: ordine.importoTotale ?? null,
            righe: ordine.righe,
            fornitoreNome,
          },
          createdBy: ctx.user?.id ?? null,
          forza: input.forza,
        });
      } catch (errore: any) {
        comePreconditionSanificata(errore);
      }
    }),

  // ── Slice 2: collegamento assistito documento → ordine ──────────────────

  /**
   * I candidati d'ordine per un documento non ancora collegato. Nessuna
   * scelta automatica: punteggi spiegabili, segnali con evidenza, stato
   * esplicito (certa/candidata/ambigua/assente) e sempre una conferma
   * umana. Un PDF senza testo non produce candidati: produce il suo stato.
   */
  candidati: procedura
    .input(z.object({ documentoId: z.number() }))
    .query(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      const trovato = documentoInSede(input.documentoId, sedeId);
      if (!trovato) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento non trovato.",
        });
      }
      await autorizzaCollegamento(
        ctx,
        "analisiDocumenti.candidati",
        trovato.commessa
      );

      const collegamento = collegamentoAttivo(sedeId, input.documentoId);

      let pipeline: Awaited<ReturnType<typeof candidatiPerDocumento>>;
      try {
        pipeline = await candidatiPerDocumento({
          documento: trovato.documento,
          sedeId,
          ordiniRifiutati: ordiniRifiutatiPerDocumento(
            sedeId,
            input.documentoId
          ),
          segnaliEconomici: await conSegnaliEconomici(ctx),
        });
      } catch (errore: any) {
        comePreconditionSanificata(errore);
      }
      const { byteChecksum, esitoParser, esito } = pipeline;
      if (esitoParser.esito !== "estratto" || !esito) {
        return {
          statoDocumento: esitoParser.esito,
          motivoDocumento:
            "motivo" in esitoParser && esitoParser.motivo
              ? `${esitoParser.motivo} Impossibile proporre candidati.`
              : esitoParser.esito === "scansione_senza_testo"
                ? "PDF senza testo estraibile: senza OCR il contenuto non viene compreso e non è possibile proporre candidati."
                : null,
          esito: null,
          collegamento,
          duplicato: null,
        };
      }

      const duplicato = collegamentoDuplicatoPerChecksum(
        sedeId,
        byteChecksum,
        input.documentoId
      );
      return {
        statoDocumento: "estratto" as const,
        motivoDocumento: null,
        esito,
        collegamento,
        duplicato: duplicato
          ? {
              documentoId: duplicato.documentoId,
              ordineId: duplicato.ordineId,
              avviso:
                "Un documento identico (stessa impronta) è già collegato a un ordine: possibile doppio caricamento.",
            }
          : null,
      };
    }),

  /** Conferma umana del collegamento. Idempotente; non tocca ordine né commessa. */
  collega: procedura
    .input(
      z.object({
        documentoId: z.number(),
        ordineId: z.number(),
        motivo: z.string().max(300).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      const trovatoDoc = documentoInSede(input.documentoId, sedeId);
      const trovatoOrdine = getOrdineFornitoreInSede(input.ordineId, sedeId);
      if (!trovatoDoc || !trovatoOrdine) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento o ordine non trovato.",
        });
      }
      await autorizzaCollegamento(
        ctx,
        "analisiDocumenti.collega",
        trovatoDoc.commessa
      );

      // Fotografia del perché: si ricalcolano i candidati al momento della
      // conferma (stessa pipeline della query), così il collegamento
      // registra punteggio e motivazioni veri, non quelli di una schermata
      // vecchia.
      let punteggio: number | null = null;
      let motivazioni: string[] = ["Collegamento confermato manualmente."];
      let byteChecksum: string | null = null;
      try {
        const pipeline = await candidatiPerDocumento({
          documento: trovatoDoc.documento,
          sedeId,
          ordiniRifiutati: new Set(),
          segnaliEconomici: await conSegnaliEconomici(ctx),
        });
        byteChecksum = pipeline.byteChecksum;
        const candidato = pipeline.esito?.candidati.find(
          c => c.ordineId === input.ordineId
        );
        if (candidato) {
          punteggio = candidato.punteggio;
          motivazioni = candidato.segnali.map(s => s.dettaglio);
        }
      } catch {
        // Byte momentaneamente illeggibili: il collegamento resta possibile
        // (decisione umana), semplicemente senza fotografia dei segnali.
      }

      try {
        const { collegamento, riusato } = confermaCollegamento({
          sedeId,
          documentoId: input.documentoId,
          ordineId: input.ordineId,
          punteggio,
          motivazioni,
          byteChecksum,
          utenteId: ctx.user?.id ?? null,
          motivo: input.motivo?.trim() || null,
        });
        return { collegamento, riusato };
      } catch (errore: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: String(errore?.message ?? "Collegamento non riuscito."),
        });
      }
    }),

  /** Rifiuto registrato di un candidato: non verrà più proposto come certo. */
  rifiuta: procedura
    .input(
      z.object({
        documentoId: z.number(),
        ordineId: z.number(),
        motivo: z.string().max(300).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      const trovatoDoc = documentoInSede(input.documentoId, sedeId);
      const trovatoOrdine = getOrdineFornitoreInSede(input.ordineId, sedeId);
      if (!trovatoDoc || !trovatoOrdine) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento o ordine non trovato.",
        });
      }
      await autorizzaCollegamento(
        ctx,
        "analisiDocumenti.rifiuta",
        trovatoDoc.commessa
      );
      try {
        return rifiutaCandidato({
          sedeId,
          documentoId: input.documentoId,
          ordineId: input.ordineId,
          utenteId: ctx.user?.id ?? null,
          motivo: input.motivo?.trim() || null,
        });
      } catch (errore: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: String(errore?.message ?? "Rifiuto non registrato."),
        });
      }
    }),

  /** Annulla il collegamento confermato (correzione = annulla + conferma). */
  annulla: procedura
    .input(
      z.object({
        documentoId: z.number(),
        motivo: z.string().max(300).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      const trovatoDoc = documentoInSede(input.documentoId, sedeId);
      if (!trovatoDoc) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento non trovato.",
        });
      }
      await autorizzaCollegamento(
        ctx,
        "analisiDocumenti.annulla",
        trovatoDoc.commessa
      );
      try {
        return annullaCollegamento({
          sedeId,
          documentoId: input.documentoId,
          utenteId: ctx.user?.id ?? null,
          motivo: input.motivo?.trim() || null,
        });
      } catch (errore: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: String(errore?.message ?? "Annullamento non riuscito."),
        });
      }
    }),
});
