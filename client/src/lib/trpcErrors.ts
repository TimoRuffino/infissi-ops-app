// Lettura degli errori tRPC lato client.
//
// Un pannello che nasconde qualunque errore mente due volte: fa sparire una
// superficie che l'utente potrebbe usare, e tratta un guasto di rete come se
// fosse un rifiuto di permesso. Qui si distinguono i due casi una volta sola.
//
// Non è una regola di autorizzazione: il confine resta la procedura server.
// Questo predicato descrive soltanto *cosa il server ha già risposto*.

/** Forma minima di un errore tRPC lato client: interessa solo il codice. */
export type ErroreConCodice = {
  data?: { code?: string } | null;
} | null;

const CODICI_DI_PERMESSO = new Set(["FORBIDDEN", "UNAUTHORIZED"]);

/**
 * Vero quando la query è stata rifiutata dal confine dei permessi: il pannello
 * non riguarda questo utente e resta nascosto, senza lasciar dedurre che
 * esista. Ogni altro errore è un guasto, e va mostrato con un ritentativo.
 */
export function permessoNegato(errore: ErroreConCodice | undefined): boolean {
  const codice = errore?.data?.code;
  return typeof codice === "string" && CODICI_DI_PERMESSO.has(codice);
}
