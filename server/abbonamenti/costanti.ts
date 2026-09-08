// server/abbonamenti/costanti.ts
// Numeri e messaggi dell'abbonamento (spec WS4 §3, §4, §10). Qui solo dati
// e funzioni pure: chi decide è `servizio.ts`. I valori che la direzione può
// cambiare senza toccare il codice (budget incluso, cambio euro→dollaro)
// arrivano dall'ambiente, non da una costante compilata.
import { periodiLocali } from "../tars/costi/ledger";

/** Prova gratuita di ogni azienda nuova (spec madre §18-bis). */
export const GIORNI_PROVA = 30;
/** Da `past_due` alla sola lettura (spec madre §10.3, decisione 5). */
export const GIORNI_TOLLERANZA_INSOLUTO = 7;
/** Giorni interi che fanno scattare l'avviso di scadenza, una volta ciascuno. */
export const GIORNI_AVVISO = [7, 3, 1] as const;
/** Tolleranza dopo il 100 % di storage e di Tars (decisione 3 dell'08/09). */
export const TOLLERANZA_PREDEFINITA_GIORNI = 7;

const BUDGET_TARS_EUR_PREDEFINITO = 25;
const CAMBIO_EUR_USD_PREDEFINITO = 1.08;

/**
 * Un numero dall'ambiente. Un valore sbagliato NON ricade sul predefinito: un
 * budget letto male diventerebbe silenziosamente un altro budget, e la spec
 * (§10) vuole il comando in errore senza scritture. Per difetto deve essere
 * maggiore di zero; `permettiZero` lo ammette — serve al solo budget Tars,
 * dove zero è un piano legittimo (nessun Tars incluso) e `impostaBudgetTars`
 * lo accetta già come tetto esplicito.
 */
function numeroDaAmbiente(
  nome: string,
  predefinito: number,
  opzioni: { permettiZero?: boolean } = {}
): number {
  const grezzo = process.env[nome];
  if (grezzo == null || grezzo.trim() === "") return predefinito;
  const valore = Number(grezzo);
  const valido = opzioni.permettiZero ? valore >= 0 : valore > 0;
  if (!Number.isFinite(valore) || !valido) {
    const soglia = opzioni.permettiZero ? "maggiore o uguale a zero" : "maggiore di zero";
    throw new Error(`${nome} non valido: «${grezzo}». Serve un numero ${soglia} (predefinito: ${predefinito}).`);
  }
  return valore;
}

/**
 * Budget Tars incluso per una nuova azienda, in euro al mese (decisione 4).
 * Zero è valido (un piano senza Tars incluso): resta rifiutato solo un
 * valore negativo o non numerico.
 */
export function budgetTarsPredefinitoEur(): number {
  return numeroDaAmbiente("SAAS_BUDGET_TARS_EUR_MESE", BUDGET_TARS_EUR_PREDEFINITO, { permettiZero: true });
}

/**
 * Il ledger conta in nano-dollari del provider; il budget si scrive in euro.
 * Deve restare strettamente positivo: `eurInNano`/`nanoInEur` lo usano per
 * moltiplicare e dividere importi reali, e uno zero (o un negativo) li
 * renderebbe indefiniti o capovolti.
 */
export function cambioEurUsd(): number {
  return numeroDaAmbiente("SAAS_CAMBIO_EUR_USD", CAMBIO_EUR_USD_PREDEFINITO);
}

export function eurInNano(eur: number): number {
  return Math.round(eur * cambioEurUsd() * 1e9);
}

export function nanoInEur(nano: number): number {
  return nano / cambioEurUsd() / 1e9;
}

export const MESSAGGI_ABBONAMENTO = {
  spazioEsaurito: (gb: number) =>
    `Spazio esaurito: l'azienda ha superato i ${gb} GB inclusi. Libera spazio o chiedi capacità aggiuntiva.`,
  budgetTars:
    "Tars ha esaurito il budget mensile dell'azienda; le funzioni che non costano restano disponibili, il budget si rinnova il primo del mese.",
  tenant1Intoccabile:
    "Il tenant 1 è la proprietaria della piattaforma: niente omaggio, proroga o disdetta.",
} as const;

/** «AAAA-MM» nel fuso del dominio (Europe/Rome): il mese non cambia in UTC. */
export function meseLocale(adesso: Date): string {
  return periodiLocali(adesso).mese;
}

const MS_GIORNO = 86_400_000;

/**
 * Giorni interi che mancano a `fine`, per eccesso: a 6 giorni e mezzo dalla
 * scadenza ne mancano ancora 7. Si conta sugli istanti, mai sulle date
 * locali, così l'ora legale non sposta un avviso di un giorno. Negativo
 * quando la scadenza è passata.
 */
export function giorniInteriFino(fine: Date, adesso: Date): number {
  return Math.ceil((fine.getTime() - adesso.getTime()) / MS_GIORNO);
}
