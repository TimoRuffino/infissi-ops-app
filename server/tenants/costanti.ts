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

/** Ciclo di vita (piano 10/09/2026, D6): un'azienda `in_attesa` mai attivata si cancella dopo 14 giorni. */
export const ATTESA_ATTIVAZIONE_MS = 14 * 24 * 60 * 60 * 1000;

/** Ritenzione di un'azienda `cancellato` prima che il giro accodi `svuota_tenant` (D5). */
export const RITENZIONE_CANCELLAZIONE_MS = 30 * 24 * 60 * 60 * 1000;

/** Un reinvio dell'invito per lo stesso utente non prima di 10 minuti dal precedente (D8). */
export const ATTESA_REINVIO_INVITO_MS = 10 * 60 * 1000;

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
  // «Modifica azienda» (piano 09/09/2026, Task 2): il tenant 1 è l'ancora di
  // ogni URL, comando script e riferimento già in uso — stesso principio di
  // MESSAGGI_ABBONAMENTO.tenant1Intoccabile (server/abbonamenti/costanti.ts).
  tenant1SlugIntoccabile: "Il tenant 1 è la proprietaria della piattaforma: lo slug non cambia.",
  // Stesso concetto di MESSAGGI_PIATTAFORMA.proprietarioAmbiguo
  // (server/piattaforma/inviti.ts, per l'invito): qui per chi modifica un
  // proprietario esistente. Non si importa da lì: il verso della dipendenza
  // va da piattaforma verso tenants, mai il contrario.
  proprietarioAmbiguo: "L'azienda ha più proprietari: indica utenteId.",
  // Estratta dal letterale sparso in `modificaProprietario` (revisione Task
  // 2 → Task 3): stessa parola, così il router del pannello può confrontare
  // l'esito del comando con la costante invece che con una stringa a mano.
  emailGiaInUso: "Email già in uso",
  // Ciclo di vita (piano 10/09/2026). Un messaggio solo per i tre stati che
  // chiudono la porta (`in_attesa`, `archiviato`, `cancellato`): distinguere
  // aiuterebbe solo chi tasta account non suoi.
  aziendaNonAccessibile: "Questa azienda non è attiva: contatta l'assistenza.",
  // Come `tenant1SlugIntoccabile`: la proprietaria della piattaforma non si
  // archivia né si cancella — sospenderla (con `ancheTenant1`) resta l'unico
  // freno previsto.
  tenant1NonSiChiude: "Il tenant 1 è la proprietaria della piattaforma: non si archivia né si cancella.",
  aziendaSvuotata: "L'azienda è già stata svuotata: i dati non esistono più.",
} as const;
