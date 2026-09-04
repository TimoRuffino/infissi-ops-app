import { afterEach, describe, expect, it, vi } from "vitest";
import { FIC } from "../routers/fattureInCloud";
import {
  creaClientFicEmissione,
  type ClienteFicInput,
  type ContestoFic,
  type DocumentoFicInput,
} from "./emissione";
import { creaClientFicFinto, type ChiamataFic } from "./fake";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

// Stesso pattern di server/routers/fattureInCloud.oauth.test.ts.
function response(status: number, value: unknown, testoGrezzo?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    text: async () => testoGrezzo ?? JSON.stringify(value),
    headers: { get: (_nome: string) => null },
  } as any;
}

function rispostaBinaria(status: number, bytes: Buffer) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => bytes.toString("utf-8"),
    headers: {
      get: (nome: string) =>
        nome.toLowerCase() === "content-length" ? String(bytes.length) : null,
    },
  } as any;
}

const ctx: ContestoFic = {
  companyId: 77,
  token: "a/segreto-token-di-test-lunghissimo-non-deve-comparire",
};

const clienteFixture: ClienteFicInput = {
  name: "Mario Rossi",
  type: "person",
  first_name: "Mario",
  last_name: "Rossi",
  tax_code: "RSSMRA80A01H501U",
  vat_number: null,
  address_street: "Via Roma 1",
  address_postal_code: "00100",
  address_city: "Roma",
  address_province: "RM",
  country: "Italia",
  email: "mario.rossi@example.test",
  certified_email: null,
  ei_code: "0000000",
  e_invoice: true,
};

const documentoFixture: DocumentoFicInput = {
  type: "invoice",
  entity: { id: 42 },
  date: "2026-09-04",
  visible_subject: "Acconto contratto 2026-014",
  notes: "Pagamento come da contratto.",
  items_list: [
    { name: "Acconto lavori", qty: 1, net_price: 1000, vat: { id: 3 } },
  ],
  payments_list: [{ amount: 1220, due_date: "2026-10-04", status: "not_paid" }],
  e_invoice: true,
  ei_data: {
    payment_method: "MP05",
    bank_iban: "IT60X0542811101000000123456",
  },
  show_payments: true,
  show_payment_method: true,
};

