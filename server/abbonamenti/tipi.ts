// server/abbonamenti/tipi.ts
// I tipi dell'abbonamento vivono nel control plane (`server/tenants/tipi.ts`)
// perché è il repository a persisterli (spec WS4 §3): qui solo la
// riesportazione, così il dominio si legge senza risalire ogni volta ai tenant.
export type {
  Abbonamento,
  Attore,
  Omaggio,
  Periodicita,
  StatoAbbonamento,
  TipoAbbonamento,
} from "../tenants/tipi";
