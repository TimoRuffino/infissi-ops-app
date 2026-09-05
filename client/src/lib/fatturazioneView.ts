// Presentazione pura dell'elenco «Fatturazione guidata» (piano 4): etichetta
// del pulsante primario della card, tono dei quattro pallini dei passi,
// testo dei giorni nello stato, importi già pronti da mostrare (mai un
// numero grezzo diviso per 100 nel componente) e filtro dell'elenco per
// stato e ricerca libera. Nessun calcolo di dominio qui: lo stato dei passi
// e gli importi arrivano già calcolati dal server
// (`server/fatturazione/passi.ts`, funzione pura `calcolaPassi`).
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §4 (modello) e §6 (client).
import {
  ORDINE_PASSI,
  type CommessaDaFatturare,
  type EsitoPasso,
  type PassoFatturazione,
  type StatoDaFatturare,
} from "@shared/fatturazione/passi";
import { formatCent } from "./limitiView";

/**
 * «Fatturata» vince su tutto: nell'elenco (`fatturazioneGuidata.daFare`) una
 * commessa con la fattura già `fatto` è già uscita dai risultati (§4.2 della
 * specifica), ma questo stesso record alimenta anche la pagina a passi di
 * una singola commessa (`fatturazioneGuidata.passi`), dove può restare in
 * vista un istante dopo l'emissione, prima del refetch. In quel momento il
 * pulsante non deve proporre «Continua» su un percorso già concluso.
 * Altrimenti: «Inizia fatturazione» solo se nessun passo è stato toccato,
 * «Continua» in ogni altro caso (misto, o tutto fatto tranne la fattura).
 * `non_disponibile` (passo dietro un flag spento, es. Limiti o Fattura) non
 * è un passo toccato: conta come non iniziato quanto `da_fare`, altrimenti
 * una commessa mai aperta con la fatturazione spenta proporrebbe «Continua»
 * su un percorso in realtà mai cominciato.
 */
export function etichettaPulsante(
  passi: Record<PassoFatturazione, EsitoPasso>
): "Inizia fatturazione" | "Continua" | "Fatturata" {
  if (passi.fattura === "fatto") return "Fatturata";
  const nessunPassoIniziato = ORDINE_PASSI.every(
    passo => passi[passo] !== "in_corso" && passi[passo] !== "fatto"
  );
  return nessunPassoIniziato ? "Inizia fatturazione" : "Continua";
}

/**
 * Tono semantico del pallino di un passo. Il colore non è mai il solo
 * segnale: la card espone anche un `aria-label` con l'esito per esteso.
 * Fallback difensivo su `esito` sconosciuto (bundle client più vecchio di
 * un server che introduce un quinto esito) invece di un tono inventato: si
 * comporta come «da fare», l'esito meno allarmante.
 */
export function tonoPasso(
  esito: EsitoPasso
): "neutro" | "attivo" | "ok" | "spento" {
  if (esito === "fatto") return "ok";
  if (esito === "in_corso") return "attivo";
  if (esito === "non_disponibile") return "spento";
  return "neutro";
}

/**
 * Su quale passo lo stepper lascia cliccare (piano 4, Task 5): quelli già
 * toccati — `fatto` o `in_corso` — e il primo non concluso, che è il
 * prossimo gesto. Un passo più avanti resta spento: non si salta il
 * contratto per andare alla fattura.
 *
 * Differenza voluta rispetto a `prossimoPasso` del server, che salta i passi
 * `non_disponibile`: qui il primo non concluso è raggiungibile anche se è
 * dietro un interruttore spento. Con la fatturazione spenta e i limiti
 * conclusi, il quarto passo si apre e dice perché è fermo, invece di restare
 * un pallino muto che non si può nemmeno interrogare.
 *
 * Ruling P4-R14 (I2 della review finale): `documenti` non blocca mai
 * `contratto`. Il contratto si può ancora scrivere a mano anche a
 * fascicolo vuoto (nessun PDF caricato, nessun documento di tipo
 * `contratto`) — capacità che esisteva prima di questo piano e che nessun
 * ruling toglie di proposito. Quando il primo passo non concluso è
 * `documenti`, `contratto` resta comunque raggiungibile; `limiti` e
 * `fattura` restano bloccati finché `contratto` non è `fatto`.
 */
