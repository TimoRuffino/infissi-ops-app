// Annunci di sistema nella chat aziendale.
//
// Il canale generale è il registro leggibile di quello che il CRM fa da solo
// o su approvazione: assegnazioni, azioni autonome di Tars, decisioni degli
// operatori sulle proposte. Non è una notifica — resta lì, con il suo
// orario, e chiunque può risalire a chi ha deciso cosa.
//
// Ogni funzione è "best effort": un annuncio non riuscito non deve mai far
// fallire l'operazione che lo ha generato. Un errore va nei log, non
// all'utente che stava salvando altro.

import {
  canaleGenerale,
  chiaveDiretta,
  scriviMessaggio,
  trovaOCreaCanale,
} from "./store";

const NOME_SISTEMA = "Tars";

function log(errore: unknown, contesto: string): void {
  console.error(
    `[chat] annuncio ${contesto} fallito:`,
    (errore as any)?.message ?? errore
  );
}

/** Testo compatto di un'azione: cosa, su cosa, con che esito. */
function rigaAzione(input: {
  titolo: string;
  esito: string;
  eseguita: boolean;
}): string {
  const segno = input.eseguita ? "✓" : "✗";
  const coda = input.esito && input.esito !== "eseguita" ? ` — ${input.esito}` : "";
  return `${segno} ${input.titolo}${coda}`;
}

/**
 * Tars ha eseguito qualcosa in autonomia. È l'annuncio che rende
 * l'autonomia accettabile: senza, nessuno saprebbe cosa è cambiato.
 */
export async function annunciaAzioniAutonome(input: {
  sedeId: number;
  azioni: ReadonlyArray<{
    titolo: string;
    esito: string;
    eseguita: boolean;
    propostaId: number;
    commessaId: number | null;
  }>;
}): Promise<void> {
  if (input.azioni.length === 0) return;
  try {
    const canale = await canaleGenerale(input.sedeId);
    const intestazione =
      input.azioni.length === 1
        ? "Ho eseguito in autonomia:"
        : `Ho eseguito ${input.azioni.length} azioni in autonomia:`;
    await scriviMessaggio({
      sedeId: input.sedeId,
      canaleId: canale.id,
      autoreId: null,
      autoreNome: NOME_SISTEMA,
      testo: [intestazione, ...input.azioni.map(rigaAzione)].join("\n"),
      commessaId:
        input.azioni.length === 1 ? input.azioni[0].commessaId : null,
      propostaId:
        input.azioni.length === 1 ? input.azioni[0].propostaId : null,
      link: "/tars?tab=registro",
    });
  } catch (errore) {
    log(errore, "azioni autonome");
  }
}

/** Un operatore ha deciso su una proposta: approvata o rifiutata. */
export async function annunciaDecisioneProposta(input: {
  sedeId: number;
  decisore: string;
  decisione: "approvata" | "rifiutata";
  titolo: string;
  esito: string | null;
  propostaId: number;
  commessaId: number | null;
}): Promise<void> {
  try {
    const canale = await canaleGenerale(input.sedeId);
    const verbo =
      input.decisione === "approvata" ? "ha approvato" : "ha rifiutato";
    const coda = input.esito ? `\n${input.esito}` : "";
    await scriviMessaggio({
      sedeId: input.sedeId,
      canaleId: canale.id,
      autoreId: null,
      autoreNome: NOME_SISTEMA,
      testo: `${input.decisore} ${verbo}: ${input.titolo}${coda}`,
      commessaId: input.commessaId,
      propostaId: input.propostaId,
      link: "/tars?tab=proposte",
    });
  } catch (errore) {
    log(errore, "decisione proposta");
  }
}

/**
 * Una commessa (o un'altra entità) è stata assegnata a qualcuno: il
 * messaggio va nella SUA conversazione diretta con il sistema, non nel
 * generale — è una consegna personale, non un fatto d'ufficio.
 */
export async function annunciaAssegnazione(input: {
  sedeId: number;
  assegnatarioId: number;
  assegnatarioNome: string;
  attore: string;
  entita: string;
  titolo: string;
  commessaId: number | null;
  link: string;
}): Promise<void> {
  try {
    const canale = await trovaOCreaCanale({
      sedeId: input.sedeId,
      tipo: "diretto",
      // Il sistema usa l'id 0: una conversazione diretta con Tars, distinta
      // da quelle fra persone e sempre disponibile.
      chiave: chiaveDiretta(0, input.assegnatarioId),
      nome: NOME_SISTEMA,
      membriIds: [input.assegnatarioId],
    });
    await scriviMessaggio({
      sedeId: input.sedeId,
      canaleId: canale.id,
      autoreId: null,
      autoreNome: NOME_SISTEMA,
      testo: `${input.attore} ti ha assegnato ${input.entita}: ${input.titolo}`,
      commessaId: input.commessaId,
      link: input.link,
    });
  } catch (errore) {
    log(errore, "assegnazione");
  }
}
