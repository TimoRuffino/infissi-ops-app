// server/tenants/express.ts
// La guardia del tenant per le rotte Express (WS2, Task 8): stessa regola
// della guardiaTenant di tRPC in _core/trpc.ts — `motivoRifiutoTenant` (pura)
// decide, qui la traduciamo in un 412 con lo stesso messaggio — per le rotte
// che non passano da tRPC: i file di commessa, gli allegati di posta, le
// anteprime e lo stream SSE delle notifiche. `conTenantDelContesto` mette il
// tenant della richiesta nell'ALS per la durata del gestore, così gli store
// che lo leggono (persistedStore) vedono il tenant giusto anche fuori da tRPC.
import type { Response } from "express";
import { TENANT_PREDEFINITO_ID } from "./costanti";
import { conTenant } from "./contestoCorrente";
import { motivoRifiutoTenant } from "./regole";
import type { TenantRecord } from "./tipi";

type Ctx = { tenantId: number | null; tenant: TenantRecord | null; sedeId: number | null };

/** Stessa guardia di tRPC per le rotte Express: 412 con lo stesso messaggio. */
export function rifiutaTenant(res: Response, ctx: Ctx, op: { scrittura: boolean }): boolean {
  const rifiuto = motivoRifiutoTenant(ctx, op);
  if (!rifiuto) return false;
  res.status(412).json({ error: rifiuto.messaggio });
  return true;
}

/** Il tenant della richiesta nel contesto per tutta la durata di `fn`. */
export function conTenantDelContesto<T>(ctx: { tenantId: number | null }, fn: () => T): T {
  return conTenant(ctx.tenantId ?? TENANT_PREDEFINITO_ID, fn);
}
