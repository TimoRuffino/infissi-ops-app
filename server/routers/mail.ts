// Router posta — configurazione caselle e lettura delle comunicazioni.
//
// Le caselle le gestisce solo la direzione: una casella configurata è una
// fonte di dati personali (clienti e, se si collegano quelle personali,
// colleghi). La password entra e non esce più: nessuna procedura qui la
// restituisce, nemmeno cifrata.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { assertSedeScope, requireDirezione } from "../_core/permissions";
import { secretBoxConfigured } from "../_core/secretBox";
import {
  caselle,
  casellaPubblica,
  newCasellaId,
  proteggiPassword,
  saveCaselle,
  type Casella,
} from "../tars/caselle";
import {
  importaStorico,
  riavviaWatchers,
  sincronizzaCasella,
  sincronizzaTutte,
  testaCasella,
} from "../tars/imap";
import {
  appPubblica,
  completaOnboarding,
  configPubblica,
  configWhatsApp,
  getAppWhatsApp,
  newConfigWhatsAppId,
  proteggiSegreto,
  provaConnessione,
  saveAppWhatsApp,
  saveConfigWhatsApp,
  sincronizzaStorico,
  type ConfigWhatsApp,
} from "../tars/whatsapp";
import {
  deleteComunicazione,
  deleteComunicazioniByCasella,
  getComunicazione,
  listComunicazioni,
  segnaTutteViste,
  setMatchComunicazione,
  setStatoComunicazione,
  statsComunicazioni,
} from "../tars/comunicazioni";
import { getCommessaById } from "./commesse";

function trovaCasella(id: number, sedeId: number | null): Casella {
  const c = caselle.find((x) => x.id === id);
  assertSedeScope(c ?? null, sedeId);
  return c!;
}

function assertChiaveCifratura() {
  if (!secretBoxConfigured()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "MAIL_ENCRYPTION_KEY non configurata sul server: senza chiave le password delle caselle non possono essere salvate in sicurezza.",
    });
  }
}

