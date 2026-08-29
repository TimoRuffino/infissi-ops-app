// Annunci di sistema nella chat aziendale.
//
// Oggi l'unico annuncio vivo è l'assegnazione: un messaggio nella
// conversazione diretta fra il mittente di sistema (id 0) e l'assegnatario.
// Gli annunci del canale generale — azioni autonome e decisioni sulle
// proposte — sono stati rimossi il 28/08/2026 insieme all'agente che li
// generava (recuperabili da git se il futuro agente li rivorrà).
//
// Ogni funzione è "best effort": un annuncio non riuscito non deve mai far
// fallire l'operazione che lo ha generato. Un errore va nei log, non
// all'utente che stava salvando altro.

import { chiaveDiretta, scriviMessaggio, trovaOCreaCanale } from "./store";

// Firma dei messaggi di sistema. Fino al 28/08/2026 era "Tars": i canali
// diretti creati prima di quella data conservano il vecchio nome nel DB
// (rinominarli è una migrazione, decisione rimandata al futuro agente).
const NOME_SISTEMA = "Sistema";

function log(errore: unknown, contesto: string): void {
  console.error(
    `[chat] annuncio ${contesto} fallito:`,
    (errore as any)?.message ?? errore
  );
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
      // Il mittente di sistema usa l'id 0: una conversazione distinta da
      // quelle fra persone e sempre disponibile.
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
