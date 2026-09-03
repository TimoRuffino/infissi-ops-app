// Presentazione pura della tab Limiti: raggruppamento delle voci, spiegazione
// di ogni numero con i suoi input, badge di validità. Niente calcoli di
// dominio: i limiti arrivano già fatti dal server.
import type { Computo, GruppoVoce, VoceComputo } from "@shared/limiti/tipi";
import { formatEuroSimbolo } from "./euro";

export type StatoComputoView = {
  computo: Computo | null;
  valido: boolean;
  motivo: string | null;
};

const ORDINE: GruppoVoce[] = ["prodotti", "controtelai", "opere", "eventuali"];
const ETICHETTE: Record<GruppoVoce, string> = {
  prodotti: "Prodotti (Allegato A e DEI)",
  controtelai: "Controtelai",
  opere: "Opere complementari",
  eventuali: "Servizi eventuali",
};

export function etichettaGruppo(g: GruppoVoce): string {
  return ETICHETTE[g];
}

export function formatCent(cent: number | null | undefined): string {
  if (cent == null) return "—";
  return formatEuroSimbolo(cent / 100);
}

/**
 * Voci per gruppo, nell'ordine di lettura del foglio. Le voci non incluse
 * restano nell'elenco — servono a capire perché un massimale vince
 * sull'altro — ma non entrano nel totale del gruppo: sommarle direbbe una
 * cifra che il computo non usa da nessuna parte.
 */
export function raggruppaVoci(
  voci: VoceComputo[]
): Array<{ gruppo: GruppoVoce; etichetta: string; voci: VoceComputo[]; totaleCent: number }> {
  return ORDINE.flatMap(gruppo => {
    const mie = voci.filter(v => v.gruppo === gruppo).sort((a, b) => a.ordine - b.ordine);
    if (mie.length === 0) return [];
    const totaleCent = mie.reduce((s, v) => (v.inclusa ? s + v.limiteCent : s), 0);
    return [{ gruppo, etichetta: ETICHETTE[gruppo], voci: mie, totaleCent }];
  });
}

const numero = (n: number) => n.toLocaleString("it-IT", { maximumFractionDigits: 3 });

export function spiegaVoce(v: VoceComputo): string {
  const unita = v.unita === "€/mq" ? "mq" : v.unita;
  const base = `${numero(v.quantita)} ${unita} × ${formatCent(v.prezzoUnitCent)}`;
  const zona = typeof v.dettaglio.zona === "string" && v.dettaglio.zona ? ` (zona ${v.dettaglio.zona})` : "";
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
