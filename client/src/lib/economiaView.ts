export type AffidabilitaEconomia = "alta" | "media" | "insufficiente";

export function percentualeCopertura(
  fatturatoMese: number,
  obiettivoMensile: number | null
): number {
  if (!obiettivoMensile || obiettivoMensile <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((fatturatoMese / obiettivoMensile) * 100))
  );
}

export function etichettaAffidabilita(
  affidabilita: AffidabilitaEconomia
): string {
  if (affidabilita === "alta") return "Affidabilita alta";
  if (affidabilita === "media") return "Affidabilita media";
  return "Dati insufficienti";
}

export function statoCopertura(
  stato: "disponibile" | "dati_insufficienti",
  ancoraDaFatturare: number | null
): "raggiunto" | "da_coprire" | "insufficiente" {
  if (stato !== "disponibile" || ancoraDaFatturare == null) {
    return "insufficiente";
  }
  return ancoraDaFatturare <= 0 ? "raggiunto" : "da_coprire";
}
