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
import { interruttoreAttivo } from "../platform/interruttori";
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

/**
 * `anteprima` è una query pubblica che, con un token indovinato, direbbe il
 * nome dell'azienda e l'email di chi ci lavora: senza limite si possono
 * provare token quanto si vuole. La chiave è l'indirizzo, non il token —
 * chi enumera cambia token a ogni colpo — e la finestra è più larga di
 * quella di `accetta` (30 invece di 5): ricaricare la propria pagina
 * d'invito è legittimo, e un token valido azzera comunque il contatore.
 */
const limiteAnteprime = creaLimiteTentativi({
  finestraMs: 15 * 60 * 1000,
  massimo: 30,
  messaggio: MESSAGGI_PIATTAFORMA.troppiTentativi,
});

/** Chiave del limitatore: l'hash del token, mai il token in chiaro. */
const chiaveToken = (token: string): string =>
  `invito:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;

/** Chiave dell'anteprima: l'indirizzo di chi chiede, `?` se il proxy non lo dà. */
const chiaveIndirizzo = (req: { ip?: string }): string => `anteprima:${req.ip || "?"}`;

/** Solo per i test: azzera i limitatori della pagina d'invito. */
export function __azzeraLimiteInvitiPerTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  limiteInviti.__azzeraTutto();
  limiteAnteprime.__azzeraTutto();
}

const tokenSchema = z.string().min(20).max(200);

/**
 * Porta chiusa a interruttore spento (WS6, R10): accettare un invito
 * aprirebbe la sessione di un utente di un'altra azienda, che a flag spento
 * finisce dentro il tenant 1; e già l'anteprima direbbe a chi ha il link il
 * nome dell'azienda e di chi ci lavora. Il token non viene toccato: quando
 * l'interruttore torna acceso l'invito vale ancora.
 */
function assicuraMultiAziendaAcceso(): void {
  if (!interruttoreAttivo("multiAzienda")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: MESSAGGI_PIATTAFORMA.solaLetturaFlagSpento,
    });
  }
}

export const invitiRouter = router({
  /** Non consuma: la pagina la richiama a ogni caricamento senza bruciare il token. */
  anteprima: publicProcedure.input(z.object({ token: tokenSchema })).query(async ({ input, ctx }) => {
    assicuraMultiAziendaAcceso();
    const chiave = chiaveIndirizzo(ctx.req);
    limiteAnteprime.verifica(chiave);
    const invito = await anteprimaInvito({ token: input.token, adesso: new Date() });
    if (!invito) {
      limiteAnteprime.fallito(chiave);
      throw new TRPCError({ code: "NOT_FOUND", message: MESSAGGI_PIATTAFORMA.invitoNonValido });
    }
    limiteAnteprime.azzera(chiave);
    return invito;
  }),

  accetta: publicProcedure
    .input(z.object({ token: tokenSchema, password: passwordSchema }))
    .mutation(async ({ input, ctx }) => {
      assicuraMultiAziendaAcceso();
      const chiave = chiaveToken(input.token);
      limiteInviti.verifica(chiave);
      let esito: Awaited<ReturnType<typeof accettaInvito>>;
      try {
        esito = await accettaInvito({ token: input.token, password: input.password, adesso: new Date() });
      } catch (e) {
        const messaggio = e instanceof Error ? e.message : String(e);
        if (messaggio !== MESSAGGI_PIATTAFORMA.invitoNonValido) {
          console.error(`[inviti] accettazione fallita: ${messaggio}`);
        }
        limiteInviti.fallito(chiave);
        throw new TRPCError({ code: "NOT_FOUND", message: MESSAGGI_PIATTAFORMA.invitoNonValido });
      }
      limiteInviti.azzera(chiave);
      const utente = conTenant(esito.tenantId, () => getUtentiStore().find((u: any) => u.id === esito.utenteId));
      return apriSessioneLocale(ctx, utente);
    }),
});
