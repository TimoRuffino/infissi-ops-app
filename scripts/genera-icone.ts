// Genera le icone raster del marchio dai tracciati canonici.
//
// iOS non accetta SVG per apple-touch-icon e ignora la trasparenza, quindi
// l'icona nasce su fondo pieno. Il service worker cerca /icon-192.png da
// prima di questo rebranding, e finora quel file non esisteva.
//
// Rieseguibile: se il marchio cambia, i PNG si rigenerano invece di restare
// indietro. Uso: pnpm icone
//
// La geometria (scala e offset del riquadro del segno dentro l'icona
// quadrata) vive in shared/marchio.ts, dove è testata: qui non si
// ricalcola, si importa. Questo script resta responsabile della sola I/O —
// comporre l'SVG sorgente, chiamare sharp, scrivere i file.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { inquadraturaIcona } from "../shared/marchio";

const FONDO = "#fffdfd";
const ANTA_FISSA = "#d92f55";
const ANTA_APERTA = "#e8a33d";
const TRACCIATO =
  "M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 L88 75.162 " +
  "A4 4 0 0 1 85.321 78.938 L53.321 90.138 A4 4 0 0 1 48 86.362 " +
  "L48 13.638 A4 4 0 0 1 53.321 9.862 Z";

function sorgente(lato: number, fondo: string | null = FONDO): Buffer {
  const { scala, offsetX, offsetY } = inquadraturaIcona(lato);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}">` +
      (fondo ? `<rect width="${lato}" height="${lato}" fill="${fondo}"/>` : "") +
      `<g transform="translate(${offsetX} ${offsetY}) scale(${scala})">` +
      `<rect x="12" y="16" width="27" height="68" rx="4" fill="${ANTA_FISSA}"/>` +
      `<path fill="${ANTA_APERTA}" d="${TRACCIATO}"/>` +
      `</g></svg>`
  );
}

const ICONE = [
  { nome: "apple-touch-icon.png", lato: 180, fondo: FONDO },
  { nome: "icon-192.png", lato: 192, fondo: FONDO },
  // Il marchio delle mail (server/_core/bustaEmail.ts): SENZA fondo. Le
  // altre due nascono su fondo pieno perché iOS ignora la trasparenza; una
  // mail no — e in tema scuro un fondo `#fffdfd` diventa un francobollo
  // bianco appiccicato sopra la carta scura. 128 px per un `<img>` da 40:
  // regge anche uno schermo a 3×.
  { nome: "marchio-email.png", lato: 128, fondo: null },
];

for (const { nome, lato, fondo } of ICONE) {
  const percorso = join("client", "public", nome);
  const png = await sharp(sorgente(lato, fondo)).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(percorso, png);
  console.log(`${percorso} — ${lato}×${lato}${fondo ? "" : ", trasparente"}, ${png.length} byte`);
}
