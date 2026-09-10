// Le parole del pannello Piattaforma (spec WS6 §8, §10). Modulo PURO:
// nessun React, nessuna query, nessun `new Date()` nascosto — l'istante
// arriva sempre da fuori, come in `components/abbonamento/testi.ts`, da cui
// questo file prende i formati già decisi (date italiane, byte, percentuali).
//
// I testi che l'utente vede anche dal server sono ricopiati qui come
// costanti, non importati: il client non tira dentro moduli di `server/`
// (la sola eccezione del repo sono gli `import type`). Se cambiano di là
// vanno cambiati anche qui — sono due, e sono segnati.
import {
  byteScritti,
  dataItaliana,
  percentualeScritta,
} from "@/components/abbonamento/testi";
import { formatEuroSimbolo } from "@/lib/euro";

/** Copia di `MESSAGGI_PIATTAFORMA.invitoNonValido` (server/piattaforma/costanti.ts). */
export const TESTO_INVITO_NON_VALIDO =
  "Questo invito non è valido o è scaduto: chiedi un nuovo invito.";

/** Copia di `MESSAGGI_PIATTAFORMA.postaNonConfigurata` (server/piattaforma/costanti.ts). */
export const TESTO_POSTA_NON_CONFIGURATA =
  "Posta della piattaforma non configurata: copia il link e consegnalo a mano.";

/** Copia di `MESSAGGI_PIATTAFORMA.solaLetturaFlagSpento` (server/piattaforma/costanti.ts). */
export const TESTO_SOLA_LETTURA_FLAG_SPENTO =
  "Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura.";

/** La password minima della pagina d'invito, come `passwordSchema` (server/routers/utenti.ts). */
export const PASSWORD_MINIMA = 12;

/** Copia di `MESSAGGI_PIATTAFORMA.iscrizioneNonDisponibile` (server/piattaforma/costanti.ts). */
export const TESTO_ISCRIZIONI_CHIUSE =
  "Le iscrizioni non sono aperte al momento: scrivici e ti apriamo noi la prova.";

type StatoAzienda = "in_attesa" | "attivo" | "sospeso" | "archiviato" | "cancellato";

/** «Attiva»/«Sospesa»/…: si parla dell'azienda, non della riga di una tabella. */
export function etichettaStatoAzienda(stato: StatoAzienda): string {
  switch (stato) {
    case "in_attesa":
      return "In attesa";
    case "sospeso":
      return "Sospesa";
    case "archiviato":
      return "Archiviata";
    case "cancellato":
      return "Cancellata";
    default:
      return "Attiva";
  }
}

/** Variante del badge: rosso solo ciò che toglie qualcosa; l'attesa avvisa, l'archivio è neutro. */
export function tonoStatoAzienda(stato: StatoAzienda): "success" | "danger" | "secondary" | "warning" {
  if (stato === "sospeso" || stato === "cancellato") return "danger";
  if (stato === "archiviato") return "secondary";
  if (stato === "in_attesa") return "warning";
  return "success";
}

/**
 * Il conto alla rovescia dello svuotamento (ciclo di vita, 10/09/2026):
 * `null` fuori dallo stato «cancellata». La ritenzione è di 30 giorni dal
 * momento della cancellazione; a svuotamento avvenuto lo dice chiaro.
 */
export function etichettaRitenzione(
  riga: { stato: StatoAzienda; cancellatoIl: Date | null; svuotatoIl: Date | null },
  adesso: Date
): string | null {
  if (riga.stato !== "cancellato") return null;
  if (riga.svuotatoIl) return `Svuotata il ${dataItaliana(riga.svuotatoIl)}: i dati non esistono più.`;
  if (!riga.cancellatoIl) return null;
  const svuotamento = new Date(riga.cancellatoIl.getTime() + 30 * 86_400_000);
  return adesso.getTime() >= svuotamento.getTime()
    ? "Ritenzione compiuta: lo svuotamento è in coda."
    : `Dati conservati fino al ${dataItaliana(svuotamento)}: fino ad allora «Riattiva» annulla la cancellazione.`;
}

