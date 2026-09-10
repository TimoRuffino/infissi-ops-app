// Due conferme dello stesso ordine parlano della stessa merce o di merce
// diversa?
//
// È il discriminante fra una REVISIONE (stessa merce, importo cambiato: vale
// l'ultima) e una conferma PARZIALE (merce diversa: i due importi si
// sommano). L'estrattore delle righe è dichiaratamente a bassa confidenza,
// quindi la regola è prudente in un verso solo: un articolo in comune basta
// per dire «stessa merce», e se non c'è abbastanza materia per decidere la
// risposta è «ignoto» — mai «disgiunti» per assenza di prove.

export type EsitoConfronto = "disgiunti" | "sovrapposti" | "ignoto";

/** Un nome che non identifica niente non è un articolo. */
function significativi(nomi: readonly string[] | null | undefined): Set<string> {
  const insieme = new Set<string>();
  for (const nome of nomi ?? []) {
    const pulito = String(nome ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    // Meno di quattro caratteri utili è un'unità di misura o un numero di
    // riga, non un articolo.
    if (pulito.replace(/\s/g, "").length < 4) continue;
    insieme.add(pulito);
  }
  return insieme;
}

export function confrontoArticoli(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined
): EsitoConfronto {
  const primi = significativi(a);
  const secondi = significativi(b);
  if (primi.size === 0 || secondi.size === 0) return "ignoto";
  for (const nome of primi) if (secondi.has(nome)) return "sovrapposti";
  return "disgiunti";
}
