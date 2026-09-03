// Presentazione pura della tab Limiti: raggruppamento delle voci, spiegazione
// di ogni numero con i suoi input, badge di validità. Niente calcoli di
// dominio: i limiti arrivano già fatti dal server.
import type { Computo, VoceComputo } from "@shared/limiti/tipi";
import { formatEuroSimbolo } from "./euro";

export type StatoComputoView = {
  computo: Computo | null;
  valido: boolean;
  motivo: string | null;
};

/**
 * I gruppi mostrati non sono quelli del motore: `prodotti` tiene insieme i
 * massimali dell'Allegato A (CHECK 1) e le voci DEI per riga (CHECK 2), che
 * appartengono a due conti diversi. Sommarli darebbe una cifra che nel
 * computo non esiste, quindi qui la tab li separa.
 */
export type ChiaveGruppo =
  | "prodotti_check1"
  | "prodotti_check2"
  | "controtelai"
  | "opere"
  | "eventuali";

const ORDINE: ChiaveGruppo[] = [
  "prodotti_check1",
  "prodotti_check2",
  "controtelai",
  "opere",
  "eventuali",
];
const ETICHETTE: Record<ChiaveGruppo, string> = {
  prodotti_check1: "Prodotti · CHECK 1 (Allegato A)",
  prodotti_check2: "Prodotti · CHECK 2 (DEI per riga)",
  controtelai: "Controtelai",
  opere: "Opere complementari",
  eventuali: "Servizi eventuali",
};

export function etichettaGruppo(g: ChiaveGruppo): string {
  return ETICHETTE[g];
}

export function formatCent(cent: number | null | undefined): string {
  if (cent == null) return "—";
  return formatEuroSimbolo(cent / 100);
}

/** In quale sezione della tab finisce la voce. */
function chiaveDi(v: VoceComputo): ChiaveGruppo {
  if (v.gruppo !== "prodotti") return v.gruppo;
  if (v.codice.startsWith("dei_riga_")) return "prodotti_check2";
  if (v.codice.startsWith("massimale_")) return "prodotti_check1";
  // Voce di prodotto che non conosciamo: la colloca il check in cui entra,
  // meglio che farla sparire dall'elenco.
  return v.inCheck2 && !v.inCheck1 ? "prodotti_check2" : "prodotti_check1";
}

export type GruppoVociView = {
  gruppo: ChiaveGruppo;
  etichetta: string;
  voci: VoceComputo[];
  /** null quando il totale non è calcolabile: si mostra «—», non uno zero. */
  totaleCent: number | null;
  incompleto: boolean;
};

/**
 * Voci per sezione, nell'ordine di lettura del foglio.
 *
 * Il totale di CHECK 2 è `deiProdottiCent` del computo, non la somma delle
 * righe mostrate: il motore somma gli euro e arrotonda una volta sola, mentre
 * sommare qui righe già arrotondate darebbe un centesimo di differenza dalla
 * card in testa. Quando è null il CHECK 2 è incompleto e non c'è totale.
 *
 * Le voci escluse (`inclusa === false` — solo opere e servizi eventuali non
 * scelti; i massimali sono sempre inclusi) restano in elenco perché
 * spiegano cosa il computo ha lasciato fuori, ma non entrano nei totali,
 * esattamente come nel `somma()` del motore.
 */
export function raggruppaVoci(
  voci: VoceComputo[],
  deiProdottiCent: number | null
): GruppoVociView[] {
  return ORDINE.flatMap(gruppo => {
    const mie = voci.filter(v => chiaveDi(v) === gruppo).sort((a, b) => a.ordine - b.ordine);
    if (mie.length === 0) return [];
    const daMotore = gruppo === "prodotti_check2";
    const totaleCent = daMotore
      ? deiProdottiCent
      : mie.reduce((s, v) => (v.inclusa ? s + v.limiteCent : s), 0);
    return [
      {
        gruppo,
        etichetta: ETICHETTE[gruppo],
        voci: mie,
        totaleCent,
        incompleto: daMotore && deiProdottiCent == null,
      },
    ];
  });
}

const numero = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 3 });

const PREFISSO_ACCESSORIO = "accessorio ";

/**
 * Il perché di una cifra, con i suoi input.
 *
 * Una riga DEI con oscurante abbinato o accessori vale più del suo
 * «mq × prezzo»: quel prodotto sarebbe una cifra che non torna con il limite
 * scritto accanto. In quel caso si mostrano gli addendi.
 */
export function spiegaVoce(v: VoceComputo): string {
  const d = v.dettaglio;
  const euro = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  const accessori = Object.entries(d).filter(([k]) => k.startsWith(PREFISSO_ACCESSORIO));
  const conOscurante = d.oscurante != null || d.oscuranteBase != null;

  if (conOscurante || accessori.length > 0) {
    const parti: string[] = [];
    const base = euro("base");
    if (base != null) parti.push(`base ${formatEuroSimbolo(base)}`);
    const oscurante = euro("oscuranteBase");
    if (oscurante != null) parti.push(`oscurante ${formatEuroSimbolo(oscurante)}`);
    if (accessori.length > 0) {
      const somma = accessori.reduce((s, [, val]) => s + (typeof val === "number" ? val : 0), 0);
      parti.push(`accessori ${formatEuroSimbolo(somma)}`);
    }
    if (parti.length > 0) return parti.join(" + ");
  }

  const unita = v.unita === "€/mq" ? "mq" : v.unita;
  const base = `${numero(v.quantita)} ${unita} × ${formatCent(v.prezzoUnitCent)}`;
  const zona = typeof d.zona === "string" && d.zona ? ` (zona ${d.zona})` : "";
  return base + zona;
}

export function badgeStato(s: StatoComputoView): { testo: string; tono: "success" | "warning" | "muted" } {
  if (!s.computo) return { testo: "Non eseguito", tono: "muted" };
  if (s.valido) return { testo: "Aggiornato", tono: "success" };
  return { testo: "Da rifare", tono: "warning" };
}

export function etichettaTabLimiti(s: StatoComputoView | undefined): string {
  if (!s || !s.computo) return "Limiti";
  return s.valido ? "Limiti ✓" : "Limiti · da rifare";
}

/**
 * Il motivo, quando le avvertenze lo elencano già per esteso («Il computo è
 * incompleto: …»), si ferma alla prima frase: il resto è lì sotto.
 */
export function motivoSintetico(motivo: string | null, nAvvertenze: number): string | null {
  if (!motivo) return null;
  if (nAvvertenze === 0) return motivo;
  const fine = motivo.indexOf(":");
  const punto = motivo.indexOf(". ");
  const taglio = [fine, punto].filter(i => i > 0).sort((a, b) => a - b)[0];
  return taglio == null ? motivo : `${motivo.slice(0, taglio)}.`;
}
