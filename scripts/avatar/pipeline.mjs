// Pipeline avatar: PNG RGBA -> bbox alpha -> crop quadrato -> downscale premoltiplicato.
// Nessuna dipendenza: solo zlib/fs di Node.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(file) {
  const buf = readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error(`${file}: non è un PNG`);
  let off = 8, ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0), h: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error(`${file}: IHDR mancante`);
  if (ihdr.depth !== 8 || ihdr.color !== 6 || ihdr.interlace !== 0) {
    throw new Error(`${file}: atteso RGBA 8bit non interlacciato, trovato depth=${ihdr.depth} color=${ihdr.color} interlace=${ihdr.interlace}`);
  }
  const { w, h } = ihdr;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let ri = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[ri++];
    const line = raw.subarray(ri, ri + stride); ri += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}

function encodePng({ w, h, data }) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filtro None
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, payload) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function alphaBBox({ w, h, data }, threshold = 16) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('immagine completamente trasparente');
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Larghezza e centro della testa misurati su una fascia all'altezza degli occhi:
// più in basso il bbox prende le spalle, più in alto solo la calotta.
function headBand({ w, data }, bb, from = 0.12, to = 0.28, threshold = 16) {
  const yStart = bb.y0 + Math.round(bb.h * from);
  const yEnd = bb.y0 + Math.round(bb.h * to);
  let x0 = w, x1 = -1;
  for (let y = yStart; y < yEnd; y++) {
    const row = y * w * 4;
    for (let x = bb.x0; x <= bb.x1; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  if (x1 < 0) return { cx: Math.round((bb.x0 + bb.x1) / 2), width: bb.w };
  return { cx: Math.round((x0 + x1) / 2), width: x1 - x0 + 1 };
}

// Ritaglia anche fuori dai bordi: l'eccedenza resta trasparente.
function crop(img, left, top, side) {
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    const sy = top + y;
    if (sy < 0 || sy >= img.h) continue;
    const xFrom = Math.max(0, -left);
    const xTo = Math.min(side, img.w - left);
    if (xTo <= xFrom) continue;
    const srcStart = (sy * img.w + left + xFrom) * 4;
    img.data.copy(out, (y * side + xFrom) * 4, srcStart, srcStart + (xTo - xFrom) * 4);
  }
  return { w: side, h: side, data: out };
}

// Downscale box-filter su canale premoltiplicato: evita aloni scuri sui bordi alpha.
function resize(img, size) {
  const { w, h, data } = img;
  const out = Buffer.alloc(size * size * 4);
  const sx = w / size, sy = h / size;
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          const al = data[i + 3] / 255;
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al;
          a += data[i + 3]; n++;
        }
      }
      const o = (y * size + x) * 4;
      const am = a / n;
      const un = am > 0 ? n * (am / 255) : 1;
      out[o] = Math.min(255, Math.round(r / un));
      out[o + 1] = Math.min(255, Math.round(g / un));
      out[o + 2] = Math.min(255, Math.round(b / un));
      out[o + 3] = Math.round(am);
    }
  }
  return { w: size, h: size, data: out };
}

const [srcDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.png')).sort()) {
  const name = basename(file, '.png');
  const img = decodePng(join(srcDir, file));
  const bb = alphaBBox(img);

  // Figura intera dentro il quadrato: la mascotte va vista tutta, non solo
  // in volto. Il margine del 20% serve alla maschera tonda dell'avatar, che
  // altrimenti taglierebbe i lati della testa (larga quanto tutto il corpo)
  // e le antenne. L'euristica del volto resta sotto per i soggetti umani.
  const head = headBand(img, bb);
  const side = Math.round(Math.max(bb.w, bb.h) * 1.2);
  const left = Math.round((bb.x0 + bb.x1) / 2) - Math.round(side / 2);
  const top = Math.round((bb.y0 + bb.y1) / 2) - Math.round(side / 2);

  const sq = crop(img, left, top, side);
  for (const size of [512, 256]) {
    writeFileSync(join(outDir, `${name}-${size}.png`), encodePng(resize(sq, size)));
  }
  console.log(
    `${name.padEnd(20)} bbox=${bb.x0},${bb.y0} ${bb.w}x${bb.h}  testa=${head.width}px @${head.cx}  crop=${left},${top} ${side}px`,
  );
}
