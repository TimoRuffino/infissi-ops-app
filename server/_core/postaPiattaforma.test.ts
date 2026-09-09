// server/_core/postaPiattaforma.test.ts
// Mittente transazionale della piattaforma (spec §7): senza RESEND_API_KEY
// non lancia mai; con la chiave fa una POST a Resend; ogni fallimento — HTTP
// non 2xx o rete rotta — torna { inviato: false, motivo } senza scrivere
// indirizzo, oggetto o corpo nel log, solo il dominio del destinatario.
// La rete non locale è vietata da testSetup.ts: il mittente vero si prova
// rimpiazzando global.fetch, convenzione di driveBackup.test.ts:68-162.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __impostaPostaPerTest,
  inviaPosta,
  postaConfigurata,
} from "./postaPiattaforma";

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.POSTA_PIATTAFORMA_MITTENTE;
  __impostaPostaPerTest(null);
  vi.restoreAllMocks();
});

const messaggio = { a: "mario@acme.test", oggetto: "Prova", testo: "ciao" };

describe("inviaPosta", () => {
  it("senza chiave: non configurata, non lancia", async () => {
    expect(postaConfigurata()).toBe(false);
    expect(await inviaPosta(messaggio)).toEqual({
      inviato: false,
      motivo: expect.stringContaining("non configurata"),
    });
  });

  it("con chiave: POST a Resend con mittente, destinatario e testo", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 })
    );
    global.fetch = fetchMock as any;

    expect(await inviaPosta(messaggio)).toEqual({ inviato: true, id: "em_1" });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body)).toMatchObject({
      from: "Wyndoor <no-reply@wyndoor.com>",
      to: ["mario@acme.test"],
      subject: "Prova",
      text: "ciao",
    });
  });

  it("4xx e rete rotta: inviato false con motivo, senza corpo nel log", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "segreto" }), { status: 422 })
    ) as any;
    expect(await inviaPosta(messaggio)).toEqual({
      inviato: false,
      motivo: "Resend ha risposto 422",
    });

    global.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as any;
    expect((await inviaPosta(messaggio)).inviato).toBe(false);

    const loggato = warn.mock.calls.flat().join(" ");
    expect(loggato).not.toContain("segreto");
    expect(loggato).not.toContain("mario@acme.test");
    expect(loggato).toContain("acme.test");
  });
});
