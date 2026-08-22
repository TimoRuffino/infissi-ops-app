// Test della parte deterministica dell'ingestione posta: cifratura dei
// segreti, aggancio mail→commessa, idempotenza dell'insert.
//
// Il giro IMAP vero non è coperto qui: richiede un server. Quello che conta
// è che le regole di aggancio siano prevedibili e che rileggere la stessa
// casella non duplichi nulla.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
  secretBoxConfigured,
} from "../_core/secretBox";
import { estraiCodiceCommessa, matchComunicazione } from "./match";
import {
  deleteComunicazione,
  escapeRicercaWhatsApp,
  getComunicazione,
  getThreadWhatsApp,
  insertComunicazione,
  listComunicazioni,
  listConversazioniWhatsApp,
  listDaAnalizzare,
  markAnalizzate,
  normalizzaControparteWhatsApp,
  setClassificazioneComunicazione,
  setMatchComunicazione,
  setStatoComunicazione,
  segnaTutteViste,
  statsComunicazioni,
  _resetComunicazioniInMemoria,
} from "./comunicazioni";
import { getClientiStore } from "../routers/clienti";

const CLIENTI = [
  { id: 1, nome: "Mario", cognome: "Rossi", email: "mario.rossi@example.com" },
  { id: 2, nome: "Anna", cognome: "Verdi", email: "anna.verdi@example.com" },
  { id: 3, nome: " ", cognome: "Condominio Aurora", email: null },
];

const COMMESSE = [
  {
    id: 10,
    codice: "COM-2026-035",
    clienteId: 1,
    stato: "produzione",
    email: null,
  },
  {
    id: 11,
    codice: "COM-2026-051",
    clienteId: 2,
    stato: "attesa_posa",
    email: "cantiere@example.com",
  },
  {
    id: 12,
    codice: "COM-2026-052",
    clienteId: 2,
    stato: "preventivo",
    email: null,
  },
  {
    id: 13,
    codice: "COM-2025-001",
    clienteId: 1,
    stato: "archiviata",
    email: null,
    archivedAt: new Date(),
  },
];

describe("secretBox", () => {
  const prev = process.env.MAIL_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.MAIL_ENCRYPTION_KEY = "chiave-di-test-non-usare-in-produzione";
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.MAIL_ENCRYPTION_KEY;
    else process.env.MAIL_ENCRYPTION_KEY = prev;
  });

  it("cifra e decifra restituendo il valore originale", () => {
    expect(secretBoxConfigured()).toBe(true);
    const segreto = "p@ssw0rd della casella";
    const cifrato = encryptSecret(segreto);
    expect(cifrato).not.toContain(segreto);
    expect(isEncrypted(cifrato)).toBe(true);
    expect(decryptSecret(cifrato)).toBe(segreto);
  });

  it("due cifrature dello stesso testo differiscono (IV casuale)", () => {
    expect(encryptSecret("uguale")).not.toBe(encryptSecret("uguale"));
  });

  it("rifiuta un testo cifrato manomesso", () => {
    const cifrato = encryptSecret("segreto");
    const parti = cifrato.split(".");
    // Altera il ciphertext lasciando intatto il tag: GCM deve accorgersene.
    const manomesso = [
      parti[0],
      parti[1],
      parti[2],
      Buffer.from("altro").toString("base64"),
    ].join(".");
    expect(() => decryptSecret(manomesso)).toThrow();
  });

  it("rifiuta un formato sconosciuto", () => {
    expect(() => decryptSecret("password-in-chiaro")).toThrow(/formato/);
  });
});

describe("estraiCodiceCommessa", () => {
  it("riconosce le varianti di punteggiatura", () => {
    expect(estraiCodiceCommessa("rif. COM-2026-035 grazie")).toBe(
      "COM-2026-035"
    );
    expect(estraiCodiceCommessa("COM 2026 35")).toBe("COM-2026-035");
    expect(estraiCodiceCommessa("com_2026_035")).toBe("COM-2026-035");
  });
  it("non inventa codici", () => {
    expect(estraiCodiceCommessa("nessun riferimento qui")).toBeNull();
    expect(estraiCodiceCommessa("COMPLIMENTI 2026")).toBeNull();
  });
});