/**
 * La riga del blocco (spazio o Tars): `null` quando non c'è niente da dire.
 * Un blocco già scattato e una tolleranza che corre non sono la stessa cosa
 * e non si scrivono allo stesso modo — chi legge deve capire in un colpo
 * d'occhio se l'azienda è già ferma o se ha ancora tempo.
 */
export function etichettaBlocco(
  bloccoDal: Date | null | undefined,
  adesso: Date
): string | null {
  if (!bloccoDal) return null;
  return adesso.getTime() >= bloccoDal.getTime()
    ? `Fermo dal ${dataItaliana(bloccoDal)}`
    : `Si ferma il ${dataItaliana(bloccoDal)}`;
}

/**
 * Lo spazio in una riga: usato, quota e percentuale. `—` quando lo storage
 * non è mai stato contato: una riga «0 GB di 5 GB» direbbe una cosa falsa e
 * rassicurante.
 */
export function riassuntoSpazio(
  storage:
    | { bytes: number; quotaBytes: number; percentuale: number }
    | null
    | undefined
): string {
  if (!storage) return "—";
  return `${byteScritti(storage.bytes)} di ${byteScritti(storage.quotaBytes)} · ${percentualeScritta(storage.percentuale)}`;
}

/**
 * Tars del mese in una riga. `consumoEur === null` è «non lo so» (ledger
 * irraggiungibile, spec §4.4) e resta `—`; `budgetEur === null` è «nessun
 * tetto» (il tenant 1, R16) e va detto, non nascosto. Con il tetto si mostra
 * la somma di budget ed extra, che è il numero contro cui si blocca davvero.
 */
export function riassuntoTars(
  tars:
    | {
        consumoEur: number | null;
        budgetEur: number | null;
        extraEur: number;
        percentuale: number | null;
      }
    | null
    | undefined
): string {
  if (!tars || tars.consumoEur == null) return "—";
  const consumo = formatEuroSimbolo(tars.consumoEur);
  if (tars.budgetEur == null) return `${consumo} · senza tetto`;
  const tetto = formatEuroSimbolo(tars.budgetEur + (tars.extraEur || 0));
  const percentuale =
    tars.percentuale == null ? "" : ` · ${percentualeScritta(tars.percentuale)}`;
  return `${consumo} di ${tetto}${percentuale}`;
}

/**
 * L'ultimo backup: quando e com'è andato. `ok === null` è un backup ancora
 * aperto (partito e non chiuso), non un fallimento.
 */
export function riassuntoBackup(
  ultimo: { startedAt: Date; ok: boolean | null } | null | undefined
): string {
  if (!ultimo) return "Mai";
  const esito = ultimo.ok == null ? "in corso" : ultimo.ok ? "riuscito" : "fallito";
  return `${dataItaliana(ultimo.startedAt)} · ${esito}`;
}

/**
 * L'esito dell'invito al proprietario (spec §6.1): la posta è andata, oppure
 * il link va consegnato a mano. Il fallimento della posta non è un errore
 * del flusso — l'azienda è nata lo stesso — quindi il testo dice prima cosa
 * fare e poi, quando c'è, perché.
 *
 * La posta fallisce in due modi che si risolvono in due posti diversi:
 * manca `RESEND_API_KEY` (si mette su Railway) oppure Resend ha rifiutato —
 * 422 per un mittente su un dominio non verificato, un timeout, la rete.
 * Fino al 10/09/2026 il pannello mostrava sempre il primo testo anche nel
 * secondo caso: `motivo` arrivava dal server (`esitoPubblico`,
 * server/piattaforma/router.ts) e veniva buttato via, e chi guardava
 * andava a cercare una chiave che c'era già.
 */
