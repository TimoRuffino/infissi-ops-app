// server/_core/bustaEmail.test.ts
// La busta delle mail di piattaforma. Funzione pura: qui si prova la BUSTA,
// non chi la manda (postaPiattaforma.test.ts) né cosa ci va dentro
// (piattaforma/testi.test.ts).
//
// Una mail non si può «guardare nel browser» dal test: quello che si può
// provare è che sia un documento vero, che il link sopravviva anche quando
// il bottone non si vede, che niente di ciò che arriva da fuori entri come
// markup, e che la versione testo dica le stesse cose della versione HTML.
import { describe, expect, it } from "vitest";
import { componiEmail } from "./bustaEmail";

const BASE = {
  titolo: "Il tuo accesso è pronto",
  preheader: "Scegli la password e sei dentro.",
  saluto: "Ciao Mario",
  paragrafi: ["Prima riga del corpo.", "Seconda riga del corpo."],
  scheda: [
    { voce: "Azienda", valore: "Acme S.r.l." },
    { voce: "Accesso", valore: "mario@acme.it" },
  ],
  azione: {
    etichetta: "Scegli la password",
    href: "https://app.wyndoor.com/invito/abc123",
  },
  note: ["Il link vale 7 giorni."],
  contatto: "info@wyndoor.it",
  baseUrl: "https://app.wyndoor.com",
};

describe("componiEmail — il documento", () => {
  it("è un documento HTML italiano con la codifica dichiarata", () => {
    const { html } = componiEmail(BASE);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="it"');
    expect(html).toContain('charset="utf-8"');
  });

  it("porta il titolo nel <title>, dove il client lo cerca", () => {
    expect(componiEmail(BASE).html).toContain(
      "<title>Il tuo accesso è pronto</title>"
    );
  });

  it("dichiara i due schemi di colore invece di lasciar invertire a caso", () => {
    const { html } = componiEmail(BASE);
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toMatch(/prefers-color-scheme\s*:\s*dark/);
  });

  it("tiene il corpo dentro i 600 px come TETTO: sotto, si restringe", () => {
    const { html } = componiEmail(BASE);
    // `width:600px` fisso non si restringe mai: su un telefono la mail
    // uscirebbe dallo schermo di lato. Fluida con un tetto, e il 600 fisso
    // solo dentro la tabella condizionale per Outlook.
    expect(html).toContain("width:100%;max-width:600px");
    expect(html).not.toMatch(/[^-]width:600px/);
    expect(html).toContain(
      '<!--[if mso]><table role="presentation" width="600"'
    );
  });
});

describe("componiEmail — il preheader", () => {
  it("mette il preheader dove la casella legge l'anteprima", () => {
    expect(componiEmail(BASE).html).toContain(BASE.preheader);
  });

  it("lo nasconde nel corpo: è per l'elenco dei messaggi, non per la pagina", () => {
    const html = componiEmail(BASE).html;
    const riga = html.split("\n").find(r => r.includes(BASE.preheader)) ?? "";
    expect(riga).toMatch(/display\s*:\s*none/);
  });
});

describe("componiEmail — l'azione", () => {
  it("il bottone punta al link", () => {
    expect(componiEmail(BASE).html).toContain(`href="${BASE.azione.href}"`);
  });

  it("ripete il link in chiaro: un bottone che non si vede non si copia", () => {
    const { html } = componiEmail(BASE);
    // Due volte: nel bottone e nel ripiego sotto.
    const quante = html.split(BASE.azione.href).length - 1;
    expect(quante).toBeGreaterThanOrEqual(2);
  });

  it("porta la versione Outlook del bottone, che ignora border-radius e padding", () => {
    const { html } = componiEmail(BASE);
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("v:roundrect");
  });

  it("senza azione non inventa né bottone né ripiego", () => {
    const { html, testo } = componiEmail({ ...BASE, azione: undefined });
    expect(html).not.toContain("v:roundrect");
    expect(testo).not.toContain("http");
  });

  it("rifiuta un indirizzo che non sia http o https", () => {
    expect(() =>
      componiEmail({
        ...BASE,
        azione: { etichetta: "Vai", href: "javascript:alert(1)" },
      })
    ).toThrow();
  });
});

