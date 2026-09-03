// Un PDF 1.4 minimo ma valido, con un flusso di testo non compresso: il
// parser (unpdf/pdfjs) lo legge davvero, quindi un test attraversa la stessa
// strada della produzione, OCR escluso. Solo per test e prove: Helvetica
// senza codifica non ha il simbolo «€», scrivere «EUR».

export function pdfConTesto(righe: string[]): Buffer {
  const sicura = (r: string) => r.replace(/[()\\]/g, m => "\\" + m);
  const contenuto = righe
    .map((r, i) => `BT /F1 11 Tf 40 ${780 - i * 16} Td (${sicura(r)}) Tj ET`)
    .join("\n");
  const oggetti = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(contenuto, "latin1")} >>\nstream\n${contenuto}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  oggetti.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf +=
    `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n` +
    offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
