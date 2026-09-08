// Le parole dell'abbonamento (spec WS4 §8). Modulo PURO: nessun React,
// nessuna query, nessun `new Date()` nascosto — l'istante arriva sempre da
// fuori. Qui vive la sola decisione «che cosa merita di essere detto»; chi
// disegna la riga (`AvvisoAzienda`) e chi disegna la scheda
// (`AbbonamentoCard`) prendono da qui il testo già scritto.
//
// Il tono di voce è quello delle notifiche del server
// (`server/abbonamenti/notifiche.ts`, `quota.ts`): si dice il fatto, la data
// e cosa fare. Mai un allarme senza una via d'uscita.
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "../../../../server/routers";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** Il contratto dell'azienda, come lo restituisce `tenants.abbonamento`. */
export type Abbonamento = RouterOutputs["tenants"]["abbonamento"];
/** Le due risorse misurate, come le restituisce `tenants.consumi`. */
export type Consumi = RouterOutputs["tenants"]["consumi"];

/**
 * `attenzione` è un fatto che sta arrivando e si può ancora evitare;
 * `errore` è un fatto già accaduto che toglie qualcosa (sola lettura,
 * caricamenti fermi, Tars fermo). Non è una scala di gravità estetica: decide
 * l'icona e il colore, e per questo resta a due valori.
 */
export type TonoAvviso = "attenzione" | "errore";

export type FraseAvviso = {
  /**
   * Identifica il FATTO, non la riga: chi chiude un avviso lo chiude per
   * questa sessione, ma se il fatto cambia (un giorno in meno, una
   * percentuale nuova) la chiave cambia e l'avviso torna. È la stessa idea
   * della `canonicalKey` delle notifiche del server.
   */
  chiave: string;
  testo: string;
  tono: TonoAvviso;
};

/** Dallo 80 % in su si avvisa; il 50 % resta un fatto del registro (spec §8). */
const SOGLIA_AVVISO_PERCENTUALE = 80;
/** Giorni entro cui una scadenza vale un avviso (le stesse soglie del worker). */
const GIORNI_AVVISO_SCADENZA = 7;

/** «GG/MM/AAAA»: le date che l'azienda legge sono italiane, non ISO. */
export function dataItaliana(istante: Date): string {
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(istante);
}

/** «AAAA-MM-GG» locale: serve solo come discriminante stabile di una chiave. */
function giornoChiave(istante: Date): string {
  const mese = String(istante.getMonth() + 1).padStart(2, "0");
  const giorno = String(istante.getDate()).padStart(2, "0");
  return `${istante.getFullYear()}-${mese}-${giorno}`;
}

function giorniScritti(n: number): string {
  return `${n} ${n === 1 ? "giorno" : "giorni"}`;
}

/**
 * La percentuale come si scrive in italiano: virgola decimale, spazio prima
 * del segno, e nessun «,0» inutile (92 %, non 92,0 %).
 */
export function percentualeScritta(n: number): string {
  return `${n.toLocaleString("it-IT", { maximumFractionDigits: 1 })} %`;
}

/**
 * «al» o «all'» davanti a una percentuale. La preposizione articolata si
 * elide davanti a vocale, e in questa scala i numeri che si leggono con
 * l'iniziale vocalica sono l'8, l'11 e gli 80-89 («otto», «undici»,
 * «ottantacinque»); dal 100 in su la lettura riparte da «cento…», che è
 * consonante. I decimali non contano: «ottantacinque virgola cinque»
 * comincia comunque per vocale.
 */
function allaPercentuale(n: number): string {
  const intero = Math.floor(Math.abs(n));
  const vocale = intero === 8 || intero === 11 || (intero >= 80 && intero <= 89);
  return `${vocale ? "all'" : "al "}${percentualeScritta(n)}`;
}

/** Bloccato davvero, non «in tolleranza»: la data di stacco è passata. */
function bloccato(bloccoDal: Date | null, adesso: Date): boolean {
  return bloccoDal != null && adesso.getTime() >= bloccoDal.getTime();
}

/**
 * Le righe dell'avviso dell'azienda, in ordine di lettura: prima il
 * contratto (è la cosa che spegne tutto), poi lo spazio, poi Tars. Array
 * vuoto quando non c'è niente da dire — e anche finché i payload non sono
 * arrivati: un avviso non si inventa su dati mancanti.
 */