describe("componiEmail — niente markup da fuori", () => {
  it("escapa titolo, saluto, paragrafi e scheda", () => {
    const { html } = componiEmail({
      ...BASE,
      titolo: "Tende & Infissi <Srl>",
      saluto: 'Ciao <b>"Mario"</b>',
      paragrafi: ["<script>alert(1)</script>"],
      scheda: [{ voce: "Azienda", valore: "A & B <spa>" }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("Tende &amp; Infissi &lt;Srl&gt;");
    expect(html).toContain("A &amp; B &lt;spa&gt;");
  });

  it("escapa l'indirizzo del bottone: la base può nascere dall'header Host", () => {
    const { html } = componiEmail({
      ...BASE,
      azione: {
        etichetta: "Vai",
        href: 'https://app.wyndoor.com/invito/x?a=1&b="2',
      },
    });
    expect(html).toContain(
      'href="https://app.wyndoor.com/invito/x?a=1&amp;b=&quot;2"'
    );
    expect(html).not.toContain('b="2"');
  });
});

describe("componiEmail — il marchio", () => {
  it("mostra le due ante dal dominio dell'app", () => {
    const { html } = componiEmail(BASE);
    expect(html).toContain('src="https://app.wyndoor.com/marchio-email.png"');
  });

  it("il segno è decorativo: la parola accanto è testo, non alt", () => {
    const { html } = componiEmail(BASE);
    // Con `alt="Wyndoor"` un client che blocca le immagini scriverebbe
    // «Wyndoor Wyndoor»: la parola c'è già come testo vivo.
    expect(html).toContain('alt=""');
    expect(html).not.toContain('alt="Wyndoor"');
    expect(html).toContain(">Wyndoor</td>");
  });

  it("una barra finale nella base non raddoppia nell'indirizzo dell'immagine", () => {
    const { html } = componiEmail({
      ...BASE,
      baseUrl: "https://app.wyndoor.com/",
    });
    expect(html).toContain('src="https://app.wyndoor.com/marchio-email.png"');
    expect(html).not.toContain("com//marchio-email.png");
  });
});

describe("componiEmail — la versione testo", () => {
  it("dice le stesse cose senza un solo tag", () => {
    const { testo } = componiEmail(BASE);
    expect(testo).toContain("Ciao Mario");
    expect(testo).toContain("Il tuo accesso è pronto");
    expect(testo).toContain("Prima riga del corpo.");
    expect(testo).toContain("Azienda: Acme S.r.l.");
    expect(testo).toContain(BASE.azione.href);
    expect(testo).toContain("Il link vale 7 giorni.");
    expect(testo).not.toMatch(/<[a-z/]/i);
  });

  it("nella versione testo niente entità HTML: & resta &", () => {
    const { testo } = componiEmail({
      ...BASE,
      scheda: [{ voce: "Azienda", valore: "Tende & Infissi" }],
    });
    expect(testo).toContain("Tende & Infissi");
    expect(testo).not.toContain("&amp;");
  });
});

describe("componiEmail — il piede", () => {
  it("mostra il contatto quando c'è, in HTML e in testo", () => {
    const { html, testo } = componiEmail(BASE);
    expect(html).toContain("info@wyndoor.it");
    expect(testo).toContain("info@wyndoor.it");
  });

  it("senza contatto non lascia un piede monco", () => {
    const { html, testo } = componiEmail({ ...BASE, contatto: undefined });
    expect(html).not.toContain("info@wyndoor.it");
    expect(testo).not.toContain("info@wyndoor.it");
    expect(testo).toContain("Wyndoor");
  });
});
