// server/_core/contestoDiProva.ts
// Un TrpcContext costruito a mano per i test dei router (WS1). Da usare nei
// test nuovi al posto delle funzioni `context()` locali.
import type { TenantRecord } from "../tenants/tipi";
import type { TrpcContext } from "./context";

export function contestoDiProva(input: {
  utenteId: number;
  ruoli?: string[];
  sedeId: number | null;
  sediIds?: number[];
  tenantId?: number | null;
  tenant?: TenantRecord | null;
  nome?: string;
  email?: string;
}): TrpcContext {
  const ruoli = input.ruoli ?? ["direzione"];
  const sediIds = input.sediIds ?? (input.sedeId == null ? [] : [input.sedeId]);
  return {
    user: {
      id: input.utenteId,
      openId: `local-${input.utenteId}`,
      name: input.nome ?? `Utente ${input.utenteId}`,
      email: input.email ?? `utente${input.utenteId}@prova.test`,
      loginMethod: "local",
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "http", headers: {} } as any,
    // `sedi.switch` e il login scrivono cookie: due no-op bastano.
    res: { cookie() {}, clearCookie() {} } as any,
    tenantId: input.tenantId === undefined ? 1 : input.tenantId,
    tenant: input.tenant ?? null,
    sedeId: input.sedeId,
    sediIds,
  };
}
