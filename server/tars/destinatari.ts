// T6 — Ogni proposta al suo destinatario (D4, 03/09/2026).
//
// La coda «di tutti» sparisce: una proposta nasce con un destinatario
// derivato DETERMINISTICAMENTE da assegnatario della commessa, ruolo,
// stato della commessa e natura del tema. La direzione vede tutto, più
// ciò che non ha un assegnatario.
//
// Regole (D4):
// - tema amministrativo (fattura, pagamento, incasso) O commessa in
//   «fatture_pagamento» / «ordini_ultimazione» → ruolo amministrazione;
// - post-vendita → chi ha il ticket in carico, altrimenti chi ha la
//   commessa;
// - tema commerciale con commessa assegnata → solo quell'utente;
// - tutto il resto (nessun assegnatario, nessuna regola) → direzione.

export type DestinatarioTars = {
  utenteId: number | null;
  ruolo: "amministrazione" | "direzione" | null;
  motivo: string;
};

const STATI_AMMINISTRATIVI = new Set(["fatture_pagamento", "ordini_ultimazione"]);

export function destinatarioPerTema(input: {
  tema: "commerciale" | "amministrativo" | "post_vendita" | "comunicazione";
  commessa?: { assegnatoA?: number | null; stato?: string | null } | null;
  ticket?: { assegnatoA?: number | null } | null;
  categoriaComunicazione?: string | null;
}): DestinatarioTars {
  const commessa = input.commessa ?? null;
  const statoAmministrativo =
    commessa?.stato != null && STATI_AMMINISTRATIVI.has(commessa.stato);

  if (input.tema === "amministrativo" || input.categoriaComunicazione === "amministrativa" || statoAmministrativo) {
    return {
      utenteId: null,
      ruolo: "amministrazione",
      motivo: statoAmministrativo
        ? `commessa in «${commessa!.stato}»`
        : "tema amministrativo",
    };
  }
  if (input.tema === "post_vendita") {
    const inCarico = input.ticket?.assegnatoA ?? commessa?.assegnatoA ?? null;
    return inCarico != null
      ? { utenteId: inCarico, ruolo: null, motivo: "ticket o commessa in carico" }
      : { utenteId: null, ruolo: "direzione", motivo: "post-vendita senza assegnatario" };
  }
  // Commerciale e comunicazioni operative: l'assegnatario della commessa.
  const assegnatario = commessa?.assegnatoA ?? null;
  if (assegnatario != null) {
    return { utenteId: assegnatario, ruolo: null, motivo: "assegnatario della commessa" };
  }
  return { utenteId: null, ruolo: "direzione", motivo: "senza assegnatario" };
}

/** La direzione vede tutto; gli altri solo ciò che è LORO (utente o ruolo). */
export function puoVedere(
  contesto: { utenteId: number; ruoli: readonly string[]; direzione: boolean },
  destinatario: DestinatarioTars
): boolean {
  if (contesto.direzione) return true;
  if (destinatario.utenteId != null) return destinatario.utenteId === contesto.utenteId;
  if (destinatario.ruolo === "direzione") return false;
  if (destinatario.ruolo != null) return contesto.ruoli.includes(destinatario.ruolo);
  return false;
}