describe("matchComunicazione", () => {
  const base = { clienti: CLIENTI as any, commesse: COMMESSE as any };

  it("il codice nel testo vince su tutto, con confidenza alta", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "sconosciuto@fornitore.it",
      oggetto: "Conferma ordine",
      testo: "In riferimento alla COM-2026-035 confermiamo la merce.",
    });
    expect(m.commessaId).toBe(10);
    expect(m.clienteId).toBe(1);
    expect(m.confidenza).toBe("alta");
  });

  it("mittente cliente con una sola commessa attiva → aggancio pieno", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "Mario.Rossi@Example.com",
      oggetto: "Domanda",
      testo: "Buongiorno, a che punto siamo?",
    });
    expect(m.clienteId).toBe(1);
    expect(m.commessaId).toBe(10); // la 13 è archiviata, non conta
    expect(m.confidenza).toBe("alta");
  });

  it("cliente con più commesse attive: aggancia il cliente, non indovina la commessa", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "anna.verdi@example.com",
      oggetto: "Aggiornamento",
      testo: "Ci sono novità?",
    });
    expect(m.clienteId).toBe(2);
    expect(m.commessaId).toBeNull();
    expect(m.confidenza).toBe("media");
    expect(m.motivo).toMatch(/COM-2026-051.*COM-2026-052/);
  });

  it("email di contatto della commessa", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "cantiere@example.com",
      oggetto: "Accesso al cantiere",
      testo: "Il cancello è aperto dalle 8.",
    });
    expect(m.commessaId).toBe(11);
    expect(m.confidenza).toBe("media");
  });

  it("codice citato ma inesistente: lo dice invece di tacere", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "tizio@altro.it",
      oggetto: "COM-2026-999",
      testo: "vedi oggetto",
    });
    expect(m.commessaId).toBeNull();
    expect(m.confidenza).toBe("bassa");
    expect(m.motivo).toMatch(/non corrisponde/);
  });

  it("mai una commessa archiviata", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "x@y.it",
      oggetto: "vecchia pratica",
      testo: "riferimento COM-2025-001",
    });
    expect(m.commessaId).toBeNull();
  });

  it("nessun indizio → nessun aggancio", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "newsletter@spam.it",
      oggetto: "Offerta imperdibile",
      testo: "Compra ora!",
    });
    expect(m.confidenza).toBe("nessuna");
    expect(m.clienteId).toBeNull();
    expect(m.commessaId).toBeNull();
  });

  it("cognome lungo e univoco nell'oggetto: aggancio ma dichiarato incerto", () => {
    const m = matchComunicazione({
      ...base,
      mittente: "studio@architetti.it",
      oggetto: "Preventivo Condominio Aurora",
      testo: "In allegato la richiesta.",
    });
    expect(m.clienteId).toBe(3);
    expect(m.confidenza).toBe("bassa");
  });
});

