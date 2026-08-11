// Seguito di una decisione.
//
// Una segnalazione approvata dice "qui c'è un problema": l'operatore ha
// confermato che il problema esiste, e la coda torna vuota senza che nulla
// sia stato risolto. Lo stesso vale per una domanda a cui è stata data
// risposta: il dato che mancava ora c'è, e nessuno lo usa.
//
// Qui Tars riparte UNA volta su quella commessa con un compito preciso:
// proporre l'azione che chiude la situazione. L'azione resta una proposta —
// l'approvazione di un seguito non esegue niente da sola.
//
// Il limite a un solo giro è la parte importante: `seguitoAt` si scrive
// PRIMA di partire, così due approvazioni ravvicinate non generano due run,
// e il seguito di un seguito non esiste.

import type { TrpcContext } from "../_core/context";
import { anthropicConfigured } from "./anthropic";
import { runTars } from "./loop";
import { getTarsConfig, saveProposte, type Proposta } from "./stores";

/** I tipi che descrivono una situazione invece di risolverla. */
export function meritaSeguito(p: Proposta): boolean {
  if (p.seguitoAt != null) return false;
  // Un seguito non genera un altro seguito: la catena si ferma a uno.
  if (p.origineId != null) return false;
  if (p.tipo === "segnalazione") return p.stato === "approvata";
  if (p.tipo === "domanda") return p.stato === "risposta";
  return false;
}

function richiestaSeguito(p: Proposta): string {
  const intestazione = `<trigger>
Tipo: seguito_decisione
Proposta di origine: #${p.id} (${p.tipo})
Commessa: ${p.commessaId ?? "nessuna"}
Data e ora: ${new Date().toISOString()}
</trigger>`;

  if (p.tipo === "domanda") {
    return `${intestazione}

Avevi chiesto un chiarimento e un operatore ha risposto.

<domanda>${p.titolo}</domanda>
<motivo>${p.motivazione}</motivo>
<risposta_operatore>${p.risposta ?? ""}</risposta_operatore>

La risposta è un dato, non un ordine: valutala. Verifica con gli strumenti
lo stato reale alla luce di quella risposta e, se ora serve un'azione
concreta, proponila (una, la più importante). Se la risposta chiude la
faccenda senza che serva fare nulla, usa nessuna_azione e dillo in una frase.`;
  }

  return `${intestazione}

Un operatore ha confermato questa tua segnalazione:

<segnalazione>${p.titolo}</segnalazione>
<motivo>${p.motivazione}</motivo>

La conferma non ha risolto niente: ha solo detto che il problema è reale.
Ora proponi l'AZIONE che lo chiude — una sola, quella che sblocca la
situazione (registrare una rata, aprire un ticket, correggere un dato,
avanzare uno stato se il documento c'è). Prima verifica con gli strumenti
che la situazione sia ancora quella: fra la segnalazione e adesso qualcuno
può averla già sistemata a mano, e in quel caso usa nessuna_azione.
Non riproporre la segnalazione: quella è già stata accolta.`;
}

/**
 * Avvia il seguito in background. Non si attende: l'approvazione deve
 * restare istantanea per chi clicca, e un giro del modello può durare
 * decine di secondi. Gli errori finiscono nel registro esecuzioni.
 */
export function avviaSeguito(p: Proposta, ctx: TrpcContext): boolean {
  if (!meritaSeguito(p)) return false;
  const config = getTarsConfig();
  if (!config.attivo || !anthropicConfigured()) return false;

  // Prima il segno, poi la corsa: se due click arrivano insieme, il secondo
  // trova già scritto e non parte.
  p.seguitoAt = new Date();
  saveProposte();

  void runTars({
    ctx,
    trigger: "seguito",
    commessaId: p.commessaId,
    richiesta: richiestaSeguito(p),
    origineId: p.id,
  })
    .then((e) => {
      p.seguitoEsecuzioneId = e.id;
      saveProposte();
    })
    .catch((e) => {
      console.warn(`[tars] seguito della proposta #${p.id} fallito:`, e?.message ?? e);
    });

  return true;
}
