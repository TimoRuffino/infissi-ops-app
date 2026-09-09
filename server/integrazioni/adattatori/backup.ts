// Avvolge il backup Drive di WS3: `driveBackup.ts` non si tocca.
//
// Dopo WS3 il backup è per AZIENDA, non «unico per l'installazione» come
// dice ancora l'intestazione della pagina Impostazioni. `ambito: "azienda"`
// registra il fatto di WS3, non lo cambia.

import {
  backupStatus,
  buildAuthUrl,
  checkBackupRoot,
  disconnectOAuth,
  issueOAuthState,
  oauthClientFromEnv,
} from "../../_core/driveBackup";
import { callbackCanonico } from "../callback";
import type { Adattatore, Avvio, Problema, Stato } from "../contratto";

export const backup: Adattatore = {
  chiave: "backup",
  ambito: "azienda",
  permesso: "direzione",

  async stato(): Promise<Stato> {
    const s = backupStatus();
    return {
      chiave: "backup",
      ambito: "azienda",
      collegato: s.driveConfigurato,
      soggetto: s.oauthEmail ?? s.serviceAccountEmail ?? null,
      verificatoIl: null,
      problema: null,
    };
  },

  async verifica(): Promise<Problema | null> {
    const esito = await checkBackupRoot();
    if (esito.ok) return null;
    return {
      causa: "La cartella di backup su Google Drive non è più raggiungibile.",
      rimedio:
        "Ricollega il tuo account Google: il permesso può essere stato revocato o la cartella spostata.",
      azione: "ricollega",
    };
  },

  async avvia(ctx): Promise<Avvio> {
    // Prima il callback: se manca, non si emette nemmeno lo `state`.
    const redirectUri = callbackCanonico("GOOGLE_OAUTH_REDIRECT_URI");
    if (!oauthClientFromEnv()) {
      throw new Error("Client OAuth Google non configurato sulla piattaforma.");
    }
    const state = await issueOAuthState(Number(ctx.user?.id ?? 0));
    const url = buildAuthUrl(redirectUri, state);
    if (!url) throw new Error("URL di autorizzazione Google non costruibile.");
    return { tipo: "url", url };
  },

  async scollega(): Promise<void> {
    disconnectOAuth();
  },
};
