// server/tenants/cli.ts — parti pure dello script `pnpm tenant`.
import type { TenantEvento, TipoComando } from "./tipi";

export type Opzioni = {
  sotto: string | null;
  valori: Record<string, string>;
  flag: Set<string>;
};

export function opzioni(argv: readonly string[]): Opzioni {
  const [, , sotto = null, ...resto] = argv;
  const valori: Record<string, string> = {};
  const flag = new Set<string>();
  for (const arg of resto) {
    if (!arg.startsWith("--")) continue;
    const corpo = arg.slice(2);
    const uguale = corpo.indexOf("=");
    if (uguale === -1) flag.add(corpo);
    else valori[corpo.slice(0, uguale)] = corpo.slice(uguale + 1);
  }
  return { sotto: sotto && !sotto.startsWith("--") ? sotto : null, valori, flag };
}

export function anteprima(comando: {
  tipo: TipoComando;
  tenantId: number | null;
  payload: Record<string, unknown>;
}): string {
  const payload: Record<string, unknown> = { ...comando.payload };
  const proprietario = payload.proprietario as Record<string, unknown> | undefined;
  if (proprietario && "passwordHash" in proprietario) {
    payload.proprietario = { ...proprietario, passwordHash: "<hash>" };
  }
  return JSON.stringify({ tipo: comando.tipo, tenantId: comando.tenantId, payload }, null, 2);
}

/** I worker sospesi secondo gli eventi: l'ultima sospensione per etichetta, non seguita da un riarmo e non ancora scaduta. */
export function workerSospesi(
  eventi: TenantEvento[],
  adesso = new Date()
): Array<{ etichetta: string; finoA: Date; errore: string }> {
  const ultimo = new Map<string, TenantEvento>();
  for (const e of eventi) {
    if (e.tipo !== "worker_sospeso" && e.tipo !== "worker_riarmato") continue;
    const etichetta = String(e.dettagli?.etichetta ?? "");
    if (etichetta) ultimo.set(etichetta, e);
  }
  const out: Array<{ etichetta: string; finoA: Date; errore: string }> = [];
  for (const [etichetta, e] of ultimo) {
    if (e.tipo !== "worker_sospeso") continue;
    const finoA = new Date(e.createdAt.getTime() + Number(e.dettagli?.minuti ?? 0) * 60_000);
    if (finoA > adesso) out.push({ etichetta, finoA, errore: String(e.dettagli?.errore ?? "") });
  }
  return out;
}