export function frasiAvviso(
  abbonamento: Abbonamento | null | undefined,
  consumi: Consumi | null | undefined,
  adesso: Date
): FraseAvviso[] {
  const frasi: FraseAvviso[] = [];

  if (abbonamento) {
    const giorni = abbonamento.giorniAllaScadenza;
    if (abbonamento.solaLettura) {
      // La porta è già chiusa: l'insoluto e la scadenza sono cronaca vecchia,
      // e ripeterli sopra questa riga non aggiungerebbe nulla da fare.
      frasi.push({
        chiave: "sola-lettura",
        testo:
          "Azienda in sola lettura: nessuna modifica finché l'abbonamento non è regolarizzato",
        tono: "errore",
      });
    } else if (abbonamento.stato === "past_due") {
      // `giorniAllaScadenza` è negativo da scaduto; mezza giornata arrotonda a
      // zero, e «da 0 giorni» non si dice: il primo giorno è già un giorno.
      const daGiorni = giorni == null ? null : Math.max(1, -giorni);
      frasi.push({
        chiave: `insoluto:${daGiorni ?? "?"}`,
        testo:
          daGiorni == null
            ? "Abbonamento scaduto: in attesa di pagamento, poi sola lettura"
            : `Abbonamento scaduto: da ${giorniScritti(daGiorni)} in attesa di pagamento, poi sola lettura`,
        tono: "errore",
      });
    } else if (giorni != null && giorni <= GIORNI_AVVISO_SCADENZA) {
      // Un omaggio con scadenza non è «la prova»: chi l'ha ricevuto non deve
      // leggere che gli sta finendo un periodo di prova che non ha (stesso
      // ragionamento della notifica in `server/abbonamenti/servizio.ts`).
      const omaggio = abbonamento.tipo === "complimentary";
      const soggetto = omaggio ? "L'abbonamento omaggio" : "La prova gratuita";
      const quando = giorni <= 0 ? "oggi" : `fra ${giorniScritti(giorni)}`;
      frasi.push({
        chiave: `${omaggio ? "omaggio" : "prova"}:${Math.max(0, giorni)}`,
        testo: `${soggetto} finisce ${quando}`,
        tono: "attenzione",
      });
    }
  }

  if (consumi) {
    const { storage, tars } = consumi;

    if (bloccato(storage.bloccoDal, adesso) && storage.bloccoDal) {
      frasi.push({
        chiave: `storage-bloccato:${giornoChiave(storage.bloccoDal)}`,
        testo: `Caricamenti fermi dal ${dataItaliana(storage.bloccoDal)}: libera spazio o chiedi capacità`,
        tono: "errore",
      });
    } else if (storage.percentuale >= SOGLIA_AVVISO_PERCENTUALE) {
      // Oltre quota `bloccoDal` esiste già mentre la tolleranza corre: quella
      // data è più utile del numero di giorni, perché è il giorno esatto in
      // cui i caricamenti si fermano.
      frasi.push({
        chiave: `storage:${storage.percentuale}`,
        testo: storage.bloccoDal
          ? `Spazio ${allaPercentuale(storage.percentuale)}: dal ${dataItaliana(storage.bloccoDal)} i caricamenti nuovi si fermano`
          : `Spazio ${allaPercentuale(storage.percentuale)}: oltre il 100 % i caricamenti si fermano dopo ${giorniScritti(storage.tolleranzaGiorni)}`,
        tono: "attenzione",
      });
    }

    if (bloccato(tars.bloccoDal, adesso)) {
      frasi.push({
        chiave: `tars-bloccato:${tars.mese}`,
        testo: "Tars fermo per questo mese",
        tono: "errore",
      });
    } else if (
      // `percentuale` è `null` quando non c'è tetto per azienda (tenant 1) o
      // quando il ledger non è leggibile: «non lo so» non diventa un avviso.
      tars.percentuale != null &&
      tars.percentuale >= SOGLIA_AVVISO_PERCENTUALE
    ) {
      frasi.push({
        chiave: `tars:${tars.percentuale}`,
        testo: tars.bloccoDal
          ? `Tars ${allaPercentuale(tars.percentuale)} del budget del mese: dal ${dataItaliana(tars.bloccoDal)} le funzioni a pagamento si fermano`
          : `Tars ${allaPercentuale(tars.percentuale)} del budget del mese`,
        tono: "attenzione",
      });
    }
  }

  return frasi;
}

// ── Parole della scheda «Abbonamento e consumi» ─────────────────────────

type StatoAbbonamento = NonNullable<Abbonamento["stato"]>;
type TipoAbbonamento = NonNullable<Abbonamento["tipo"]>;

/**
 * Lo stato in italiano operativo: quello che l'azienda capisce, non il valore
 * della colonna. `suspended` e `cancelled` si leggono dal posto di chi lavora
 * — si legge, si scarica, non si scrive — e il perché lo racconta il registro.
 */
const ETICHETTE_STATO: Record<StatoAbbonamento, string> = {
  trialing: "In prova",
  active: "Attivo",
  past_due: "In attesa di pagamento",
  grace: "In tolleranza",
  suspended: "Sola lettura",
  cancelled: "Disdetto",
};

export function etichettaStato(stato: Abbonamento["stato"]): string {
  return stato ? ETICHETTE_STATO[stato] : "Nessun abbonamento";
}

/** Il tono del badge di stato: gli stessi due livelli delle frasi, più «quieto». */
export function tonoStato(stato: Abbonamento["stato"]): "quieto" | "attenzione" | "errore" {
  if (stato === "past_due" || stato === "grace") return "attenzione";
  if (stato === "suspended" || stato === "cancelled") return "errore";
  return "quieto";
}

export function etichettaTipo(tipo: Abbonamento["tipo"]): string {
  const etichette: Record<TipoAbbonamento, string> = {
    paid: "Abbonamento",
    complimentary: "Abbonamento omaggio",
  };
  return tipo ? etichette[tipo] : "Nessun abbonamento";
}

/**
 * Byte in una misura leggibile (GB con un decimale, MB sotto il giga). Base
 * 1024 come la quota, che nasce in GB binari (`QUOTA_STORAGE_PREDEFINITA_BYTES`).
 */
export function byteScritti(bytes: number): string {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  if (bytes >= GB) return `${(bytes / GB).toLocaleString("it-IT", { maximumFractionDigits: 1 })} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB).toLocaleString("it-IT")} MB`;
  return `${Math.max(0, Math.round(bytes / 1024)).toLocaleString("it-IT")} KB`;
}

/**
 * «AAAA-MM» (come lo scrive il ledger) letto in italiano: «settembre 2026».
 * Il mese del budget si legge in una scheda, non in un log.
 */
export function meseScritto(mese: string): string {
  const [anno, numero] = mese.split("-").map(Number);
  if (!Number.isFinite(anno) || !Number.isFinite(numero)) return mese;
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(
    new Date(anno, numero - 1, 1)
  );
}