export function testoEsitoInvito(esito: {
  inviato: boolean;
  email?: string | null;
  link?: string | null;
  motivo?: string | null;
}): string {
  if (esito.inviato) {
    return esito.email
      ? `Invito inviato a ${esito.email}.`
      : "Invito inviato al proprietario.";
  }
  const motivo = esito.motivo?.trim();
  // Senza motivo, o quando il motivo È la chiave mancante, resta il testo
  // del server: dice già da sé cosa fare.
  if (!motivo || motivo === TESTO_POSTA_NON_CONFIGURATA) {
    return TESTO_POSTA_NON_CONFIGURATA;
  }
  return `La posta non è partita (${motivo}): copia il link e consegnalo a mano.`;
}

// ── Pagina pubblica /invito ────────────────────────────────────────────

/** Una regola della password: cosa chiede e se è già soddisfatta. */
export type RegolaPassword = { testo: string; soddisfatta: boolean };

/**
 * Le due regole della password d'invito, nell'ordine in cui si compilano.
 * Vivono qui e non dentro `InvitoPage.tsx` perché una regola dentro un
 * componente non si prova: la suite gira senza DOM.
 *
 * La seconda regola è falsa finché la conferma è vuota: `"" === ""` sarebbe
 * vero, e a campi vuoti chi guarda vedrebbe una spunta verde per qualcosa
 * che non ha ancora fatto.
 */
export function regolePassword(password: string, conferma: string): RegolaPassword[] {
  return [
    {
      testo: `Almeno ${PASSWORD_MINIMA} caratteri`,
      soddisfatta: password.length >= PASSWORD_MINIMA,
    },
    {
      testo: "Le due password coincidono",
      soddisfatta: conferma.length > 0 && password === conferma,
    },
  ];
}

/**
 * Il messaggio da mostrare al momento dell'invio, o `null` se si può
 * mandare. Le due condizioni si fermano qui e non arrivano al server: una
 * password corta o due password diverse non sono un tentativo sbagliato, e
 * non devono consumare uno dei cinque del limitatore (spec §6.2).
 */
export function erroreInvioPassword(password: string, conferma: string): string | null {
  if (password.length < PASSWORD_MINIMA) {
    return `La password deve avere almeno ${PASSWORD_MINIMA} caratteri.`;
  }
  if (password !== conferma) return "Le due password non coincidono.";
  return null;
}

/** «Scade il GG/MM/AAAA»: la vita del link d'invito, in chiaro. */
export function scadenzaInvito(scadeIl: Date): string {
  return `Scade il ${dataItaliana(scadeIl)}`;
}

/**
 * L'esito del dialogo «Nuova azienda» dopo `piattaforma.crea` (fix-round
 * Task 8, promemoria #1): prima di questa funzione il dialogo mostrava
 * «Azienda creata» e «Apri la scheda» anche quando `comando.stato ===
 * "errore"` — un'azienda mai nata. `stato !== "eseguito"` (errore, o
 * `in_attesa` ancora aperto oltre il timeout di `eseguiComandoSubito`)
 * decide tutto: nessuna frase sull'invito, nessuna scheda da aprire, solo
 * l'errore del dominio (`comando.esito.errore`) o un ripiego generico se il
 * comando non ne ha ancora uno. Quando l'azienda nasce invece, la `nota`
 * (esisteva già, spec §5.2) prende il posto della frase sull'invito — i due
 * casi non capitano insieme, il server manda o l'una o l'altra.
 */