export function passoRaggiungibile(
  passi: Record<PassoFatturazione, EsitoPasso>,
  passo: PassoFatturazione
): boolean {
  const esito = passi[passo];
  if (esito === "fatto" || esito === "in_corso") return true;
  const primoNonFatto = ORDINE_PASSI.find(p => passi[p] !== "fatto");
  if (passo === primoNonFatto) return true;
  return primoNonFatto === "documenti" && passo === "contratto";
}

/** Il passo chiesto dall'URL (`?passo=`), se è uno dei quattro; altrimenti niente. */
export function passoDallaQuery(search: string): PassoFatturazione | null {
  const richiesto = new URLSearchParams(search).get("passo");
  return ORDINE_PASSI.find(passo => passo === richiesto) ?? null;
}

/**
 * Il passo su cui la pagina `/fatturazione/:id` atterra quando si apre —
 * alla primissima lettura (senza `?passo=`) e ogni volta che l'URL ne chiede
 * uno che i prerequisiti non permettono ancora (P4-R8): il richiesto se
 * `passoRaggiungibile`, altrimenti il prossimo passo del server; se il
 * percorso è già concluso (`prossimoPasso` `null`, fattura emessa) l'ultimo
 * passo, così anche un'apertura senza `?passo=` a percorso finito atterra su
 * Fattura invece di restare bloccata per mancanza di un prossimo passo.
 */
export function passoIniziale(
  passi: Record<PassoFatturazione, EsitoPasso>,
  prossimoPasso: PassoFatturazione | null,
  richiesto: PassoFatturazione | null
): PassoFatturazione {
  if (richiesto != null && passoRaggiungibile(passi, richiesto)) {
    return richiesto;
  }
  return prossimoPasso ?? ORDINE_PASSI[ORDINE_PASSI.length - 1];
}

/** "oggi" / "1 giorno" / "N giorni"; "—" quando il server non sa dire da quando (nessuna milestone né updatedAt). */
export function giorniTesto(giorni: number | null): string {
  if (giorni == null) return "—";
  if (giorni === 0) return "oggi";
  if (giorni === 1) return "1 giorno";
  return `${giorni} giorni`;
}

/**
 * Importi pronti per la card: stringhe già formattate con l'helper euro
 * condiviso (mai `cent / 100` nel componente), oppure `null` quando il
 * server li nasconde per assenza di `economia.read` — la card allora non
 * mostra la riga degli importi.
 */
export function importiCard(commessa: CommessaDaFatturare): {
  pattuito: string | null;
  prevista: string | null;
  stima: boolean;
} {
  return {
    pattuito:
      commessa.pattuitoCent == null ? null : formatCent(commessa.pattuitoCent),
    prevista:
      commessa.fatturaPrevistaCent == null
        ? null
        : formatCent(commessa.fatturaPrevistaCent),
    stima: commessa.fatturaPrevistaStima,
  };
}

/** Filtro dell'elenco per stato e testo libero su cliente o codice, senza distinguere maiuscole e minuscole. */
export function filtraCommesse(
  elenco: CommessaDaFatturare[],
  filtro: { stato: "tutti" | StatoDaFatturare; testo: string }
): CommessaDaFatturare[] {
  const query = filtro.testo.trim().toLowerCase();
  return elenco.filter(commessa => {
    if (filtro.stato !== "tutti" && commessa.stato !== filtro.stato) {
      return false;
    }
    if (!query) return true;
    return (
      commessa.cliente.toLowerCase().includes(query) ||
      commessa.codice.toLowerCase().includes(query)
    );
  });
}