describe("ingestione comunicazioni", () => {
  beforeAll(() => _resetComunicazioniInMemoria());

  const nuova = (messageId: string, oggetto: string) => ({
    sedeId: 1,
    casellaId: 1,
    messageId,
    canale: "email" as const,
    direzione: "in" as const,
    mittente: "mario.rossi@example.com",
    mittenteNome: "Mario Rossi",
    destinatari: ["ordini@ruffinogroup.it"],
    oggetto,
    testo: "corpo del messaggio",
    allegati: [],
    clienteId: 1,
    commessaId: 10,
    matchConfidenza: "alta" as const,
    matchMotivo: "test",
    stato: "nuova" as const,
    receivedAt: new Date("2026-08-06T10:00:00Z"),
  });

  it("inserisce e poi ignora il duplicato sullo stesso message_id", async () => {
    const prima = await insertComunicazione(
      nuova("<abc@example.com>", "Prima")
    );
    expect(prima).not.toBeNull();

    const doppia = await insertComunicazione(
      nuova("<abc@example.com>", "Prima")
    );
    expect(doppia).toBeNull();

    const rows = await listComunicazioni({ sedeId: 1 });
    expect(rows).toHaveLength(1);
  });

  it("la stessa mail su una casella diversa è un'altra riga", async () => {
    const altra = await insertComunicazione({
      ...nuova("<abc@example.com>", "Prima"),
      casellaId: 2,
    });
    expect(altra).not.toBeNull();
  });

  it("filtra per commessa e per non collegate", async () => {
    await insertComunicazione({
      ...nuova("<sciolta@example.com>", "Senza commessa"),
      commessaId: null,
      clienteId: null,
      matchConfidenza: "nessuna",
    });
    const perCommessa = await listComunicazioni({ sedeId: 1, commessaId: 10 });
    expect(perCommessa.every(c => c.commessaId === 10)).toBe(true);

    const sciolte = await listComunicazioni({
      sedeId: 1,
      soloNonCollegate: true,
    });
    expect(sciolte).toHaveLength(1);
    expect(sciolte[0].oggetto).toBe("Senza commessa");
  });

  it("non mostra le comunicazioni di un'altra sede", async () => {
    await insertComunicazione({
      ...nuova("<altrasede@example.com>", "Altra sede"),
      sedeId: 2,
    });
    const sede1 = await listComunicazioni({ sedeId: 1 });
    expect(sede1.some(c => c.oggetto === "Altra sede")).toBe(false);
  });

  it("separa offerte e spam dalla coda e dai contatori operativi", async () => {
    const offerta = await insertComunicazione({
      ...nuova("<offerta-esclusa@example.com>", "Offerte speciali di agosto"),
      mittente: "newsletter@promo.example.com",
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      testo: "Sconti esclusivi. Disiscriviti quando vuoi.",
      segnaliFiltro: {
        listUnsubscribe: "<mailto:unsubscribe@promo.example.com>",
        precedence: "bulk",
      },
    });
    expect(offerta?.categoria).toBe("da_classificare");
    await setClassificazioneComunicazione(offerta!.id, 1, {
      categoria: "spam",
      motivo: "Classificata come spam da Tars nel test.",
      fonte: "tars",
      score: 95,
    });

    const operative = await listComunicazioni({ sedeId: 1 });
    expect(operative.some(c => c.id === offerta!.id)).toBe(false);
    const escluse = await listComunicazioni({ sedeId: 1, soloEscluse: true });
    expect(escluse.some(c => c.id === offerta!.id)).toBe(true);
    const stats = await statsComunicazioni(1);
    expect(stats.totali).toBe(operative.length);
    expect(stats.escluse).toBeGreaterThanOrEqual(1);
  });

  it("l'eliminazione è un tombstone: sparisce dalle liste ma NON risorge alla risincronizzazione", async () => {
    const daEliminare = await insertComunicazione(
      nuova("<da-eliminare@example.com>", "Newsletter inutile")
    );
    expect(daEliminare).not.toBeNull();

    const ok = await deleteComunicazione(daEliminare!.id, 1);
    expect(ok).toBe(true);

    // Sparita da liste e stats…
    const rows = await listComunicazioni({ sedeId: 1 });
    expect(rows.some(c => c.id === daEliminare!.id)).toBe(false);
    const stats = await statsComunicazioni(1);
    expect(stats.totali).toBe(rows.length);
    expect(stats.email).toBe(rows.length);
    expect(stats.whatsapp).toBe(0);
    expect(stats.gestite).toBe(0);

    // …ma il re-import dello stesso message_id viene assorbito dal tombstone.
    const reimport = await insertComunicazione(
      nuova("<da-eliminare@example.com>", "Newsletter inutile")
    );
    expect(reimport).toBeNull();

    // Non eliminabile due volte; sede sbagliata → false.
    expect(await deleteComunicazione(daEliminare!.id, 1)).toBe(false);
  });

  it("coda di analisi: anche le collegate (per la gestione), mai eliminate né già viste", async () => {
    const inCoda = await listDaAnalizzare(1, 10);
    // Le collegate ci sono (Tars può proporre azioni di gestione), le
    // eliminate no. "Senza commessa" resta in coda per il collegamento.
    expect(inCoda.some(c => c.oggetto === "Senza commessa")).toBe(true);
    expect(inCoda.some(c => c.commessaId != null)).toBe(true);
    expect(inCoda.every(c => !c.deletedAt && !c.tarsAnalizzata)).toBe(true);

    await markAnalizzate(inCoda.map(c => c.id));
    const dopo = await listDaAnalizzare(1, 10);
    expect(dopo).toHaveLength(0);

    // Analizzata ma ancora visibile in lista: lo smistamento non nasconde.
    const c = await getComunicazione(inCoda[0].id, 1);
    expect(c?.tarsAnalizzata).toBe(true);
  });
});