describe("client FiC di emissione", () => {
  it("cercaClienti: query esatta (q + fieldset=basic) e mappatura dei campi", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response(200, {
        data: [
          {
            id: 10,
            name: "Mario Rossi",
            tax_code: "RSSMRA80A01H501U",
            vat_number: null,
            phone: "ignorato",
          },
        ],
      })
    );
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const risultato = await client.cercaClienti(ctx, "RSSMRA80A01H501U");

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${FIC}/c/77/entities/clients?q=RSSMRA80A01H501U&fieldset=basic`
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      `Bearer ${ctx.token}`
    );
    expect(fetchMock.mock.calls[0][1].headers.accept).toBe("application/json");
    expect(risultato).toEqual([
      {
        id: 10,
        name: "Mario Rossi",
        tax_code: "RSSMRA80A01H501U",
        vat_number: null,
      },
    ]);
  });

  it("creaCliente: POST body {data: cliente}, risposta id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { data: { id: 88 } }));
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const creato = await client.creaCliente(ctx, clienteFixture);

    expect(fetchMock.mock.calls[0][0]).toBe(`${FIC}/c/77/entities/clients`);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      `Bearer ${ctx.token}`
    );
    expect(fetchMock.mock.calls[0][1].headers["content-type"]).toBe(
      "application/json"
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      data: clienteFixture,
    });
    expect(creato).toEqual({ id: 88 });
  });

  it("creaDocumento: POST body {data, options: {fix_payments}}, risposta normalizzata", async () => {
    const rispostaServer = {
      data: {
        id: 501,
        number: 14,
        numeration: null,
        date: "2026-09-04",
        amount_net: 1000,
        amount_vat: 220,
        amount_gross: 1220,
        url: "https://secure.fattureincloud.it/invoice/501",
        ei_status: null,
        payments_list: [{ id: 9001, amount: 1220, due_date: "2026-10-04" }],
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, rispostaServer));
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const creato = await client.creaDocumento(ctx, documentoFixture, {
      fix_payments: true,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${FIC}/c/77/issued_documents`);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      `Bearer ${ctx.token}`
    );
    expect(fetchMock.mock.calls[0][1].headers["content-type"]).toBe(
      "application/json"
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      data: documentoFixture,
      options: { fix_payments: true },
    });
    expect(creato).toEqual(rispostaServer.data);
  });

  it("creaDocumento: 401 → errore italiano, mai il token nel messaggio", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(401, { error: "unauthorized" }));
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const promessa = client.creaDocumento(ctx, documentoFixture, {
      fix_payments: true,
    });
    await expect(promessa).rejects.toThrow(
      /Token rifiutato da Fatture in Cloud/
    );
    await promessa.catch((e: Error) => {
      expect(e.message).not.toContain(ctx.token);
    });
  });

  it("leggiDocumento: GET con i fields esatti", async () => {
    const rispostaServer = {
      data: {
        id: 501,
        number: 14,
        numeration: "/A",
        date: "2026-09-04",
        amount_net: 1000,
        amount_vat: 220,
        amount_gross: 1220,
        url: "https://secure.fattureincloud.it/invoice/501",
        ei_status: "sent",
        payments_list: [{ id: 9001, amount: 1220, due_date: "2026-10-04" }],
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, rispostaServer));
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const letto = await client.leggiDocumento(ctx, 501);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${FIC}/c/77/issued_documents/501?fields=id,number,numeration,date,amount_net,amount_vat,amount_gross,url,ei_status,payments_list`
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(letto).toEqual(rispostaServer.data);
  });

  it("verificaXml: 200 con success true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { data: { success: true } }));
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    await expect(client.verificaXml(ctx, 501)).resolves.toEqual({
      success: true,
      errori: [],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${FIC}/c/77/issued_documents/501/e_invoice/xml_verify`
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      `Bearer ${ctx.token}`
    );
  });

  it("verificaXml: 422 con xml_errors → success false ed errori description/code", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response(422, {
        error: {
          validation_result: {
            xml_errors: [
              { code: "00404", description: "Codice destinatario non valido" },
              { code: "00411", description: "" },
            ],
          },
        },
      })
    );
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const esito = await client.verificaXml(ctx, 501);
    expect(esito).toEqual({
      success: false,
      errori: ["Codice destinatario non valido", "00411"],
    });
  });

  it("verificaXml: errore HTTP senza xml_errors ricade sul messaggio generico, senza eccezione", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(500, { error: "boom" }));
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const esito = await client.verificaXml(ctx, 501);
    expect(esito.success).toBe(false);
    expect(esito.errori).toHaveLength(1);
    expect(esito.errori[0]).toMatch(/HTTP 500/);
    expect(esito.errori[0]).not.toContain(ctx.token);
  });

  it("inviaEInvoice: POST con dry_run, risposta name/date", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response(200, {
        data: { name: "IT01234567890_00001.xml", date: "2026-09-04" },
      })
    );
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const esito = await client.inviaEInvoice(ctx, 501, { dry_run: true });

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${FIC}/c/77/issued_documents/501/e_invoice/send`
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      data: {},
      options: { dry_run: true },
    });
    expect(esito).toEqual({
      name: "IT01234567890_00001.xml",
      date: "2026-09-04",
    });
  });

  it("scaricaXml: Accept text/xml, legge text() non json(), esito Buffer", async () => {
    const xml =
      '<?xml version="1.0"?><FatturaElettronica>contenuto</FatturaElettronica>';
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => xml,
      json: async () => {
        throw new Error("scaricaXml non deve chiamare json()");
      },
      headers: { get: () => null },
    });
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const buffer = await client.scaricaXml(ctx, 501);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${FIC}/c/77/issued_documents/501/e_invoice/xml?include_attachment=false`
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
    expect(fetchMock.mock.calls[0][1].headers.accept).toBe("text/xml");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString("utf-8")).toBe(xml);
  });

  it("scaricaXml: errore HTTP lancia con messaggio italiano", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "not found",
      headers: { get: () => null },
    });
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    await expect(client.scaricaXml(ctx, 999)).rejects.toThrow(
      /Azienda non trovata/
    );
  });

  it("scaricaPdf: due chiamate, url firmato senza bearer, tetto e magic bytes rispettati", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4 contenuto finto della fattura");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          data: { id: 501, url: "https://files.fattureincloud.it/signed/xyz" },
        })
      )
      .mockResolvedValueOnce(rispostaBinaria(200, pdfBytes));
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    const pdf = await client.scaricaPdf(ctx, 501);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${FIC}/c/77/issued_documents/501?fields=id,url`
    );
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      `Bearer ${ctx.token}`
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://files.fattureincloud.it/signed/xyz"
    );
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].headers.accept).toBe("application/pdf");
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("scaricaPdf: file oltre i 10MB dichiarati viene rifiutato", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          data: { id: 501, url: "https://files.fattureincloud.it/signed/xyz" },
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (nome: string) =>
            nome === "content-length" ? String(11 * 1024 * 1024) : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => "",
      });
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();
    await expect(client.scaricaPdf(ctx, 501)).rejects.toThrow(
      /supera il limite di 10MB/
    );
  });

  it("motivoScarto: GET error_reason, null quando assente", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, { data: { reason: "Codice destinatario inesistente" } })
      )
      .mockResolvedValueOnce(response(200, { data: { reason: null } }));
    global.fetch = fetchMock as any;
    const client = creaClientFicEmissione();

    await expect(client.motivoScarto(ctx, 501)).resolves.toBe(
      "Codice destinatario inesistente"
    );
    await expect(client.motivoScarto(ctx, 501)).resolves.toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${FIC}/c/77/issued_documents/501/e_invoice/error_reason`
    );
  });
});

