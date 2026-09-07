// Genera le icone raster del marchio dai tracciati canonici.
//
// iOS non accetta SVG per apple-touch-icon e ignora la trasparenza, quindi
// l'icona nasce su fondo pieno. Il service worker cerca /icon-192.png da
// prima di questo rebranding, e finora quel file non esisteva.
//
// Rieseguibile: se il marchio cambia, i PNG si rigenerano invece di restare
// indietro. Uso: pnpm icone
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const FONDO = "#fffdfd";
const ANTA_FISSA = "#d92f55";
const ANTA_APERTA = "#e8a33d";
const TRACCIATO =
  "M53.321 9.862 L85.321 21.062 A4 4 0 0 1 88 24.838 L88 75.162 " +
  "A4 4 0 0 1 85.321 78.938 L53.321 90.138 A4 4 0 0 1 48 86.362 " +
  "L48 13.638 A4 4 0 0 1 53.321 9.862 Z";

/** Margine del 12 % per lato: il segno non deve toccare i bordi dell'icona. */
const RESPIRO = 0.12;

function sorgente(lato: number): Buffer {
  const contenuto = lato * (1 - RESPIRO * 2);
  const scala = contenuto / 82;
  const offsetX = lato * RESPIRO - 9 * scala;
  const offsetY = lato * RESPIRO - 5 * scala;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}">` +
      `<rect width="${lato}" height="${lato}" fill="${FONDO}"/>` +
      `<g transform="translate(${offsetX} ${offsetY}) scale(${scala})">` +
      `<rect x="12" y="16" width="27" height="68" rx="4" fill="${ANTA_FISSA}"/>` +
      `<path fill="${ANTA_APERTA}" d="${TRACCIATO}"/>` +
      `</g></svg>`
  );
}

const ICONE = [
  { nome: "apple-touch-icon.png", lato: 180 },
  { nome: "icon-192.png", lato: 192 },
];

for (const { nome, lato } of ICONE) {
  const percorso = join("client", "public", nome);
  const png = await sharp(sorgente(lato)).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(percorso, png);
  console.log(`${percorso} — ${lato}×${lato}, ${png.length} byte`);
}