// Collegare una mail a una commessa È gestirla: l'operatore (o la proposta
// che ha approvato) ha deciso dove va a finire. Restava in "Da gestire" per
// sempre perché setMatchComunicazione non toccava lo stato.
describe("collegamento esplicito → gestita", () => {
  beforeAll(() => _resetComunicazioniInMemoria());

  const base = (messageId: string, oggetto: string) => ({
    sedeId: 1,
    casellaId: 1,
    messageId,
    canale: "email" as const,
    direzione: "in" as const,
    mittente: "mario.rossi@example.com",
    mittenteNome: "Mario Rossi",
    destinatari: ["ordini@ruffinogroup.it"],
    oggetto,
    testo: "corpo",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna" as const,
    matchMotivo: null,
    stato: "nuova" as const,
    receivedAt: new Date("2026-08-19T10:00:00Z"),
  });

  const collega = (id: number, commessaId: number | null) =>
    setMatchComunicazione(id, 1, {
      clienteId: commessaId == null ? null : 7,
      commessaId,
      confidenza: commessaId == null ? "nessuna" : "alta",
      motivo: "collegata nel test",
    });

  it("collegare a una commessa porta la mail in Gestite", async () => {
    const c = await insertComunicazione(base("<c1@x>", "Da collegare"));
    expect(c!.stato).toBe("nuova");

    expect(await collega(c!.id, 10)).toBe(true);
    expect((await getComunicazione(c!.id, 1))?.stato).toBe("gestita");
  });

  it("scollegare la riporta nella coda operativa", async () => {
    const c = await insertComunicazione(base("<c2@x>", "Collegata per errore"));
    await collega(c!.id, 10);
    expect((await getComunicazione(c!.id, 1))?.stato).toBe("gestita");

    await collega(c!.id, null);
    expect((await getComunicazione(c!.id, 1))?.stato).toBe("vista");
  });

  it("una esclusa che viene scollegata resta fuori dalla coda", async () => {
    const c = await insertComunicazione(base("<c3@x>", "Newsletter"));
    await setClassificazioneComunicazione(c!.id, 1, {
      categoria: "offerta_marketing",
      motivo: "newsletter",
      fonte: "tars",
      score: 95,
    });
    expect((await getComunicazione(c!.id, 1))?.stato).toBe("gestita");

    await collega(c!.id, null);
    expect((await getComunicazione(c!.id, 1))?.stato).toBe("gestita");
  });

  it("il match automatico all'arrivo NON marca gestita", async () => {
    // Una richiesta nuova su una commessa aperta è lavoro da leggere:
    // l'ingestione non passa da setMatchComunicazione e non deve nascondere.
    const c = await insertComunicazione({
      ...base("<c4@x>", "Riconosciuta all'arrivo"),
      clienteId: 1,
      commessaId: 10,
      matchConfidenza: "alta",
      matchMotivo: "codice commessa nel testo",
    });
    expect(c!.commessaId).toBe(10);
    expect(c!.stato).toBe("nuova");
  });

  it("una mail già gestita a mano non regredisce quando la si collega", async () => {
    const c = await insertComunicazione(base("<c5@x>", "Chiusa a mano"));
    await setStatoComunicazione(c!.id, 1, "gestita");

    await collega(c!.id, 10);
    expect((await getComunicazione(c!.id, 1))?.stato).toBe("gestita");
  });
});

describe("estrazione testo allegati", () => {
  it("legge i file di testo così come sono", async () => {
    const { estraiTestoAllegato } = await import("./allegati");
    const testo = await estraiTestoAllegato(
      Buffer.from("riga1\nriga2", "utf8"),
      "text/plain",
      "note.txt"
    );
    expect(testo).toBe("riga1\nriga2");
  });

  it("dichiara i formati non leggibili invece di tacere", async () => {
    const { estraiTestoAllegato } = await import("./allegati");
    const testo = await estraiTestoAllegato(
      Buffer.alloc(2048),
      "application/vnd.ms-excel",
      "listino.xls"
    );
    expect(testo).toMatch(/Formato non leggibile/);
    expect(testo).toMatch(/2 KB/);
  });

  it("estrae il testo da un PDF vero", async () => {
    // PDF minimo generato al volo: una pagina, testo "Conferma ordine 4471".
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.text("Conferma ordine 4471", 10, 10);
    const buffer = Buffer.from(doc.output("arraybuffer"));

    const { estraiTestoAllegato } = await import("./allegati");
    const testo = await estraiTestoAllegato(
      buffer,
      "application/pdf",
      "co.pdf"
    );
    expect(testo).toContain("Conferma ordine 4471");
  });
});

