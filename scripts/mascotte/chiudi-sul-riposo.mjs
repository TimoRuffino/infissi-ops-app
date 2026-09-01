// Fa atterrare un siparietto esattamente sulla posa di riposo.
//
// Al modello video si chiede di tornare in piedi alla fine, e in effetti lo
// fa — ma non sul fotogramma esatto da cui era partito: il generato deriva.
// Restava così un salto di ~20 al rientro nell'idle, cioè quanto quello del
// loop che avevamo appena corretto.
//
// Qui le ultime battute vengono fuse progressivamente verso la posa neutra,
// così l'ultimo fotogramma È quello con cui l'idle ricomincia. La fusione è
// corta e parte da fotogrammi già quasi uguali alla neutra, quindi non
// lascia scie.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crc32 = b => zlib.crc32(b) >>> 0;
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function decodePng(file) {
  const buf = readFileSync(file);
  let off = 8, ihdr = null; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: d.readUInt32BE(0), h: d.readUInt32BE(4), color: d[9] };
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const { w, h, color } = ihdr, ch = color === 6 ? 4 : 3, stride = w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  let ri = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[ri++], line = raw.subarray(ri, ri + stride); ri += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}

function encodePng({ w, h, data }) {
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ck = (t, p) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(p.length);
    const td = Buffer.concat([Buffer.from(t, 'ascii'), p]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([SIG, ck('IHDR', ih), ck('IDAT', zlib.deflateSync(raw, { level: 6 })), ck('IEND', Buffer.alloc(0))]);
}

const [dir, riferimento, nStr, dove = 'coda'] = process.argv.slice(2);
const N = Number(nStr ?? 8);
const neutra = decodePng(riferimento);
const files = readdirSync(dir).filter(f => f.endsWith('.png')).sort();
const tot = files.length;
if (tot <= N) throw new Error(`servono più di ${N} fotogrammi, trovati ${tot}`);

// Le clip nate da un render diverso non partono nemmeno dalla posa neutra:
// per quelle si fonde anche la testa, o il salto resta solo spostato in
// entrata invece che in uscita.
const punti = [];
if (dove === 'coda' || dove === 'entrambi') {
  for (let k = 0; k < N; k++) punti.push({ i: tot - N + k, peso: (k + 1) / N });
}
if (dove === 'testa' || dove === 'entrambi') {
  for (let k = 0; k < N; k++) punti.push({ i: k, peso: (N - k) / N });
}

for (const { i, peso } of punti) {
  const f = join(dir, files[i]);
  const img = decodePng(f);
  if (img.w !== neutra.w || img.h !== neutra.h) {
    throw new Error(`misure diverse dalla posa neutra: ${img.w}x${img.h} vs ${neutra.w}x${neutra.h}`);
  }
  // Curva morbida, così l'aggancio non parte di scatto.
  const p = peso * peso * (3 - 2 * peso);
  const out = Buffer.alloc(img.w * img.h * 4);
  for (let q = 0; q < img.w * img.h; q++) {
    const a = q * img.ch, b = q * neutra.ch, o = q * 4;
    for (let c = 0; c < 4; c++) {
      const va = c === 3 && img.ch === 3 ? 255 : img.data[a + c];
      const vb = c === 3 && neutra.ch === 3 ? 255 : neutra.data[b + c];
      out[o + c] = Math.round(va * (1 - p) + vb * p);
    }
  }
  writeFileSync(f, encodePng({ w: img.w, h: img.h, data: out }));
}

console.log(`   aggancio alla posa neutra (${dove}): ${N} fotogrammi per capo`);
