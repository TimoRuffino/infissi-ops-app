// Ciclo di vita dell'azienda (piano 10/09/2026, D1-D2): il tenant è il
// cancello OPERATIVO, l'abbonamento la verità di fatturazione — `in_prova` e
// `scaduto` non esistono qui perché vivono già su `StatoAbbonamento`
// (`trialing`, `suspended`).
// - `in_attesa`: nata dal modulo pubblico, invito mai accettato. Nessun
//   login, nessun worker; diventa `attivo` all'accettazione dell'invito.
// - `attivo` / `sospeso`: come dal WS1 (sospeso = sola lettura).
// - `archiviato`: uscita ordinata reversibile — login e sessioni rifiutati,
//   worker esclusi, dati intatti.
// - `cancellato`: come archiviato + `cancellatoIl`; dopo 30 giorni di
//   ritenzione il giro del ciclo di vita accoda `svuota_tenant`. Riattivabile
//   finché `svuotatoIl` è NULL, mai dopo.
export type StatoTenant = "in_attesa" | "attivo" | "sospeso" | "archiviato" | "cancellato";

/**
 * Dati di fatturazione dell'azienda («Modifica azienda», piano 09/09/2026,
 * Task 1): tutti facoltativi, nessuna validazione fiscale oltre forma e
 * lunghezza (spec nel piano, Task 2 li applica). Mai nei log.
 */
export type DatiFatturazione = {
  partitaIva: string | null;
  codiceFiscale: string | null;
  indirizzoLegale: string | null;
  emailAmministrativa: string | null;
  pec: string | null;
  codiceSdi: string | null;
};

export type TenantRecord = {
  id: number;
  slug: string;
  nome: string;
  stato: StatoTenant;
  motivoStato: string | null;
  createdAt: Date;
  updatedAt: Date;
  storageQuotaBytes: number;
  fatturazione: DatiFatturazione;
  note: string | null;
  /** Da quando l'azienda è `cancellato`: la ritenzione di 30 giorni si conta da qui. NULL fuori da quello stato. */
  cancellatoIl: Date | null;
  /** Quando `svuota_tenant` ha rimosso i dati: da qui in poi la riga è una lapide e `riattiva` rifiuta. */
  svuotatoIl: Date | null;
};

export type Attore =
  | { tipo: "utente"; id: number }
  | { tipo: "script"; nome: string }
  | { tipo: "piattaforma"; email: string } // WS6: chi agisce dal pannello piattaforma
  | { tipo: "boot" };

export function attoreTesto(attore: Attore): string {
  if (attore.tipo === "utente") return `utente:${attore.id}`;
  if (attore.tipo === "script") return attore.nome.startsWith("script:") ? attore.nome : `script:${attore.nome}`;
  if (attore.tipo === "piattaforma") return `piattaforma:${attore.email.trim().toLowerCase()}`;
  return "boot";
}

export type TipoEvento =
  | "creato"
  | "sospeso"
  | "riattivato"
  | "proprietario_assegnato"
  | "proprietario_revocato"
  | "comando_fallito"
  | "storage_soglia"
  | "storage_ricalcolato"
  | "worker_sospeso"
  | "worker_riarmato"
  | "archivi_ripristinati"
  // WS4 (abbonamenti, spec §3): `abbonamento_stato` porta `{ da, a, motivo }`,
  // `abbonamento_avviso` `{ giorniAllaScadenza, fineIso }`,
  // `abbonamento_modificato` `{ campo, prima, dopo }` (il marcatore del provider usa
  // `{ campo: "provider_evento", evento, tipo }`), `tars_soglia`
  // `{ percentuale, mese }`.
  | "abbonamento_creato"
  | "abbonamento_stato"
  | "abbonamento_omaggio"
  | "abbonamento_prova_prorogata"
  | "abbonamento_avviso"
  | "abbonamento_modificato"
  | "tars_soglia"
  | "storage_bloccato"
  | "storage_sbloccato"
  | "tars_bloccato"
  | "tars_sbloccato"
  // WS6 (pannello piattaforma, spec §4.1): `invito_inviato` porta
  // `{ invitoId, utenteId, email, scadeIl, inviato: boolean, motivo?: string }`,
  // `invito_accettato` `{ invitoId, utenteId }`, `invito_annullato` `{ invitoId }`.
  | "invito_inviato"
  | "invito_accettato"
  | "invito_annullato"
  // «Modifica azienda» (pannello piattaforma, piano 09/09/2026): `tenant_modificato`
  // porta `{ campi: [{ campo, prima, dopo }] }` (solo i campi davvero
  // cambiati, nessun dato sensibile oltre ai valori stessi — non ci sono
  // segreti), `proprietario_modificato` `{ utenteId, campi }`, `slug_cambiato`
  // `{ da, a }`.
  | "tenant_modificato"
  | "proprietario_modificato"
  | "slug_cambiato"
  // Ciclo di vita (piano 10/09/2026): `attivato` quando un tenant `in_attesa`
  // accetta l'invito (dettagli `{ invitoId, utenteId }`); `archiviato` e
  // `cancellato` dai comandi omonimi (il motivo nella colonna `motivo`);
  // `svuotato` a fine ritenzione, con i conteggi
  // `{ file, righeTabelle, store, utenti, sedi, slugPrima }`.
  | "attivato"
  | "archiviato"
  | "cancellato"
  | "svuotato"
  // Pietre miliari del percorso di attivazione (D9): registrate una volta
  // sola per azienda da `segnaPietraMiliare`, dettagli `{ id }` del record
  // che le ha innescate.
  | "prima_commessa"
  | "prima_fattura"
  | "primo_utente_aggiunto";

