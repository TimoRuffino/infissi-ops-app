// Router tRPC della fatturazione dal contratto: bozza, modifica, emissione,
// stati SdI, nota di credito, documenti. Stesso pattern di contratti.ts —
// il router valida con zod, autorizza, delega al servizio di dominio e
// mappa gli errori: nessuna regola di fatturazione vive qui (v. CLAUDE.md,
// «Agente AI» — vale anche per il codice umano, non solo per Tars).
//
// Dietro due interruttori (piano 2, 04/09/2026): FLAG_FATTURAZIONE via
// `procedureConInterruttore` (kill switch della feature, in middleware,
// prima di qualunque input) e FLAG_LIMITI via `assicuraInterruttore`
// dentro ogni handler — la fatturazione dal contratto non ha senso senza
// il contratto strutturato e il computo dei limiti su cui si fonda.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { STATI_FATTURA, TIPI_FATTURA } from "@shared/fatturazione/tipi";
import { DICITURE, type ChiaveDicitura } from "@shared/fatturazione/diciture";
import { procedureConInterruttore, router } from "../_core/trpc";
import { assicuraInterruttore } from "../platform/interruttori";
import { authorizeCoreOperation, effectiveCapabilitySet } from "../authz/enforcement";
import { getFile } from "../_core/fileStorage";
import { aggiornaDocumentoFic, contestoFicPerSede, creaSuFic, inviaAlloSdi } from "../fatture/emissione";
import { creaClientFicEmissione } from "../fic/emissione";
import { classificaRigheFic, confrontaLati, latoCrm } from "../fatture/confronto";
import { fattureFicCollegate, ficFatture } from "./ficFatture";
import { creaNotaCredito } from "../fatture/notaCredito";
import { getFattureRepository } from "../fatture/repository";
import { sdiDryRun } from "../fatture/dryRun";
import {
  aggiornaBozza as aggiornaBozzaServizio,
  creaBozzaLibera as creaBozzaLiberaServizio,
  annullaBozza as annullaBozzaServizio,
  eliminaBozza as eliminaBozzaServizio,
  creaBozza as creaBozzaServizio,
  fatturePerCommessa,
  leggiFattura,
  MAX_DESCRIZIONE_RIGA,
  MAX_RIGHE_AGGIUNTE,
  rigeneraBozza as rigeneraBozzaServizio,
  validaPerEmissione,
} from "../fatture/servizio";
import { aggiornaStatoFattura } from "../fatture/sonda";
import { erroreServizioComeTrpc } from "./contratti";
import { getCommessaById } from "./commesse";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("fatturazione");

/** 10 MB: un PDF di una fattura reale non li avvicina nemmeno; oltre, qualcosa non va e non deve gonfiare la risposta tRPC. */
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

function commessaInSede(commessaId: number, sedeId: number): void {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata." });
  }
}

