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
