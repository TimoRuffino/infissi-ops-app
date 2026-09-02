import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        __dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

/** Un anno: il massimo che valga la pena dichiarare. */
const UN_ANNO_S = 60 * 60 * 24 * 365;
/** Un'ora di respiro per i file dal nome fisso. */
const UN_ORA_S = 60 * 60;

export const CACHE_MAI = "no-cache";
export const CACHE_IMMUTABILE = `public, max-age=${UN_ANNO_S}, immutable`;
export const CACHE_RIVALIDA = `public, max-age=${UN_ORA_S}`;

/**
 * Per quanto un file statico può restare in cache nel browser.
 *
 * Express, lasciato ai suoi valori di partenza, dichiarava `max-age=0` su
 * tutto: a ogni caricamento il browser rivalidava ogni singolo file — il
 * bundle, il foglio di stile, i font, le clip della mascotte — e ognuna di
 * quelle domande è un giro di rete fino a Railway solo per sentirsi
 * rispondere «non è cambiato niente».
 *
 * Vite firma i file di /assets con l'impronta del contenuto: se cambia il
 * contenuto cambia il nome, quindi quell'indirizzo non può mai mentire e la
 * risposta si può tenere per sempre. Chi ha un nome fisso (mascotte, avatar,
 * logo) può cambiare sotto lo stesso indirizzo, quindi si continua a
 * rivalidarlo — ma non a ogni caricamento di pagina.
 *
 * Due file non vanno mai in cache: l'indice, che è l'unico posto dove sono
 * scritti i nomi degli asset del rilascio corrente, e il service worker, che
 * in cache sarebbe un aggiornamento che non arriva mai.
 */
export function cacheStatica(percorso: string): string {
  const nome = percorso.split(/[\\/]/).pop() ?? "";
  if (nome === "index.html" || nome === "notification-sw.js") return CACHE_MAI;
  const segmenti = percorso.split(/[\\/]/);
  if (segmenti.includes("assets")) return CACHE_IMMUTABILE;
  return CACHE_RIVALIDA;
}

/**
 * `radice` serve ai test, che montano una cartella finta per leggere le
 * intestazioni davvero emesse invece di fidarsi della regola sulla carta.
 */
export function serveStatic(app: Express, radice?: string) {
  const distPath =
    radice ??
    (process.env.NODE_ENV === "development"
      ? path.resolve(__dirname, "../..", "dist", "public")
      : path.resolve(__dirname, "public"));
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.use(
    express.static(distPath, {
      // L'indice passa dal fallback qui sotto, che gli mette le sue regole.
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader("Cache-Control", cacheStatica(filePath));
      },
    })
  );

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", CACHE_MAI);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
