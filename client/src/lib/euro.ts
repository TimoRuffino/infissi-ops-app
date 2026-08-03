// Parsing di importi in euro scritti a mano.
//
// Il parser precedente faceva `v.replace(/\./g, "").replace(",", ".")`: buono
// per la notazione italiana ("1.500,50"), disastroso per chi digita il punto
// come separatore decimale — cosa normalissima sui tastierini numerici.
// "1500.50" diventava 150050, cento volte tanto, e veniva salvato senza un
// avviso. Da qui la regola esplicita qui sotto.
//
// Convenzione:
//   - punto E virgola  → l'ultimo dei due è il decimale ("1.500,50" = 1500.5)
//   - solo virgola      → decimale ("1500,50" = 1500.5)
//   - solo punto        → decimale se seguito da 1 o 2 cifre ("1500.50"),
//                         separatore di migliaia se seguito da esattamente 3
//                         cifre o se ce n'è più d'uno ("1.500", "1.234.567")
//   - niente            → numero puro
export function parseEuro(raw: string): number | null {
  const s = raw.trim().replace(/[€\s ]/g, "");
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;

  const ultimaVirgola = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");
  let normalizzato: string;

  if (ultimaVirgola >= 0 && ultimoPunto >= 0) {
    const dec = Math.max(ultimaVirgola, ultimoPunto);
    normalizzato = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else if (ultimaVirgola >= 0) {
    normalizzato = s.replace(/,/g, ".");
    // Più virgole = migliaia ("1,234,567" all'inglese): tieni solo l'ultima.
    const parti = normalizzato.split(".");
    if (parti.length > 2) {
      normalizzato = parti.slice(0, -1).join("") + "." + parti[parti.length - 1];
    }
  } else if (ultimoPunto >= 0) {
    const decimali = s.length - ultimoPunto - 1;
    const piuDiUnPunto = s.indexOf(".") !== ultimoPunto;
    normalizzato = piuDiUnPunto || decimali === 3 ? s.replace(/\./g, "") : s;
  } else {
    normalizzato = s;
  }

  const n = Number(normalizzato);
  return Number.isFinite(n) ? n : null;
}

/** Come parseEuro ma accetta solo importi > 0 (registrazione di un incasso). */
export function parseEuroPositivo(raw: string): number | null {
  const n = parseEuro(raw);
  return n != null && n > 0 ? n : null;
}

/** Come parseEuro ma accetta anche 0 (un costo può legittimamente essere 0). */
export function parseEuroNonNegativo(raw: string): number | null {
  const n = parseEuro(raw);
  return n != null && n >= 0 ? n : null;
}

// Formattazione degli importi, unica per tutto il CRM: punto per le migliaia,
// virgola per i decimali, sempre due cifre decimali anche quando sono ",00".
//
// `useGrouping: true` è necessario: la regola italiana di Intl raggruppa solo
// da 5 cifre (minimumGroupingDigits 2), quindi 5000 usciva "5000" mentre
// 10000 usciva "10.000" — due importi vicini scritti in modi diversi.
export function formatEuro(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return v.toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
}

/** Come formatEuro ma con il simbolo davanti: "€ 1.234,56". */
export function formatEuroSimbolo(n: number | null | undefined): string {
  return `€ ${formatEuro(n)}`;
}
