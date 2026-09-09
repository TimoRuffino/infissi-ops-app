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

type StatoAzienda = "attivo" | "sospeso";

/** «Attiva»/«Sospesa»: si parla dell'azienda, non della riga di una tabella. */
export function etichettaStatoAzienda(stato: StatoAzienda): string {
  return stato === "sospeso" ? "Sospesa" : "Attiva";
}

/** Variante del badge: solo ciò che toglie qualcosa si colora di rosso. */
export function tonoStatoAzienda(stato: StatoAzienda): "success" | "danger" {
  return stato === "sospeso" ? "danger" : "success";
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
 * del flusso — l'azienda è nata lo stesso — quindi il testo dice cosa fare,
 * non cosa è andato storto.
 */
export function testoEsitoInvito(esito: {
  inviato: boolean;
  email?: string | null;
  link?: string | null;
}): string {
  if (!esito.inviato) return TESTO_POSTA_NON_CONFIGURATA;
  return esito.email
    ? `Invito inviato a ${esito.email}.`
    : "Invito inviato al proprietario.";
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
  invito: { inviato: boolean; email?: string | null; link?: string | null } | null;
}): { titolo: string; descrizione: string; mostraScheda: boolean; link?: string } {
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