/** Il nome del file scaricato: il numero della fattura («127/2026» → «127-2026»), o l'id se non ancora numerata. */
function nomeDocumento(fattura: { numero: string | null; id: number }, tipo: "pdf" | "xml"): string {
  const pulito = (fattura.numero ?? "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${pulito || `fattura-${fattura.id}`}.${tipo}`;
}

// ── zod: mirror di ModificaBozza (server/fatture/servizio.ts) campo per campo ──

const rigaCorrezioneSchema = z.object({
  ordine: z.number().int().min(1),
  importoCent: z.number().int().min(0),
  descrizione: z.string().trim().min(1).max(MAX_DESCRIZIONE_RIGA).optional(),
});

const rigaAggiuntaSchema = z.object({
  tipo: z.enum(["bene", "servizio"]),
  descrizione: z.string().trim().min(1).max(MAX_DESCRIZIONE_RIGA),
  importoCent: z.number().int().min(0),
  aliquota: z.union([z.literal(22), z.literal(10)]),
  beneSignificativo: z.boolean(),
});

const scadenzaInputSchema = z.object({
  numero: z.number().int().min(1),
  quotaPct: z.number().min(0).max(100),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  importoCent: z.number().int().min(0),
  descrizione: z.string().trim().max(120).nullable(),
});

const modificaBozzaSchema = z.object({
  righe: z.array(rigaCorrezioneSchema).max(200).optional(),
  righeAggiunte: z.array(rigaAggiuntaSchema).max(MAX_RIGHE_AGGIUNTE).optional(),
  righeRimosse: z.array(z.number().int().min(1)).max(200).optional(),
  scadenze: z.array(scadenzaInputSchema).max(12).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  // Solo le chiavi che esistono davvero in shared/fatturazione/diciture.ts:
  // una dicitura sconosciuta non deve poter finire silenziosa in fattura.
  diciture: z.array(z.enum(Object.keys(DICITURE) as [ChiaveDicitura, ...ChiaveDicitura[]])).max(20).optional(),
  intestazioneCantiere: z.string().trim().max(300).nullable().optional(),
  riequilibraBeniAMarkupCent: z.number().int().min(0).optional(),
  // Markup scritto a mano (08/09/2026): un importo lo forza, `null` torna al calcolo.
  markupForzatoCent: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  scavalcoLimiti: z
    .object({ attivo: z.boolean(), motivo: z.string().trim().max(300).nullable() })
    .optional(),
  // Anagrafica corretta dalla fattura (07/09/2026): il servizio normalizza,
  // `controlliCliente` giudica; qui solo forma e lunghezze.
  clienteSnapshot: z
    .object({
      nome: z.string().trim().min(1).max(200),
      tipo: z.enum(["privato", "azienda", "condominio", "ente_pubblico"]),
      codiceFiscale: z.string().trim().max(16).nullable(),
      partitaIva: z.string().trim().max(11).nullable(),
      indirizzo: z.string().trim().max(200),
      cap: z.string().trim().max(5),
      citta: z.string().trim().max(100),
      provincia: z.string().trim().max(2),
      email: z.string().trim().max(200).nullable(),
      pec: z.string().trim().max(200).nullable(),
      codiceDestinatario: z.string().trim().max(7),
    })
    .partial()
    .optional(),
  detrazioneTipo: z.enum(["nessuna", "ecobonus", "ristrutturazione"]).optional(),
});

const selezioneNotaCreditoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("totale") }),
  z.object({
    tipo: z.literal("parziale"),
    righe: z
      .array(z.object({ ordine: z.number().int().min(1), importoCent: z.number().int().positive() }))
      .min(1)
      .max(200),
  }),
]);