describe("segnaTutteViste", () => {
  it("porta le nuove a vista, senza toccare gestite ed eliminate", async () => {
    const prima = await listComunicazioni({ sedeId: 1, stato: "nuova" });
    expect(prima.length).toBeGreaterThan(0);

    const { segnaTutteViste } = await import("./comunicazioni");
    const n = await segnaTutteViste(1);
    expect(n).toBe(prima.length);

    expect(await listComunicazioni({ sedeId: 1, stato: "nuova" })).toHaveLength(
      0
    );
    // Idempotente.
    expect(await segnaTutteViste(1)).toBe(0);
  });
});

describe("read model comunicazioni per canale", () => {
  beforeAll(() => _resetComunicazioniInMemoria());

  it("tipizza i parametri nullable dei predicati SQL per canale", () => {
    const source = readFileSync(
      new URL("./comunicazioni.ts", import.meta.url),
      "utf8"
    );
    const predicate =
      /AND \(\$\{canale \?\? null\}::text IS NULL OR canale = \$\{canale \?\? null\}::text\)/g;

    expect(source.match(predicate)).toHaveLength(2);
  });

  it("filtra statistiche e bulk view sul canale richiesto", async () => {
    const email = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "<canale-email@example.com>",
      canale: "email",
      direzione: "in",
      mittente: "email@example.com",
      mittenteNome: null,
      destinatari: [],
      oggetto: "Email",
      testo: "Email",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date("2026-08-20T10:00:00Z"),
    });
    const whatsapp = await insertComunicazione({
      sedeId: 1,
      casellaId: 8,
      messageId: "wa-canale-1",
      canale: "whatsapp",
      direzione: "in",
      mittente: "+393331112222",
      mittenteNome: null,
      destinatari: [],
      oggetto: "WhatsApp",
      testo: "WhatsApp",
      allegati: [],
      clienteId: null,
      commessaId: null,
      matchConfidenza: "nessuna",
      matchMotivo: null,
      stato: "nuova",
      receivedAt: new Date("2026-08-20T11:00:00Z"),
    });

    expect(email).not.toBeNull();
    expect(whatsapp).not.toBeNull();
    expect((await statsComunicazioni(1, "email")).whatsapp).toBe(0);
    expect((await statsComunicazioni(1, "whatsapp")).email).toBe(0);
    expect(await segnaTutteViste(1, "email")).toBe(1);
    expect((await getComunicazione(whatsapp!.id, 1))?.stato).toBe("nuova");
  });
});