describe("fake FIC a copione", () => {
  it("metodo non previsto nel copione lancia FIC_FINTO e resta comunque registrato", async () => {
    const registro: ChiamataFic[] = [];
    const client = creaClientFicFinto({}, registro);
    await expect(client.motivoScarto(ctx, 501)).rejects.toThrow(
      "FIC_FINTO: metodo non previsto motivoScarto"
    );
    expect(registro).toEqual([
      { metodo: "motivoScarto", path: "501", body: { documentId: 501 } },
    ]);
  });

  it("chiama l'implementazione del copione quando presente e registra ogni chiamata in ordine", async () => {
    const registro: ChiamataFic[] = [];
    const client = creaClientFicFinto(
      {
        cercaClienti: async () => [
          {
            id: 1,
            name: "Mario Rossi",
            tax_code: "RSSMRA80A01H501U",
            vat_number: null,
          },
        ],
        creaCliente: async () => ({ id: 9 }),
      },
      registro
    );
    const trovati = await client.cercaClienti(ctx, "RSSMRA80A01H501U");
    const creato = await client.creaCliente(ctx, clienteFixture);

    expect(trovati).toEqual([
      {
        id: 1,
        name: "Mario Rossi",
        tax_code: "RSSMRA80A01H501U",
        vat_number: null,
      },
    ]);
    expect(creato).toEqual({ id: 9 });
    expect(registro.map(c => c.metodo)).toEqual([
      "cercaClienti",
      "creaCliente",
    ]);
    expect(registro[0]).toEqual({
      metodo: "cercaClienti",
      path: "RSSMRA80A01H501U",
      body: { q: "RSSMRA80A01H501U" },
    });
    expect(registro[1]).toEqual({
      metodo: "creaCliente",
      path: "",
      body: clienteFixture,
    });
  });

  it("senza registro esplicito il fake funziona comunque (registro di default)", async () => {
    const client = creaClientFicFinto({ creaCliente: async () => ({ id: 1 }) });
    await expect(client.creaCliente(ctx, clienteFixture)).resolves.toEqual({
      id: 1,
    });
  });
});
