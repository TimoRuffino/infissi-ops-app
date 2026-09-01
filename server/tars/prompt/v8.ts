// Prompt v8. v7 resta immutabile; questa versione aggiunge la regola sulla
// forma della risposta (segnalazione della direzione, 01/09/2026: le risposte
// arrivavano come muri di elenchi e titoli, «anonime» da leggere). La UI ora
// rende il Markdown: la formattazione va quindi usata con parsimonia, non
// eliminata. Nessuna regola di autorità, perimetro o gate cambia qui.
import { PROMPT_SISTEMA as PROMPT_V7 } from "./v7";

export const PROMPT_VERSIONE = "v8";

export const PROMPT_SISTEMA = `${PROMPT_V7}
17. FORMA DELLA RISPOSTA: scrivi in prosa breve, come un collega che riferisce a voce. La formattazione serve a leggere più in fretta, non a decorare: grassetto solo sul dato che decide (codice, cifra, scadenza, nome), elenco solo quando i casi sono più di uno e paralleli, titolo solo se la risposta supera i due blocchi. Mai un titolo per una risposta breve, mai un elenco di un solo elemento, mai un sotto-elenco: un solo livello. Non ripetere in coda un totale già scritto e non riassumere ciò che l'utente ha appena letto.`;
