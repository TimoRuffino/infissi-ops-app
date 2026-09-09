// server/piattaforma/invitiRouter.ts
// Router pubblico degli inviti (spec §6.2), montato come `inviti`: la pagina
// `/invito/:token` (fuori dalla shell, senza sessione) parla solo con
// questo router. `anteprima` legge senza consumare; `accetta` imposta la
// password e apre la sessione locale come fa `auth.login` — stesso cookie
// (COOKIE_NAME via apriSessioneLocale), stessa forma di LocalUser.
//
// Limite di tentativi (spec §6.2, come il login: 5 in 15 minuti) con chiave
// derivata dall'hash del token: mai il token in chiaro in una chiave di
// cache o di log.
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { creaLimiteTentativi } from "../_core/limiteTentativi";
import { publicProcedure, router } from "../_core/trpc";
import { apriSessioneLocale } from "../localAuth";
import { getUtentiStore, passwordSchema } from "../routers/utenti";
import { conTenant } from "../tenants/contestoCorrente";
import { MESSAGGI_PIATTAFORMA } from "./costanti";
import { accettaInvito, anteprimaInvito } from "./inviti";

const limiteInviti = creaLimiteTentativi({
  finestraMs: 15 * 60 * 1000,
  massimo: 5,
  messaggio: MESSAGGI_PIATTAFORMA.troppiTentativi,
});

/** Chiave del limitatore: l'hash del token, mai il token in chiaro. */
const chiaveToken = (token: string): string =>
  `invito:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;

const tokenSchema = z.string().min(20).max(200);

export const invitiRouter = router({
  /** Non consuma: la pagina la richiama a ogni caricamento senza bruciare il token. */
  anteprima: publicProcedure.input(z.object({ token: tokenSchema })).query(async ({ input }) => {
    const invito = await anteprimaInvito({ token: input.token, adesso: new Date() });
    if (!invito) throw new TRPCError({ code: "NOT_FOUND", message: MESSAGGI_PIATTAFORMA.invitoNonValido });
    return invito;
  }),

  accetta: publicProcedure
    .input(z.object({ token: tokenSchema, password: passwordSchema }))
    .mutation(async ({ input, ctx }) => {
      const chiave = chiaveToken(input.token);
      limiteInviti.verifica(chiave);
      let esito: Awaited<ReturnType<typeof accettaInvito>>;
      try {
        esito = await accettaInvito({ token: input.token, password: input.password, adesso: new Date() });
      } catch {
        limiteInviti.fallito(chiave);
        throw new TRPCError({ code: "NOT_FOUND", message: MESSAGGI_PIATTAFORMA.invitoNonValido });
      }
      limiteInviti.azzera(chiave);
      const utente = conTenant(esito.tenantId, () => getUtentiStore().find((u: any) => u.id === esito.utenteId));
      return apriSessioneLocale(ctx, utente);
    }),
});
