// server/tenants/cli.ts — parti pure dello script `pnpm tenant`.
import type { TipoComando } from "./tipi";

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
