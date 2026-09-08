// Il filo della conversazione (punto 27 del piano
// `2026-09-08-tars-piu-intelligente`).
//
// Non esiste `inReplyTo`, non esistono `references`, non esiste un thread:
// ogni messaggio è un'isola. Tars vede «tre comunicazioni non collegate» e
// non «il cliente ha chiesto la stessa cosa tre volte in dieci giorni e
// nessuno ha risposto» — che è l'unica delle due frasi che fa fare qualcosa.
//
// Il filo si DERIVA, senza colonne nuove e senza migrazioni: stessa
// controparte, stesso canale, stesso oggetto una volta tolti i «Re:» e i
// «Fwd:». Funziona anche sui messaggi già in archivio, che è il punto: la
// conversazione da riparare è quella di ieri, non quella di domani.
//
// Due segnali, entrambi deterministici:
//   • **insistenza** — quanti messaggi in ingresso di fila senza che noi
//     abbiamo risposto in mezzo. Chi ripete non è più paziente;
//   • **attesa** — da quanti giorni pende il più vecchio non risposto.

export type MessaggioDelFilo = {
  id: number;
  canale: string;
  direzione: string;
  mittente: string | null;
  mittenteNome: string | null;
  destinatari: string[];
  oggetto: string | null;
  commessaId: number | null;
  receivedAt: Date | string;
};

export type Filo = {
  chiave: string;
  canale: string;
  /** L'indirizzo o il numero dall'altra parte. */
  controparte: string;
  nome: string | null;
  oggetto: string;
  commessaId: number | null;
  messaggi: number;
  ultimoIngresso: Date | null;
  ultimaRisposta: Date | null;
  /** Messaggi in ingresso di fila senza una nostra risposta in mezzo. */
  insistenze: number;
  /** Giorni da quando pende il più vecchio non risposto; null se non pende. */
  giorniInAttesa: number | null;
};

const PREFISSI = /^\s*((re|r|rif|fwd|fw|i|tr)\s*(\[\d+\])?\s*:\s*)+/i;

/** «Re: Fwd: Preventivo Rossi» e «preventivo rossi» sono lo stesso filo. */
export function oggettoNormalizzato(oggetto: string | null | undefined): string {
  let testo = String(oggetto ?? "").trim();
  let prima: string;
  do {
    prima = testo;
    testo = testo.replace(PREFISSI, "");
  } while (testo !== prima);
  return testo.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Numeri e indirizzi si confrontano senza spazi, punti e maiuscole. */
export function controparteNormalizzata(valore: string | null | undefined): string {
  const testo = String(valore ?? "").trim().toLowerCase();
  return /^[+\d\s().-]+$/.test(testo) ? testo.replace(/[^\d]/g, "") : testo;
}

function istante(m: MessaggioDelFilo): number {
  const t = new Date(m.receivedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

function controparteDi(m: MessaggioDelFilo): string {
  return m.direzione === "out"
    ? controparteNormalizzata(m.destinatari?.[0] ?? "")
    : controparteNormalizzata(m.mittente);
}

/**
 * Raggruppa i messaggi in fili e misura insistenza e attesa. Puro: prende
 * la lista e l'ora, non tocca niente.
 */
export function fili(
  messaggi: readonly MessaggioDelFilo[],
  adesso: Date
): Filo[] {
  const gruppi = new Map<string, MessaggioDelFilo[]>();
  for (const m of messaggi) {
    const controparte = controparteDi(m);
    if (!controparte) continue;
    const chiave = `${m.canale}|${controparte}|${oggettoNormalizzato(m.oggetto)}`;
    const lista = gruppi.get(chiave) ?? [];
    lista.push(m);
    gruppi.set(chiave, lista);
  }

  const esito: Filo[] = [];
  for (const [chiave, lista] of gruppi) {
    const ordinati = [...lista].sort((a, b) => istante(a) - istante(b));
    const ingressi = ordinati.filter(m => m.direzione !== "out");
    const uscite = ordinati.filter(m => m.direzione === "out");
    const ultimoIngresso = ingressi.at(-1) ?? null;
    const ultimaRisposta = uscite.at(-1) ?? null;

    // Quanti in ingresso dopo la nostra ultima risposta: è l'insistenza.
    const dopoLaRisposta = ultimaRisposta
      ? ingressi.filter(m => istante(m) > istante(ultimaRisposta))
      : ingressi;
    const primoNonRisposto = dopoLaRisposta[0] ?? null;

    esito.push({
      chiave,
      canale: ordinati[0].canale,
      controparte: controparteDi(ordinati[0]),
      nome: ingressi.find(m => m.mittenteNome)?.mittenteNome ?? null,
      oggetto: oggettoNormalizzato(ordinati.at(-1)!.oggetto) || "(senza oggetto)",
      commessaId: ordinati.map(m => m.commessaId).find(id => id != null) ?? null,
      messaggi: ordinati.length,
      ultimoIngresso: ultimoIngresso ? new Date(istante(ultimoIngresso)) : null,
      ultimaRisposta: ultimaRisposta ? new Date(istante(ultimaRisposta)) : null,
      insistenze: dopoLaRisposta.length,
      giorniInAttesa: primoNonRisposto
        ? Math.max(
            0,
            Math.floor((adesso.getTime() - istante(primoNonRisposto)) / 86_400_000)
          )
        : null,
    });
  }
  return esito;
}

/** Da quante ripetizioni in su una conversazione va guardata. */
export const INSISTENZE_DA_GUARDARE = 2;
/** E da quanti giorni di silenzio nostro. */
export const GIORNI_ATTESA_DA_GUARDARE = 2;

/**
 * I fili che chiedono qualcosa: chi ha ripetuto, o chi aspetta da giorni.
 * Ordinati per insistenza e poi per attesa — chi ripete viene prima.
 */
export function filiInAttesa(tutti: readonly Filo[]): Filo[] {
  return tutti
    .filter(
      f =>
        f.giorniInAttesa != null &&
        (f.insistenze >= INSISTENZE_DA_GUARDARE ||
          f.giorniInAttesa >= GIORNI_ATTESA_DA_GUARDARE)
    )
    .sort(
      (a, b) =>
        b.insistenze - a.insistenze || (b.giorniInAttesa ?? 0) - (a.giorniInAttesa ?? 0)
    );
}
