// Presentazione pura della stampa dei limiti (07/09/2026, «devo poter
// stampare i limiti»): l'intestazione del computo, le righe del contratto
// come le legge il foglio «CALCOLO NUOVI LIMITI» (quantità, misure, mq,
// prezzo) e le sezioni del computo con i loro totali. Niente calcoli di
// dominio: i numeri arrivano dal server, qui si mettono in colonna.
import type { Computo, Contratto, RigaContratto } from "@shared/limiti/tipi";
import { dataItaliana, etichettaCategoria } from "./contrattoView";
import { formatEuro } from "./euro";
import { formatCent, raggruppaVoci, spiegaVoce, type GruppoVociView } from "./limitiView";

const DETRAZIONE: Record<Contratto["detrazioneTipo"], string> = {
  nessuna: "Nessuna",
  ecobonus: "Ecobonus",
  ristrutturazione: "Ristrutturazione (bonus casa)",
};

const mm = (n: number | null) => (n == null ? "—" : n.toLocaleString("it-IT"));
const mq = (n: number) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export type VoceIntestazioneStampa = { etichetta: string; valore: string };

/** Le coppie dell'intestazione: parametri del computo e del contratto, nell'ordine del foglio (INIZIO). */
export function intestazioneLimiti(
  contratto: Pick<Contratto, "zonaClimatica" | "piano" | "distanzaKm" | "detrazioneTipo" | "detrazionePct" | "pattuitoCent" | "pattuitoTipo" | "comuneCantiere" | "dataFirma"> | null,
  computo: Pick<Computo, "tariffeAl" | "createdAt" | "esito"> | null
): VoceIntestazioneStampa[] {
  const voci: VoceIntestazioneStampa[] = [];
  if (contratto) {
    if (contratto.comuneCantiere) voci.push({ etichetta: "Cantiere", valore: contratto.comuneCantiere });
    voci.push({ etichetta: "Zona climatica", valore: contratto.zonaClimatica ?? "—" });
    voci.push({ etichetta: "Piano", valore: contratto.piano == null ? "—" : String(contratto.piano) });
    if (contratto.distanzaKm != null) voci.push({ etichetta: "Distanza", valore: `${contratto.distanzaKm} km` });
    voci.push({
      etichetta: "Detrazione",
      valore: `${DETRAZIONE[contratto.detrazioneTipo]}${contratto.detrazionePct != null && contratto.detrazioneTipo !== "nessuna" ? ` ${contratto.detrazionePct} %` : ""}`,
    });
    voci.push({ etichetta: "Pattuito", valore: `€ ${formatEuro(contratto.pattuitoCent / 100)} ${contratto.pattuitoTipo}` });
    if (contratto.dataFirma) voci.push({ etichetta: "Contratto firmato il", valore: dataItaliana(contratto.dataFirma) });
  }
  if (computo) {
    voci.push({ etichetta: "Listino", valore: computo.tariffeAl ? dataItaliana(computo.tariffeAl) : "—" });
    voci.push({ etichetta: "Calcolato il", valore: dataItaliana(new Date(computo.createdAt).toISOString().slice(0, 10)) });
    voci.push({ etichetta: "Esito", valore: computo.esito === "ok" ? "Completo" : "Incompleto" });
  }
  return voci;
}

export type RigaContrattoStampa = {
  chiave: string;
  descrizione: string;
  categoria: string;
  quantita: string;
  misure: string;
  mq: string;
  prezzo: string;
};

/** Le righe del contratto come nel foglio: N., descrizione, categoria, quantità, L × H, mq, prezzo di contratto. */
export function righeContrattoStampa(righe: readonly RigaContratto[]): RigaContrattoStampa[] {
  return [...righe]
    .sort((a, b) => a.ordine - b.ordine)
    .map((r, i) => ({
      chiave: `${r.id}-${i}`,
      descrizione: `${r.descrizione}${r.oscuranteIntegrato ? ` con ${r.oscuranteIntegrato}` : ""}`,
      categoria: etichettaCategoria(r.categoria),
      quantita: String(r.quantita),
      misure: r.larghezzaMm != null && r.altezzaMm != null ? `${mm(r.larghezzaMm)} × ${mm(r.altezzaMm)} mm` : r.misuraDei != null ? `${r.misuraDei}` : "—",
      mq: r.mq > 0 ? mq(r.mq) : "—",
      prezzo: r.prezzoTotCent == null ? "—" : formatCent(r.prezzoTotCent),
    }));
}

export type RigaVoceStampa = {
  chiave: string;
  descrizione: string;
  codiceDei: string;
  calcolo: string;
  limite: string;
  inclusa: boolean;
};

export type SezioneStampa = {
  etichetta: string;
  righe: RigaVoceStampa[];
  totale: string;
};

/** Le sezioni del computo nell'ordine del foglio, con le voci escluse marcate (restano in elenco, non nei totali). */
export function sezioniComputoStampa(computo: Pick<Computo, "voci" | "deiProdottiCent">): SezioneStampa[] {
  return raggruppaVoci(computo.voci, computo.deiProdottiCent).map((g: GruppoVociView) => ({
    etichetta: g.etichetta,
    righe: g.voci.map(v => ({
      chiave: v.codice,
      descrizione: v.descrizione,
      codiceDei: v.codiceDei ?? "",
      calcolo: spiegaVoce(v),
      limite: formatCent(v.limiteCent),
      inclusa: v.inclusa,
    })),
    totale: g.incompleto ? "—" : formatCent(g.totaleCent),
  }));
}

/** I totali in fondo: CHECK 1, CHECK 2, il limite (il minore), detraibile e detrazione stimata. */
export function totaliComputoStampa(
  computo: Pick<Computo, "check1Cent" | "check2Cent" | "deiProdottiCent" | "limiteCent" | "detraibileCent" | "detrazioneStimataCent">
): VoceIntestazioneStampa[] {
  return [
    { etichetta: "CHECK 1 · Allegato A", valore: formatCent(computo.check1Cent) },
    { etichetta: "CHECK 2 · DEI", valore: formatCent(computo.check2Cent) },
    { etichetta: "CHECK 2 · prodotti DEI", valore: formatCent(computo.deiProdottiCent) },
    { etichetta: "Limite di spesa (il minore)", valore: formatCent(computo.limiteCent) },
    { etichetta: "Detraibile", valore: formatCent(computo.detraibileCent) },
    { etichetta: "Detrazione stimata", valore: formatCent(computo.detrazioneStimataCent) },
  ];
}

/** L'indirizzo della stampa dei limiti di una commessa: una sola forma, come per la fattura. */
export function hrefStampaLimiti(commessaId: number): string {
  return `/commesse/${commessaId}/limiti/stampa`;
}