describe("conversazioni WhatsApp", () => {
  const clienteId = 919_001;
  let conTimestampCondivisoId: number;

  beforeAll(() => {
    _resetComunicazioniInMemoria();
    getClientiStore().push({
      id: clienteId,
      sedeId: 1,
      nome: "Lia",
      cognome: "Cliente CRM",
    });
  });

  afterAll(() => {
    const clienti = getClientiStore();
    const index = clienti.findIndex(c => c.id === clienteId);
    if (index >= 0) clienti.splice(index, 1);
  });

  const nuovoMessaggioWhatsApp = (overrides: Record<string, unknown> = {}) => ({
    sedeId: 1,
    casellaId: 8,
    messageId: "wa-read-model-base",
    canale: "whatsapp" as const,
    direzione: "in" as const,
    mittente: "+393331112222",
    mittenteNome: "Profilo WhatsApp",
    destinatari: [],
    oggetto: "",
    testo: "Messaggio WhatsApp",
    allegati: [],
    clienteId: null,
    commessaId: null,
    matchConfidenza: "nessuna" as const,
    matchMotivo: null,
    stato: "nuova" as const,
    receivedAt: new Date("2026-08-22T10:00:00Z"),
    ...overrides,
  });

  it("raggruppa per numero aziendale e controparte, mantenendo nomi e non letti corretti", async () => {
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-8-in-1",
        mittente: "333 111 2222",
        clienteId,
        commessaId: 71,
        matchConfidenza: "alta",
        testo: "Primo messaggio",
        receivedAt: new Date("2026-08-22T10:00:00Z"),
      })
    );
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-8-out-1",
        direzione: "out",
        mittente: "0039 3331112222",
        clienteId,
        commessaId: 71,
        matchConfidenza: "alta",
        testo: "Risposta ufficio",
        stato: "nuova",
        receivedAt: new Date("2026-08-22T10:01:00Z"),
      })
    );
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-8-in-2",
        mittente: "+39 (333) 111-2222",
        clienteId,
        commessaId: 71,
        matchConfidenza: "alta",
        testo: "Ultimo messaggio",
        receivedAt: new Date("2026-08-22T10:02:00Z"),
      })
    );
    const conTimestampCondiviso = await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-8-in-stesso-istante",
        mittente: "+393331112222",
        clienteId: null,
        commessaId: null,
        matchConfidenza: "nessuna",
        testo: "Messaggio con timestamp condiviso",
        receivedAt: new Date("2026-08-22T10:02:00Z"),
      })
    );
    conTimestampCondivisoId = conTimestampCondiviso!.id;
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-8-in-nuovo-non-collegato",
        mittente: "+393331112222",
        mittenteNome: "Profilo WhatsApp recente",
        clienteId: null,
        commessaId: null,
        matchConfidenza: "nessuna",
        testo: "Nuovo messaggio non collegato",
        receivedAt: new Date("2026-08-22T10:03:00Z"),
      })
    );
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-9-in-1",
        casellaId: 9,
        mittente: "+393331112222",
        mittenteNome: "Profilo alternativo",
        testo: "Secondo numero aziendale",
        stato: "gestita",
        receivedAt: new Date("2026-08-22T10:01:30Z"),
      })
    );
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-9-out-1",
        casellaId: 9,
        direzione: "out",
        mittente: "+393331112222",
        mittenteNome: null,
        testo: "Ultimo secondo numero",
        stato: "gestita",
        receivedAt: new Date("2026-08-22T10:01:45Z"),
      })
    );
    const esclusa = await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-esclusa",
        mittente: "+393339999999",
        testo: "Spam",
        categoria: "spam",
      })
    );
    const tombstone = await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-tombstone",
        mittente: "+393338888888",
        testo: "Da eliminare",
      })
    );
    await deleteComunicazione(tombstone!.id, 1);
    await insertComunicazione(
      nuovoMessaggioWhatsApp({
        messageId: "wa-altra-sede",
        sedeId: 2,
        testo: "Sede separata",
      })
    );

    expect(normalizzaControparteWhatsApp("0039 3331112222")).toBe(
      "+393331112222"
    );

    const conversazioni = await listConversazioniWhatsApp({
      sedeId: 1,
      limit: 20,
      offset: 0,
    });
    expect(conversazioni).toHaveLength(2);
    expect(conversazioni[0]).toMatchObject({
      key: "wa:8:+393331112222",
      casellaId: 8,
      controparte: "+393331112222",
      nomeProfilo: "Cliente CRM Lia",
      ultimoMessaggio: "Nuovo messaggio non collegato",
      direzioneUltimoMessaggio: "in",
      nonLetti: 4,
      totaleMessaggi: 5,
      clienteId,
      commessaId: 71,
      matchConfidenza: "alta",
    });
    expect(conversazioni[1]).toMatchObject({
      key: "wa:9:+393331112222",
      casellaId: 9,
      controparte: "+393331112222",
      nomeProfilo: "Profilo alternativo",
      nonLetti: 0,
      totaleMessaggi: 2,
      ultimoMessaggio: "Ultimo secondo numero",
    });
    expect(esclusa).not.toBeNull();

    expect(
      await listConversazioniWhatsApp({ sedeId: 1, soloDaGestire: true })
    ).toHaveLength(1);
    expect(
      await listConversazioniWhatsApp({ sedeId: 1, search: "Cliente CRM" })
    ).toHaveLength(1);
    expect(await listConversazioniWhatsApp({ sedeId: 2 })).toHaveLength(1);
  });

  it("escapa i caratteri wildcard della ricerca WhatsApp per ILIKE letterale", () => {
    expect(escapeRicercaWhatsApp("100%_\\ pronto")).toBe(
      "100\\%\\_\\\\ pronto"
    );
  });

  it("pagina il thread con un cursore composto senza buchi sui timestamp uguali", async () => {
    const thread = await getThreadWhatsApp({
      sedeId: 1,
      casellaId: 8,
      controparte: "+393331112222",
      limit: 2,
    });

    expect(thread).not.toBeNull();
    expect(thread!.messaggi.map(m => m.testo)).toEqual([
      "Messaggio con timestamp condiviso",
      "Nuovo messaggio non collegato",
    ]);
    expect(thread!.messaggi.map(m => m.receivedAt.getTime())).toEqual(
      [...thread!.messaggi]
        .map(m => m.receivedAt.getTime())
        .sort((a, b) => a - b)
    );
    expect(thread!.hasMore).toBe(true);
    expect(thread!.nextBefore).toEqual({
      receivedAt: new Date("2026-08-22T10:02:00Z"),
      id: conTimestampCondivisoId,
    });

    const paginaPrecedente = await getThreadWhatsApp({
      sedeId: 1,
      casellaId: 8,
      controparte: "+393331112222",
      before: thread!.nextBefore!,
      limit: 2,
    });
    expect(paginaPrecedente!.messaggi.map(m => m.testo)).toEqual([
      "Risposta ufficio",
      "Ultimo messaggio",
    ]);
    expect(paginaPrecedente!.hasMore).toBe(true);
    expect(paginaPrecedente!.nextBefore).toMatchObject({
      receivedAt: new Date("2026-08-22T10:01:00Z"),
    });
    const paginaPiuVecchia = await getThreadWhatsApp({
      sedeId: 1,
      casellaId: 8,
      controparte: "+393331112222",
      before: paginaPrecedente!.nextBefore!,
      limit: 2,
    });
    expect(paginaPiuVecchia!.messaggi.map(m => m.testo)).toEqual([
      "Primo messaggio",
    ]);
    expect(paginaPiuVecchia!.hasMore).toBe(false);
    expect([
      ...paginaPiuVecchia!.messaggi,
      ...paginaPrecedente!.messaggi,
      ...thread!.messaggi,
    ].map(m => m.testo)).toEqual([
      "Primo messaggio",
      "Risposta ufficio",
      "Ultimo messaggio",
      "Messaggio con timestamp condiviso",
      "Nuovo messaggio non collegato",
    ]);
    expect(
      (await getThreadWhatsApp({
        sedeId: 2,
        casellaId: 8,
        controparte: "+393331112222",
      }))?.messaggi.map(m => m.testo)
    ).toEqual(["Sede separata"]);
    expect(
      await getThreadWhatsApp({
        sedeId: 3,
        casellaId: 8,
        controparte: "+393331112222",
      })
    ).toBeNull();
  });
});

describe("backfill storico", () => {
  it("una mail pre-marcata analizzata entra col match ma resta fuori dalla coda Tars", async () => {
    const vecchia = await insertComunicazione({
      sedeId: 1,
      casellaId: 1,
      messageId: "<storico-1@example.com>",
      canale: "email",
      direzione: "in",
      mittente: "mario.rossi@example.com",
      mittenteNome: "Mario Rossi",
      destinatari: [],
      oggetto: "Vecchia conferma",
      testo: "riferimento COM-2026-035",
      allegati: [],
      clienteId: 1,
      commessaId: 10,
      matchConfidenza: "alta",
      matchMotivo: "storico",
      stato: "nuova",
      tarsAnalizzata: true,
      receivedAt: new Date("2026-02-01T10:00:00Z"),
    });
    expect(vecchia).not.toBeNull();
    expect(vecchia!.tarsAnalizzata).toBe(true);
    // Visibile in lista, agganciata, ma NON in coda di analisi.
    const lista = await listComunicazioni({ sedeId: 1, commessaId: 10 });
    expect(lista.some(c => c.id === vecchia!.id)).toBe(true);
    const coda = await listDaAnalizzare(1, 50);
    expect(coda.some(c => c.id === vecchia!.id)).toBe(false);
  });
});