export function esitoCreazione(dati: {
  stato: string;
  errore?: string;
  nota?: string;
  invito: {
    inviato: boolean;
    email?: string | null;
    link?: string | null;
    baseUrl?: string | null;
    motivo?: string | null;
  } | null;
}): {
  titolo: string;
  descrizione: string;
  mostraScheda: boolean;
  link?: string;
  /** L'indirizzo da cui nasce il link (I5): si mostra solo insieme al link. */
  base?: string;
} {
  if (dati.stato !== "eseguito") {
    return {
      titolo: "Creazione non riuscita",
      descrizione: dati.errore || "Il comando non è andato a buon fine.",
      mostraScheda: false,
    };
  }
  if (dati.nota) {
    return { titolo: "Azienda creata", descrizione: dati.nota, mostraScheda: true };
  }
  if (dati.invito) {
    return {
      titolo: "Azienda creata",
      descrizione: testoEsitoInvito(dati.invito),
      mostraScheda: true,
      // Dopo R9 il server manda il `link` SOLO quando la posta non è
      // partita: qui basta guardare se c'è, senza dedurlo da `inviato`.
      link: dati.invito.link ?? undefined,
      base: dati.invito.link ? dati.invito.baseUrl ?? undefined : undefined,
    };
  }
  return { titolo: "Azienda creata", descrizione: "", mostraScheda: true };
}

// ── Registro: eventi, attori, comandi ──────────────────────────────────

/**
 * I tipi di `tenant_eventi` (server/tenants/tipi.ts) in italiano. La mappa
 * NON è esaustiva per contratto: un tipo nuovo lato server deve comparire
 * nella scheda com'è scritto, non sparire dietro una riga vuota. Per questo
 * la firma accetta una stringa e il ripiego è il valore stesso.
 */
const ETICHETTE_EVENTO: Record<string, string> = {
  creato: "Azienda creata",
  sospeso: "Azienda sospesa",
  riattivato: "Azienda riattivata",
  proprietario_assegnato: "Proprietario assegnato",
  proprietario_revocato: "Proprietario revocato",
  comando_fallito: "Comando fallito",
  storage_soglia: "Soglia di spazio",
  storage_ricalcolato: "Spazio ricalcolato",
  worker_sospeso: "Worker fermato",
  worker_riarmato: "Worker riarmato",
  archivi_ripristinati: "Archivi ripristinati",
  abbonamento_creato: "Abbonamento creato",
  abbonamento_stato: "Stato dell'abbonamento",
  abbonamento_omaggio: "Omaggio concesso",
  abbonamento_prova_prorogata: "Prova prorogata",
  abbonamento_avviso: "Avviso di scadenza",
  abbonamento_modificato: "Abbonamento modificato",
  tars_soglia: "Soglia di Tars",
  storage_bloccato: "Caricamenti fermi",
  storage_sbloccato: "Caricamenti ripresi",
  tars_bloccato: "Tars fermo",
  tars_sbloccato: "Tars ripreso",
  invito_inviato: "Invito inviato",
  invito_accettato: "Invito accettato",
  invito_annullato: "Invito annullato",
  tenant_modificato: "Azienda modificata",
  proprietario_modificato: "Proprietario modificato",
  slug_cambiato: "Slug cambiato",
  // Ciclo di vita (10/09/2026)
  attivato: "Azienda attivata",
  archiviato: "Azienda archiviata",
  cancellato: "Azienda cancellata",
  svuotato: "Dati svuotati",
  prima_commessa: "Prima commessa",
  prima_fattura: "Prima fattura",
  primo_utente_aggiunto: "Primo utente aggiunto",
};

export function etichettaEvento(tipo: string): string {
  return ETICHETTE_EVENTO[tipo] ?? tipo;
}

/**
 * Chi ha agito, come lo scrive `attoreTesto` (server/tenants/tipi.ts):
 * `piattaforma:<email>`, `script:<nome>`, `utente:<id>`, `boot`. Il registro
 * serve a rispondere a «chi è stato»: una riga che dice `script:tenant@host`
 * costringe a tradurre a mente ogni volta. Ciò che non ha una di queste
 * forme passa com'è: inventare una traduzione sarebbe peggio che mostrarla.
 */
export function attoreLeggibile(attore: string): string {
  const testo = attore.trim();
  if (!testo) return "—";
  if (testo === "boot") return "avvio del server";
  const [prefisso, ...resto] = testo.split(":");
  const valore = resto.join(":").trim();
  if (!valore) return testo;
  if (prefisso === "piattaforma") return `piattaforma (${valore})`;
  if (prefisso === "script") return `riga di comando (${valore})`;
  if (prefisso === "utente") return `utente ${valore}`;
  return testo;
}

