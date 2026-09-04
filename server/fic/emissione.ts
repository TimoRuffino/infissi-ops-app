// Client FiC di emissione: ricerca/creazione cliente, creazione fattura o
// nota di credito, verifica dell'XML e-fattura, invio a SdI (con dry_run),
// download XML/PDF, motivo di uno scarto.
//
// Ogni chiamata riceve azienda e token già risolti (ContestoFic): questo
// client non conosce la sede né la configurazione di Fatture in Cloud —
// quella è responsabilità di chi lo chiama (il servizio di dominio a monte,
// che risolve sede → token via accessTokenFic/getCfg).
import {
  FIC,
  fetchFicConTimeout,
  ficGet,
  messaggioErroreFic,
} from "../routers/fattureInCloud";

export type ContestoFic = {
  companyId: number;
  token: string;
  signal?: AbortSignal;
};

export type ClienteFicInput = {
  name: string;
  type: "person" | "company";
  first_name?: string;
  last_name?: string;
  tax_code?: string | null;
  vat_number?: string | null;
  address_street: string;
  address_postal_code: string;
  address_city: string;
  address_province: string;
  country: "Italia";
  email?: string | null;
  certified_email?: string | null;
  ei_code: string;
  e_invoice: true;
};

export type DocumentoFicInput = {
  type: "invoice" | "credit_note";
  entity: { id: number };
  date: string;
  numeration?: string;
  subject?: string;
  visible_subject: string;
  notes: string;
  items_list: Array<{
    name: string;
    description?: string;
    qty: number;
    net_price: number;
    vat: { id: number };
  }>;
  payments_list: Array<{
    amount: number;
    due_date: string;
    status: "not_paid";
    payment_account?: { id: number };
    payment_terms?: { days: number; type: "standard" };
  }>;
  e_invoice: true;
  ei_data: {
    payment_method: string;
    bank_iban?: string;
    bank_name?: string;
    bank_beneficiary?: string;
  };
  show_payments: true;
  show_payment_method: true;
};

export type DocumentoFicCreato = {
  id: number;
  number: number;
  numeration: string | null;
  date: string;
  amount_net: number;
  amount_vat: number;
  amount_gross: number;
  url: string | null;
  ei_status: string | null;
  payments_list: Array<{ id: number; amount: number; due_date: string }>;
};

export type ClientFicEmissione = {
  cercaClienti(
    ctx: ContestoFic,
    q: string
  ): Promise<
    Array<{
      id: number;
      name: string;
      tax_code: string | null;
      vat_number: string | null;
    }>
  >;
  creaCliente(ctx: ContestoFic, cliente: ClienteFicInput): Promise<{ id: number }>;
  creaDocumento(
    ctx: ContestoFic,
    documento: DocumentoFicInput,
    opzioni: { fix_payments: boolean }
  ): Promise<DocumentoFicCreato>;
  leggiDocumento(
    ctx: ContestoFic,
    documentId: number
  ): Promise<DocumentoFicCreato & { ei_status: string | null }>;
  verificaXml(
    ctx: ContestoFic,
    documentId: number
  ): Promise<{ success: boolean; errori: string[] }>;
  inviaEInvoice(
    ctx: ContestoFic,
    documentId: number,
    opzioni: { dry_run: boolean }
  ): Promise<{ name: string | null; date: string | null }>;
  scaricaXml(ctx: ContestoFic, documentId: number): Promise<Buffer>;
  scaricaPdf(ctx: ContestoFic, documentId: number): Promise<Buffer>;
  motivoScarto(ctx: ContestoFic, documentId: number): Promise<string | null>;
};

