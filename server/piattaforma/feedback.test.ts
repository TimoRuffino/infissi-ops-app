// server/piattaforma/feedback.test.ts
// La segnalazione di un'azienda: dove arriva, che cosa porta con sé, che
// cosa rifiuta. Il mittente vero non parte mai (`__impostaPostaPerTest`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessaggioPosta } from "../_core/postaPiattaforma";
import { __impostaPostaPerTest } from "../_core/postaPiattaforma";
import { MESSAGGI_FEEDBACK } from "./costanti";
import {
  byteDaBase64,
  componiFeedback,
  destinatarioFeedback,
  inviaFeedback,
  paginaSicura,
  riassunto,
  type ContestoFeedback,
} from "./feedback";
import { __azzeraLimiteFeedbackPerTest, feedbackRouter } from "./feedbackRouter";

const contesto = (extra: Partial<ContestoFeedback> = {}): ContestoFeedback => ({
  azienda: { id: 2, nome: "Serramenti Però", stato: "attivo" },
  sede: "Torino",
  utente: { nome: "Mara Bini", email: "mara@serramenti.test", ruoli: ["direzione"] },
  pagina: "/commesse/12",
  browser: "Mozilla/5.0 (Macintosh)",
  baseUrl: "https://app.wyndoor.com",
  inviatoIl: new Date("2026-09-10T09:30:00Z"),
  ...extra,
});

/** L'ultima busta consegnata al mittente finto. */
let spedite: MessaggioPosta[] = [];

beforeEach(() => {
  spedite = [];
  process.env.RESEND_API_KEY = "re_test";
  __impostaPostaPerTest(async m => {
    spedite.push(m);
    return { inviato: true, id: "em_feedback" };
  });
  __azzeraLimiteFeedbackPerTest();
});

afterEach(() => {
  __impostaPostaPerTest(null);
  delete process.env.RESEND_API_KEY;
  delete process.env.POSTA_FEEDBACK;
  vi.restoreAllMocks();
});

describe("destinatarioFeedback", () => {
  it("è supporto@wyndoor.com, e POSTA_FEEDBACK lo sposta", () => {
    expect(destinatarioFeedback()).toBe("supporto@wyndoor.com");
    process.env.POSTA_FEEDBACK = " assistenza@wyndoor.com ";
    expect(destinatarioFeedback()).toBe("assistenza@wyndoor.com");
  });
});

describe("regole d'ingresso", () => {
  it("byteDaBase64 conta i byte veri, riempimento compreso", () => {
    expect(byteDaBase64("")).toBe(0);
    expect(byteDaBase64(Buffer.from("abc").toString("base64"))).toBe(3);
    expect(byteDaBase64(Buffer.from("abcd").toString("base64"))).toBe(4);
    expect(byteDaBase64(Buffer.alloc(1500).toString("base64"))).toBe(1500);
  });

  it("paginaSicura tiene solo un cammino interno", () => {
    expect(paginaSicura("/commesse/12?tab=fatture")).toBe("/commesse/12?tab=fatture");
    expect(paginaSicura("  ")).toBeNull();
    expect(paginaSicura("javascript:alert(1)")).toBeNull();
    expect(paginaSicura("https://altrove.test/rubata")).toBeNull();
    // `//host` in un href vale «stesso schema, altro dominio».
    expect(paginaSicura("//altrove.test/rubata")).toBeNull();
  });

  it("riassunto prende la prima riga e la accorcia", () => {
    expect(riassunto("non si apre\naltra riga")).toBe("non si apre");
    // Una parola sola lunghissima si tronca; una frase si taglia sullo spazio.
    expect(riassunto("a".repeat(100))).toHaveLength(70);
    expect(riassunto("Salvo la conferma d'ordine di Oknoplast e la commessa resta senza costo")).toBe(
      "Salvo la conferma d'ordine di Oknoplast e la commessa resta senza…"
    );
  });
});

