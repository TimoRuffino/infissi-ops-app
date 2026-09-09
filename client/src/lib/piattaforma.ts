// La sezione Piattaforma, lato client (spec WS6 §8). Modulo PURO: nessun
// React, nessuna query. Qui vivono la decisione della guardia e la regola
// dello slug, così si possono verificare senza montare una route.
//
// Resta una guardia UX: l'autorizzazione vera è di `piattaformaProcedure`
// (server/_core/trpc.ts), che rilegge l'utente dallo store e confronta
// l'email con PLATFORM_ADMIN_EMAILS a ogni chiamata.

/**
 * L'azienda che possiede la piattaforma: si amministra come le altre, ma si
 * dice — un badge nell'elenco, e le conferme in più su sospensione e
 * ripristino. È lo stesso numero di `TENANT_PREDEFINITO_ID`
 * (server/tenants/costanti.ts), che il client non può importare: il server
 * non si importa dal browser. Sta qui, una volta sola, invece che ricopiato
 * in ogni pagina che ne ha bisogno.
 */
export const TENANT_PIATTAFORMA_ID = 1;

/** Esito della guardia visuale della piattaforma: attesa, accesso o rifiuto. */
export type PiattaformaGate = "allowed" | "blocked" | "loading";

/**
 * Adapter puro di `tenants.mio.piattaforma`. Fail-closed: `blocked` è la
 * risposta anche quando il payload manca del tutto (query in errore,
 * sessione scaduta), perché il client non ha una seconda fonte da cui
 * dedurre la capacità — e non deve inventarsene una.
 */
export function piattaformaGateLabel(input: {
  mio: { piattaforma?: boolean } | null | undefined;
  loading?: boolean;
}): PiattaformaGate {
  if (input.loading) return "loading";
  return input.mio?.piattaforma === true ? "allowed" : "blocked";
}

/**
 * Lo slug suggerito dalla ragione sociale (spec §8): minuscolo, senza
 * accenti, con un trattino al posto di ogni gruppo di caratteri non validi e
 * al più 40 caratteri — la stessa forma che `SLUG_RE`
 * (server/tenants/costanti.ts) accetta. I trattini si tolgono anche DOPO il
 * taglio: uno slug che finisce con «-» verrebbe rifiutato dal server, e
 * l'utente non capirebbe perché il campo compilato da noi non va bene.
 *
 * Resta un suggerimento: il campo è modificabile e la verità la dice il
 * server, che rifiuta gli slug non validi e quelli già presi.
 */
export function slugSuggerito(nome: string): string {
  return nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}
