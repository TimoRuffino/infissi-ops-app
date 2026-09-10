// server/piattaforma/testi.ts
// Le PAROLE dell'invito (spec §7): funzione pura, nessuno store, nessuna
// rete — solo la busta che Task 5 passa a inviaPosta di
// server/_core/postaPiattaforma.ts. Stessa separazione di accesso.ts fra la
// regola pura e chi la applica: qui si prova solo il testo.
//
// La FORMA (documento HTML, marchio, bottone, tema scuro, escaping) sta in
// `_core/bustaEmail.ts` e vale per ogni mail di piattaforma: questo file
// decide che cosa dire, non come farlo apparire. Il confine tiene se qui
// non compare un solo tag.
import { componiEmail } from "../_core/bustaEmail";

/**
 * La scadenza per esteso: «17 settembre 2026». Non «17/09/2026», che in una
 * casella inglese si legge come il 9 di luglio, e non «fra 7 giorni», che è
 * vero solo il giorno in cui la mail parte — chi la apre il quinto giorno
 * non ha modo di sapere quanto gli resta. Il fuso è quello dell'azienda che
 * riceve, non quello del server.
 */
const dataPerEsteso = (istante: Date): string =>
  new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome",
  }).format(istante);

/**
 * Oggetto, corpo testo e corpo HTML dell'invito (spec §7).
 *
 * L'oggetto chiede un'azione e nomina l'azienda: «Attiva il tuo accesso a
 * Wyndoor per <Azienda>». Chi lo riceve non ci ha mai parlato prima — un
 * oggetto descrittivo, in una casella piena, non si distingue da una
 * comunicazione di servizio, e i primi 40 caratteri sono tutto ciò che si
 * vede su un telefono.
 *
 * Nella scheda finiscono le tre cose che il destinatario deve sapere e che
 * non ricorderà: quale azienda, con quale indirizzo entra (è il suo nome
 * utente, non un dettaglio) e fino a quando vale il link.
 *
 * `contatto` è l'indirizzo a cui rispondere. Assente, il piede non promette
 * una risposta che nessuno leggerebbe: il mittente è un `no-reply`.
 */
export function testoInvito(input: {
  nome: string;
  azienda: string;
  /** L'indirizzo con cui entrerà: nella scheda, perché è il suo nome utente. */
  email: string;
  link: string;
  giorni: number;
  scadeIl: Date;
  /** La base dell'app, da cui la busta ricava il marchio. */
  baseUrl: string;
  contatto?: string;
}): { oggetto: string; testo: string; html: string } {
  const { html, testo } = componiEmail({
    // Senza «Wyndoor»: la parola è già nel marchio sopra, nell'oggetto e
    // nella riga sotto. Tre volte in quattro righe si notano.
    titolo: "Il tuo accesso è pronto",
    preheader: `Scegli la password ed entri subito. Il link vale ${input.giorni} giorni.`,
    saluto: `Ciao ${input.nome}`,
    paragrafi: [
      `La piattaforma Wyndoor ha creato l'accesso di ${input.azienda} e questo invito è per te: scegli una password ed entri subito.`,
      `Da dentro colleghi la fatturazione, il backup e la posta quando vuoi: al primo ingresso te li propone uno alla volta, e ogni passo si può saltare.`,
    ],
    scheda: [
      { voce: "Azienda", valore: input.azienda },
      { voce: "Accesso", valore: input.email },
      { voce: "Valido", valore: `fino al ${dataPerEsteso(input.scadeIl)}` },
    ],
    azione: { etichetta: "Scegli la password", href: input.link },
    note: [
      `Il link vale ${input.giorni} giorni e si usa una volta sola.`,
      `Se non aspettavi questo messaggio, ignoralo: senza questo link nessuno entra.`,
    ],
    contatto: input.contatto,
    baseUrl: input.baseUrl,
  });

  return {
    oggetto: `Attiva il tuo accesso a Wyndoor per ${input.azienda}`,
    testo,
    html,
  };
}
