// Spazzata finale del rebranding.
//
// Il prodotto ha cambiato nome due volte in due giorni, e questa spazzata
// insegue entrambe le forme lasciate indietro: quella di prima del 07/09 e
// quella durata un giorno solo, fino all'08/09. Sopravvivono legittimamente
// solo nell'archivio — verbali datati, documenti di design, prompt passati di
// Tars — che portano il nome che il prodotto aveva quando furono scritti.
// Ovunque altro sono residui.
//
// Nessuno dei due compare mai per esteso in questo file: vengono composti da
// pezzi, così la spazzata non inciampa in sé stessa.
//
// Limite noto: `percorsi()` cammina solo i file di testo elencati in
// ESTENSIONI. Un binario generato le è invisibile — in particolare
// PRD_infissi_ops_v4.pdf, il gemello PDF di
// documento_requisiti_infissi_ops.md (`handoff.md` lo cataloga «versione
// PDF del PRD»). Se il markdown cambia ma il PDF non viene
// rigenerato, questo test resta verde mentre il PDF consegnato a chi è
// fuori dall'azienda porta ancora il nome vecchio. Dopo ogni modifica al
// PRD: `bash scripts/build-prd-pdf.sh`, poi verificare a mano (pdftotext)
// che il nome nuovo compaia e il vecchio no.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";

import { PRODOTTO, PRODOTTO_PAYOFF } from "./brand";

const VECCHIO_NOME = ["Ruffino", "Flow"].join(" ");

/**
 * Il nome intermedio. Per un giorno solo, dal 07 all'08/09/2026, il prodotto
 * si è chiamato come oggi ma con una o sola. Va inseguito quanto il nome
 * ancora precedente: un residuo di allora è indistinguibile a occhio da un
 * refuso di battitura di oggi, ed è proprio il motivo per cui serve una
 * macchina invece della lettura.
 *
 * Composto da pezzi, come l'altro, e cercato solo dove NON è seguito da una
 * seconda o. Senza quel vincolo la regola troverebbe sé stessa dentro ogni
 * occorrenza del nome corretto, e la spazzata fallirebbe ovunque invece che
 * dove serve.
 */
const NOME_INTERMEDIO = new RegExp("Wynd" + "or(?!o)");

/**
 * Cartelle che non contengono sorgenti del progetto, confrontate per
 * percorso dalla radice — non per solo nome, altrimenti una futura
 * `client/src/data/` uscirebbe dalla scansione in silenzio insieme
 * all'omonima `data/` di raccolta alla radice. Oggi coincidono perché ogni
 * voce vive solo alla radice (un segmento solo), ma il confronto è per
 * percorso completo di proposito. `.github` NON è qui: `ci.yml` va
 * controllato come ogni altro documento vivo.
 */
const IGNORATE = new Set([
  ".git",
  ".claude",
  ".superpowers",
  ".manus-logs",
  "node_modules",
  "dist",
  "output",
  "tmp",
  "backups",
  "data",
  "attached_assets",
]);

/**
 * L'archivio: qui il vecchio nome è memoria, non residuo. La lista è corta
 * di proposito. Le guardie (`driveBackup.brand.test.ts`,
 * `archivio.test.ts`) non compaiono perché compongono il vecchio nome da
 * pezzi invece di scriverlo: un'esenzione in meno è un controllo in più.
 */
const ARCHIVIO = [
  join("docs", "design"),
  join("docs", "tars"),
  join("docs", "superpowers", "plans"),
  join("docs", "superpowers", "specs"),
  join("server", "tars", "prompt", "v1.ts"),
  join("server", "tars", "prompt", "v2.ts"),
  join("server", "tars", "prompt", "v3.ts"),
  join("server", "tars", "prompt", "v4.ts"),
];

/**
 * Occorrenze legittime fuori dall'archivio: identificatori esterni che
 * portano ancora il vecchio nome. Riscriverli nel documento non li
 * rinominerebbe davvero — farebbe solo mentire il documento.
 */
const DEROGHE = [
  {
    file: "handoff.md",
    // Nome reale del servizio su Railway. La rinomina è fuori perimetro
    // (spec §12) e va fatta sulla piattaforma, non nel testo.
    frammento: "servizio `" + VECCHIO_NOME + "`",
  },
  {
    file: "documento_requisiti_infissi_ops.md",
    // La voce di changelog che racconta il cambio nome deve poter
    // nominare il nome che si sta lasciando: è cronaca del rebranding
    // stesso, non un residuo dimenticato. Riscriverla direbbe che il
    // prodotto si è sempre chiamato Wyndoor, il che è falso quanto non
    // rinominare il servizio Railway nella deroga sopra.
    frammento: "cambiato nome da «" + VECCHIO_NOME + "»",
  },
];

const ESTENSIONI = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".py",
  ".css",
  ".html",
  ".md",
  ".sh",
  ".yml",
  ".yaml",
  ".json",
  ".toml",
]);

function archiviato(percorso: string): boolean {
  return ARCHIVIO.some(
    voce => percorso === voce || percorso.startsWith(voce + sep)
  );
}

/** Il contenuto senza le occorrenze esplicitamente derogate. */
function senzaDeroghe(percorso: string, contenuto: string): string {
  return DEROGHE.filter(d => d.file === percorso).reduce(
    (testo, d) => testo.split(d.frammento).join(""),
    contenuto
  );
}

function percorsi(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const percorso = dir === "." ? nome : join(dir, nome);
    // Per percorso dalla radice, non per nome: una cartella "data" innestata
    // altrove (fuori dai binari) resta dentro la scansione.
    if (IGNORATE.has(percorso)) continue;
    if (statSync(percorso).isDirectory()) {
      out.push(...percorsi(percorso));
      continue;
    }
    if (ESTENSIONI.has(extname(nome))) out.push(percorso);
  }
  return out;
}

describe("identità del prodotto", () => {
  it("espone nome e payoff", () => {
    expect(PRODOTTO).toBe("Wyndoor");
    expect(PRODOTTO_PAYOFF).toBe("Gestionale commesse infissi");
  });

  it("non lascia residui del vecchio nome fuori dall'archivio", () => {
    const residui = percorsi(".")
      .filter(percorso => !archiviato(percorso))
      .filter(percorso =>
        senzaDeroghe(percorso, readFileSync(percorso, "utf8")).includes(
          VECCHIO_NOME
        )
      );
    expect(
      residui,
      `Il vecchio nome sopravvive qui:\n${residui.join("\n")}`
    ).toEqual([]);
  });

  it("non lascia residui del nome intermedio fuori dall'archivio", () => {
    const residui = percorsi(".")
      .filter(percorso => !archiviato(percorso))
      .filter(percorso =>
        NOME_INTERMEDIO.test(
          senzaDeroghe(percorso, readFileSync(percorso, "utf8"))
        )
      );
    expect(
      residui,
      `Il nome con una o sola sopravvive qui:\n${residui.join("\n")}`
    ).toEqual([]);
  });

  it("tiene ogni deroga ancorata a un'occorrenza che esiste davvero", () => {
    // Una deroga che non corrisponde più a nulla è una regola morta che
    // continuerebbe a coprire testo nuovo.
    for (const d of DEROGHE) {
      expect(readFileSync(d.file, "utf8"), d.file).toContain(d.frammento);
    }
  });
});
