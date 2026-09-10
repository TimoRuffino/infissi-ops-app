// scripts/anteprima-email.ts
// `pnpm posta:anteprima` — scrive su file la mail di piattaforma con dati
// finti e ne stampa la versione testo.
//
// Perché serve: una mail non si guarda in un test. `bustaEmail.test.ts`
// prova che il documento sia un documento, che il link sopravviva al bottone
// e che niente entri come markup — nessuna di quelle cose dice se la mail è
// bella, se il bottone si vede, se il tema scuro regge o se su 390 px il
// testo va a capo dove deve. Questo script apre quella porta: si guarda nel
// browser, a 1440 e a 390, prima di mandarla a un cliente.
//
// Non tocca la rete, non legge il database, non manda niente: compone e
// scrive. Il marchio nella busta è un `<img>` verso `<base>/icon-192.png`,
// quindi con `--base` puntato a un dominio spento si vede il ricambio
// testuale — che è esattamente ciò che vede chi ha le immagini bloccate.
//
//   pnpm posta:anteprima
//   pnpm posta:anteprima --base=http://localhost:5000 --out=/tmp/invito.html
//   pnpm posta:anteprima --contatto=""     # com'è senza indirizzo di risposta
//   pnpm posta:anteprima --tema=scuro      # le regole del tema scuro, forzate
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testoInvito } from "../server/piattaforma/testi";

/** `--chiave=valore`; `undefined` se l'argomento non c'è (≠ presente e vuoto). */
function argomento(chiave: string): string | undefined {
  const trovato = process.argv.find(a => a.startsWith(`--${chiave}=`));
  return trovato === undefined ? undefined : trovato.slice(chiave.length + 3);
}

const base = argomento("base") || "https://app.wyndoor.com";
const contatto = argomento("contatto") ?? "info@wyndoor.it";
// `tmp/` del repo (già in .gitignore): dentro il progetto il pannello
// Browser la apre come pagina vera invece che come istantanea, e la si
// può ridimensionare a 390 per vedere com'è sul telefono.
const tema = argomento("tema") === "scuro" ? "scuro" : "chiaro";
const uscita =
  argomento("out") ||
  join(process.cwd(), "tmp", `anteprima-invito-${tema}.html`);
mkdirSync(join(uscita, ".."), { recursive: true });

// Sette giorni, come `TTL_INVITO_MS`, a partire da oggi: la data nella
// scheda deve leggersi come si leggerà davvero.
const scadeIl = new Date(Date.now() + 7 * 86_400_000);

const invito = testoInvito({
  nome: "Giulia Bianchi",
  azienda: "Serramenti Bianchi S.r.l.",
  email: "giulia.bianchi@serramentibianchi.it",
  link: `${base.replace(/\/+$/, "")}/invito/7f3c9a21b5e84d06af12c7e390b4d5a86c1f2e73`,
  giorni: 7,
  scadeIl,
  baseUrl: base,
  contatto: contatto || undefined,
});

/**
 * Il tema scuro di una mail vive in `@media (prefers-color-scheme:dark)`, e
 * un file locale aperto nel browser lo risolve sempre come chiaro. Qui la
 * condizione si toglie: le REGOLE restano quelle vere, cambia solo quando si
 * applicano. È una simulazione, non una prova — la prova è aprire la mail
 * in Apple Mail con il tema scuro acceso.
 */
const html =
  tema === "scuro"
    ? invito.html.replace("@media (prefers-color-scheme:dark){", "@media all{")
    : invito.html;

writeFileSync(uscita, html, "utf8");

console.log(`Oggetto: ${invito.oggetto}`);
console.log(
  `Tema:    ${tema}${tema === "scuro" ? " (media query forzata: simulazione)" : ""}`
);
console.log(`HTML:    ${uscita}`);
console.log("");
console.log("── versione testo ───────────────────────────────────────────");
console.log(invito.testo);
console.log("─────────────────────────────────────────────────────────────");
