// Le REGOLE con cui si riconosce un fornitore da un testo o dal dominio di una
// mail, e il SEED dei venticinque della Ruffino Group.
//
// Le conferme d'ordine portano il fornitore come lo scrive il PDF («ALIAS Srl
// Porte blindate», «DE - DOOR DESIGN S.R.L. Veronica Gregori», «REFERENTE
// Natascia De Biasi -», «PAIL SERRAMENTI - Domenico Cin…») e il magazzino
// finiva con dieci nomi per lo stesso fornitore, che il filtro non trovava.
// Qui il nome letto (o il dominio della mail) si riconduce al nome
// dell'elenco; ciò che non si riconosce resta com'è, ripulito, e un referente
// non è mai un fornitore.
//
// Le regole sono conoscenza di dominio e restano qui. L'ELENCO no: dal
// 10/09/2026 ogni azienda ha i suoi fornitori (spec
// `docs/superpowers/specs/2026-09-10-fornitori-per-azienda-e-profili-design.md`),
// e questo file non sa più chi siano. `riconoscitoreFornitori(elenco)`
// costruisce il riconoscitore da un elenco qualunque; chi glielo passa è
// `server/fornitori/riconoscimento.ts`.
//
// `SEED_FORNITORI_TENANT_1` sono i fornitori della Ruffino Group: si importano
// UNA VOLTA nell'anagrafica del tenant 1 (bottone in `/fornitori`) e servono
// da ripiego a interruttore spento. Nessun altro percorso li legge — guardia
// `server/fornitori/riconoscimento.confine.test.ts`.

export type FornitoreRiconoscibile = {
  nome: string;
  /** Parole o domini che lo identificano, in minuscolo. */
  chiavi: readonly string[];
  /**
   * Quando la voce è un PORTALE e non un produttore: il fornitore a cui
   * riconduce. Antenore è il portale di Wnd/Oknoplast, non un fornitore.
   */
  portaleDi?: string | null;
};

export type Riconoscitore = {
  /** Il nome dell'elenco che il testo (o il dominio della mail) nomina. */
  nome(testo: string | null | undefined, email?: string | null): string | null;
  /** Il nome con cui registrare un fornitore letto da un documento. */
  normalizza(testo: string | null | undefined, email?: string | null): string | null;
  /** La sorgente del pattern dei mittenti, per i pre-filtri (memoria e SQL). */
  sorgenteMittenti(): string;
};

export const SEED_FORNITORI_TENANT_1: readonly FornitoreRiconoscibile[] = [
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
  // Il portale con cui si ordina da Wnd/Oknoplast, non un fornitore: 94 mail
  // da `antenore.biz` finivano in «Da riconoscere» perché il dominio non è
  // quello del produttore (10/09/2026).
  { nome: "Wnd", chiavi: ["antenore"], portaleDi: "Wnd" },
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

/** Un referente, un agente o una persona non sono un fornitore. */
const NON_FORNITORE =
  /^(?:referente|rif\.?|agente|sig\.?(?:ra)?|sigg?\.|dott\.?(?:ssa)?|geom\.?|arch\.?|ing\.?|att\.?ne|c\.a\.|alla cortese)(?:\s|$)/i;

/**
 * Le regole applicate a UN elenco: è la firma che rende i fornitori un dato
 * dell'azienda invece di una costante del prodotto.
 */
export function riconoscitoreFornitori(
  elenco: readonly FornitoreRiconoscibile[]
): Riconoscitore {
  // I portali si guardano DOPO i produttori: il dominio di chi fabbrica è più
  // preciso di quello del canale con cui gli si ordina.
  const diretti = elenco.filter(f => !f.portaleDi);
  const portali = elenco.filter(f => f.portaleDi);

  const cerca = (
    voci: readonly FornitoreRiconoscibile[],
    testo: string | null | undefined,
    dominio: string | null
  ): string | null => {
    for (const f of voci) {
      for (const chiave of f.chiavi) {
        if (testo && contieneChiave(testo, chiave)) return f.portaleDi ?? f.nome;
        if (dominio && contieneChiave(dominio, chiave)) return f.portaleDi ?? f.nome;
      }
    }
    return null;
  };

  const nome: Riconoscitore["nome"] = (testo, email) => {
    const dominio = email?.includes("@") ? email.split("@")[1] : null;
    return cerca(diretti, testo, dominio) ?? cerca(portali, testo, dominio);
  };

  return {
    nome,

    normalizza(testo, email) {
      const noto = nome(testo, email);
      if (noto) return noto;
      const grezzo = String(testo ?? "").replace(/\s+/g, " ").trim();
      if (!grezzo) return null;
      // Il primo segmento con almeno tre lettere: «DE - DOOR DESIGN…» non è «DE».
      const segmenti = grezzo.split(/\s+[-–|]\s+/).map(s => s.trim());
      const prima = segmenti.find(s => (s.match(/[a-zà-ú]/gi) ?? []).length >= 3) ?? "";
      if (!prima || NON_FORNITORE.test(prima)) return null;
      return prima.slice(0, 60);
    },

    /**
     * Volutamente LARGO: il pre-filtro pesca, il giudizio fine
     * (`allegatoDaConferma`) scarta. Le chiavi valgono come sottostringa —
     * `pailporte.com` contiene «pailporte» — e una chiave corta come «wnd» sta
     * dentro «downdraft»: va bene così, lì a decidere è `nome()`.
     *
     * Sintassi comune a JS e POSIX (niente `\b`, niente lookahead): la stessa
     * stringa finisce in un `RegExp` e in un `~*` di Postgres.
     */
    sorgenteMittenti() {
      const chiavi = elenco.flatMap(f => f.chiavi);
      // Un elenco vuoto deve produrre un pattern che non combacia con NIENTE.
      // `new RegExp("")` combacia con TUTTO: sarebbe il difetto peggiore
      // possibile qui, perché aprirebbe il pre-filtro della posta a ogni
      // mittente esistente proprio per le aziende che l'elenco non ce l'hanno
      // ancora.
      if (chiavi.length === 0) return "(?!)";
      return chiavi
        .map(chiave => chiave.replace(/[^a-z0-9]+/g, "[^a-z0-9]*"))
        .sort((a, b) => b.length - a.length)
        .join("|");
    },
  };
}