/**
 * I tipi di `tenant_comandi` con il nome dell'azione, non del `case`.
 * Stessa regola della mappa degli eventi: un comando sconosciuto si mostra.
 */
const ETICHETTE_COMANDO: Record<string, string> = {
  crea: "Creazione",
  sospendi: "Sospensione",
  riattiva: "Riattivazione",
  assegna_proprietario: "Proprietario assegnato",
  revoca_proprietario: "Proprietario revocato",
  ricalcola_storage: "Ricalcolo dello spazio",
  ripristina_archivi: "Ripristino degli archivi",
  imposta_abbonamento: "Abbonamento",
  modifica_tenant: "Modifica dell'azienda",
  modifica_proprietario: "Modifica del proprietario",
  archivia: "Archiviazione",
  cancella: "Cancellazione",
  svuota_tenant: "Svuotamento dei dati",
};

export function etichettaComando(tipo: string): string {
  return ETICHETTE_COMANDO[tipo] ?? tipo;
}

/** Il tono del badge di stato di un comando: solo l'errore si colora. */
export function tonoStatoComando(stato: string): "success" | "warning" | "danger" {
  if (stato === "errore") return "danger";
  if (stato === "in_attesa") return "warning";
  return "success";
}

/** Lo stato di un comando in italiano: «Eseguito», «In corso…», «Errore». */
export function etichettaStatoComando(stato: string): string {
  if (stato === "errore") return "Errore";
  if (stato === "in_attesa") return "In corso…";
  return "Eseguito";
}

/**
 * Il messaggio del dominio dentro `comando.esito` (spec §10): il pannello lo
 * mostra così com'è, non lo riscrive. `undefined` quando non c'è.
 */
export function erroreDelComando(
  esito: Record<string, unknown> | null | undefined
): string | undefined {
  const errore = esito?.errore;
  return typeof errore === "string" && errore.length > 0 ? errore : undefined;
}

/** «GG/MM/AAAA hh:mm»: nel registro due eventi dello stesso giorno vanno distinti. */
export function dataOraItaliana(istante: Date): string {
  const ora = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(istante);
  return `${dataItaliana(istante)} ${ora}`;
}

/**
 * I `dettagli` di un evento su una riga sola. Non è un JSON viewer: è la
 * riga di una tabella, e serve a capire *cosa* è cambiato senza aprire
 * niente. `null` e `undefined` spariscono (non sono valori), i booleani si
 * leggono in italiano, il resto passa da `JSON.stringify` invece di
 * diventare `[object Object]`.
 */
export function dettagliCompatti(
  dettagli: Record<string, unknown> | null | undefined
): string {
  if (!dettagli) return "";
  return Object.entries(dettagli)
    .filter(([, valore]) => valore != null)
    .map(([chiave, valore]) => {
      if (typeof valore === "boolean") return `${chiave}: ${valore ? "sì" : "no"}`;
      if (typeof valore === "object") return `${chiave}: ${JSON.stringify(valore)}`;
      return `${chiave}: ${String(valore)}`;
    })
    .join(" · ");
}

/**
 * Lo stato di un invito, che nel record è la combinazione di tre date
 * (`usatoIl`, `annullatoIl`, `scadeIl`) e mai un campo solo. L'ordine conta:
 * un invito annullato resta annullato anche se non è ancora scaduto, e un
 * invito usato è storia chiusa. `pendente` è la sola condizione in cui
 * «Annulla» ha senso.
 */
export function statoInvito(
  invito: { scadeIl: Date; usatoIl: Date | null; annullatoIl: Date | null },
  adesso: Date
): { etichetta: string; tono: "success" | "warning" | "info" | "secondary"; pendente: boolean } {
  if (invito.annullatoIl) return { etichetta: "Annullato", tono: "secondary", pendente: false };
  if (invito.usatoIl) return { etichetta: "Accettato", tono: "success", pendente: false };
  if (invito.scadeIl.getTime() <= adesso.getTime()) {
    return { etichetta: "Scaduto", tono: "warning", pendente: false };
  }
  return { etichetta: "In sospeso", tono: "info", pendente: true };
}

