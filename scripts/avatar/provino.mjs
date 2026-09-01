// Provino QA: riga 1 = avatar a 256px, riga 2 = tondo 64px come in lista utenti.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crc32 = (b) => zlib.crc32(b) >>> 0;
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
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4) };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const { w, h } = ihdr, bpp = 4, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  let ri = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[ri++], line = raw.subarray(ri, ri + stride); ri += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
  }
  return { w, h, data: out };
}

function encodePng({ w, h, data }) {
  const stride = w * 4, raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (t, p) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(p.length);
    const td = Buffer.concat([Buffer.from(t, 'ascii'), p]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function box(img, size) {
  const { w, h, data } = img, out = Buffer.alloc(size * size * 4), s = w / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const x0 = Math.floor(x * s), x1 = Math.max(x0 + 1, Math.floor((x + 1) * s));
    const y0 = Math.floor(y * s), y1 = Math.max(y0 + 1, Math.floor((y + 1) * s));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * w + xx) * 4, al = data[i + 3] / 255;
      r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += data[i + 3]; n++;
    }
    const o = (y * size + x) * 4, am = a / n, un = am > 0 ? n * (am / 255) : 1;
    out[o] = Math.min(255, Math.round(r / un)); out[o + 1] = Math.min(255, Math.round(g / un));
    out[o + 2] = Math.min(255, Math.round(b / un)); out[o + 3] = Math.round(am);
  }
  return { w: size, h: size, data: out };
}

const [srcDir, outFile] = process.argv.slice(2);
const files = readdirSync(srcDir).filter((f) => f.endsWith('-512.png')).sort();
const CELL = 256, PAD = 12, DOT = 64;
const W = files.length * (CELL + PAD) + PAD, H = PAD + CELL + PAD + CELL + PAD;
const canvas = Buffer.alloc(W * H * 4);
// fondo grigio chiarissimo, per vedere sia i bordi alpha sia i capelli scuri
for (let i = 0; i < W * H; i++) {
  canvas[i * 4] = 244; canvas[i * 4 + 1] = 244; canvas[i * 4 + 2] = 246; canvas[i * 4 + 3] = 255;
}
const blit = (src, dx, dy, circle = false) => {
  const r = src.w / 2;
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    if (circle && Math.hypot(x - r + 0.5, y - r + 0.5) > r) continue;
    const si = (y * src.w + x) * 4, al = src.data[si + 3] / 255;
    if (al === 0) continue;
    const di = ((dy + y) * W + dx + x) * 4;
    for (let k = 0; k < 3; k++) canvas[di + k] = Math.round(src.data[si + k] * al + canvas[di + k] * (1 - al));
  }
};

files.forEach((f, i) => {
  const img = decodePng(join(srcDir, f));
  const dx = PAD + i * (CELL + PAD);
  blit(box(img, CELL), dx, PAD);
  blit(box(img, DOT), dx + (CELL - DOT) / 2, PAD + CELL + PAD + (CELL - DOT) / 2, true);
});
writeFileSync(outFile, encodePng({ w: W, h: H, data: canvas }));
console.log(`${outFile}  ${W}x${H}  (${files.length} avatar)`);
