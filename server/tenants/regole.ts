// Regole pure del tenant: niente store, niente database, niente tRPC.
import { interruttoreAttivo } from "../platform/interruttori";
import { MESSAGGI, RUOLO_PROPRIETARIO, SLUG_RE, TENANT_PREDEFINITO_ID } from "./costanti";
import type { StatoTenant, TenantRecord } from "./tipi";

export type UtentePresidio = {
  id: number;
  attivo: boolean;
  ruoli: string[];
  tenantId: number;
};

export function slugValido(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export type Rifiuto = { codice: "PRECONDITION_FAILED"; messaggio: string };

/**
 * Gli stati che chiudono la porta del tutto (piano 10/09/2026, D2): niente
 * letture, niente scritture, nessuna esenzione — a differenza del `sospeso`,
 * che resta sola lettura. Il login usa la stessa lista (`routers.ts`).
 */
export const STATI_INACCESSIBILI: readonly StatoTenant[] = ["in_attesa", "archiviato", "cancellato"];

/** Guardia unica di tRPC ed Express (spec WS2 §5.2). Pura: legge solo l'interruttore. */
export function motivoRifiutoTenant(
  ctx: { tenantId: number | null; tenant: TenantRecord | null; sedeId: number | null },
  op: { scrittura: boolean; esente?: boolean }
): Rifiuto | null {
  if (!interruttoreAttivo("multiAzienda")) return null;
  if (!ctx.tenant) return null; // contesto senza record (test a mano): nessuna guardia, come nel WS1
  if (STATI_INACCESSIBILI.includes(ctx.tenant.stato)) {
    return { codice: "PRECONDITION_FAILED", messaggio: MESSAGGI.aziendaNonAccessibile };
  }
  if (op.scrittura && !op.esente && ctx.tenant.stato === "sospeso") {
    return { codice: "PRECONDITION_FAILED", messaggio: MESSAGGI.solaLettura };
  }
  if (ctx.sedeId == null) return { codice: "PRECONDITION_FAILED", messaggio: MESSAGGI.senzaSede };
  return null;
}

// ── Transizioni del ciclo di vita (piano 10/09/2026, D3) ────────────────────
// Da quali stati parte ciascuna azione. `sospendi` e `riattiva` restano
// permissive quanto basta ai flussi esistenti (una ri-sospensione aggiorna il
// motivo, il ripristino archivi sospende e riattiva senza guardare prima);
// gli stati nuovi si raggiungono e si lasciano un passaggio alla volta.
// `in_attesa` si lascia SOLO accettando l'invito (→ attivo) o con `cancella`.
export const STATI_DI_PARTENZA = {
  sospendi: ["attivo", "sospeso"],
  riattiva: ["attivo", "sospeso", "archiviato", "cancellato"],
  archivia: ["attivo", "sospeso"],
  cancella: ["in_attesa", "attivo", "sospeso", "archiviato"],
} as const satisfies Record<string, readonly StatoTenant[]>;

export type AzioneCicloDiVita = keyof typeof STATI_DI_PARTENZA;

/**
 * Messaggio di rifiuto se `azione` non può partire dallo stato attuale del
 * tenant (`null` = ammessa). Il caso «riattiva un cancellato già svuotato» ha
 * il suo messaggio: lì il problema non è lo stato, è che i dati non ci sono più.
 */
export function motivoRifiutoTransizione(
  azione: AzioneCicloDiVita,
  tenant: Pick<TenantRecord, "stato" | "svuotatoIl">
): string | null {
  if (azione === "riattiva" && tenant.stato === "cancellato" && tenant.svuotatoIl) {
    return MESSAGGI.aziendaSvuotata;
  }
  if (!(STATI_DI_PARTENZA[azione] as readonly StatoTenant[]).includes(tenant.stato)) {
    return `Transizione non ammessa: ${azione} da «${tenant.stato}».`;
  }
  return null;
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
 *
 * `opzioni.proprietari` (default `true`) governa solo la guardia
 * dell'ultimo proprietario: con `FLAG_MULTI_AZIENDA` spento il ruolo non è
 * assegnabile (spec §8.3, comportamento di prima del WS1) e la guardia non
 * deve scattare — `utenti.ts` passa `{ proprietari: multi }`. La guardia
 * dell'ultima direzione resta sempre attiva.
 */
export function motivoRifiutoPresidio(
  prima: UtentePresidio,
  dopo: UtentePresidio | null,
  utenti: readonly UtentePresidio[],
  opzioni: { proprietari: boolean } = { proprietari: true }
): string | null {
  const altri = utenti.filter(u => u.id !== prima.id);
  const futuro = dopo ? [...altri, dopo] : altri;
  const ora = contaPresidi(utenti, prima.tenantId);
  const poi = contaPresidi(futuro, prima.tenantId);
  if (ora.direzione > 0 && poi.direzione === 0) {
    return "Impossibile: questo è l'ultimo utente direzione attivo dell'azienda. Promuovi un altro utente prima di disattivarlo, eliminarlo o togliergli il ruolo.";
  }
  if (opzioni.proprietari && ora.proprietari > 0 && poi.proprietari === 0) {
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

/**
 * Lo store `sedi` letto come righe dello specchio `tenant_sedi` (Task 12):
 * una sede senza `tenantId` è una sede legacy, cioè del tenant 1 — la stessa
 * regola di ripiego di `presidioDi`. Pura: chi la chiama passa lo store.
 */
export function righeTenantSedi(
  sedi: ReadonlyArray<{ id: number; tenantId?: number | null }>
): Array<{ sedeId: number; tenantId: number }> {
  return sedi.map(s => ({
    sedeId: s.id,
    tenantId: typeof s.tenantId === "number" ? s.tenantId : TENANT_PREDEFINITO_ID,
  }));
}
