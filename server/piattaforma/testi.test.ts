// server/piattaforma/testi.test.ts
// Testo dell'invito (spec §7): funzione pura, provata qui sul testo — non
// dentro il flusso che lo invia (quello è Task 5, sopra inviaPosta di
// postaPiattaforma.ts). La FORMA della mail (documento, bottone, tema
// scuro, escaping) è di `_core/bustaEmail.ts` e ha i suoi test: qui si
// prova che cosa DICE l'invito, e che ogni cosa che deve arrivare al
// destinatario ci sia in tutt'e due le versioni.
import { describe, expect, it } from "vitest";
import { testoInvito } from "./testi";

const BASE = {
  nome: "Mario Rossi",
  azienda: "Acme S.r.l.",
  email: "mario@acme.it",
  link: "https://app.wyndoor.com/invito/abc123",
  giorni: 7,
  scadeIl: new Date("2026-09-17T10:00:00.000Z"),
  baseUrl: "https://app.wyndoor.com",
  contatto: "info@wyndoor.it",
};

describe("testoInvito — l'oggetto", () => {
  it("chiede un'azione e nomina l'azienda, con la grafia Wyndoor", () => {
    const { oggetto } = testoInvito(BASE);
    expect(oggetto).toBe("Attiva il tuo accesso a Wyndoor per Acme S.r.l.");
  });

  it("resta leggibile su mobile: la parte che conta sta nei primi 40 caratteri", () => {
    expect(testoInvito(BASE).oggetto.slice(0, 40)).toContain("Attiva il tuo accesso a Wyndoor");
  });
});

describe("testoInvito — cosa arriva al destinatario", () => {
  it("saluta per nome e dice chi ha creato l'accesso", () => {
    const { testo, html } = testoInvito(BASE);
    expect(testo).toContain("Ciao Mario Rossi");
    expect(testo).toContain("Wyndoor");
    expect(html).toContain("Ciao Mario Rossi");
  });

  it("mette azienda, indirizzo di accesso e scadenza nella scheda", () => {
    const { testo, html } = testoInvito(BASE);
    expect(testo).toContain("Azienda: Acme S.r.l.");
    expect(testo).toContain("Accesso: mario@acme.it");
    expect(html).toContain("Acme S.r.l.");
    expect(html).toContain("mario@acme.it");
  });

  it("la scadenza è una data, non solo «fra N giorni»", () => {
    const { testo, html } = testoInvito(BASE);
    expect(testo).toContain("17 settembre 2026");
    expect(html).toContain("17 settembre 2026");
  });

  it("il link vale N giorni (parametrico) e si usa una volta sola", () => {
    expect(testoInvito(BASE).testo).toContain("7 giorni");
    expect(testoInvito({ ...BASE, giorni: 3 }).testo).toContain("3 giorni");
    expect(testoInvito(BASE).testo).toContain("una volta sola");
  });

  it("avvisa di ignorare il messaggio se non atteso", () => {
    const { testo, html } = testoInvito(BASE);
    expect(testo).toContain("Se non aspettavi questo messaggio");
    expect(html).toContain("Se non aspettavi questo messaggio");
  });

  it("dice a chi rispondere quando un contatto c'è", () => {
    expect(testoInvito(BASE).testo).toContain("info@wyndoor.it");
    expect(testoInvito(BASE).html).toContain("info@wyndoor.it");
  });

  it("senza contatto non promette una risposta che nessuno leggerebbe", () => {
    const senza = testoInvito({ ...BASE, contatto: undefined });
    expect(senza.testo).not.toContain("info@wyndoor.it");
    expect(senza.html).not.toContain("info@wyndoor.it");
  });
});

describe("testoInvito — il link", () => {
  it("l'HTML lo porta come href e lo ripete in chiaro da copiare", () => {
    const { html } = testoInvito(BASE);
    expect(html).toContain(`href="${BASE.link}"`);
    expect(html).toContain(`>${BASE.link}<`);
  });

  it("la versione testo lo porta su una riga sua, intero", () => {
    expect(testoInvito(BASE).testo).toContain(BASE.link);
  });
});

describe("testoInvito — la busta", () => {
  it("è un documento HTML, non una manciata di paragrafi", () => {
    const { html } = testoInvito(BASE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="it"');
  });

  it("il marchio nasce dalla base che gli viene data, non da un dominio fisso", () => {
    const { html } = testoInvito({ ...BASE, baseUrl: "https://crm.esempio.it" });
    expect(html).toContain('src="https://crm.esempio.it/marchio-email.png"');
  });

  it("escapa nome e azienda per non lasciar passare markup", () => {
    const { html } = testoInvito({
      ...BASE,
      nome: 'Mario <b>"Rossi"</b> & C.',
      azienda: "Tende & Infissi <Srl>",
      link: "https://app.wyndoor.com/invito/xyz?token=ABC&t=1",
    });
    expect(html).not.toContain("<b>Rossi</b>");
    expect(html).toContain("Mario &lt;b&gt;&quot;Rossi&quot;&lt;/b&gt; &amp; C.");
    expect(html).toContain("Tende &amp; Infissi &lt;Srl&gt;");
    expect(html).toContain(
      'href="https://app.wyndoor.com/invito/xyz?token=ABC&amp;t=1"'
    );
  });
});
