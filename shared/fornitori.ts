// I fornitori dell'azienda con un nome solo (07/09/2026, «la gestione del
// magazzino è un casino»): le conferme d'ordine portano il fornitore come
// lo scrive il PDF («ALIAS Srl Porte blindate», «DE - DOOR DESIGN S.R.L.
// Veronica Gregori», «REFERENTE Natascia De Biasi -», «PAIL SERRAMENTI -
// Domenico Cin…») e il magazzino finiva con dieci nomi per lo stesso
// fornitore, che il filtro non trovava. Qui il nome letto (o il dominio
// della mail) si riconduce al nome aziendale; ciò che non si riconosce resta
// com'è, ripulito, e un referente non è mai un fornitore.
//
// Condiviso fra server (regola delle conferme, costi) e client (filtri).

export type FornitoreNoto = {
  nome: string;
  /** Parole o domini che lo identificano, in minuscolo. */
  chiavi: readonly string[];
};

export const FORNITORI_NOTI: readonly FornitoreNoto[] = [
  // «DE - DOOR DESIGN S.R.L. Veronica Gregori»: l'agenzia che firma le conferme Alias.
  { nome: "Alias", chiavi: ["alias", "aliasblindate", "door design", "doordesign"] },
  { nome: "Pail", chiavi: ["pail", "pailporte", "pail serramenti"] },
  { nome: "Oskura", chiavi: ["oskura"] },
  { nome: "Brianzatende", chiavi: ["brianzatende", "brianza tende"] },
  { nome: "Primed", chiavi: ["primed"] },
  { nome: "Henry Glass", chiavi: ["henry glass", "henryglass"] },
  { nome: "Fivizzanese", chiavi: ["fivizzanese", "ferramentafivizzanese"] },
  { nome: "Wnd", chiavi: ["wnd"] },
  { nome: "Oknoplast", chiavi: ["oknoplast"] },
  { nome: "Palmieri", chiavi: ["palmieri"] },
  { nome: "Erreci", chiavi: ["erreci", "errecci"] },
  { nome: "Korus", chiavi: ["korus"] },
  { nome: "Punto del Serramento", chiavi: ["punto del serramento", "puntodelserramento"] },
  { nome: "Kopern", chiavi: ["kopern"] },
  { nome: "Citea", chiavi: ["citea"] },
  { nome: "Cerrato", chiavi: ["cerrato"] },
  { nome: "Seraplastic", chiavi: ["seraplastic"] },
  { nome: "ST Scale", chiavi: ["st scale", "stscale"] },
  { nome: "Sharknet", chiavi: ["sharknet"] },
  { nome: "BT Glass", chiavi: ["bt glass", "btglass"] },
  { nome: "Bertolotto", chiavi: ["bertolotto"] },
  { nome: "Cibofer", chiavi: ["cibofer"] },
  { nome: "Effe Industrial", chiavi: ["effeindustrial", "effe industrial"] },
  { nome: "Bodytech", chiavi: ["bodytech"] },
  { nome: "Gianesin", chiavi: ["gianesin"] },
];

/** I nomi, nell'ordine in cui compaiono nei filtri. */
export const FORNITORI: readonly string[] = FORNITORI_NOTI.map(f => f.nome);

export type Portale = {
  /** Parole o domini che identificano il portale, in minuscolo. */
  chiavi: readonly string[];
  /** Il fornitore da cui si ordina attraverso questo portale. */
  fornitore: string;
};

/**
 * I portali con cui si ordina (direzione, 10/09/2026). Non sono fornitori:
 * sono il canale con cui si ordina DA un fornitore, e il loro dominio non è
 * quello del produttore. `antenore.biz` mandava 94 mail che finivano tutte
 * in «Da riconoscere».
 *
 * Un portale che serve più produttori riconduce a UNO solo — qui Wnd, l'unico
 * con consegne registrate. Se un giorno servisse distinguere Oknoplast, a
 * dirlo sarà il testo del documento, mai il dominio del portale.
 */
export const PORTALI: readonly Portale[] = [
  { chiavi: ["antenore"], fornitore: "Wnd" },
];