// ── «Modifica azienda» (piano 09/09/2026, Task 4) ──────────────────────

/**
 * I sei campi di fatturazione del control plane (`DatiFatturazione`,
 * server/tenants/tipi.ts) con il nome che hanno per chi li compila e
 * l'aiuto che dice la regola PRIMA che il server la faccia rispettare.
 * Sono facoltativi tutti e sei: un'azienda può vivere senza, e chi apre il
 * dialogo non deve inventarsi una P. IVA per poter salvare le note.
 *
 * L'ordine è quello in cui si copiano da una visura: identificativi
 * fiscali, indirizzo, recapiti della fatturazione elettronica.
 */
export const CAMPI_FATTURAZIONE = [
  { campo: "partitaIva", etichetta: "Partita IVA", aiuto: "Undici cifre." },
  { campo: "codiceFiscale", etichetta: "Codice fiscale", aiuto: "Da 11 a 16 caratteri." },
  { campo: "indirizzoLegale", etichetta: "Sede legale", aiuto: "Via, numero, CAP e comune." },
  {
    campo: "emailAmministrativa",
    etichetta: "Email amministrativa",
    aiuto: "Dove arrivano le fatture dell'abbonamento.",
  },
  { campo: "pec", etichetta: "PEC", aiuto: "L'indirizzo di posta certificata." },
  { campo: "codiceSdi", etichetta: "Codice SDI", aiuto: "Sette caratteri." },
] as const;

export type CampoFatturazione = (typeof CAMPI_FATTURAZIONE)[number]["campo"];

/**
 * La forma di un indirizzo email, non la sua esistenza: qualcosa, una
 * chiocciola, un dominio con un punto. La stessa guardia che
 * `SezioneProprietari` usa da sempre prima di invitare — qui in un posto
 * solo, perché ora la vogliono anche i due campi di fatturazione e l'email
 * del proprietario nel dialogo di modifica.
 */
export function emailPlausibile(valore: string): boolean {
  return /.+@.+\..+/.test(valore.trim());
}

/**
 * Il campo di fatturazione è vuoto o ha la forma giusta? Il messaggio da
 * mostrare sotto il campo, oppure `null`.
 *
 * Sono le stesse regole di `schemaPayloadModificaTenant`
 * (server/tenants/comandi.ts) — vuoto azzera, altrimenti forma e lunghezza —
 * scritte qui per dirle mentre si scrive invece che dopo il viaggio: un
 * `ZodError` sul campo `fatturazione.partitaIva` non dice a nessuno che
 * mancava una cifra. La verità resta del server: questa è una cortesia.
 */
export function erroreFatturazione(campo: CampoFatturazione, valore: string): string | null {
  const testo = valore.trim();
  if (testo === "") return null;
  switch (campo) {
    case "partitaIva":
      return /^\d{11}$/.test(testo) ? null : "La partita IVA sono undici cifre, senza «IT».";
    case "codiceFiscale":
      return testo.length >= 11 && testo.length <= 16
        ? null
        : "Il codice fiscale va da 11 a 16 caratteri.";
    case "indirizzoLegale":
      return testo.length <= 200 ? null : "La sede legale non supera i 200 caratteri.";
    case "emailAmministrativa":
      return emailPlausibile(testo) ? null : "Questo non è un indirizzo email.";
    case "pec":
      return emailPlausibile(testo) ? null : "Questo non è un indirizzo PEC.";
    case "codiceSdi":
      return testo.length === 7 ? null : "Il codice SDI sono sette caratteri.";
  }
}

