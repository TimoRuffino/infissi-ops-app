// Registro delle versioni di entità (T3) — spec §21, decisioni 17 e 19.
//
// Una «versione» è un valore economico da calcolare che cambia SEMPRE
// quando l'entità cambia: qui updatedAt (o un hash id+updatedAt per le
// liste, così anche un'entità NUOVA invalida). Il registro sonda le
// versioni CORRENTI a costo trascurabile: è il fondamento
// dell'invalidazione di C0 v2 e del fascicolo C3. Un riferimento che il
// registro non sa sondare restituisce null e chi chiede DEVE trattarlo
// come «freschezza non verificabile» (niente riuso): fail-closed.

import { createHash } from "node:crypto";
import { versioneRegistroPagamenti } from "../_core/commessaPayments";
import { getCommessaById, getCommesseStore } from "../routers/commesse";
import { getOrdiniFornitoreDiSede } from "../routers/fornitori";

export function versioneData(valore: unknown): string {
  const data = valore instanceof Date ? valore : new Date(String(valore ?? 0));
  return Number.isNaN(data.getTime()) ? "-" : String(data.getTime());
}

function hashLista(coppie: Array<[number | string, string]>): string {
  return createHash("sha256")
    .update(
      coppie
        .map(([id, v]) => `${id}:${v}`)
        .sort()
        .join("|")
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Versione corrente del riferimento nella sede, o null se il registro
 * non sa sondarlo (o l'entità non è visibile dalla sede).
 */
export function versioneCorrente(
  riferimento: string,
  sedeId: number
): string | null {
  const [tipo, ...resto] = riferimento.split(":");
  const arg = resto.join(":");

  if (tipo === "commessa") {
    const c: any = getCommessaById(Number(arg));
    if (!c || c.sedeId !== sedeId) return null;
    return versioneData(c.updatedAt);
  }
  if (tipo === "registroPagamenti" && arg.startsWith("commessa:")) {
    const c: any = getCommessaById(Number(arg.slice("commessa:".length)));
    if (!c || c.sedeId !== sedeId) return null;
    return versioneRegistroPagamenti(c.pagamenti);
  }
  if (tipo === "ordine") {
    const trovato = getOrdiniFornitoreDiSede(sedeId).find(
      o => o.ordine.id === Number(arg)
    );
    return trovato ? versioneData(trovato.ordine.updatedAt) : null;
  }
  if (tipo === "ordini-di-commessa") {
    const commessaId = Number(arg);
    return hashLista(
      getOrdiniFornitoreDiSede(sedeId)
        .filter(o => o.ordine.commessaId === commessaId)
        .map(o => [o.ordine.id, versioneData(o.ordine.updatedAt)])
    );
  }
  if (tipo === "commesse-sede") {
    if (Number(arg) !== sedeId) return null;
    return hashLista(
      (getCommesseStore() as any[])
        .filter(c => c.sedeId === sedeId)
        .map(c => [c.id, versioneData(c.updatedAt)])
    );
  }
  if (tipo === "ordini-sede") {
    if (Number(arg) !== sedeId) return null;
    return hashLista(
      getOrdiniFornitoreDiSede(sedeId).map(o => [
        o.ordine.id,
        versioneData(o.ordine.updatedAt),
      ])
    );
  }
  return null;
}

/** Tutte le versioni richieste coincidono con le correnti (fail-closed). */
export function versioniAncoraValide(
  versioni: Record<string, string>,
  sedeId: number
): boolean {
  return Object.entries(versioni).every(([riferimento, valore]) => {
    const corrente = versioneCorrente(riferimento, sedeId);
    return corrente != null && corrente === valore;
  });
}
