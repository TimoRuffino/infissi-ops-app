// I profili di lettura e gli esempi da cui nascono.
//
// Modulo FOGLIA come `anagrafica.ts`, e per lo stesso motivo: lo leggono
// `costoDaConferma` e `archivio`, e passare da un router che importa
// l'archivio sarebbe un ciclo.
//
// La chiave di un profilo è `(sedeId, fornitoreId, impronta)`: un fornitore
// ha più moduli — Alias manda sia «Ordini_di_Vendi» sia «Esportazione» — e
// sono profili diversi, non uno che si sovrascrive.

import type { AncoraCampo, ProfiloLettura } from "@shared/documenti/profilo";
import { persistedStore } from "../_core/persistence";
import { DEFAULT_SEDE_ID } from "../routers/sedi";
import { improntaLayout } from "../documenti/impronta";
import { interruttoreAttivo } from "../platform/interruttori";

export type EsempioConferma = {
  id: number;
  sedeId: number;
  fornitoreId: number;
  nomeFile: string;
  mimeType: string;
  storageKey: string;
  checksum: string;
  size: number;
  /** Null quando il file non si è potuto leggere: un illeggibile non è una forma. */
  impronta: string | null;
  createdBy: number | null;
  createdAt: Date;
};

export const storeProfili = persistedStore<ProfiloLettura>("fornitori_profili", righe => {
  for (const r of righe as any[]) {
    if (r.sedeId === undefined) r.sedeId = DEFAULT_SEDE_ID;
    if (!Array.isArray(r.ancore)) r.ancore = [];
    if (r.blocco === undefined) r.blocco = null;
    if (typeof r.lettureSenzaCorrezione !== "number") r.lettureSenzaCorrezione = 0;
    if (typeof r.versione !== "number") r.versione = 1;
    if (r.origine !== "correzione" && r.origine !== "catalogo") r.origine = "correzione";
    if (r.esempioId === undefined) r.esempioId = null;
  }
});

export const storeEsempi = persistedStore<EsempioConferma>("fornitori_esempi", righe => {
  for (const r of righe as any[]) {
    if (r.sedeId === undefined) r.sedeId = DEFAULT_SEDE_ID;
    if (r.impronta === undefined) r.impronta = null;
  }
});

const profili = storeProfili.items;

function diSede(p: ProfiloLettura, sedeId: number): boolean {
  return (p.sedeId ?? DEFAULT_SEDE_ID) === sedeId;
}

/**
 * Il profilo del MODULO che queste pagine sono, se ne conosciamo uno. Si
 * cerca per impronta e non per fornitore: è ciò che permette di scegliere il
 * profilo PRIMA di sapere di chi è la conferma.
 */
export function profiloPerPagine(
  sedeId: number,
  pagine: readonly string[]
): ProfiloLettura | null {
  if (pagine.length === 0) return null;
  const impronta = improntaLayout(pagine);
  const candidati = profili.filter(p => diSede(p, sedeId) && p.impronta === impronta);
  if (candidati.length === 0) return null;
  // Due fornitori della stessa sede possono usare lo stesso modulo (capita con
  // i rivenditori dello stesso produttore). Vince il profilo aggiornato più di
  // recente: una regola qualunque andrebbe bene, purché sia UNA — un profilo
  // scelto a caso fra due darebbe letture diverse dello stesso file.
  return candidati.reduce((migliore, p) =>
    new Date(p.updatedAt).getTime() >= new Date(migliore.updatedAt).getTime() ? p : migliore
  );
}

export function profiliDiFornitore(sedeId: number, fornitoreId: number): ProfiloLettura[] {
  return profili.filter(p => diSede(p, sedeId) && p.fornitoreId === fornitoreId);
}

export function salvaProfilo(input: {
  sedeId: number;
  fornitoreId: number;
  impronta: string;
  ancore: readonly AncoraCampo[];
  blocco: ProfiloLettura["blocco"];
  esempioId: number | null;
  createdBy: number | null;
}): ProfiloLettura {
  const now = new Date();
  const esistente = profili.find(
    p =>
      diSede(p, input.sedeId) &&
      p.fornitoreId === input.fornitoreId &&
      p.impronta === input.impronta
  );
  if (esistente) {
    esistente.ancore = [...input.ancore];
    esistente.blocco = input.blocco;
    esistente.esempioId = input.esempioId ?? esistente.esempioId;
    esistente.versione += 1;
    // Un profilo riscritto è un profilo in prova: le letture pulite di prima
    // valevano per le ancore di prima.
    esistente.lettureSenzaCorrezione = 0;
    esistente.updatedAt = now;
    storeProfili.save();
    return esistente;
  }
  const nuovo: ProfiloLettura = {
    id: storeProfili.prossimoId(),
    sedeId: input.sedeId,
    fornitoreId: input.fornitoreId,
    versione: 1,
    impronta: input.impronta,
    ancore: [...input.ancore],
    blocco: input.blocco,
    origine: "correzione",
    esempioId: input.esempioId,
    lettureSenzaCorrezione: 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  profili.push(nuovo);
  storeProfili.save();
  return nuovo;
}

/** Una conferma letta con questo profilo che nessuno ha corretto. */
export function segnaLetturaPulita(profiloId: number, sedeId: number): void {
  const p = profili.find(x => x.id === profiloId && diSede(x, sedeId));
  if (!p) return;
  p.lettureSenzaCorrezione += 1;
  p.updatedAt = new Date();
  storeProfili.save();
}

/** Una smentita sola rimette il profilo in prova: è il comportamento voluto. */
export function azzeraLetturePulite(profiloId: number, sedeId: number): void {
  const p = profili.find(x => x.id === profiloId && diSede(x, sedeId));
  if (!p || p.lettureSenzaCorrezione === 0) return;
  p.lettureSenzaCorrezione = 0;
  p.updatedAt = new Date();
  storeProfili.save();
}

/**
 * Il profilo da passare all'estrattore per queste pagine. È l'UNICO punto che
 * guarda l'interruttore: i chiamanti non lo sanno e non devono saperlo.
 */
export function contestoProfilo(
  sedeId: number,
  pagine: readonly string[]
): { profilo: { ancore: readonly AncoraCampo[] } | null; profiloId: number | null } {
  if (!interruttoreAttivo("profiliLettura")) return { profilo: null, profiloId: null };
  const p = profiloPerPagine(sedeId, pagine);
  if (!p) return { profilo: null, profiloId: null };
  return { profilo: { ancore: p.ancore }, profiloId: p.id };
}

/**
 * Il fornitore HA profili, ma nessuno combacia con queste pagine: ha cambiato
 * modulo (spec §5.4). Va detto — un profilo che smette di combaciare in
 * silenzio è peggio di nessun profilo, perché il costo nasce da quella
 * lettura.
 */
export function moduloSconosciuto(
  sedeId: number,
  fornitoreId: number | null,
  pagine: readonly string[]
): boolean {
  if (!interruttoreAttivo("profiliLettura")) return false;
  if (fornitoreId == null) return false;
  if (profiliDiFornitore(sedeId, fornitoreId).length === 0) return false;
  return profiloPerPagine(sedeId, pagine) == null;
}

/** Solo per i test. */
export function azzeraProfiliPerTest(): void {
  storeProfili.items.splice(0, storeProfili.items.length);
  storeEsempi.items.splice(0, storeEsempi.items.length);
}