export const mailRouter = router({
  // ── Caselle ───────────────────────────────────────────────────────────
  caselle: router({
    list: protectedProcedure.query(({ ctx }) => {
      requireDirezione(ctx.user);
      return caselle
        .filter((c) => c.sedeId === ctx.sedeId)
        .map(casellaPubblica)
        .sort((a, b) => a.nome.localeCompare(b.nome));
    }),

    // Nome e indirizzo delle caselle, per il filtro in /comunicazioni.
    // Aperto a tutti gli autenticati (list completa resta direzione-only):
    // niente host, niente stato, niente diagnostica.
    opzioni: protectedProcedure.query(({ ctx }) => {
      return caselle
        .filter((c) => c.sedeId === ctx.sedeId)
        .map((c) => ({ id: c.id, nome: c.nome, indirizzo: c.indirizzo }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
    }),

    stato: protectedProcedure.query(({ ctx }) => {
      const mie = caselle.filter((c) => c.sedeId === ctx.sedeId);
      return {
        chiaveConfigurata: secretBoxConfigured(),
        totali: mie.length,
        attive: mie.filter((c) => c.attiva).length,
        conErrori: mie.filter((c) => !!c.ultimoErrore).length,
      };
    }),

    create: protectedProcedure
      .input(
        z.object({
          nome: z.string().min(1).max(80),
          indirizzo: z.string().email(),
          host: z.string().min(1).max(200),
          porta: z.number().int().min(1).max(65535).default(993),
          tls: z.boolean().default(true),
          password: z.string().min(1).max(500),
          cartella: z.string().min(1).max(100).default("INBOX"),
        })
      )
      .mutation(({ input, ctx }) => {
        requireDirezione(ctx.user);
        assertChiaveCifratura();
        const dup = caselle.some(
          (c) =>
            c.sedeId === ctx.sedeId &&
            c.indirizzo.toLowerCase() === input.indirizzo.toLowerCase()
        );
        if (dup) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Questa casella è già configurata.",
          });
        }
        const now = new Date();
        const casella: Casella = {
          id: newCasellaId(),
          sedeId: ctx.sedeId ?? 1,
          nome: input.nome.trim(),
          indirizzo: input.indirizzo.trim().toLowerCase(),
          host: input.host.trim(),
          porta: input.porta,
          tls: input.tls,
          passwordCifrata: proteggiPassword(input.password),
          cartella: input.cartella.trim() || "INBOX",
          // Si aggiunge spenta: prima si prova la connessione, poi si accende.
          attiva: false,
          ultimoUid: null,
          uidValidity: null,
          ultimaSync: null,
          ultimoErrore: null,
          messaggiImportati: 0,
          createdAt: now,
          updatedAt: now,
        };
        caselle.push(casella);
        saveCaselle();
        riavviaWatchers();
        return casellaPubblica(casella);
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          nome: z.string().min(1).max(80).optional(),
          host: z.string().min(1).max(200).optional(),
          porta: z.number().int().min(1).max(65535).optional(),
          tls: z.boolean().optional(),
          // Assente = password invariata. Cambiarla resetta il segnalibro
          // solo se cambia anche la cartella, non da sola.
          password: z.string().min(1).max(500).optional(),
          cartella: z.string().min(1).max(100).optional(),
          attiva: z.boolean().optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = trovaCasella(input.id, ctx.sedeId);
        if (input.password !== undefined) {
          assertChiaveCifratura();
          c.passwordCifrata = proteggiPassword(input.password);
        }
        if (input.nome !== undefined) c.nome = input.nome.trim();
        if (input.host !== undefined) c.host = input.host.trim();
        if (input.porta !== undefined) c.porta = input.porta;
        if (input.tls !== undefined) c.tls = input.tls;
        if (input.cartella !== undefined && input.cartella !== c.cartella) {
          c.cartella = input.cartella.trim() || "INBOX";
          // Cartella diversa = UID di un altro spazio: si riparte.
          c.ultimoUid = null;
          c.uidValidity = null;
        }
        if (input.attiva !== undefined) c.attiva = input.attiva;
        c.updatedAt = new Date();
        saveCaselle();
        riavviaWatchers();
        return casellaPubblica(c);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number(), cancellaComunicazioni: z.boolean().default(false) }))
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = trovaCasella(input.id, ctx.sedeId);
        const idx = caselle.findIndex((x) => x.id === c.id);
        caselle.splice(idx, 1);
        saveCaselle();
        riavviaWatchers();
        let cancellate = 0;
        if (input.cancellaComunicazioni) {
          cancellate = await deleteComunicazioniByCasella(c.id, "email");
        }
        return { success: true as const, cancellate };
      }),

    // Prova credenziali e raggiungibilità senza importare niente.
    test: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = trovaCasella(input.id, ctx.sedeId);
        const esito = await testaCasella(c);
        if (esito.ok) {
          c.ultimoErrore = null;
        } else {
          c.ultimoErrore = esito.errore;
        }
        c.updatedAt = new Date();
        saveCaselle();
        return esito;
      }),

    sync: protectedProcedure
      .input(z.object({ id: z.number().optional() }).optional())
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        if (input?.id != null) {
          const c = trovaCasella(input.id, ctx.sedeId);
          return [await sincronizzaCasella(c)];
        }
        return sincronizzaTutte(ctx.sedeId ?? undefined);
      }),

    // Rilegge gli ultimi 6 mesi di una casella già sincronizzata: le mail
    // già presenti vengono scartate dall'insert idempotente, le vecchie
    // entrano col match ma senza finire in coda di analisi Tars.
    importaStorico: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = trovaCasella(input.id, ctx.sedeId);
        return importaStorico(c);
      }),
  }),

  // ── WhatsApp (sola lettura) ───────────────────────────────────────────
  whatsapp: router({
    list: protectedProcedure.query(({ ctx }) => {
      requireDirezione(ctx.user);
      return configWhatsApp
        .filter((c) => c.sedeId === ctx.sedeId)
        .map(configPubblica);
    }),

    // Configurazione dell'app Meta: una per sede, vale per i numeri di
    // quella sede.
    app: protectedProcedure.query(({ ctx }) => {
      requireDirezione(ctx.user);
      return appPubblica(ctx.sedeId);
    }),

    setApp: protectedProcedure
      .input(
        z.object({
          appId: z.string().max(60).optional(),
          configId: z.string().max(60).optional(),
          appSecret: z.string().max(200).optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        requireDirezione(ctx.user);
        const a = getAppWhatsApp(ctx.sedeId);
        if (input.appSecret) {
          assertChiaveCifratura();
          a.appSecretCifrato = proteggiSegreto(input.appSecret);
        }
        if (input.appId !== undefined) a.appId = input.appId.trim();
        if (input.configId !== undefined) a.configId = input.configId.trim();
        a.updatedAt = new Date();
        saveAppWhatsApp();
        return appPubblica(ctx.sedeId);
      }),

    // Chiusura dell'Embedded Signup: dal code si ricava il token, si
    // sottoscrive la WABA e la configurazione si compila da sola.
    onboarding: protectedProcedure
      .input(
        z.object({
          code: z.string().min(10).max(2000),
          wabaId: z.string().min(3).max(60),
          phoneNumberId: z.string().min(3).max(60).optional(),
          nome: z.string().max(80).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        assertChiaveCifratura();
        try {
          const config = await completaOnboarding({
            code: input.code,
            wabaId: input.wabaId,
            phoneNumberId: input.phoneNumberId,
            sedeId: ctx.sedeId ?? 1,
            nome: input.nome,
          });
          return configPubblica(config);
        } catch (e: any) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: e?.message ?? "Onboarding non riuscito.",
          });
        }
      }),

    // Legge account e numeri dalla WABA: diagnostica per l'operatore e,
    // per la App Review, la chiamata reale che Meta pretende di vedere
    // prima di concedere il permesso in accesso avanzato.
    prova: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = configWhatsApp.find((x) => x.id === input.id);
        assertSedeScope(c ?? null, ctx.sedeId);
        return provaConnessione(c!);
      }),

    // Ritenta il sync dello storico: utile solo entro 24 ore dal
    // collegamento, dopo Meta impone di rifare l'onboarding.
    syncStorico: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = configWhatsApp.find((x) => x.id === input.id);
        assertSedeScope(c ?? null, ctx.sedeId);
        return sincronizzaStorico(c!);
      }),

    // L'URL da incollare in Meta: si costruisce dall'host della richiesta,
    // così è giusto sia in locale sia su Railway senza configurazione.
    webhookUrl: protectedProcedure.query(({ ctx }) => {
      const host = ctx.req.get("host") ?? "localhost:3000";
      const proto = ctx.req.protocol ?? "https";
      return {
        url: `${proto}://${host}/api/webhook/whatsapp`,
        chiaveConfigurata: secretBoxConfigured(),
      };
    }),

    // Il flusso di Meta impone quest'ordine: prima si verifica il webhook,
    // POI si registra il numero. Ma il phone number id nasce solo con la
    // registrazione — quindi alla creazione serve il solo verify token, e
    // il resto si completa dopo. L'accensione, quella, li pretende tutti.
    create: protectedProcedure
      .input(
        z.object({
          nome: z.string().min(1).max(80),
          numero: z.string().max(30).optional(),
          phoneNumberId: z.string().max(60).optional(),
          wabaId: z.string().max(60).optional(),
          token: z.string().max(1000).optional(),
          appSecret: z.string().max(200).optional(),
          verifyToken: z.string().min(8).max(200),
        })
      )
      .mutation(({ input, ctx }) => {
        requireDirezione(ctx.user);
        const phoneNumberId = input.phoneNumberId?.trim() ?? "";
        if (
          phoneNumberId &&
          configWhatsApp.some((c) => c.phoneNumberId === phoneNumberId)
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Questo numero è già configurato.",
          });
        }
        if (input.token || input.appSecret) assertChiaveCifratura();
        const now = new Date();
        const config: ConfigWhatsApp = {
          id: newConfigWhatsAppId(),
          sedeId: ctx.sedeId ?? 1,
          nome: input.nome.trim(),
          numero: input.numero?.trim() ?? "",
          phoneNumberId,
          wabaId: input.wabaId?.trim() ?? "",
          tokenCifrato: input.token ? proteggiSegreto(input.token) : "",
          appSecretCifrato: input.appSecret
            ? proteggiSegreto(input.appSecret)
            : "",
          verifyToken: input.verifyToken.trim(),
          // Si aggiunge spenta: prima si completa la verifica del webhook
          // su Meta e si registra il numero, poi si accende.
          attiva: false,
          ultimoMessaggio: null,
          messaggiRicevuti: 0,
          ultimoErrore: null,
          onboardingAt: null,
          storicoSincronizzato: null,
          createdAt: now,
          updatedAt: now,
        };
        configWhatsApp.push(config);
        saveConfigWhatsApp();
        return configPubblica(config);
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          nome: z.string().min(1).max(80).optional(),
          numero: z.string().max(30).optional(),
          phoneNumberId: z.string().max(60).optional(),
          wabaId: z.string().max(60).optional(),
          token: z.string().max(1000).optional(),
          appSecret: z.string().max(200).optional(),
          verifyToken: z.string().min(8).max(200).optional(),
          attiva: z.boolean().optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = configWhatsApp.find((x) => x.id === input.id);
        assertSedeScope(c ?? null, ctx.sedeId);
        if (input.token) {
          assertChiaveCifratura();
          c!.tokenCifrato = proteggiSegreto(input.token);
        }
        if (input.appSecret) {
          assertChiaveCifratura();
          c!.appSecretCifrato = proteggiSegreto(input.appSecret);
        }
        if (input.nome !== undefined) c!.nome = input.nome.trim();
        if (input.numero !== undefined) c!.numero = input.numero.trim();
        if (input.phoneNumberId !== undefined) {
          c!.phoneNumberId = input.phoneNumberId.trim();
        }
        if (input.wabaId !== undefined) c!.wabaId = input.wabaId.trim();
        if (input.verifyToken !== undefined) {
          c!.verifyToken = input.verifyToken.trim();
        }
        if (input.attiva !== undefined) {
          // Accendere una configurazione incompleta significherebbe rifiutare
          // ogni webhook in silenzio (senza app secret la firma non si
          // verifica): meglio dirlo qui, con l'elenco di cosa manca.
          if (input.attiva) {
            const mancanti: string[] = [];
            if (!c!.phoneNumberId) mancanti.push("Phone number ID");
            if (!c!.wabaId) mancanti.push("WhatsApp Business Account ID");
            if (!c!.tokenCifrato) mancanti.push("token di accesso");
            // L'app secret può essere quello del numero o quello dell'app
            // (Embedded Signup): basta che ce ne sia uno.
            if (
              !c!.appSecretCifrato &&
              !getAppWhatsApp(c!.sedeId).appSecretCifrato
            ) {
              mancanti.push("app secret");
            }
            if (mancanti.length > 0) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `Prima di attivare il numero completa: ${mancanti.join(", ")}.`,
              });
            }
          }
          c!.attiva = input.attiva;
        }
        c!.updatedAt = new Date();
        saveConfigWhatsApp();
        return configPubblica(c!);
      }),

    delete: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          cancellaComunicazioni: z.boolean().default(false),
        })
      )
      .mutation(async ({ input, ctx }) => {
        requireDirezione(ctx.user);
        const c = configWhatsApp.find((x) => x.id === input.id);
        assertSedeScope(c ?? null, ctx.sedeId);
        const idx = configWhatsApp.findIndex((x) => x.id === input.id);
        configWhatsApp.splice(idx, 1);
        saveConfigWhatsApp();
        let cancellate = 0;
        if (input.cancellaComunicazioni) {
          cancellate = await deleteComunicazioniByCasella(input.id, "whatsapp");
        }
        return { success: true as const, cancellate };
      }),
  }),

  // ── Comunicazioni ─────────────────────────────────────────────────────
  comunicazioni: router({
    list: protectedProcedure
      .input(
        z
          .object({
            commessaId: z.number().optional(),
            clienteId: z.number().optional(),
            casellaId: z.number().optional(),
            canale: z.enum(["email", "whatsapp"]).optional(),
            stato: z.enum(["nuova", "vista", "gestita"]).optional(),
            search: z.string().max(200).optional(),
            soloNonCollegate: z.boolean().optional(),
            limit: z.number().int().min(1).max(200).optional(),
            offset: z.number().int().min(0).optional(),
          })
          .optional()
      )
      .query(async ({ input, ctx }) => {
        return listComunicazioni({
          sedeId: ctx.sedeId ?? 1,
          commessaId: input?.commessaId ?? null,
          clienteId: input?.clienteId ?? null,
          casellaId: input?.casellaId ?? null,
          canale: input?.canale,
          stato: input?.stato,
          search: input?.search,
          soloNonCollegate: input?.soloNonCollegate,
          limit: input?.limit,
          offset: input?.offset,
        });
      }),

    segnaTutteViste: protectedProcedure.mutation(async ({ ctx }) => {
      const n = await segnaTutteViste(ctx.sedeId ?? 1);
      return { aggiornate: n };
    }),

    byId: protectedProcedure
      .input(z.number())
      .query(async ({ input, ctx }) => {
        return getComunicazione(input, ctx.sedeId ?? 1);
      }),

    stats: protectedProcedure.query(async ({ ctx }) => {
      return statsComunicazioni(ctx.sedeId ?? 1);
    }),

    setStato: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          stato: z.enum(["nuova", "vista", "gestita"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const ok = await setStatoComunicazione(
          input.id,
          ctx.sedeId ?? 1,
          input.stato
        );
        if (!ok) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Comunicazione non trovata.",
          });
        }
        return { success: true as const };
      }),

    // Elimina dal CRM. La casella non viene toccata: il messaggio resta
    // visibile nel client di posta. Tombstone, quindi non riappare alla
    // prossima sincronizzazione.
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const ok = await deleteComunicazione(input.id, ctx.sedeId ?? 1);
        if (!ok) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Comunicazione non trovata.",
          });
        }
        return { success: true as const };
      }),

    // Correzione manuale dell'aggancio: l'operatore sposta una mail sulla
    // commessa giusta quando il match automatico ha sbagliato.
    collega: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          commessaId: z.number().nullable(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const sedeId = ctx.sedeId ?? 1;
        let clienteId: number | null = null;
        if (input.commessaId != null) {
          const commessa = getCommessaById(input.commessaId);
          assertSedeScope(commessa ?? null, ctx.sedeId);
          clienteId = (commessa as any).clienteId ?? null;
        }
        const ok = await setMatchComunicazione(input.id, sedeId, {
          clienteId,
          commessaId: input.commessaId,
          confidenza: input.commessaId == null ? "nessuna" : "alta",
          motivo:
            input.commessaId == null
              ? null
              : "Collegata a mano da un operatore.",
        });
        if (!ok) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Comunicazione non trovata.",
          });
        }
        return { success: true as const };
      }),
  }),
});
