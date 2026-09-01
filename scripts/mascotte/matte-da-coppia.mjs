// Ricava l'alpha esatto da due versioni degli stessi fotogrammi: una su
// fondo grigio noto, una su fondo nero (lo "scontornato" di Higgsfield, che
// però è opaco: yuv420p, nessun canale alpha).
//
// Un key sulla luminanza non va bene: lo schermo del volto è antracite e
// verrebbe bucato insieme al fondo. Con due fondi diversi invece l'alpha si
// risolve, non si indovina:
//   sul nero   Cn = α·S
//   sul grigio Cg = α·S + (1−α)·G
//   quindi     (Cg − Cn) = (1−α)·G   →   α = 1 − (Cg − Cn)/G
// e il colore vero è S = Cn/α (il PNG vuole alpha non premoltiplicato).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
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
    const d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: d.readUInt32BE(0), h: d.readUInt32BE(4), color: d[9] };
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const { w, h, color } = ihdr;
  const canale = color === 6 ? 4 : 3;
  const stride = w * canale;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  let ri = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[ri++], line = raw.subarray(ri, ri + stride); ri += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= canale ? cur[x - canale] : 0, b = prev ? prev[x] : 0;
      const c = prev && x >= canale ? prev[x - canale] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
  }
  return { w, h, canale, data: out };
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

const [dirGrigio, dirNero, dirOut, gStr] = process.argv.slice(2);
const G = (gStr ?? '217,213,209').split(',').map(Number);
mkdirSync(dirOut, { recursive: true });

const files = readdirSync(dirGrigio).filter(f => f.endsWith('.png')).sort();
let opachi = 0, totali = 0;

for (const nome of files) {
  const g = decodePng(join(dirGrigio, nome));
  const n = decodePng(join(dirNero, nome));
  if (g.w !== n.w || g.h !== n.h) throw new Error(`${nome}: dimensioni diverse fra le due versioni`);

  const out = Buffer.alloc(g.w * g.h * 4);
  for (let i = 0; i < g.w * g.h; i++) {
    const gi = i * g.canale, ni = i * n.canale, o = i * 4;

    // Media sui tre canali: la compressione 4:2:0 sporca i bordi, mediare
    // smorza il rumore invece di propagarlo su un solo canale.
    let somma = 0;
    for (let c = 0; c < 3; c++) somma += (g.data[gi + c] - n.data[ni + c]) / G[c];
    const alpha = Math.max(0, Math.min(1, 1 - somma / 3));

    if (alpha < 0.02) { totali++; continue; }
    out[o + 3] = Math.round(alpha * 255);
    for (let c = 0; c < 3; c++) {
      out[o + c] = Math.max(0, Math.min(255, Math.round(n.data[ni + c] / alpha)));
    }
    if (alpha > 0.98) opachi++;
    totali++;
  }
  writeFileSync(join(dirOut, nome), encodePng({ w: g.w, h: g.h, data: out }));
}

console.log(
  `${files.length} fotogrammi · ${Math.round((opachi / totali) * 100)}% pixel pienamente opachi ` +
  `(il resto è fondo o bordo sfumato)`,
);
