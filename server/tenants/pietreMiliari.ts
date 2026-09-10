// server/tenants/pietreMiliari.ts
// Il percorso di attivazione come DATI (ciclo di vita, piano 10/09/2026,
// D9): la prima commessa, la prima fattura e il primo utente aggiunto
// diventano eventi di `tenant_eventi`, una volta sola per azienda. Il
// pannello piattaforma li legge dal control plane senza toccare i moduli di
// dominio (guardia server/piattaforma/confine.test.ts); la quarta tappa,
// `invito_accettato`, esiste già.
//
// Costo: una query di esistenza per (azienda, tappa) per processo — poi la
// cache in memoria risponde lei. Mai un errore che propaga nel flusso di
// dominio: perdere una pietra miliare non deve far fallire una commessa.
import { interruttoreAttivo } from "../platform/interruttori";
import { getTenantRepository } from "./repository";
import type { TipoEvento } from "./tipi";

export type PietraMiliare = "prima_commessa" | "prima_fattura" | "primo_utente_aggiunto";

export const PIETRE_MILIARI: readonly PietraMiliare[] = [
  "prima_commessa",
  "prima_fattura",
  "primo_utente_aggiunto",
];

const segnate = new Set<string>();

/** Solo per i test: azzera la cache in memoria fra un caso e l'altro. */
export function __azzeraPietreMiliariPerTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY_PIETRE_MILIARI");
  segnate.clear();
}

/**
 * Registra la pietra miliare se per quell'azienda non esiste ancora.
 * Inerte a interruttore spento (a flag spento c'è solo il tenant 1, che ha
 * anni di commesse alle spalle: solo rumore). `dettagli` porta l'id del
 * record che l'ha innescata, mai altro.
 */
export async function segnaPietraMiliare(
  tenantId: number,
  tipo: PietraMiliare,
  dettagli?: Record<string, unknown>
): Promise<void> {
  if (!interruttoreAttivo("multiAzienda")) return;
  const chiave = `${tenantId}:${tipo}`;
  if (segnate.has(chiave)) return;
  try {
    const repo = getTenantRepository();
    if (!(await repo.esisteEvento(tenantId, tipo as TipoEvento))) {
      await repo.registraEvento({ tenantId, tipo: tipo as TipoEvento, attore: "sistema", dettagli: dettagli ?? null });
    }
    segnate.add(chiave);
  } catch (errore) {
    console.error(
      `[pietre-miliari] ${tipo} del tenant ${tenantId} non registrata:`,
      errore instanceof Error ? errore.message : errore
    );
  }
}
