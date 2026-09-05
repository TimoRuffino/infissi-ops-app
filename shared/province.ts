/**
 * Province e città metropolitane italiane: sigla automobilistica e nome,
 * in ordine alfabetico di nome. È l'elenco del menu a tendina
 * dell'anagrafica cliente e il valore che finisce in `address_province`
 * della fattura elettronica (due lettere maiuscole, obbligatorie per lo
 * SdI). Sud Sardegna (SU) sostituisce le vecchie CI/VS; OT e OG non
 * esistono più.
 */
const ELENCO: Array<{ sigla: string; nome: string }> = [
  { sigla: "AG", nome: "Agrigento" },
  { sigla: "AL", nome: "Alessandria" },
  { sigla: "AN", nome: "Ancona" },
  { sigla: "AO", nome: "Aosta" },
  { sigla: "AR", nome: "Arezzo" },
  { sigla: "AP", nome: "Ascoli Piceno" },
  { sigla: "AT", nome: "Asti" },
  { sigla: "AV", nome: "Avellino" },
  { sigla: "BA", nome: "Bari" },
  { sigla: "BT", nome: "Barletta-Andria-Trani" },
  { sigla: "BL", nome: "Belluno" },
  { sigla: "BN", nome: "Benevento" },
  { sigla: "BG", nome: "Bergamo" },
  { sigla: "BI", nome: "Biella" },
  { sigla: "BO", nome: "Bologna" },
  { sigla: "BZ", nome: "Bolzano" },
  { sigla: "BS", nome: "Brescia" },
  { sigla: "BR", nome: "Brindisi" },
  { sigla: "CA", nome: "Cagliari" },
  { sigla: "CL", nome: "Caltanissetta" },
  { sigla: "CB", nome: "Campobasso" },
  { sigla: "CE", nome: "Caserta" },
  { sigla: "CT", nome: "Catania" },
  { sigla: "CZ", nome: "Catanzaro" },
  { sigla: "CH", nome: "Chieti" },
  { sigla: "CO", nome: "Como" },
  { sigla: "CS", nome: "Cosenza" },
  { sigla: "CR", nome: "Cremona" },
  { sigla: "KR", nome: "Crotone" },
  { sigla: "CN", nome: "Cuneo" },
  { sigla: "EN", nome: "Enna" },
  { sigla: "FM", nome: "Fermo" },
  { sigla: "FE", nome: "Ferrara" },
  { sigla: "FI", nome: "Firenze" },
  { sigla: "FG", nome: "Foggia" },
  { sigla: "FC", nome: "Forlì-Cesena" },
  { sigla: "FR", nome: "Frosinone" },
  { sigla: "GE", nome: "Genova" },
  { sigla: "GO", nome: "Gorizia" },
  { sigla: "GR", nome: "Grosseto" },
  { sigla: "IM", nome: "Imperia" },
  { sigla: "IS", nome: "Isernia" },
  { sigla: "SP", nome: "La Spezia" },
  { sigla: "AQ", nome: "L'Aquila" },
  { sigla: "LT", nome: "Latina" },
  { sigla: "LE", nome: "Lecce" },
  { sigla: "LC", nome: "Lecco" },
  { sigla: "LI", nome: "Livorno" },
  { sigla: "LO", nome: "Lodi" },
  { sigla: "LU", nome: "Lucca" },
  { sigla: "MC", nome: "Macerata" },
  { sigla: "MN", nome: "Mantova" },
  { sigla: "MS", nome: "Massa-Carrara" },
  { sigla: "MT", nome: "Matera" },
  { sigla: "ME", nome: "Messina" },
  { sigla: "MI", nome: "Milano" },
  { sigla: "MO", nome: "Modena" },
  { sigla: "MB", nome: "Monza e Brianza" },
  { sigla: "NA", nome: "Napoli" },
  { sigla: "NO", nome: "Novara" },
  { sigla: "NU", nome: "Nuoro" },
  { sigla: "OR", nome: "Oristano" },
  { sigla: "PD", nome: "Padova" },
  { sigla: "PA", nome: "Palermo" },
  { sigla: "PR", nome: "Parma" },
  { sigla: "PV", nome: "Pavia" },
  { sigla: "PG", nome: "Perugia" },
  { sigla: "PU", nome: "Pesaro e Urbino" },
  { sigla: "PE", nome: "Pescara" },
  { sigla: "PC", nome: "Piacenza" },
  { sigla: "PI", nome: "Pisa" },
  { sigla: "PT", nome: "Pistoia" },
  { sigla: "PN", nome: "Pordenone" },
  { sigla: "PZ", nome: "Potenza" },
  { sigla: "PO", nome: "Prato" },
  { sigla: "RG", nome: "Ragusa" },
  { sigla: "RA", nome: "Ravenna" },
  { sigla: "RC", nome: "Reggio Calabria" },
  { sigla: "RE", nome: "Reggio Emilia" },
  { sigla: "RI", nome: "Rieti" },
  { sigla: "RN", nome: "Rimini" },
  { sigla: "RM", nome: "Roma" },
  { sigla: "RO", nome: "Rovigo" },
  { sigla: "SA", nome: "Salerno" },
  { sigla: "SS", nome: "Sassari" },
  { sigla: "SV", nome: "Savona" },
  { sigla: "SI", nome: "Siena" },
  { sigla: "SR", nome: "Siracusa" },
  { sigla: "SO", nome: "Sondrio" },
  { sigla: "SU", nome: "Sud Sardegna" },
  { sigla: "TA", nome: "Taranto" },
  { sigla: "TE", nome: "Teramo" },
  { sigla: "TR", nome: "Terni" },
  { sigla: "TO", nome: "Torino" },
  { sigla: "TP", nome: "Trapani" },
  { sigla: "TN", nome: "Trento" },
  { sigla: "TV", nome: "Treviso" },
  { sigla: "TS", nome: "Trieste" },
  { sigla: "UD", nome: "Udine" },
  { sigla: "VA", nome: "Varese" },
  { sigla: "VE", nome: "Venezia" },
  { sigla: "VB", nome: "Verbano-Cusio-Ossola" },
  { sigla: "VC", nome: "Vercelli" },
  { sigla: "VR", nome: "Verona" },
  { sigla: "VV", nome: "Vibo Valentia" },
  { sigla: "VI", nome: "Vicenza" },
  { sigla: "VT", nome: "Viterbo" },
];

export const PROVINCE: ReadonlyArray<{ sigla: string; nome: string }> = [...ELENCO].sort((a, b) =>
  a.nome.localeCompare(b.nome, "it")
);

const SIGLE = new Set(PROVINCE.map(p => p.sigla));

/** Vero per una sigla in elenco (confronto senza distinzione di maiuscole). */
export function siglaProvinciaValida(sigla: string | null | undefined): boolean {
  return !!sigla && SIGLE.has(sigla.trim().toUpperCase());
}

/**
 * La sigla normalizzata (due maiuscole) se è in elenco, altrimenti `null`:
 * accetta "to", " TO ", ma non "Torino" né "XX".
 */
export function siglaProvincia(sigla: string | null | undefined): string | null {
  if (!sigla) return null;
  const s = sigla.trim().toUpperCase();
  return SIGLE.has(s) ? s : null;
}

/** "TO — Torino": l'etichetta del menu a tendina. */
export function etichettaProvincia(sigla: string): string {
  const p = PROVINCE.find(x => x.sigla === sigla);
  return p ? `${p.sigla} — ${p.nome}` : sigla;
}
