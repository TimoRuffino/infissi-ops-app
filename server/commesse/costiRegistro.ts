// Il registro costi fornitore di una commessa (`costi[]`), visto dal lato
// dei documenti: un costo può essere nato da una conferma d'ordine e in quel
// caso segue il documento — si sposta con lui, sparisce con lui.
//
// Operazioni sincrone sullo store in memoria, come il resto del router
// commesse. Nessuna autorizzazione qui: chi chiama è un servizio di dominio
// reagendo a un fatto del fascicolo, non una procedura esposta.

import { getCommessaById, saveCommesseStore } from "../routers/commesse";

export type CostoRegistrato = {
  id: number;
  importo: number;
  fornitore: string | null;
  descrizione: string | null;
  data: string | null;
  numeroOrdine: string | null;
  note: string | null;
  /** Il documento del fascicolo da cui il costo è nato, se c'è. */
  documentoId: number | null;
  /** Una persona ha modificato l'importo dalla scheda: nessuna rilettura lo tocca più. */
  modificatoAMano?: boolean;
  createdAt: Date;
};

/** Le impronte che la regola lascia su un costo che scrive lei. */
export const DESCRIZIONE_COSTO_DA_CONFERMA = "Conferma d'ordine ";
export const NOTA_COSTO_DA_CONFERMA = "Letto dalla conferma d'ordine ";

/**
 * Un costo NATO dalla regola e mai toccato da una persona: porta la
 * descrizione e la nota che scrive lei, non è stato modificato dalla scheda
 * e non è un costo manuale collegato dopo. Solo questo una rilettura può
 * correggere.
 */
export function costoNatoDallaRegola(costo: CostoRegistrato): boolean {
  if (costo.documentoId == null || costo.modificatoAMano) return false;
  return (
    String(costo.descrizione ?? "").startsWith(DESCRIZIONE_COSTO_DA_CONFERMA) &&
    String(costo.note ?? "").startsWith(NOTA_COSTO_DA_CONFERMA)
  );
}

export function costiDi(commessa: any): CostoRegistrato[] {
  if (!Array.isArray(commessa.costi)) commessa.costi = [];
  return commessa.costi;
}

export function costoDelDocumento(
  commessa: any,
  documentoId: number
): CostoRegistrato | null {
  return costiDi(commessa).find(c => c.documentoId === documentoId) ?? null;
}

function prossimoIdCosto(commessa: any): number {
  const costi = costiDi(commessa);
  return costi.length ? Math.max(...costi.map(c => c.id ?? 0)) + 1 : 1;
}

/** Confronto di numeri d'ordine tollerante a spazi, trattini e minuscole. */
export function riferimentoNormalizzato(valore: string | null | undefined): string {
  return String(valore ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function aggiungiCosto(
  commessa: any,
  dati: Omit<CostoRegistrato, "id" | "createdAt">
): CostoRegistrato {
  const costo: CostoRegistrato = {
    id: prossimoIdCosto(commessa),
    ...dati,
    createdAt: new Date(),
  };
  costiDi(commessa).push(costo);
  commessa.updatedAt = new Date();
  saveCommesseStore();
  return costo;
}

/**
 * Un costo scritto a mano (o importato dagli ordini) per lo stesso ordine
 * o per lo stesso importo: la conferma lo conferma, non lo raddoppia.
 */
export function costoManualeCorrispondente(
  commessa: any,
  criterio: { numeroOrdine: string | null; importo: number }
): CostoRegistrato | null {
  const riferimento = riferimentoNormalizzato(criterio.numeroOrdine);
  return (
    costiDi(commessa).find(c => {
      if (c.documentoId != null) return false;
      if (
        riferimento.length >= 3 &&
        riferimentoNormalizzato(c.numeroOrdine) === riferimento
      ) {
        return true;
      }
      return Math.abs((c.importo ?? 0) - criterio.importo) < 0.005;
    }) ?? null
  );
}

/**
 * Una rilettura migliore corregge l'importo di un costo NATO dalla regola e
 * mai toccato da una persona (04/09/2026: tre conferme Pail lette «22,00»
 * — l'aliquota IVA — da un estrattore vecchio). Chi chiama ha verificato
 * che l'importo a registro è ancora quello scritto dalla lettura precedente.
 */
export function aggiornaImportoCosto(
  commessa: any,
  costo: CostoRegistrato,
  importo: number,
  nota: string,
  completa: { fornitore?: string | null; data?: string | null; numeroOrdine?: string | null } = {}
): void {
  costo.importo = importo;
  if (!costo.fornitore && completa.fornitore) costo.fornitore = completa.fornitore;
  if (!costo.data && completa.data) costo.data = completa.data;
  if (!costo.numeroOrdine && completa.numeroOrdine) costo.numeroOrdine = completa.numeroOrdine;
  costo.note = costo.note ? `${costo.note} ${nota}`.slice(0, 300) : nota;
  commessa.updatedAt = new Date();
  saveCommesseStore();
}

export function collegaCostoAlDocumento(
  commessa: any,
  costo: CostoRegistrato,
  documentoId: number,
  nota: string
): void {
  costo.documentoId = documentoId;
  costo.note = costo.note ? `${costo.note} ${nota}`.slice(0, 300) : nota;
  commessa.updatedAt = new Date();
  saveCommesseStore();
}

/** Il documento esce dal fascicolo (o smette di essere una conferma): il costo nato da lui se ne va. */
export function rimuoviCostoDelDocumento(
  documentoId: number,
  commessaId: number
): CostoRegistrato | null {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa) return null;
  const costi = costiDi(commessa);
  const indice = costi.findIndex(c => c.documentoId === documentoId);
  if (indice === -1) return null;
  const [rimosso] = costi.splice(indice, 1);
  commessa.updatedAt = new Date();
  saveCommesseStore();
  return rimosso;
}

/** Il documento cambia fascicolo: il costo lo segue, con un id nuovo nella destinazione. */
export function spostaCostoDelDocumento(
  documentoId: number,
  daCommessaId: number,
  aCommessaId: number
): boolean {
  const destinazione: any = getCommessaById(aCommessaId);
  if (!destinazione) return false;
  const rimosso = rimuoviCostoDelDocumento(documentoId, daCommessaId);
  if (!rimosso) return false;
  const { id: _id, createdAt: _createdAt, ...dati } = rimosso;
  aggiungiCosto(destinazione, dati);
  return true;
}
