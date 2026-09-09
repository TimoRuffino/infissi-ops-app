import { describe, expect, it } from "vitest";
import { traduciErroreMeta } from "./whatsapp";

// Chi ha «già WhatsApp Business» spesso ha già provato anche qualcos'altro.
// L'errore di Meta in quel caso è incomprensibile e, soprattutto, non dice
// la cosa che serve: il numero va staccato dall'altra piattaforma PRIMA.
describe("errori Meta tradotti", () => {
  const giaAltrove = [
    "Phone number is already registered on WhatsApp Business API",
    "The phone number you are trying to register is already in use",
    "(#133005) Phone number already exists in another WhatsApp Business Account",
    "Phone number already registered to another WABA",
  ];

  for (const grezzo of giaAltrove) {
    it(`riconosce «${grezzo.slice(0, 40)}…» come numero già collegato altrove`, () => {
      const t = traduciErroreMeta(grezzo);
      expect(t).toMatch(/altra piattaforma|già collegato/i);
      expect(t).toMatch(/stacca|scollega/i);
      // Il messaggio di Meta non deve trapelare: è inglese e non aiuta.
      expect(t).not.toMatch(/already|register/i);
    });
  }

  it("il numero non è sull'app Business: lo dice, invece di parlare di WABA", () => {
    const t = traduciErroreMeta("This phone number is not associated with a WhatsApp Business app account");
    expect(t).toMatch(/WhatsApp Business/);
    expect(t).toMatch(/telefono/i);
  });

  it("PIN della verifica in due passaggi: rimedio concreto", () => {
    const t = traduciErroreMeta("(#133005) Two-step verification PIN mismatch");
    expect(t).toMatch(/verifica in due passaggi|PIN/i);
    expect(t).not.toMatch(/mismatch/i);
  });

  it("un errore che non conosciamo passa, ma dentro una frase che si capisce", () => {
    const t = traduciErroreMeta("Some unmapped Graph failure 12345");
    expect(t).toMatch(/WhatsApp/);
    // Qui il testo originale SERVE: è l'unico indizio per l'assistenza.
    expect(t).toContain("Some unmapped Graph failure 12345");
  });

  it("un errore vuoto non produce una frase monca", () => {
    expect(traduciErroreMeta("")).toMatch(/WhatsApp/);
    expect(traduciErroreMeta("").trim()).not.toMatch(/:$/);
  });
});
