// I dodici giorni per mandare allo SdI una fattura immediata, contati come
// li conta un calendario appeso al muro a Sarzana: giorni interi in
// Europe/Rome, non ore. Stessa aritmetica di `giornoAssoluto` in
// client/src/lib/tarsView.ts e stesso motivo per cui `iso()` in
// server/fatture/emissione.ts usa il fuso italiano — a mezzanotte e mezza
// l'UTC è ancora il giorno prima, e il conto sbaglierebbe di uno.
//
// Il termine decorre dalla data del documento, che per la fattura
// immediata è la data di effettuazione dell'operazione ed è quella che
// finisce nell'XML. Il cronometro parte quindi al primo gesto («Invia a
// Fatture in Cloud»), non al secondo.

/** Giorni concessi dalla data del documento (fattura immediata). */
export const GIORNI_INVIO_SDI = 12;

const FUSO = "Europe/Rome";
const MS_GIORNO = 86_400_000;

/** Numero del giorno di calendario, nel fuso dato: la differenza fra due è in giorni interi. */
function giornoAssoluto(value: Date, timeZone = FUSO): number {
  const parti = new Intl.DateTimeFormat("it-IT", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(value);
  const numero = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(parti.find(parte => parte.type === tipo)?.value);
  return Math.floor(
    Date.UTC(numero("year"), numero("month") - 1, numero("day")) / MS_GIORNO
  );
}

/**
 * Quanti giorni restano per mandare allo SdI una fattura datata
 * `dataDocumento` (YYYY-MM-DD). `0` è l'ultimo giorno utile, negativo è
 * ritardo. `null` quando la data non è una data: meglio niente contatore
 * che un contatore inventato.
 */
export function giorniPerInvioSdi(
  dataDocumento: string | null,
  oggi: Date
): number | null {
  if (!dataDocumento || !/^\d{4}-\d{2}-\d{2}$/.test(dataDocumento)) return null;
  const [anno, mese, giorno] = dataDocumento.split("-").map(Number);
  const emissione = Math.floor(Date.UTC(anno, mese - 1, giorno) / MS_GIORNO);
  if (!Number.isFinite(emissione)) return null;
  return emissione + GIORNI_INVIO_SDI - giornoAssoluto(oggi);
}

export type TonoScadenza = "neutro" | "attenzione" | "errore";

/**
 * Come si mostra il contatore. Ambra negli ultimi tre giorni, rosso
 * all'ultimo e dopo: l'invio resta possibile anche in ritardo (la legge
 * prevede una sanzione, non un divieto), quindi il rosso avvisa, non
 * blocca.
 */
export function toniScadenzaSdi(giorni: number): {
  tono: TonoScadenza;
  testo: string;
} {
  if (giorni < 0) {
    const n = Math.abs(giorni);
    return {
      tono: "errore",
      testo: `Scaduta da ${n} ${n === 1 ? "giorno" : "giorni"}`,
    };
  }
  if (giorni === 0) {
    return { tono: "errore", testo: "Ultimo giorno per l'invio allo SdI" };
  }
  return {
    tono: giorni <= 3 ? "attenzione" : "neutro",
    testo: `${giorni} ${giorni === 1 ? "giorno" : "giorni"} per l'invio allo SdI`,
  };
}
