// Invio allo SdI in prova. Acceso finché la direzione non lo spegne per
// sede/ambiente con FATTURAZIONE_SDI_DRY_RUN=off: la prima fattura reale
// passa dal commercialista prima di uscire davvero (spec §11).
const VALORI_OFF = new Set(["off", "false", "0", "spento", "no"]);

export function sdiDryRun(): boolean {
  const grezzo = process.env.FATTURAZIONE_SDI_DRY_RUN?.trim().toLowerCase();
  return !(grezzo && VALORI_OFF.has(grezzo));
}
