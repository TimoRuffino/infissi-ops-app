export type StatoTenant = "attivo" | "sospeso";

export type TenantRecord = {
  id: number;
  slug: string;
  nome: string;
  stato: StatoTenant;
  motivoStato: string | null;
  createdAt: Date;
  updatedAt: Date;
  storageQuotaBytes: number;
};

export type Attore =
  | { tipo: "utente"; id: number }
  | { tipo: "script"; nome: string }
  | { tipo: "boot" };

export function attoreTesto(attore: Attore): string {
  if (attore.tipo === "utente") return `utente:${attore.id}`;
  if (attore.tipo === "script") return attore.nome.startsWith("script:") ? attore.nome : `script:${attore.nome}`;
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
  | "archivi_ripristinati";

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
  | "ripristina_archivi";

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
