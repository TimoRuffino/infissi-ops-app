// Fake a copione del client FiC di emissione: nessuna rete, nessun mock di
// fetch. Ogni metodo del copione viene chiamato quando previsto; ogni
// metodo NON previsto lancia FIC_FINTO — un pipeline che chiama qualcosa di
// inatteso deve fallire rumorosamente, non silenziosamente con undefined.
//
// Ogni chiamata (prevista o no) viene comunque appesa a `registro`, così i
// test della pipeline di emissione possono asserire ordine e idempotenza
// (es. "creaCliente non è stato richiamato una seconda volta"). `path` è
// l'identificativo principale della chiamata (il documentId per i metodi
// sui documenti, la query per cercaClienti, stringa vuota per le creazioni
// che non hanno ancora un id) — un equivalente semplificato del percorso
// HTTP che il client reale userebbe; `body` porta gli argomenti rilevanti
// per intero, per il confronto diretto nei test.
import type { ClientFicEmissione } from "./emissione";

export type ChiamataFic = { metodo: string; path: string; body: unknown };

type CopioneFic = Partial<{
  [K in keyof ClientFicEmissione]: (
    ...args: Parameters<ClientFicEmissione[K]>
  ) => ReturnType<ClientFicEmissione[K]>;
}>;

function nonPrevisto(metodo: string): never {
  throw new Error(`FIC_FINTO: metodo non previsto ${metodo}`);
}

export function creaClientFicFinto(
  copione: CopioneFic,
  registro: ChiamataFic[] = []
): ClientFicEmissione {
  const registra = (metodo: string, path: string, body: unknown) => {
    registro.push({ metodo, path, body });
  };
  return {
    async cercaClienti(ctx, q) {
      registra("cercaClienti", q, { q });
      return copione.cercaClienti
        ? copione.cercaClienti(ctx, q)
        : nonPrevisto("cercaClienti");
    },
    async creaCliente(ctx, cliente) {
      registra("creaCliente", "", cliente);
      return copione.creaCliente
        ? copione.creaCliente(ctx, cliente)
        : nonPrevisto("creaCliente");
    },
    async creaDocumento(ctx, documento, opzioni) {
      registra("creaDocumento", "", { documento, opzioni });
      return copione.creaDocumento
        ? copione.creaDocumento(ctx, documento, opzioni)
        : nonPrevisto("creaDocumento");
    },
    async leggiDocumento(ctx, documentId) {
      registra("leggiDocumento", String(documentId), { documentId });
      return copione.leggiDocumento
        ? copione.leggiDocumento(ctx, documentId)
        : nonPrevisto("leggiDocumento");
    },
    async verificaXml(ctx, documentId) {
      registra("verificaXml", String(documentId), { documentId });
      return copione.verificaXml
        ? copione.verificaXml(ctx, documentId)
        : nonPrevisto("verificaXml");
    },
    async inviaEInvoice(ctx, documentId, opzioni) {
      registra("inviaEInvoice", String(documentId), { documentId, opzioni });
      return copione.inviaEInvoice
        ? copione.inviaEInvoice(ctx, documentId, opzioni)
        : nonPrevisto("inviaEInvoice");
    },
    async scaricaXml(ctx, documentId) {
      registra("scaricaXml", String(documentId), { documentId });
      return copione.scaricaXml
        ? copione.scaricaXml(ctx, documentId)
        : nonPrevisto("scaricaXml");
    },
    async scaricaPdf(ctx, documentId) {
      registra("scaricaPdf", String(documentId), { documentId });
      return copione.scaricaPdf
        ? copione.scaricaPdf(ctx, documentId)
        : nonPrevisto("scaricaPdf");
    },
    async motivoScarto(ctx, documentId) {
      registra("motivoScarto", String(documentId), { documentId });
      return copione.motivoScarto
        ? copione.motivoScarto(ctx, documentId)
        : nonPrevisto("motivoScarto");
    },
  };
}
