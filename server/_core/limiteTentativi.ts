// server/_core/limiteTentativi.ts
// Limitatore di tentativi in memoria, per chiave (WS6 §3.2). Estratto dal
// vecchio limitatore di login di routers.ts:60-96, parametrizzato: il login
// lo usa con i numeri di sempre (comportamento invariato) e il pannello
// piattaforma lo riusa per la conferma password e per la pagina d'invito,
// ciascuno con la propria finestra e la propria chiave.
//
// Chiave minuscola così un tentativo con maiuscole diverse (email digitata a
// mano) resta sotto lo stesso contatore. Evizione lazy: una chiave fuori
// finestra viene ripulita alla prossima lettura, non da un timer separato.
import { TRPCError } from "@trpc/server";

export type LimiteTentativi = {
  /** Lancia TOO_MANY_REQUESTS se `chiave` ha già raggiunto il massimo dentro la finestra. */
  verifica(chiave: string): void;
  /** Registra un tentativo fallito per `chiave`. */
  fallito(chiave: string): void;
  /** Azzera il contatore di `chiave` (successo). */
  azzera(chiave: string): void;
  /** Solo per i test: svuota ogni chiave. */
  __azzeraTutto(): void;
};

export function creaLimiteTentativi(opzioni: {
  finestraMs: number;
  massimo: number;
  messaggio: string;
}): LimiteTentativi {
  const tentativi = new Map<string, { count: number; firstAt: number }>();

  function verifica(chiave: string): void {
    const key = chiave.toLowerCase();
    const rec = tentativi.get(key);
    if (!rec) return;
    if (Date.now() - rec.firstAt > opzioni.finestraMs) {
      tentativi.delete(key);
      return;
    }
    if (rec.count >= opzioni.massimo) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: opzioni.messaggio });
    }
  }

  function fallito(chiave: string): void {
    const key = chiave.toLowerCase();
    const rec = tentativi.get(key);
    if (!rec || Date.now() - rec.firstAt > opzioni.finestraMs) {
      tentativi.set(key, { count: 1, firstAt: Date.now() });
    } else {
      rec.count++;
    }
  }

  function azzera(chiave: string): void {
    tentativi.delete(chiave.toLowerCase());
  }

  function __azzeraTutto(): void {
    if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
    tentativi.clear();
  }

  return { verifica, fallito, azzera, __azzeraTutto };
}