/**
 * I tetti di lunghezza degli altri campi di «Modifica azienda» (nit della
 * revisione di Task 4): stessa idea di `erroreFatturazione`, stessa fonte di
 * verità — i `.max()` di `schemaPayloadModificaTenant` e
 * `schemaPayloadModificaProprietario` (server/tenants/comandi.ts) — ma senza
 * una `CampoFatturazione` in comune, perché questi campi vivono su rami
 * diversi di `ValoriModifica` (azienda, sede, proprietario). Vuoto non è mai
 * troppo lungo: chi svuota un campo facoltativo non deve leggere un avviso
 * di lunghezza.
 */
export type CampoConTettoLunghezza =
  | "nome"
  | "sedeNome"
  | "note"
  | "propNome"
  | "propCognome"
  | "propTelefono";

export function erroreLunghezzaCampo(campo: CampoConTettoLunghezza, valore: string): string | null {
  const testo = valore.trim();
  switch (campo) {
    case "nome":
      return testo.length <= 120 ? null : "La ragione sociale non supera i 120 caratteri.";
    case "sedeNome":
      return testo.length <= 120 ? null : "Il nome della sede non supera i 120 caratteri.";
    case "note":
      return testo.length <= 2000 ? null : "Le note non superano i 2000 caratteri.";
    case "propNome":
      return testo.length <= 80 ? null : "Il nome del proprietario non supera gli 80 caratteri.";
    case "propCognome":
      return testo.length <= 80 ? null : "Il cognome del proprietario non supera gli 80 caratteri.";
    case "propTelefono":
      return testo.length <= 40 ? null : "Il telefono del proprietario non supera i 40 caratteri.";
  }
}

/**
 * Cambiare lo slug non è come correggere una ragione sociale: sposta
 * l'indirizzo della scheda e cambia il `--slug=` con cui l'azienda si
 * nomina dalla riga di comando. Chi lo tocca deve saperlo prima, non
 * scoprirlo quando un segnalibro non apre più niente.
 */
export const AVVISO_SLUG =
  "Cambiando lo slug cambia l'indirizzo della scheda e il riferimento della riga di comando (--slug=).";

/** Il tenant 1 non cambia slug (`tenant1SlugIntoccabile`): il campo è di sola lettura. */
export const AVVISO_SLUG_PIATTAFORMA =
  "L'azienda della piattaforma non cambia slug: è il riferimento con cui si nomina ovunque.";

/** Il proprietario non è ancora entrato: l'email che cambia porta con sé l'invito. */
export const AVVISO_INVITO_IN_SOSPESO =
  "L'invito non è ancora stato accettato: cambiando l'email riparte al nuovo indirizzo, e il link vecchio non vale più.";

/**
 * Le due mutation partono in fila: se la prima passa e la seconda no, i dati
 * dell'azienda SONO cambiati. Dirlo prima del messaggio del dominio evita la
 * lettura sbagliata («non è andato niente»), che porterebbe a riscrivere da
 * capo anche ciò che è già a terra.
 */
export const TESTO_AZIENDA_SALVATA_PROPRIETARIO_NO =
  "I dati dell'azienda sono salvati; il proprietario no:";

/** Salvare senza aver cambiato niente non è un errore: è solo inutile, e si dice. */
export const TESTO_NESSUNA_MODIFICA = "Nessun campo è cambiato: non c'è niente da salvare.";

/**
 * Cosa sta per essere salvato, sopra la password: le sezioni toccate, in
 * italiano. Il dialogo mostra un pannello alla volta, quindi al momento di
 * confermare tre quarti delle modifiche sono fuori dallo schermo — questa
 * riga le rimette tutte davanti agli occhi.
 */
export function riepilogoModifiche(sezioni: string[]): string {
  if (sezioni.length === 0) return TESTO_NESSUNA_MODIFICA;
  const elenco =
    sezioni.length === 1
      ? sezioni[0]
      : `${sezioni.slice(0, -1).join(", ")} e ${sezioni[sezioni.length - 1]}`;
  return `Stai per salvare: ${elenco}.`;
}
