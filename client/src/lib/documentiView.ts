// Presentazione del fascicolo commessa: il tono del chip per tipo di
// documento e il tipo di documento suggerito al caricamento per lo stato
// corrente della commessa. Erano due mappe locali di `CommessaDetail.tsx`:
// vivono qui da quando l'elenco dei documenti è un componente riusabile
// (`components/documenti/ElencoDocumentiCommessa.tsx`), usato dalla scheda
// commessa e dal passo «Documenti» della fatturazione guidata.
//
// Solo presentazione: le etichette dei tipi restano in `@shared/docTipi`
// (`docTipoLabel`), la verità del gate documentale resta del server.

/**
 * Tono del chip per tipo di documento. La chiave è il tipo grezzo: un
 * documento storico con un tipo non più in elenco cade sul chip neutro
 * (`?? ""`) invece di rompere la riga.
 */
export const tipoDocColors: Record<string, string> = {
  preventivo: "bg-info-soft text-info",
  contratto: "bg-success-soft text-success",
  misure: "bg-st-misure-soft text-st-misure",
  fattura: "bg-st-pagamento-soft text-st-pagamento",
  conferma_ordine: "bg-st-ordine-soft text-st-ordine",
  ddt_consegna: "bg-st-produzione-soft text-st-produzione",
  ddt_posa: "bg-st-produzione-soft text-st-produzione",
  ddt_finale: "bg-st-produzione-soft text-st-produzione",
  saldo: "bg-st-pagamento-soft text-st-pagamento",
  foto: "bg-st-contratto-soft text-st-contratto",
  documento_identita: "bg-surface-2 text-text-2",
  visura: "bg-surface-2 text-text-2",
  planimetria: "bg-st-misure-soft text-st-misure",
  certificazione: "bg-structure-soft text-structure",
  altro: "bg-surface-2 text-text-2",
};

// Mirror of REQUIRED_DOC_TIPI_PER_STATO on the server — used to hint the
// user which doc tipo they should upload for the current state.
export const SUGGESTED_TIPO_FOR_STATO: Record<string, string> = {
  preventivo: "preventivo",
  misure_esecutive: "misure",
  aggiornamento_contratto: "contratto",
  fatture_pagamento: "fattura",
  da_ordinare: "conferma_ordine",
  ordini_ultimazione: "saldo",
  attesa_posa: "ddt_consegna",
  finiture_saldo: "ddt_posa",
  interventi_regolazioni: "ddt_finale",
};
