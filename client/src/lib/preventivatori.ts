// Catalogo e confini puri dei preventivatori.
//
// L'hub `/preventivatori` è un ingresso guidato «azienda → prodotto →
// calcola»: qui vivono il catalogo statico e il resolver delle route, così la
// pagina non decide da sola cosa è raggiungibile. Una coppia che non compare
// in `PREVENTIVATORE_ROUTES` non ha un calcolatore in Ruffino Flow, e
// l'assenza va mostrata come informazione passiva — mai come route inventata.
//
// Il catalogo è indipendente dall'anagrafica Fornitori: aggiungere o togliere
// un fornitore altrove non cambia nulla qui.

export type PreventivatoreProdotto = {
  key: string;
  label: string;
};

export type PreventivatoreAzienda = {
  id: string;
  nome: string;
  descrizione: string;
  /** Chiavi di `PRODOTTI_PREVENTIVATORE` dichiarate dall'azienda. */
  prodotti: string[];
};

export const PRODOTTI_PREVENTIVATORE: Record<string, PreventivatoreProdotto> = {
  persiane: { key: "persiane", label: "Persiane" },
  blindati: { key: "blindati", label: "Portoncini blindati" },
};

export const AZIENDE_PREVENTIVATORE: PreventivatoreAzienda[] = [
  {
    id: "fivizzanese",
    nome: "Fivizzanese",
    descrizione: "Prezzo al m² per modello, colorazione e supplementi.",
    prodotti: ["persiane"],
  },
  {
    id: "punto-del-serramento",
    nome: "Punto del Serramento",
    descrizione: "Prezzo da tabella misure di listino, con maggiorazione colore.",
    prodotti: ["persiane"],
  },
  {
    id: "alias",
    nome: "Alias",
    descrizione: "Listino non ancora modellato in Ruffino Flow.",
    prodotti: ["blindati"],
  },
];

/**
 * Route dei preventivatori realmente implementati, indicizzate
 * `${aziendaId}:${prodottoKey}`. Restano allineate a `App.tsx` e al contratto
 * di route: qui non si aggiunge una chiave prima della pagina.
 */
export const PREVENTIVATORE_ROUTES: Record<string, string> = {
  "fivizzanese:persiane": "/preventivatori/fivizzanese/persiane",
  "punto-del-serramento:persiane":
    "/preventivatori/punto-del-serramento/persiane",
};

/** Route del calcolatore, oppure `null` se quella coppia non esiste. */
export function preventivatoreRouteFor(
  aziendaId: string,
  prodottoKey: string
): string | null {
  return PREVENTIVATORE_ROUTES[`${aziendaId}:${prodottoKey}`] ?? null;
}

/** Prodotto a catalogo; una chiave sconosciuta resta leggibile com'è. */
export function prodottoPreventivatore(key: string): PreventivatoreProdotto {
  return PRODOTTI_PREVENTIVATORE[key] ?? { key, label: key };
}

export type VocePreventivatore = {
  id: string;
  aziendaId: string;
  aziendaNome: string;
  aziendaDescrizione: string;
  prodottoKey: string;
  prodottoLabel: string;
  /** `null` quando il calcolatore non esiste: nessun bottone, nessuna route. */
  route: string | null;
};

/** Una voce per ogni coppia azienda/prodotto dichiarata, in ordine stabile. */
export function vociPreventivatore(): VocePreventivatore[] {
  return AZIENDE_PREVENTIVATORE.flatMap(azienda =>
    azienda.prodotti.map(prodottoKey => {
      const prodotto = prodottoPreventivatore(prodottoKey);
      return {
        id: `${azienda.id}:${prodotto.key}`,
        aziendaId: azienda.id,
        aziendaNome: azienda.nome,
        aziendaDescrizione: azienda.descrizione,
        prodottoKey: prodotto.key,
        prodottoLabel: prodotto.label,
        route: preventivatoreRouteFor(azienda.id, prodotto.key),
      };
    })
  );
}

/** Ricerca sul catalogo già in memoria: nessuna query, nessun indice remoto. */
export function filtraVociPreventivatore(
  voci: VocePreventivatore[],
  ricerca: string
): VocePreventivatore[] {
  const query = ricerca.trim().toLowerCase();
  if (!query) return voci;
  return voci.filter(voce =>
    `${voce.aziendaNome} ${voce.prodottoLabel}`.toLowerCase().includes(query)
  );
}

// ── Confini numerici condivisi dai due calcolatori ──────────────────────────
//
// I preventivatori lavorano in millimetri interi: è così che si prende una
// misura in cantiere ed è così che sono scritti i listini. `millimetriValidi`
// è il confine severo usato per dire all'operatore che una misura non è
// utilizzabile; `millimetriDaInput` è la lettura tollerante storica dei due
// calcolatori e resta identica al carattere, perché cambiarla cambierebbe i
// prezzi già prodotti (una misura scritta "1200,5" oggi entra nel calcolo).
// I due helper non vanno confusi: il primo avvisa, il secondo calcola.

/** Millimetri interi maggiori di zero, altrimenti `null`. */
export function millimetriValidi(value: string): number | null {
  const testo = value.trim();
  if (!/^\d+$/.test(testo)) return null;
  const millimetri = Number(testo);
  return Number.isFinite(millimetri) && millimetri > 0 ? millimetri : null;
}

/** Lettura tollerante usata dal calcolo: 0 quando il valore non è utilizzabile. */
export function millimetriDaInput(value: string): number {
  const millimetri = parseFloat(value.replace(",", "."));
  return Number.isFinite(millimetri) && millimetri > 0 ? millimetri : 0;
}

/** Area in metri quadri di una misura espressa in millimetri. */
export function areaMetriQuadri(
  larghezzaMm: number,
  altezzaMm: number
): number {
  return (larghezzaMm * altezzaMm) / 1_000_000;
}

/** Iniziali dell'azienda per il tile del catalogo (massimo due caratteri). */
export function inizialiAzienda(nome: string): string {
  return nome
    .split(/\s+/)
    .map(parola => parola[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