function normalizza(testo: string): string {
  return testo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contieneChiave(testo: string, chiave: string): boolean {
  const norm = normalizza(testo);
  if (!norm) return false;
  const k = normalizza(chiave);
  // Parola intera, o sequenza di parole intere: «alias» sì, «aliasi» no.
  if (new RegExp(`(?:^| )${k}(?: |$)`).test(norm)) return true;
  // La chiave scritta tutta attaccata come parola intera («HenryGlass»,
  // «aliasblindate» nel dominio di una mail).
  const attaccata = k.replace(/ /g, "");
  return norm.split(" ").some(parola => parola === attaccata);
}

/** Il fornitore aziendale che il testo (o il dominio di una mail) nomina, oppure null. */
export function fornitoreNoto(
  testo: string | null | undefined,
  email?: string | null
): string | null {
  const dominio = email?.includes("@") ? email.split("@")[1] : null;
  for (const f of FORNITORI_NOTI) {
    for (const chiave of f.chiavi) {
      if (testo && contieneChiave(testo, chiave)) return f.nome;
      if (dominio && contieneChiave(dominio, chiave)) return f.nome;
    }
  }
  // Il portale vale meno del produttore: si guarda solo se nessun fornitore
  // noto ha risposto.
  for (const p of PORTALI) {
    for (const chiave of p.chiavi) {
      if (testo && contieneChiave(testo, chiave)) return p.fornitore;
      if (dominio && contieneChiave(dominio, chiave)) return p.fornitore;
    }
  }
  return null;
}

/** Un referente, un agente o una persona non sono un fornitore. */
const NON_FORNITORE =
  /^(?:referente|rif\.?|agente|sig\.?(?:ra)?|sigg?\.|dott\.?(?:ssa)?|geom\.?|arch\.?|ing\.?|att\.?ne|c\.a\.|alla cortese)(?:\s|$)/i;

/**
 * Il nome con cui registrare un fornitore letto da un documento: quello
 * aziendale se lo si riconosce (dal testo o dal dominio della mail),
 * altrimenti il testo ripulito — la prima parte prima di un trattino, senza
 * referenti — o null se non resta niente di sensato.
 */
export function normalizzaFornitore(
  testo: string | null | undefined,
  email?: string | null
): string | null {
  const noto = fornitoreNoto(testo, email);
  if (noto) return noto;
  const grezzo = String(testo ?? "").replace(/\s+/g, " ").trim();
  if (!grezzo) return null;
  // Il primo segmento con almeno tre lettere: «DE - DOOR DESIGN…» non è «DE».
  const segmenti = grezzo.split(/\s+[-–|]\s+/).map(s => s.trim());
  const prima = segmenti.find(s => (s.match(/[a-zà-ú]/gi) ?? []).length >= 3) ?? "";
  if (!prima || NON_FORNITORE.test(prima)) return null;
  return prima.slice(0, 60);
}

/**
 * Il pattern che riconosce il mittente di un fornitore noto, **una sola
 * sorgente** per il pre-filtro in memoria e per quello in SQL: due copie
 * divergerebbero, e la mail entrerebbe da una porta e non dall'altra.
 *
 * Le chiavi valgono come sottostringa, non come parola: `pailporte.com`
 * contiene «pailporte», `aliasblindate.com` contiene «aliasblindate». È
 * volutamente LARGO — il pre-filtro pesca, il giudizio fine
 * (`allegatoDaConferma`, che passa da `fornitoreNoto`) scarta: una chiave
 * corta come «wnd» sta dentro «downdraft», e va bene così.
 *
 * Sintassi comune a JS e POSIX (niente `\b`, niente lookahead): la stessa
 * stringa finisce in un `RegExp` e in un `~*` di Postgres.
 */
export const SORGENTE_MITTENTE_FORNITORE: string = [
  ...FORNITORI_NOTI.flatMap(f => f.chiavi),
  ...PORTALI.flatMap(p => p.chiavi),
]
  // Uno spazio nella chiave («henry glass») nel dominio non c'è: diventa
  // «qualunque cosa o niente fra le due parole».
  .map(chiave => chiave.replace(/[^a-z0-9]+/g, "[^a-z0-9]*"))
  .sort((a, b) => b.length - a.length)
  .join("|");
