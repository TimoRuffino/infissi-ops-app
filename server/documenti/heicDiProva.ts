// Fixture di prova (solo test): una foto HEIC vera di una pagina con testo,
// fatta al volo con `sips` — c'è solo su macOS. Dove manca (Linux, CI)
// restituisce null e i test che la vogliono si saltano da soli, come quelli
// che vogliono tesseract. Nessun HEIC binario nel repository.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { renderizzaPagine } from "./ocr";
import { pdfConTesto } from "./pdfMinimo";

const esegui = promisify(execFile);

export async function heicDiProva(righe: string[]): Promise<Buffer | null> {
  if (process.platform !== "darwin") return null;
  let resa;
  try {
    resa = await renderizzaPagine(pdfConTesto(righe), {
      dpi: 150,
      maxPagine: 1,
      timeoutMs: 30_000,
      formato: "jpeg",
      qualita: 90,
    });
  } catch {
    return null;
  }
  if (resa.esito === "errore" || resa.immagini.length === 0) return null;
  const cartella = await mkdtemp(join(tmpdir(), "heic-prova-"));
  try {
    const jpg = join(cartella, "pagina.jpg");
    const heic = join(cartella, "pagina.heic");
    await writeFile(jpg, resa.immagini[0]);
    await esegui("sips", ["-s", "format", "heic", jpg, "--out", heic], { timeout: 30_000 });
    return await readFile(heic);
  } catch {
    return null;
  } finally {
    await rm(cartella, { recursive: true, force: true });
  }
}
