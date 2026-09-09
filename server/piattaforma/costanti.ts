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
} as const;
export const VARIABILE_AMMINISTRATORI = "PLATFORM_ADMIN_EMAILS";
export const VARIABILE_BASE_URL = "APP_BASE_URL";
