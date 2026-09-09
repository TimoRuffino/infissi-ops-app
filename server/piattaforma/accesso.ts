// server/piattaforma/accesso.ts
// Chi amministra la piattaforma (WS6 §3.1): stesso utente, potere in più. Un
// amministratore è un utente attivo del tenant predefinito la cui email
// compare in PLATFORM_ADMIN_EMAILS — letta a ogni chiamata, senza cache,
// come interruttoreAttivo: togliere un'email vale subito.
import { TRPCError } from "@trpc/server";
import { creaLimiteTentativi } from "../_core/limiteTentativi";
import { verifyPassword } from "../_core/password";
import { getUtentiStore } from "../routers/utenti";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { conTenant } from "../tenants/contestoCorrente";
import { MESSAGGI_PIATTAFORMA, VARIABILE_AMMINISTRATORI } from "./costanti";

/** Le email amministratrici della piattaforma, senza maiuscole né spazi. */
export function emailAmministratori(): Set<string> {
  return new Set(
    (process.env[VARIABILE_AMMINISTRATORI] ?? "")
      .split(",")
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Pura: vero solo se l'utente è presente, attivo, del tenant predefinito e
 * con l'email nell'elenco. Non tocca lo store: chi chiama decide da dove
 * viene il record (JWT, riga fresca dello store, oggetto di test).
 */
export function amministraPiattaforma(
  user: { email?: string | null; tenantId?: number | null; attivo?: boolean } | null | undefined
): boolean {
  if (!user?.email || user.attivo === false) return false;
  if ((user.tenantId ?? null) !== TENANT_PREDEFINITO_ID) return false;
  return emailAmministratori().has(user.email.trim().toLowerCase());
}

/**
 * Il record vivo dell'utente della sessione, riletto dallo store del tenant
 * 1 (ruoli e `attivo` non vengono dal JWT, come fa già `createContext`).
 * Come `risolviTenantPerUtente` (tenants/contesto.ts): solo `loginMethod ===
 * "local"` viene cercato nello store — un utente OAuth legacy (`User` di
 * `drizzle/schema.ts`) ha un `id` numerico di un'altra tabella che potrebbe
 * combaciare per caso con quello di un amministratore locale.
 * `null` se l'utente non esiste più, è disattivato, non è locale o non amministra.
 */
export function utenteAmministratore(
  user: { id?: unknown; loginMethod?: string | null } | null
): any | null {
  if (!user || user.loginMethod !== "local" || typeof user.id !== "number") return null;
  const id = user.id;
  const record = conTenant(TENANT_PREDEFINITO_ID, () =>
    getUtentiStore().find((u: any) => u.id === id) ?? null
  );
  return record && amministraPiattaforma({ email: record.email, tenantId: record.tenantId, attivo: record.attivo })
    ? record
    : null;
}

// Stesso limitatore del login (WS6 §3.2: 5 tentativi in 15 minuti), chiave
// diversa così i due contatori non si mescolano.
const limiteConferme = creaLimiteTentativi({
  finestraMs: 15 * 60 * 1000,
  massimo: 5,
  messaggio: MESSAGGI_PIATTAFORMA.troppiTentativi,
});

/**
 * Verifica la password di `user` per le mutation sensibili del pannello
 * (WS6 §3.2). Lancia UNAUTHORIZED se non corrisponde, TOO_MANY_REQUESTS se
 * il limite è già stato raggiunto. Non logga mai l'email intera, solo il
 * dominio, per non finire coi dati del cliente nei log. `loginMethod` passa
 * dritto a `utenteAmministratore`: chi chiama (una mutation dietro
 * `piattaformaProcedure`, con `ctx.user` o `ctx.amministratore` già accertati
 * locali) deve dichiararlo, non deduciamo mai "local" per conto suo.
 */
export function confermaPassword(
  user: { id: number; email?: string | null; loginMethod?: string | null },
  password: string
): void {
  const chiave = `conferma:${(user.email ?? String(user.id)).toLowerCase()}`;
  limiteConferme.verifica(chiave);
  const record = utenteAmministratore(user);
  if (!record || !verifyPassword(password, record.password)) {
    limiteConferme.fallito(chiave);
    console.warn(`[piattaforma] conferma password rifiutata per ${(user.email ?? "").split("@")[1] ?? "?"}`);
    throw new TRPCError({ code: "UNAUTHORIZED", message: MESSAGGI_PIATTAFORMA.passwordNonCorretta });
  }
  limiteConferme.azzera(chiave);
}

/** Solo per i test: azzera il limitatore della conferma password. */
export function __azzeraLimiteConfermePerTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  limiteConferme.__azzeraTutto();
}
