export type StatoTenant = "attivo" | "sospeso";

export type TenantRecord = {
  id: number;
  slug: string;
  nome: string;
  stato: StatoTenant;
  motivoStato: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  | "comando_fallito";

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
  | "revoca_proprietario";

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
