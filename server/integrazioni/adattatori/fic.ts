// Avvolge Fatture in Cloud: `fattureInCloud.ts` non si tocca (WS3 l'ha
// riscritto per 66 righe).
//
// Il cliente non apre MAI l'area sviluppatori di FiC: `FIC_OAUTH_CLIENT_ID`
// e `FIC_OAUTH_CLIENT_SECRET` sono della piattaforma. La sua app chiede, il
// suo account concede.
//
// Due spigoli che si vedono solo dalla seconda azienda in poi:
//
// 1. L'auto-selezione dell'azienda scatta solo con UNA azienda sola. Con due
//    o più — commercialisti, gruppi — nessuno sceglie e `configured` resta
//    falso: collegamento riuscito, integrazione muta. Qui diventa un
//    problema con l'elenco a fianco.
// 2. Il redirect URI nasce dall'header `Host`. Vedi `../callback.ts`.

import {
  FIC_SCOPES_LETTURA,
  FIC_SCOPES_SCRITTURA,
  accessTokenFic,
  buildFicAuthUrl,
  ficGet,
  ficOAuthClientFromEnv,
  getCfg,
  issueFicOAuthState,
} from "../../routers/fattureInCloud";
import {
  callbackCanonico,
  callbackConfigurato,
  problemaDiPiattaforma,
} from "../callback";
import type { Adattatore, Avvio, Problema, Stato } from "../contratto";

export const fic: Adattatore = {
  chiave: "fic",
  ambito: "sede",
  permesso: "direzione",

  async stato(ctx): Promise<Stato> {
    const cfg = getCfg(ctx.sedeId);
    const collegato = !!cfg.accessTokenCifrato;
    // Il callback e il client OAuth sono della PIATTAFORMA (spec §6): se
    // mancano, «Collega» manderebbe il cliente a scoprire il guasto a metà
    // giro, con il messaggio di Fatture in Cloud invece del nostro. Vale solo
    // per chi deve ancora collegarsi: un collegamento che già funziona non
    // diventa un caso di assistenza perché una variabile è stata tolta.
    const piattaformaPronta =
      callbackConfigurato("FIC_OAUTH_REDIRECT_URI") && !!ficOAuthClientFromEnv();
    const problema: Problema | null = !collegato
      ? piattaformaPronta
        ? null
        : problemaDiPiattaforma("Fatture in Cloud", "FIC_OAUTH_REDIRECT_URI o il client OAuth")
      : !cfg.companyId
        ? {
            causa:
              "Il tuo account Fatture in Cloud non ha ancora un'azienda collegata a questa sede.",
            rimedio: "Scegli quale azienda usare: l'elenco è qui sotto.",
            azione: "scegli",
          }
        : null;

    return {
      chiave: "fic",
      ambito: "sede",
      collegato,
      soggetto: cfg.companyId ? `Azienda ${cfg.companyId}` : null,
      verificatoIl: cfg.lastSyncAt,
      problema,
    };
  },

  async verifica(ctx): Promise<Problema | null> {
    const cfg = getCfg(ctx.sedeId);
    if (!cfg.accessTokenCifrato) return null;
    try {
      const token = await accessTokenFic(cfg);
      if (!token) throw new Error("nessun token");
      await ficGet("/user/companies", token);
      return null;
    } catch {
      return {
        causa: "Fatture in Cloud non accetta più il collegamento di questa sede.",
        rimedio:
          "Ricollega il tuo account: l'autorizzazione può essere stata revocata.",
        azione: "ricollega",
      };
    }
  },

  async avvia(ctx, opz): Promise<Avvio> {
    // Prima il callback: se manca, non si emette nemmeno lo `state`.
    const redirectUri = callbackCanonico("FIC_OAUTH_REDIRECT_URI");
    if (!ficOAuthClientFromEnv()) {
      throw new Error(
        "Client OAuth di Fatture in Cloud non configurato sulla piattaforma."
      );
    }
    // Sola lettura all'attivazione; la scrittura si chiede al primo bisogno,
    // nel momento in cui il motivo è ovvio (decisione 6).
    const scrittura = (opz as { scrittura?: boolean } | undefined)?.scrittura === true;
    const state = await issueFicOAuthState(
      ctx.sedeId ?? 1,
      redirectUri,
      scrittura,
      Number(ctx.user?.id ?? 0)
    );
    const url = buildFicAuthUrl(
      redirectUri,
      state,
      scrittura ? FIC_SCOPES_SCRITTURA : FIC_SCOPES_LETTURA
    );
    if (!url) {
      throw new Error("URL di autorizzazione di Fatture in Cloud non costruibile.");
    }
    return { tipo: "url", url };
  },
};
