// Regole pure del tenant: niente store, niente database, niente tRPC.
import { RUOLO_PROPRIETARIO, SLUG_RE, TENANT_PREDEFINITO_ID } from "./costanti";

export type UtentePresidio = {
  id: number;
  attivo: boolean;
  ruoli: string[];
  tenantId: number;
};

export function slugValido(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * WS1 soltanto: la «porta chiusa». Gli archivi business non sono ancora
 * tenant-aware, quindi ogni tenant diverso dal predefinito viene rifiutato.
 * Il WS2 toglie questa funzione insieme ai suoi due chiamanti (guardia e login).
 */
export function portaChiusaPerTenant(tenantId: number): boolean {
  return tenantId !== TENANT_PREDEFINITO_ID;
}

export function ruoliDi(
  utente: { ruoli?: unknown; ruolo?: unknown } | null | undefined
): string[] {
  if (!utente) return [];
  if (Array.isArray(utente.ruoli) && utente.ruoli.length > 0) {
    return utente.ruoli.filter((r): r is string => typeof r === "string");
  }
  return typeof utente.ruolo === "string" && utente.ruolo ? [utente.ruolo] : [];
}

export function contaPresidi(
  utenti: readonly UtentePresidio[],
  tenantId: number
): { direzione: number; proprietari: number } {
  let direzione = 0;
  let proprietari = 0;
  for (const u of utenti) {
    if (!u.attivo || u.tenantId !== tenantId) continue;
    if (u.ruoli.includes("direzione")) direzione++;
    if (u.ruoli.includes(RUOLO_PROPRIETARIO)) proprietari++;
  }
  return { direzione, proprietari };
}

/**
 * Messaggio di rifiuto se la modifica (`dopo`) o la cancellazione (`dopo = null`)
 * lascerebbe il tenant di `prima` senza direzione attiva o senza proprietario
 * attivo. Il conteggio non attraversa mai i tenant.
 */
export function motivoRifiutoPresidio(
  prima: UtentePresidio,
  dopo: UtentePresidio | null,
  utenti: readonly UtentePresidio[]
): string | null {
  const altri = utenti.filter(u => u.id !== prima.id);
  const futuro = dopo ? [...altri, dopo] : altri;
  const ora = contaPresidi(utenti, prima.tenantId);
  const poi = contaPresidi(futuro, prima.tenantId);
  if (ora.direzione > 0 && poi.direzione === 0) {
    return "Impossibile: questo è l'ultimo utente direzione attivo dell'azienda. Promuovi un altro utente prima di disattivarlo, eliminarlo o togliergli il ruolo.";
  }
  if (ora.proprietari > 0 && poi.proprietari === 0) {
    return "Impossibile: questo è l'ultimo proprietario attivo dell'azienda. Nomina un altro proprietario prima di disattivarlo, eliminarlo o togliergli il ruolo.";
  }
  return null;
}

export function proprietarioAggiunto(prima: readonly string[], dopo: readonly string[]): boolean {
  return !prima.includes(RUOLO_PROPRIETARIO) && dopo.includes(RUOLO_PROPRIETARIO);
}

export function proprietarioTolto(prima: readonly string[], dopo: readonly string[]): boolean {
  return prima.includes(RUOLO_PROPRIETARIO) && !dopo.includes(RUOLO_PROPRIETARIO);
}

/** La vista «presidio» di un record utente dello store (tenant 1 se il campo manca). */
export function presidioDi(u: any): UtentePresidio {
  return {
    id: u.id,
    attivo: Boolean(u.attivo),
    ruoli: ruoliDi(u),
    tenantId: typeof u.tenantId === "number" ? u.tenantId : TENANT_PREDEFINITO_ID,
  };
}

/** Il tenant di un contesto: 1 quando il contesto non lo porta (interruttore spento). */
export function tenantDelContesto(ctx: { tenantId: number | null }): number {
  return ctx.tenantId ?? TENANT_PREDEFINITO_ID;
}
