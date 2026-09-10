// server/piattaforma/costanti.ts
// Messaggi e nomi delle variabili d'ambiente del pannello piattaforma (WS6
// §3, §10). Nessuna logica qui: solo testo e chiavi, così i test di dominio
// e i router condividono lo stesso testo mostrato all'utente.
export const MESSAGGI_PIATTAFORMA = {
  nonAmministratore: "Questa sezione è riservata all'amministrazione della piattaforma.",
  passwordNonCorretta: "Password non corretta.",
  solaLetturaFlagSpento: "Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura.",
  invitoNonValido: "Questo invito non è valido o è scaduto: chiedi un nuovo invito.",
  postaNonConfigurata: "Posta della piattaforma non configurata: copia il link e consegnalo a mano.",
  proprietarioAmbiguo: "L'azienda ha più proprietari: indica l'email di chi invitare.",
  tenantGiaEsistente: "L'azienda esiste già: nessun invito inviato.",
  troppiTentativi: "Troppi tentativi di accesso. Riprova tra qualche minuto.",
  invitoAppenaInviato: "Un invito per questo proprietario è appena partito: riprova fra qualche minuto.",
  iscrizioneNonDisponibile: "Le iscrizioni non sono aperte al momento: scrivici e ti apriamo noi la prova.",
  iscrizioneNonRiuscita: "Non siamo riusciti a completare la registrazione: riprova fra qualche minuto.",
  // Stesso rifiuto di `pnpm tenant sospendi` (scripts/tenant.ts) per il
  // tenant 1, adattato al campo del pannello (`ancheTenant1`, non un flag CLI).
  tenant1SospensioneConferma:
    "Sospendere il tenant 1 mette Ruffino Group in sola lettura: conferma con «anche Ruffino Group» (ancheTenant1).",
} as const;
export const VARIABILE_AMMINISTRATORI = "PLATFORM_ADMIN_EMAILS";
export const VARIABILE_BASE_URL = "APP_BASE_URL";
/** L'indirizzo a cui rispondere alle mail di piattaforma: il mittente è un
 *  `no-reply`, e senza questo una risposta non arriva a nessuno. Assente =
 *  la mail non promette una risposta (v. `contattoPiattaforma`). */
export const VARIABILE_POSTA_RISPOSTA = "POSTA_PIATTAFORMA_RISPOSTA";
