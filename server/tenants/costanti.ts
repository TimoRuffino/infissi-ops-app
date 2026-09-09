// Il tenant (azienda) sopra le sedi — WS1 (06/09/2026). Spec:
// docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md

/** Ruffino Group. MUST stay 1: è il backfill di ogni utente e sede legacy. */
export const TENANT_PREDEFINITO_ID = 1;
export const TENANT_PREDEFINITO_SLUG = "ruffino-group";
export const TENANT_PREDEFINITO_NOME = "Ruffino Group";

export const RUOLO_PROPRIETARIO = "proprietario" as const;
export const CAPABILITY_PROPRIETARI = "tenant.manage_proprietari" as const;

export const INTERVALLO_COMANDI_MS = 30_000;

/** Quota di storage per un'azienda nuova, finché nessuno la cambia (WS3 §3.2). */
export const QUOTA_STORAGE_PREDEFINITA_BYTES = 100 * 1024 ** 3; // 100 GiB

/** Un `state` OAuth non consumato entro questa finestra è scaduto (WS3 §5). */
export const TTL_STATE_OAUTH_MS = 10 * 60_000;

/** Un invito del pannello piattaforma non accettato entro una settimana è scaduto (WS6 §4.1). */
export const TTL_INVITO_MS = 7 * 24 * 60 * 60 * 1000;

/** Minuscole, cifre, trattini interni; da 1 a 40 caratteri. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const MESSAGGI = {
  solaLettura: "Azienda sospesa: il gestionale è in sola lettura.",
  senzaSede: "L'azienda non ha una sede attiva.",
  soloProprietari: "Solo un proprietario può nominare o revocare un proprietario.",
  proprietarioRichiedeFlag: "Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.",
  nonTrovato: "Risorsa non trovata.",
  // Le otto tabelle sono quelle che `verificaSchema` chiede davvero
  // (repository.ts): il messaggio ne nominava tre e mandava l'operatore a
  // cercare il guasto sulla tabella sbagliata — di solito a mancare sono le
  // due del WS3 (fix wave finale). `abbonamenti` è del WS4, `tenant_inviti`
  // del WS6 (pannello piattaforma).
  schemaAssente:
    "Tabelle del control plane del tenant assenti (tenants, tenant_eventi, tenant_comandi, tenant_sedi, tenant_storage, oauth_state, abbonamenti, tenant_inviti): le crea il server al primo avvio con questa versione; lo script non tocca lo schema.",
  // WS6 (pannello piattaforma, spec §5.2): `eseguiComandoSubito` a
  // interruttore spento — il pannello lo dice invece di eseguire comunque.
  comandiSpenti: "Con FLAG_MULTI_AZIENDA spento i comandi non vengono eseguiti.",
  // WS6 ruling R10: porta chiusa a interruttore spento. A flag spento il
  // contesto fissa `tenantId = 1` per chiunque, quindi la sessione di un
  // utente di un'altra azienda lo porterebbe dentro Ruffino Group. Finché il
  // multi-azienda è spento, quelle sessioni non si aprono.
  multiAziendaSpento: "Accesso non disponibile: il multi-azienda della piattaforma è spento.",
} as const;
