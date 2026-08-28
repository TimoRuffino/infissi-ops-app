// A quale anno appartiene una commessa.
//
// Il CRM non ha un campo "anno": ha una data di apertura che può mancare, un
// codice che quasi sempre la contiene, e un `createdAt` che c'è sempre ma
// dice quando il record è stato scritto, non quando il lavoro è cominciato —
// e per le commesse importate le due cose non coincidono.
//
// L'ordine qui sotto è quello dell'affidabilità decrescente. Serve a due
// posti che devono dare lo stesso numero: il filtro per anno della pagina
// Pagamenti e il prospetto economico, che confronta i pattuiti del CRM col
// fatturato FiC dello stesso anno. Due euristiche diverse avrebbero prodotto
// due totali diversi per lo stesso periodo.

export function annoCommessa(commessa: {
  dataApertura?: unknown;
  codice?: unknown;
  createdAt?: unknown;
}): number | null {
  const apertura = String(commessa?.dataApertura ?? "").slice(0, 4);
  if (/^\d{4}$/.test(apertura)) return Number(apertura);

  const daCodice = /^COM-(\d{4})-/i.exec(String(commessa?.codice ?? ""));
  if (daCodice) return Number(daCodice[1]);

  const creata = commessa?.createdAt ? new Date(commessa.createdAt as any) : null;
  return creata && !Number.isNaN(creata.getTime())
    ? creata.getUTCFullYear()
    : null;
}