// ── richieste JSON generiche (GET senza corpo, POST con corpo) ─────────────
// Content-Type solo sui POST; il corpo dell'errore non finisce mai loggato
// oltre 300 caratteri, e messaggioErroreFic non lo lascia mai leggere oltre
// (e non contiene mai il token: viene costruito solo da status + corpo).
async function richiestaFic(
  ctx: ContestoFic,
  path: string,
  opzioni: { method: "GET" | "POST"; body?: string }
): Promise<any> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${ctx.token}`,
    accept: "application/json",
  };
  if (opzioni.method === "POST") headers["content-type"] = "application/json";
  const init: RequestInit = { method: opzioni.method, headers };
  if (opzioni.body !== undefined) init.body = opzioni.body;
  const res = await fetchFicConTimeout(`${FIC}${path}`, init, ctx.signal);
  if (!res.ok) {
    const corpo = (await res.text()).slice(0, 300);
    throw new Error(messaggioErroreFic(res.status, corpo));
  }
  return await res.json();
}

function parseJsonSicuro(testo: string): any {
  if (!testo) return {};
  try {
    return JSON.parse(testo);
  } catch {
    return {};
  }
}

function normalizzaDocumento(d: any): DocumentoFicCreato {
  return {
    id: Number(d?.id),
    number: Number(d?.number),
    numeration: d?.numeration ?? null,
    date: String(d?.date ?? ""),
    amount_net: Number(d?.amount_net ?? 0),
    amount_vat: Number(d?.amount_vat ?? 0),
    amount_gross: Number(d?.amount_gross ?? 0),
    url: d?.url ?? null,
    ei_status: d?.ei_status ?? null,
    payments_list: Array.isArray(d?.payments_list)
      ? d.payments_list.map((p: any) => ({
          id: Number(p?.id),
          amount: Number(p?.amount),
          due_date: String(p?.due_date ?? ""),
        }))
      : [],
  };
}

// ── clienti ─────────────────────────────────────────────────────────────
async function cercaClienti(ctx: ContestoFic, q: string) {
  const data = await richiestaFic(
    ctx,
    `/c/${ctx.companyId}/entities/clients?q=${encodeURIComponent(q)}&fieldset=basic`,
    { method: "GET" }
  );
  const righe: any[] = Array.isArray(data?.data) ? data.data : [];
  return righe.map(r => ({
    id: Number(r?.id),
    name: String(r?.name ?? ""),
    tax_code: r?.tax_code ?? null,
    vat_number: r?.vat_number ?? null,
  }));
}

async function creaCliente(
  ctx: ContestoFic,
  cliente: ClienteFicInput
): Promise<{ id: number }> {
  const data = await richiestaFic(ctx, `/c/${ctx.companyId}/entities/clients`, {
    method: "POST",
    body: JSON.stringify({ data: cliente }),
  });
  return { id: Number(data?.data?.id) };
}

// ── documenti ───────────────────────────────────────────────────────────
const CAMPI_DOCUMENTO =
  "id,number,numeration,date,amount_net,amount_vat,amount_gross,url,ei_status,payments_list";

async function creaDocumento(
  ctx: ContestoFic,
  documento: DocumentoFicInput,
  opzioni: { fix_payments: boolean }
): Promise<DocumentoFicCreato> {
  const data = await richiestaFic(ctx, `/c/${ctx.companyId}/issued_documents`, {
    method: "POST",
    body: JSON.stringify({
      data: documento,
      options: { fix_payments: opzioni.fix_payments },
    }),
  });
  return normalizzaDocumento(data?.data);
}

async function leggiDocumento(
  ctx: ContestoFic,
  documentId: number
): Promise<DocumentoFicCreato & { ei_status: string | null }> {
  const data = await richiestaFic(
    ctx,
    `/c/${ctx.companyId}/issued_documents/${documentId}?fields=${CAMPI_DOCUMENTO}`,
    { method: "GET" }
  );
  return normalizzaDocumento(data?.data);
}

// ── e-fattura ───────────────────────────────────────────────────────────
async function verificaXml(
  ctx: ContestoFic,
  documentId: number
): Promise<{ success: boolean; errori: string[] }> {
  const res = await fetchFicConTimeout(
    `${FIC}/c/${ctx.companyId}/issued_documents/${documentId}/e_invoice/xml_verify`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${ctx.token}`, accept: "application/json" },
    },
    ctx.signal
  );
  const testo = await res.text();
  if (res.ok) {
    const corpo = parseJsonSicuro(testo);
    return { success: !!corpo?.data?.success, errori: [] };
  }
  // Qualunque errore HTTP (422 tipico, ma non solo) diventa esito negativo,
  // mai un'eccezione: gli errori strutturati vivono sotto
  // error.validation_result.xml_errors[]; senza quelli resta il messaggio
  // generico italiano di messaggioErroreFic.
  const corpo = parseJsonSicuro(testo);
  const xmlErrors: any[] = Array.isArray(corpo?.error?.validation_result?.xml_errors)
    ? corpo.error.validation_result.xml_errors
    : [];
  const estratti = xmlErrors
    .map((e: any) => String(e?.description || e?.code || "").trim())
    .filter(Boolean);
  const errori =
    estratti.length > 0
      ? estratti
      : [messaggioErroreFic(res.status, testo.slice(0, 300))];
  return { success: false, errori };
}

