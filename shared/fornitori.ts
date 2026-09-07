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
  { nome: "Alias", chiavi: ["alias", "aliasblindate"] },
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
  const prima = grezzo.split(/\s+[-–|]\s+/)[0].trim();
  if (!prima || NON_FORNITORE.test(prima)) return null;
  return prima.slice(0, 60);
}
