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
import { versioneFattureCommessa } from "../fatture/versioni";
import {
  interruttoreAttivo,
  statoInterruttori,
  type Interruttore,
} from "../platform/interruttori";
import { getCommessaById, getCommesseStore } from "../routers/commesse";
import { getOrdiniFornitoreDiSede } from "../routers/fornitori";
import { getDocumentiDiCommessa } from "../routers/preventiviContratti";
import { istanteComeLocale } from "./tempo";

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
    // Hash OPACO (revisione): il valore strutturato conteggio+timestamp
    // rivelerebbe l'attività di pagamento a chi non ha le capability.
    return createHash("sha256")
      .update(versioneRegistroPagamenti(c.pagamenti))
      .digest("hex")
      .slice(0, 16);
  }
  if (tipo === "documenti-di-commessa") {
    const commessaId = Number(arg);
    const c: any = getCommessaById(commessaId);
    if (!c || c.sedeId !== sedeId) return null;
    // Un documento NUOVO (o cambiato) invalida: è il gate documentale.
    return hashLista(
      getDocumentiDiCommessa(commessaId).map(d => [
        d.id,
        `${(d as any).tipo}:${(d as any).statoAtUpload ?? "-"}:${versioneData((d as any).createdAt)}`,
      ])
    );
  }
  if (tipo === "fatture-di-commessa") {
    // La versione vive in server/fatture/versioni.ts (contatore in
    // memoria, Task 17): qui solo il controllo di sede, come gli altri
    // riferimenti scoped a una commessa.
    const commessaId = Number(arg);
    const c: any = getCommessaById(commessaId);
    if (!c || c.sedeId !== sedeId) return null;
    return versioneFattureCommessa(sedeId, commessaId);
  }
  if (tipo === "flag") {
    // Ruling R33 (fix round 1, Task 17): sede-INDIPENDENTE per costruzione
    // — un interruttore vale per l'intera installazione, non per una
    // sede, quindi qui (a differenza di ogni altro ramo sopra) non c'è
    // nessun controllo di sede da fare. Un nome sconosciuto (typo, o un
    // interruttore rimosso) torna null: fail-closed, come da contratto di
    // questo registro. `Object.hasOwn` e non `in`: un nome come
    // «toString» o «constructor» esiste sul prototipo di qualunque
    // oggetto e passerebbe il controllo senza essere un interruttore.
    if (!Object.hasOwn(statoInterruttori(), arg)) return null;
    return String(interruttoreAttivo(arg as Interruttore));
  }
  if (tipo === "giorno-locale") {
    // Cambia alla mezzanotte di Roma: i derivati che dipendono da «oggi»
    // (ordini in ritardo) si invalidano col passare del giorno.
    return istanteComeLocale(new Date()).slice(0, 10);
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
