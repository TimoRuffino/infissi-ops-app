// server/piattaforma/testi.ts
// Testo dell'invito (spec §7): funzione pura, nessuno store, nessuna rete —
// solo la busta che Task 5 passa a inviaPosta di
// server/_core/postaPiattaforma.ts. Stessa separazione di accesso.ts fra la
// regola pura e chi la applica: qui si prova solo il testo.

/** Escapa i cinque caratteri che aprono markup HTML; le virgolette servono
 *  per il testo dentro l'attributo href. */
const esc = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  );

/**
 * Oggetto, corpo testo e corpo HTML dell'invito (spec §7): saluto per nome,
 * chi ha creato l'accesso («la piattaforma Wyndoor»), il link, la regola dei
 * `giorni` di validità e dell'uso singolo. `nome` e `azienda` sono escapati
 * nella versione HTML; la versione testo resta piana.
 */
export function testoInvito(input: {
  nome: string;
  azienda: string;
  link: string;
  giorni: number;
}): { oggetto: string; testo: string; html: string } {
  const oggetto = `Il tuo accesso a Wyndoor per ${input.azienda}`;

  const testo = [
    `Ciao ${input.nome},`,
    ``,
    `la piattaforma Wyndoor ha creato per te l'accesso all'azienda ${input.azienda}.`,
    `Scegli la tua password da qui:`,
    input.link,
    ``,
    `Il link vale ${input.giorni} giorni e si usa una volta sola. Se non aspettavi questo messaggio, ignoralo.`,
    ``,
    `Wyndoor`,
  ].join("\n");

  const html =
    `<p>Ciao ${esc(input.nome)},</p>` +
    `<p>la piattaforma Wyndoor ha creato per te l'accesso all'azienda ` +
    `<strong>${esc(input.azienda)}</strong>. Scegli la tua password da qui:</p>` +
    `<p><a href="${esc(input.link)}">${esc(input.link)}</a></p>` +
    `<p>Il link vale ${input.giorni} giorni e si usa una volta sola. Se non aspettavi questo messaggio, ignoralo.</p>` +
    `<p>Wyndoor</p>`;

  return { oggetto, testo, html };
}