export type TenantEvento = {
  id: number;
  tenantId: number;
  tipo: TipoEvento;
  attore: string;
  motivo: string | null;
  dettagli: Record<string, unknown> | null;
  createdAt: Date;
};

export type TipoComando =
  | "crea"
  | "sospendi"
  | "riattiva"
  | "assegna_proprietario"
  | "revoca_proprietario"
  | "ricalcola_storage"
  | "ripristina_archivi"
  | "imposta_abbonamento"
  // «Modifica azienda» (piano 09/09/2026, Task 2 li esegue in `eseguiComando`).
  | "modifica_tenant"
  | "modifica_proprietario"
  // Ciclo di vita (piano 10/09/2026, D3-D5): `archivia`/`cancella` come
  // `sospendi` (slug + motivo); `svuota_tenant` lo accoda il giro del ciclo
  // di vita a fine ritenzione (o la CLI con `--forza`).
  | "archivia"
  | "cancella"
  | "svuota_tenant";

export type StatoComando = "in_attesa" | "eseguito" | "errore";

export type TenantComando = {
  id: number;
  tipo: TipoComando;
  tenantId: number | null;
  payload: Record<string, unknown>;
  stato: StatoComando;
  esito: Record<string, unknown> | null;
  richiestoDa: string;
  createdAt: Date;
  eseguitoAt: Date | null;
};

// Contabilità dei byte per azienda (WS3, spec §3.2): una riga per tenant,
// nata al primo delta o al primo ricalcolo — non al seed del tenant, perché
// un'azienda senza file non ha nulla da contare.
export type StatoStorage = {
  tenantId: number;
  bytes: number;
  file: number;
  quotaBytes: number;
  sogliaAvvisata: 0 | 50 | 80 | 100;
  ricalcolatoIl: Date | null;
  aggiornatoIl: Date;
  // WS4 (quota che blocca, spec §6): da quando la quota è al 100 %, ininterrottamente.
  // NULL sotto al 100 % o appena ridisceso: la tolleranza (spec §6) si conta da qui.
  soglia100Dal: Date | null;
};

// Abbonamento dell'azienda (WS4, spec §3): control plane, una riga per
// tenant. `tipo: "complimentary"` è l'omaggio (proprietaria, partner, prova
// prolungata a mano): senza `periodicita` né rinnovo. Il dominio (server/abbonamenti/)
// interpreta questi campi; qui è solo persistenza.
export type TipoAbbonamento = "paid" | "complimentary";
export type Periodicita = "monthly" | "yearly";
export type StatoAbbonamento = "trialing" | "active" | "past_due" | "grace" | "suspended" | "cancelled";

export type Omaggio = {
  motivo: string;
  attore: string;
  dataIso: string;
  scadenzaIso: string | null;
};

export type Abbonamento = {
  tenantId: number;
  tipo: TipoAbbonamento;
  periodicita: Periodicita | null;
  stato: StatoAbbonamento;
  inizioPeriodo: Date;
  finePeriodo: Date | null;
  prossimoRinnovo: Date | null;
  disdettaAFinePeriodo: boolean;
  budgetTarsNanoMese: number | null;
  extraTarsNano: number;
  extraTarsMese: string | null;
  tolleranzaStorageGiorni: number;
  tolleranzaTarsGiorni: number;
  tarsSogliaAvvisata: 0 | 50 | 80 | 100;
  tarsSogliaMese: string | null;
  tarsSoglia100Dal: Date | null;
  insolutoDal: Date | null;
  provider: string;
  providerRef: Record<string, unknown> | null;
  omaggio: Omaggio | null;
  createdAt: Date;
  updatedAt: Date;
};

// `state` OAuth persistito (WS3, spec §5): FiC e Google Drive condividono la
// stessa forma, distinta dal `tipo` — un `state` emesso per l'uno non vale
// per l'altro, anche se la stringa combaciasse per caso.
export type TipoStateOAuth = "fic" | "gdrive";

export type StateOAuth = {
  state: string;
  tipo: TipoStateOAuth;
  tenantId: number;
  sedeId: number | null;
  utenteId: number;
  payload: Record<string, unknown>;
  scadeIl: Date;
};

// Inviti del pannello piattaforma (WS6, spec §4.1): un token monouso che
// completa la creazione di un'azienda — il destinatario lo apre, imposta la
// password ed entra come proprietario. Il token in chiaro esce una volta
// sola dal repository (`emettiInvito`): questo tipo di lettura non lo porta
// mai, né porta il suo hash.
export type TipoInvito = "proprietario";

export type TenantInvito = {
  id: number;
  tenantId: number;
  utenteId: number;
  email: string;
  tipo: TipoInvito;
  scadeIl: Date;
  creatoDa: string;
  createdAt: Date;
  usatoIl: Date | null;
  annullatoIl: Date | null;
};