describe("componiFeedback", () => {
  it("oggetto: tipo, azienda e prima riga", () => {
    const busta = componiFeedback({
      tipo: "bug",
      testo: "Il fascicolo non si apre\ndopo il salvataggio",
      contesto: contesto(),
    });
    expect(busta.oggetto).toBe(
      "[Wyndoor] Bug · Serramenti Però · Il fascicolo non si apre"
    );
  });

  it("il consiglio ha il suo titolo", () => {
    const busta = componiFeedback({
      tipo: "consiglio",
      testo: "Servirebbe un filtro per fornitore",
      contesto: contesto(),
    });
    expect(busta.oggetto).toContain("[Wyndoor] Consiglio ·");
    expect(busta.html).toContain("Un consiglio dal campo");
  });

  it("porta con sé il contesto che chi segnala non scrive mai", () => {
    const busta = componiFeedback({
      tipo: "bug",
      testo: "Il fascicolo non si apre",
      contesto: contesto(),
    });
    for (const atteso of [
      "Serramenti Però (#2, attivo)",
      "Torino",
      "Mara Bini",
      "mara@serramenti.test",
      "/commesse/12",
      "Mozilla/5.0 (Macintosh)",
      "10 settembre 2026",
    ]) {
      expect(busta.testo).toContain(atteso);
    }
    // Il collegamento alla pagina esatta, costruito sulla base dell'app.
    expect(busta.html).toContain("https://app.wyndoor.com/commesse/12");
  });

  it("senza sede, pagina e browser la scheda non inventa righe vuote", () => {
    const busta = componiFeedback({
      tipo: "bug",
      testo: "Succede sempre",
      contesto: contesto({ sede: null, pagina: null, browser: null }),
    });
    expect(busta.testo).not.toContain("Sede");
    expect(busta.testo).not.toContain("Pagina");
    expect(busta.html).not.toContain("Apri la pagina");
  });

  it("il testo di chi segnala non diventa markup", () => {
    const busta = componiFeedback({
      tipo: "bug",
      testo: "Rotto <script>alert(1)</script> qui",
      contesto: contesto(),
    });
    expect(busta.html).not.toContain("<script>alert(1)</script>");
    expect(busta.html).toContain("&lt;script&gt;");
  });

  it("nomina l'allegato solo quando c'è", () => {
    const con = componiFeedback({ tipo: "bug", testo: "Guarda qui", contesto: contesto(), conImmagine: true });
    const senza = componiFeedback({ tipo: "bug", testo: "Guarda qui", contesto: contesto() });
    expect(con.testo).toContain("In allegato");
    expect(senza.testo).not.toContain("In allegato");
  });
});

