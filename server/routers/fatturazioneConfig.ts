// Router tRPC della configurazione di fatturazione per sede: IBAN, banca,
// numerazione e conto FiC, footer, spese di documentazione, e la verifica
// dello scope di scrittura di Fatture in Cloud. Stesso pattern di
// contratti.ts e fatture.ts: valida, autorizza, delega a
// server/fatture/config.ts, mappa gli errori.
//
// Stessi due interruttori di fatture.ts (piano 2): FLAG_FATTURAZIONE in
// middleware, FLAG_LIMITI dentro ogni handler — la configurazione non ha
// senso da sola, governa una feature che dipende da entrambi.
import { z } from "zod";
import { procedureConInterruttore, router } from "../_core/trpc";
import { assicuraInterruttore } from "../platform/interruttori";
import { authorizeCoreOperation } from "../authz/enforcement";
import { configFatturazione, salvaConfigFatturazione, verificaScopeScrittura } from "../fatture/config";
import { sdiDryRun } from "../fatture/dryRun";
import { erroreServizioComeTrpc } from "./contratti";
import { getCfg } from "./fattureInCloud";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("fatturazione");

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

// zod: mirror del patch accettato da salvaConfigFatturazione
// (server/fatture/config.ts) — iban ≤ 34 (l'IBAN vero si verifica nel
// servizio col modulo 97), banca ≤ 80, intestatario ≤ 120, metodoPagamento
// «MPnn», numerazioneFic ≤ 20, paymentAccountIdFic intero, dicituraFooter
// ≤ 500, speseDocumentazioneCent centesimi ≥ 0 (R17).
const patchConfigSchema = z.object({
  iban: z.string().max(34).optional(),
  banca: z.string().max(80).nullable().optional(),
  intestatario: z.string().max(120).nullable().optional(),
  metodoPagamento: z.string().regex(/^MP\d{2}$/).optional(),
  numerazioneFic: z.string().max(20).nullable().optional(),
  paymentAccountIdFic: z.number().int().nullable().optional(),
  dicituraFooter: z.string().max(500).nullable().optional(),
  speseDocumentazioneCent: z.number().int().min(0).optional(),
});

export const fatturazioneConfigRouter = router({
  get: procedura.query(async ({ ctx }) => {
    assicuraInterruttore("limiti");
    const sedeId = sedeCorrente(ctx);
    await authorizeCoreOperation({
      ctx,
      endpoint: "fatturazioneConfig.get",
      capability: "fattura.read",
      resourceType: "fatturazioneConfig",
      resource: { sedeId },
      legacyAllowed: "capability",
    });
    const config = await configFatturazione(sedeId);
    // Due flag distinti (revisione): `scopeScrittura` è l'intento — l'ultimo
    // OAuth avviato chiedendo anche lo scope di scrittura (FicConfig, v.
    // server/routers/fattureInCloud.ts) — `scopeScritturaOk` è la verifica —
    // l'ultima chiamata a /issued_documents/info che ha confermato che il
    // token la esercita davvero (v. server/fatture/config.ts). La UI ne ha
    // bisogno di entrambi: il primo senza il secondo è «richiesta fatta, mai
    // verificata».
    return {
      config,
      dryRun: sdiDryRun(),
      scopeScrittura: getCfg(sedeId).scopeScrittura ?? false,
      scopeScritturaOk: config.scopeScritturaOk,
    };
  }),

  salva: procedura
    .input(patchConfigSchema)
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "fatturazioneConfig.salva",
        capability: "fattura.emit",
        resourceType: "fatturazioneConfig",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await salvaConfigFatturazione({ sedeId, patch: input });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  verificaScope: procedura.mutation(async ({ ctx }) => {
    assicuraInterruttore("limiti");
    const sedeId = sedeCorrente(ctx);
    await authorizeCoreOperation({
      ctx,
      endpoint: "fatturazioneConfig.verificaScope",
      capability: "fattura.emit",
      resourceType: "fatturazioneConfig",
      resource: { sedeId },
      legacyAllowed: "capability",
    });
    return verificaScopeScrittura({ sedeId });
  }),
});
