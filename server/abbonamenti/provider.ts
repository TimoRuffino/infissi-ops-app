// server/abbonamenti/provider.ts
// Adattatore del provider di pagamento (spec WS4 §5). Oggi esiste solo
// "nessuno": nessun checkout, nessun portale, nessun evento verificato —
// un'azienda vive di prova, omaggio e comandi manuali finché non arriva un
// provider vero. Il servizio (`servizio.ts`, `applicaEventoProvider`)
// consuma `EventoProvider` a prescindere da chi lo genera: la forma è già
// quella che serviranno checkout e webhook, cosicché collegare il provider
// vero non cambi il dominio, solo questo file.
//
// La scelta tra provider (`SAAS_PROVIDER_PAGAMENTI` da ambiente) arriva con
// il primo provider vero: oggi non c'è nulla tra cui scegliere, quindi
// `providerCorrente()` risponde sempre "nessuno".

/** Un evento del provider, già verificato e normalizzato (es. da un webhook). */
export type EventoProvider = {
  id: string;
  tipo: "pagamento_riuscito" | "pagamento_fallito" | "disdetta";
  tenantId: number;
  periodo: { inizio: Date; fine: Date } | null;
  periodicita?: "monthly" | "yearly";
};

export type ProviderPagamenti = {
  nome: string;
  /** Avvia il checkout e restituisce l'URL da aprire; `null` se il provider non lo offre. */
  avviaCheckout(input: {
    tenantId: number;
    periodicita: "monthly" | "yearly";
    ritornoUrl: string;
  }): Promise<string | null>;
  /** Portale self-service del proprietario (fatture, metodo di pagamento); `null` se assente. */
  urlPortale(tenantId: number): Promise<string | null>;
  /** Verifica firma e corpo di un webhook e lo normalizza; `null` se non valido. */
  verificaEvento(intestazioni: Record<string, string>, corpo: Buffer): Promise<EventoProvider | null>;
};

/** Nessun provider collegato: nessun checkout, nessun portale, nessun evento da verificare. */
const providerNessuno: ProviderPagamenti = {
  nome: "nessuno",
  async avviaCheckout() {
    return null;
  },
  async urlPortale() {
    return null;
  },
  async verificaEvento() {
    return null;
  },
};

/** Sostituito solo nei test (`__impostaProviderPerTest`), mai a runtime. */
let providerPerTest: ProviderPagamenti | null = null;

/**
 * Il provider attivo. Oggi sempre "nessuno" (v. commento in testa al file):
 * la lettura di `SAAS_PROVIDER_PAGAMENTI` nasce con il primo provider vero.
 */
export function providerCorrente(): ProviderPagamenti {
  if (providerPerTest) return providerPerTest;
  return providerNessuno;
}

/** Solo nei test: sostituisce il provider corrente, o lo azzera con `null`. */
export function __impostaProviderPerTest(p: ProviderPagamenti | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_PROVIDER_PAGAMENTI");
  providerPerTest = p;
}