export const fattureRouter = router({
  perCommessa: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.perCommessa",
        capability: "fattura.read",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const [elenco, caps] = await Promise.all([
        fatturePerCommessa(sedeId, input.commessaId),
        effectiveCapabilitySet(ctx, ["fattura.draft", "fattura.emit", "fattura.credit_note", "cliente.update_operational"]),
      ]);
      return {
        fatture: elenco.map(f => ({ ...f, righe: [], riepilogo: [], scadenze: [] })),
        // Fatture FiC collegate (08/09/2026): la commessa è già fatturata da
        // fuori; il tab lo dice e non propone la bozza dai limiti.
        fattureFic: fattureFicCollegate(sedeId, input.commessaId).map(f => ({
          id: f.id, numero: f.numero, data: f.data, lordoCent: Math.round(f.importoLordo * 100),
        })),
        puoDraft: caps.has("fattura.draft"),
        puoEmettere: caps.has("fattura.emit"),
        puoNotaCredito: caps.has("fattura.credit_note"),
        // L'anagrafica si corregge dalla bozza solo con il permesso sui clienti.
        puoModificareCliente: caps.has("cliente.update_operational"),
        dryRun: sdiDryRun(),
      };
    }),

  byId: procedura
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.byId",
        capability: "fattura.read",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const letto = await leggiFattura(sedeId, input.id);
      if (!letto) throw new TRPCError({ code: "NOT_FOUND", message: "Fattura non trovata." });
      return { ...letto, dryRun: sdiDryRun() };
    }),

  creaBozza: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.creaBozza",
        capability: "fattura.draft",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await creaBozzaServizio({ sedeId, commessaId: input.commessaId, actorUserId: ctx.user.id });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  /** Fattura libera (07/09/2026): vuota, senza contratto né computo, sempre dentro la commessa. */
  creaBozzaLibera: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.creaBozzaLibera",
        capability: "fattura.draft",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await creaBozzaLiberaServizio({ sedeId, commessaId: input.commessaId, actorUserId: ctx.user.id });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  aggiornaBozza: procedura
    .input(
      z.object({
        id: z.number().int(),
        revisione: z.number().int(),
        modifica: modificaBozzaSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.aggiornaBozza",
        capability: "fattura.draft",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      // L'anagrafica corretta dalla bozza torna nella scheda cliente: è una
      // modifica al cliente, con il suo permesso (come da `clienti.update`).
      if (input.modifica.clienteSnapshot) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "fatture.aggiornaBozza.cliente",
          capability: "cliente.update_operational",
          resourceType: "cliente",
          resource: { sedeId },
          legacyAllowed: "capability",
        });
      }
      // Ruling R34: «Procedi comunque» sui limiti è una decisione di chi
      // emette, non di chi compila la bozza — spec §7.3. Seconda
      // autorizzazione, mai un controllo lasciato alla UI. Spegnere lo
      // scavalco resta un'operazione da `fattura.draft`: si torna alla
      // regola, non ci si deroga.
      if (input.modifica.scavalcoLimiti?.attivo) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "fatture.scavalcoLimiti",
          capability: "fattura.emit",
          resourceType: "fattura",
          resource: { sedeId },
          legacyAllowed: "capability",
        });
      }
      try {
        return await aggiornaBozzaServizio({
          sedeId,
          id: input.id,
          revisione: input.revisione,
          actorUserId: ctx.user.id,
          modifica: input.modifica,
          // R47: se la fattura è già su Fatture in Cloud, la modifica ci
          // arriva prima di essere scritta qui. Iniettata e non importata
          // dal servizio: `emissione.ts` importa da `servizio.ts`, e il
          // contrario chiuderebbe un anello.
          sincronizzaFic: aggiornaDocumentoFic,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  rigeneraBozza: procedura
    .input(z.object({ id: z.number().int(), revisione: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.rigeneraBozza",
        capability: "fattura.draft",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await rigeneraBozzaServizio({
          sedeId,
          id: input.id,
          revisione: input.revisione,
          actorUserId: ctx.user.id,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  validazioni: procedura
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.validazioni",
        capability: "fattura.read",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        const { controlli, emettibile } = await validaPerEmissione(sedeId, input.id);
        return { controlli, emettibile };
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  emetti: procedura
    .input(z.object({ id: z.number().int(), revisione: z.number().int(), ignoraDoppione: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.emetti",
        capability: "fattura.emit",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await creaSuFic({ sedeId, id: input.id, actorUserId: ctx.user.id, revisione: input.revisione, ignoraDoppione: input.ignoraDoppione === true });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  // Secondo gesto (R44): il documento su Fatture in Cloud esiste già, qui
  // parte davvero allo SdI. Stessa capability del primo — la decisione in
  // chat è «A»: lo stesso operatore, un click dopo l'altro.
  inviaSdi: procedura
    .input(
      z.object({
        id: z.number().int(),
        revisione: z.number().int(),
        // «Invia comunque» sullo scostamento dai totali di FiC (R49): il
        // motivo lo pretende il servizio, non solo il router.
        ignoraScostamento: z.boolean().optional(),
        motivoScostamento: z.string().trim().min(1).max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.inviaSdi",
        capability: "fattura.emit",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await inviaAlloSdi({
          sedeId,
          id: input.id,
          actorUserId: ctx.user.id,
          revisione: input.revisione,
          ignoraScostamento: input.ignoraScostamento === true,
          motivoScostamento: input.motivoScostamento,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  aggiornaStato: procedura
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.aggiornaStato",
        capability: "fattura.read",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await aggiornaStatoFattura({ sedeId, id: input.id, actorUserId: ctx.user.id });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  notaCredito: procedura
    .input(
      z.object({
        fatturaId: z.number().int(),
        selezione: selezioneNotaCreditoSchema,
        motivo: z.string().trim().max(300).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.notaCredito",
        capability: "fattura.credit_note",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await creaNotaCredito({
          sedeId,
          fatturaId: input.fatturaId,
          actorUserId: ctx.user.id,
          selezione: input.selezione,
          motivo: input.motivo,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  /** Cancellazione definitiva di una bozza (o annullata, o emissione ferma senza documento FiC): la UI chiede conferma. */
  elimina: procedura
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.elimina",
        capability: "fattura.draft",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await eliminaBozzaServizio({ sedeId, id: input.id, actorUserId: ctx.user.id });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  annullaBozza: procedura
    .input(z.object({ id: z.number().int(), motivo: z.string().trim().max(300).nullable() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.annullaBozza",
        capability: "fattura.draft",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await annullaBozzaServizio({ sedeId, id: input.id, actorUserId: ctx.user.id, motivo: input.motivo });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  lista: procedura
    .input(
      z.object({
        stati: z.array(z.enum(STATI_FATTURA)).optional(),
        tipo: z.enum(TIPI_FATTURA).optional(),
        limite: z.number().int().min(1).max(200).optional(),
        /** Solo quelle nella finestra: su Fatture in Cloud e non ancora spedite. */
        daInviareSdi: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.lista",
        capability: "fattura.read",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const elenco = await getFattureRepository().lista({
        sedeId,
        stati: input.stati,
        tipo: input.tipo,
        limite: input.limite,
        daInviareSdi: input.daInviareSdi,
      });
      return elenco.map(f => {
        const commessa: any = getCommessaById(f.commessaId);
        return {
          ...f,
          commessaCodice: commessa?.codice ?? null,
          clienteNome: f.clienteSnapshot?.nome ?? null,
        };
      });
    }),

  /**
   * Bozza (o fattura) del CRM contro la fattura vera della stessa commessa
   * su Fatture in Cloud, voce per voce (studio 05/09/2026): si impara caso
   * per caso senza rifare l'analisi a mano. La fattura FiC è quella
   * collegata alla commessa oppure, se manca, quella dello stesso cliente
   * con un lordo vicino negli ultimi 180 giorni. Solo lettura.
   */
  confrontaConFic: procedura
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.confrontaConFic",
        capability: "fattura.read",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const letto = await leggiFattura(sedeId, input.id);
      if (!letto) throw new TRPCError({ code: "NOT_FOUND", message: "Fattura non trovata." });
      const f = letto.fattura;
      const parole = (s: string) => s.toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
      const nome = parole(f.clienteSnapshot?.nome ?? "");
      const finestra = Date.now() - 180 * 86_400_000;
      const candidate = ficFatture
        .filter((x: any) => (x.sedeId ?? 1) === sedeId && x.tipo === "invoice" && !x.ignorata && x.id !== f.ficDocumentId)
        .filter((x: any) => x.commessaId === f.commessaId || (nome && parole(x.clienteNome) === nome && Date.parse(x.data) >= finestra && Math.abs(x.importoLordo * 100 - f.totaleCent) <= f.totaleCent * 0.3))
        .sort((a: any, b: any) => (b.commessaId === f.commessaId ? 1 : 0) - (a.commessaId === f.commessaId ? 1 : 0) || String(b.data).localeCompare(String(a.data)));
      const scelta = candidate[0];
      if (!scelta) return { fic: null as null, voci: [], nonClassificate: [] as string[] };
      const ficCtx = await contestoFicPerSede(sedeId);
      const righe = await creaClientFicEmissione().leggiRigheDocumento(ficCtx, Number(scelta.id));
      const latoFic = classificaRigheFic(righe);
      return {
        fic: { id: Number(scelta.id), numero: String(scelta.numero ?? ""), data: String(scelta.data ?? ""), lordoCent: Math.round(scelta.importoLordo * 100), collegata: scelta.commessaId === f.commessaId },
        voci: confrontaLati(latoCrm(f), latoFic),
        nonClassificate: latoFic.nonClassificate,
      };
    }),

  documento: procedura
    .input(z.object({ id: z.number().int(), tipo: z.enum(["pdf", "xml"]) }))
    .query(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatture.documento",
        capability: "fattura.read",
        resourceType: "fattura",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const letto = await leggiFattura(sedeId, input.id);
      if (!letto) throw new TRPCError({ code: "NOT_FOUND", message: "Fattura non trovata." });
      const storageKey = input.tipo === "pdf" ? letto.fattura.pdfStorageKey : letto.fattura.xmlStorageKey;
      if (!storageKey) throw new TRPCError({ code: "NOT_FOUND", message: "Documento non disponibile." });
      const buffer = await getFile(storageKey);
      if (!buffer) throw new TRPCError({ code: "NOT_FOUND", message: "Documento non disponibile." });
      if (input.tipo === "pdf" && buffer.length > MAX_PDF_BYTES) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Il PDF supera i 10 MB." });
      }
      return {
        nome: nomeDocumento(letto.fattura, input.tipo),
        mimeType: input.tipo === "pdf" ? "application/pdf" : "application/xml",
        dataBase64: buffer.toString("base64"),
      };
    }),
});
