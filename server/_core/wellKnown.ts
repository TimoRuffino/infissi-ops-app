// File di verifica sotto /.well-known/.
//
// Chi verifica la proprietà di un dominio (Strix, Google, Meta, un'autorità
// di certificati) chiede un file a un URL fisso e confronta il contenuto
// byte per byte. Senza questa route la richiesta finisce nel catch-all
// della SPA, che risponde 200 con index.html: la verifica fallisce e il
// servizio dall'altra parte non ha modo di dire perché — vede solo del
// contenuto sbagliato.
//
// I token qui dentro NON sono segreti: esistono per essere serviti in
// chiaro a chiunque li chieda. Stanno nel codice perché è l'unico posto
// che vale in sviluppo e in produzione senza dipendere da come il build
// copia i file, e perché aggiungerne uno deve costare una riga.

import type { Express } from "express";

const FILE: Record<string, string> = {
  // Strix — verifica della proprietà di crm-ruffinogroup.up.railway.app.
  "strix-verify.txt": "strix-verify-0c75213cef17342ea8dfb6e16053b5a1",
};

/**
 * Va montata PRIMA di setupVite/serveStatic: entrambi finiscono con un
 * `app.use("*")` che inghiotte qualunque percorso non ancora gestito.
 */
export function serveWellKnown(app: Express): void {
  app.get("/.well-known/:file", (req, res, next) => {
    const contenuto = FILE[req.params.file];
    if (contenuto == null) return next();
    // Niente cache: un token si cambia e la verifica successiva deve
    // leggere quello nuovo, non una copia di un intermediario.
    res.set("cache-control", "no-store");
    res.type("text/plain").send(contenuto);
  });
}