describe("inviaFeedback", () => {
  const immagine = {
    nome: "schermata.png",
    tipo: "image/png",
    contenutoBase64: Buffer.from("finta-immagine").toString("base64"),
  };

  it("spedisce a supporto con reply_to di chi scrive e l'immagine allegata", async () => {
    await expect(
      inviaFeedback({ tipo: "bug", testo: "Non si apre", contesto: contesto(), immagine })
    ).resolves.toEqual({ inviato: true });

    expect(spedite).toHaveLength(1);
    const busta = spedite[0]!;
    expect(busta.a).toBe("supporto@wyndoor.com");
    expect(busta.rispostaA).toBe("mara@serramenti.test");
    expect(busta.allegati).toEqual([
      { nome: "schermata.png", contenutoBase64: immagine.contenutoBase64, tipo: "image/png" },
    ]);
  });

  it("senza immagine non passa nessun allegato", async () => {
    await inviaFeedback({ tipo: "consiglio", testo: "Un filtro in più", contesto: contesto() });
    expect(spedite[0]!.allegati).toBeUndefined();
  });

  it("rifiuta un tipo di file non ammesso e un'immagine oltre 2 MB", async () => {
    await expect(
      inviaFeedback({
        tipo: "bug",
        testo: "Ecco",
        contesto: contesto(),
        immagine: { ...immagine, nome: "conti.pdf", tipo: "application/pdf" },
      })
    ).rejects.toMatchObject({ message: MESSAGGI_FEEDBACK.immagineNonValida });

    await expect(
      inviaFeedback({
        tipo: "bug",
        testo: "Ecco",
        contesto: contesto(),
        immagine: { ...immagine, contenutoBase64: Buffer.alloc(2 * 1024 * 1024 + 10).toString("base64") },
      })
    ).rejects.toMatchObject({ message: MESSAGGI_FEEDBACK.immagineTroppoGrande });

    expect(spedite).toHaveLength(0);
  });

  it("senza RESEND_API_KEY lo dice invece di fingere l'invio", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      inviaFeedback({ tipo: "bug", testo: "Non si apre", contesto: contesto() })
    ).rejects.toMatchObject({ message: MESSAGGI_FEEDBACK.nonConfigurato });
    expect(spedite).toHaveLength(0);
  });

  it("un invio fallito arriva a chi ha scritto, senza il dettaglio del fornitore", async () => {
    __impostaPostaPerTest(async () => ({ inviato: false, motivo: "Resend ha risposto 402" }));
    await expect(
      inviaFeedback({ tipo: "bug", testo: "Non si apre", contesto: contesto() })
    ).rejects.toMatchObject({ message: MESSAGGI_FEEDBACK.nonRiuscito });
    await expect(
      inviaFeedback({ tipo: "bug", testo: "Non si apre", contesto: contesto() })
    ).rejects.not.toMatchObject({ message: expect.stringContaining("402") });
  });

  it("nel log finisce il dominio, mai il testo né l'indirizzo intero", async () => {
    const righe: string[] = [];
    vi.spyOn(console, "log").mockImplementation(m => void righe.push(String(m)));
    vi.spyOn(console, "warn").mockImplementation(m => void righe.push(String(m)));
    await inviaFeedback({
      tipo: "bug",
      testo: "La password del cliente è finita nel campo sbagliato",
      contesto: contesto(),
    });
    const tutto = righe.join("\n");
    expect(tutto).toContain("[posta] invio a wyndoor.com: ok");
    expect(tutto).not.toContain("password del cliente");
    expect(tutto).not.toContain("supporto@wyndoor.com");
    expect(tutto).not.toContain("mara@serramenti.test");
  });
});

describe("feedbackRouter", () => {
  const ctx = (extra: Record<string, unknown> = {}) =>
    ({
      req: {
        ip: "203.0.113.9",
        protocol: "https",
        get: (nome: string) => (nome === "user-agent" ? "Mozilla/5.0 (Test)" : "app.wyndoor.com"),
      },
      res: {},
      user: { id: 7, name: "Mara Bini", email: "mara@serramenti.test", ruoli: ["direzione"] },
      tenantId: 1,
      tenant: null,
      sedeId: null,
      sediIds: [],
      ...extra,
    }) as any;

  it("una segnalazione parte e porta l'azienda della sessione", async () => {
    const caller = feedbackRouter.createCaller(ctx());
    await expect(
      caller.invia({ tipo: "bug", testo: "Il fascicolo non si apre mai" })
    ).resolves.toEqual({ ok: true });
    expect(spedite[0]!.a).toBe("supporto@wyndoor.com");
    expect(spedite[0]!.testo).toContain("Ruffino Group");
    expect(spedite[0]!.testo).toContain("Mozilla/5.0 (Test)");
  });

  it("un anonimo non passa", async () => {
    const caller = feedbackRouter.createCaller(ctx({ user: null }));
    await expect(
      caller.invia({ tipo: "bug", testo: "Il fascicolo non si apre" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("un testo troppo corto non parte", async () => {
    const caller = feedbackRouter.createCaller(ctx());
    await expect(caller.invia({ tipo: "bug", testo: "rotto" })).rejects.toThrow();
    expect(spedite).toHaveLength(0);
  });

  it("cinque all'ora per persona, poi si aspetta", async () => {
    const caller = feedbackRouter.createCaller(ctx());
    for (let i = 0; i < 5; i++) {
      await caller.invia({ tipo: "consiglio", testo: `Segnalazione numero ${i} del giorno` });
    }
    await expect(
      caller.invia({ tipo: "consiglio", testo: "La sesta della stessa ora" })
    ).rejects.toMatchObject({ message: MESSAGGI_FEEDBACK.troppiInvii });
    expect(spedite).toHaveLength(5);
  });
});