async function inviaEInvoice(
  ctx: ContestoFic,
  documentId: number,
  opzioni: { dry_run: boolean }
): Promise<{ name: string | null; date: string | null }> {
  const data = await richiestaFic(
    ctx,
    `/c/${ctx.companyId}/issued_documents/${documentId}/e_invoice/send`,
    {
      method: "POST",
      body: JSON.stringify({ data: {}, options: { dry_run: opzioni.dry_run } }),
    }
  );
  return { name: data?.data?.name ?? null, date: data?.data?.date ?? null };
}

async function scaricaXml(ctx: ContestoFic, documentId: number): Promise<Buffer> {
  const res = await fetchFicConTimeout(
    `${FIC}/c/${ctx.companyId}/issued_documents/${documentId}/e_invoice/xml?include_attachment=false`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${ctx.token}`, accept: "text/xml" },
    },
    ctx.signal
  );
  if (!res.ok) {
    const corpo = (await res.text()).slice(0, 300);
    throw new Error(messaggioErroreFic(res.status, corpo));
  }
  const testo = await res.text();
  return Buffer.from(testo, "utf-8");
}

// scaricaPdf non può richiamare scaricaFatturaPdf(sedeId, …) di
// fattureInCloud.ts alla lettera: quella funzione risolve token e azienda
// da una sede (getCfg/accessTokenFic), mentre qui azienda e token arrivano
// già risolti in ContestoFic — l'interfaccia di questo client non porta
// sedeId. La logica resta la stessa, passo per passo: metadati con ficGet
// (già esportata), poi l'URL firmato SENZA bearer, tetto 10MB, controllo
// dei magic bytes %PDF-.
const MAX_FATTURA_PDF_BYTES = 10 * 1024 * 1024;

async function scaricaPdf(ctx: ContestoFic, documentId: number): Promise<Buffer> {
  const risposta = await ficGet(
    `/c/${ctx.companyId}/issued_documents/${documentId}?fields=id,url`,
    ctx.token,
    ctx.signal
  );
  const pdfUrl =
    typeof risposta?.data?.url === "string" ? risposta.data.url.trim() : "";
  if (!/^https:\/\//i.test(pdfUrl)) {
    throw new Error(
      "Fatture in Cloud non ha restituito il PDF della fattura. Riprova tra poco."
    );
  }
  const pdfResponse = await fetchFicConTimeout(
    pdfUrl,
    { headers: { accept: "application/pdf" } },
    ctx.signal
  );
  if (!pdfResponse.ok) {
    throw new Error(
      `Download PDF fattura fallito (HTTP ${pdfResponse.status}). Riprova il collegamento.`
    );
  }
  const declaredSize = Number(pdfResponse.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_FATTURA_PDF_BYTES) {
    throw new Error("Il PDF della fattura supera il limite di 10MB.");
  }
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  if (pdf.length > MAX_FATTURA_PDF_BYTES) {
    throw new Error("Il PDF della fattura supera il limite di 10MB.");
  }
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Il file ricevuto da Fatture in Cloud non è un PDF valido.");
  }
  return pdf;
}

async function motivoScarto(
  ctx: ContestoFic,
  documentId: number
): Promise<string | null> {
  const data = await richiestaFic(
    ctx,
    `/c/${ctx.companyId}/issued_documents/${documentId}/e_invoice/error_reason`,
    { method: "GET" }
  );
  return data?.data?.reason ?? null;
}

/** Client reale, su fetch: nessuno stato, azienda e token arrivano per chiamata via ContestoFic. */
export function creaClientFicEmissione(): ClientFicEmissione {
  return {
    cercaClienti,
    creaCliente,
    creaDocumento,
    leggiDocumento,
    verificaXml,
    inviaEInvoice,
    scaricaXml,
    scaricaPdf,
    motivoScarto,
  };
}
