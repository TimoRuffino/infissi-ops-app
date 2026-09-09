// server/piattaforma/testi.test.ts
// Testo dell'invito (spec §7): funzione pura, provata qui sul testo — non
// dentro il flusso che lo invia (quello è Task 5, sopra inviaPosta di
// postaPiattaforma.ts). Copre oggetto, corpo testo/HTML, la regola dei
// giorni e dell'uso singolo, la grafia «Wyndoor» e l'escaping HTML di nome e
// azienda quando contengono caratteri speciali.
import { describe, expect, it } from "vitest";
import { testoInvito } from "./testi";

const BASE = {
  nome: "Mario Rossi",
  azienda: "Acme S.r.l.",
  link: "https://app.wyndoor.com/invito/abc123",
  giorni: 7,
};

describe("testoInvito", () => {
  it("l'oggetto cita l'azienda con la grafia Wyndoor", () => {
    const { oggetto } = testoInvito(BASE);
    expect(oggetto).toBe("Il tuo accesso a Wyndoor per Acme S.r.l.");
  });

  it("il testo saluta per nome, dice chi ha creato l'accesso e porta il link", () => {
    const { testo } = testoInvito(BASE);
    expect(testo).toContain("Ciao Mario Rossi,");
    expect(testo).toContain("la piattaforma Wyndoor");
    expect(testo).toContain(BASE.azienda);
    expect(testo).toContain(BASE.link);
    expect(testo).toContain("Wyndoor");
  });

  it("il link vale N giorni (parametrico) e si usa una volta sola", () => {
    expect(testoInvito(BASE).testo).toContain("7 giorni");
    expect(testoInvito({ ...BASE, giorni: 3 }).testo).toContain("3 giorni");
    expect(testoInvito(BASE).testo).toContain("una volta sola");
  });

  it("avvisa di ignorare il messaggio se non atteso", () => {
    expect(testoInvito(BASE).testo).toContain(
      "Se non aspettavi questo messaggio, ignoralo."
    );
  });

  it("l'HTML porta il link come href e lo ripete come testo del link", () => {
    const { html } = testoInvito(BASE);
    expect(html).toContain(`href="${BASE.link}"`);
    expect(html).toContain(`>${BASE.link}<`);
  });

  it("l'HTML escapa nome e azienda per non lasciar passare markup", () => {
    const input = {
      nome: 'Mario <b>"Rossi"</b> & C.',
      azienda: "Tende & Infissi <Srl>",
      link: "https://app.wyndoor.com/invito/xyz?token=ABC&t=1",
      giorni: 7,
    };
    const { html } = testoInvito(input);
    expect(html).not.toContain("<b>Rossi</b>");
    expect(html).toContain(
      "Mario &lt;b&gt;&quot;Rossi&quot;&lt;/b&gt; &amp; C."
    );
    expect(html).toContain("Tende &amp; Infissi &lt;Srl&gt;");
    expect(html).toContain(
      'href="https://app.wyndoor.com/invito/xyz?token=ABC&amp;t=1"'
    );
  });
});
