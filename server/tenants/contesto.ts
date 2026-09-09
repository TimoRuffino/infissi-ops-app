// server/tenants/contesto.ts
// Risoluzione del tenant per la richiesta: chi è l'utente (dallo store, non
// dal JWT), a quale azienda appartiene, quali sedi può vedere.
import { getSedeById, sediAttiveDelTenant, sedePredefinita } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { RUOLO_PROPRIETARIO, TENANT_PREDEFINITO_ID } from "./costanti";
import { ruoliDi } from "./regole";
import { getTenantRepository } from "./repository";
import type { TenantRecord } from "./tipi";

export type TenantRisolto = { utente: any; tenantId: number; tenant: TenantRecord };

/**
 * Solo utenti locali (`loginMethod: "local"`): un utente del percorso OAuth
 * legacy non viene cercato nello store (i suoi id vengono da un'altra tabella
 * e potrebbero collidere) e, con interruttore acceso, non ha tenant.
 * `null` = sessione da rifiutare: utente assente, disattivato, o tenant sconosciuto.
 */
export function risolviTenantPerUtente(
  user: { id?: number | null; loginMethod?: string | null } | null | undefined
): TenantRisolto | null {
  if (!user || user.id == null || user.loginMethod !== "local") return null;
  const utente = getUtentiStore().find((u: any) => u.id === user.id);
  if (!utente || utente.attivo === false) return null;
  const tenantId =
    typeof utente.tenantId === "number" ? utente.tenantId : TENANT_PREDEFINITO_ID;
  const tenant = getTenantRepository().perId(tenantId);
  if (!tenant) return null;
  return { utente, tenantId, tenant };
}

/**
 * Porta chiusa a interruttore SPENTO (WS6, ruling R10). A flag spento
 * `createContext` fissa `tenantId = TENANT_PREDEFINITO_ID` per chiunque e
 * `allowedSediForUser` non guarda l'azienda: la sessione di un utente del
 * tenant 2 lo porterebbe dentro Ruffino Group, con tutte le sue sedi. Finché
 * il multi-azienda è spento, quindi, chi non è di Ruffino Group non ha
 * sessione e non fa login — spegnere l'interruttore torna a essere «il CRM
 * di prima» solo perché nessun altro entra.
 *
 * Restituisce l'id dell'azienda che vieta la sessione, `null` quando la
 * sessione è ammessa: utente di Ruffino Group, oppure record assente dallo
 * store (un utente OAuth legacy non ha azienda e resta com'era).
 */
export function tenantVietatoASpento(
  user: { id?: number | null; loginMethod?: string | null } | null | undefined
): number | null {
  if (!user || user.id == null || user.loginMethod !== "local") return null;
  const utente = getUtentiStore().find((u: any) => u.id === user.id);
  return tenantVietato(utente);
}

/** Come sopra, ma dal record dello store già in mano (il login ce l'ha). */
export function tenantVietato(utente: { tenantId?: unknown } | null | undefined): number | null {
  const tenantId = typeof utente?.tenantId === "number" ? utente.tenantId : null;
  return tenantId != null && tenantId !== TENANT_PREDEFINITO_ID ? tenantId : null;
}

/**
 * Le sedi che l'utente può vedere nel tenant: direzione e proprietario tutte
 * quelle attive; gli altri le assegnate che appartengono al tenant; se nessuna,
 * la prima sede attiva del tenant. Mai una sede di un altro tenant.
 */
export function sediAmmesse(
  user: { id?: number | null; ruoli?: unknown; ruolo?: unknown; sediIds?: unknown } | null | undefined,
  tenantId: number
): number[] {
  const record = getUtentiStore().find((u: any) => u.id === user?.id) ?? user;
  const ruoli = ruoliDi(record);
  const delTenant = sediAttiveDelTenant(tenantId).map(s => s.id);
  if (ruoli.includes("direzione") || ruoli.includes(RUOLO_PROPRIETARIO)) return delTenant;
  const assegnate: number[] = Array.isArray((record as any)?.sediIds) ? (record as any).sediIds : [];
  const valide = assegnate.filter(id => delTenant.includes(id));
  if (valide.length) return valide;
  const ripiego = sedePredefinita(tenantId);
  return ripiego == null ? [] : [ripiego];
}

/** Per i worker che girano per sede: il tenant della sede, 1 se la sede non c'è. */
export function tenantIdDellaSede(sedeId: number): number {
  return getSedeById(sedeId)?.tenantId ?? TENANT_PREDEFINITO_ID;
}
