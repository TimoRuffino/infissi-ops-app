// L'anagrafica dei fornitori dell'azienda.
//
// Sta qui e non nel router perché la leggono anche il riconoscitore
// (`riconoscimento.ts`) e il pre-filtro della posta
// (`comunicazioni/comunicazioni.ts`): passare dal router — che importa
// `fornitori/archivio.ts`, che importa `comunicazioni` — sarebbe un ciclo.
// Modulo foglia: da qui non si importa niente di dominio.

import { persistedStore } from "../_core/persistence";
import { DEFAULT_SEDE_ID } from "../routers/sedi";

export type CategoriaFornitore =
  | "pvc" | "alluminio" | "vetro" | "ferramenta" | "persiane"
  | "blindati" | "accessori" | "guarnizioni" | "altro";

export type Fornitore = {
  id: number;
  sedeId?: number;
  ragioneSociale: string;
  /** Facoltativa: per riconoscere il mittente di una conferma non serve. */
  partitaIva?: string;
  indirizzo?: string;
  citta?: string;
  telefono?: string;
  email?: string;
  categoria: CategoriaFornitore;
  referenteCommerciale?: string;
  scontistica?: number; // % sconto
  note?: string;
  attivo: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const storeFornitori = persistedStore<Fornitore>("fornitori", loaded => {
  for (const f of loaded) {
    if ((f as any).sedeId === undefined) (f as any).sedeId = 1;
  }
});

const fornitori = storeFornitori.items;

/** I fornitori di una sede, in ordine alfabetico. */
export function fornitoriDiSede(sedeId: number): Fornitore[] {
  return fornitori
    .filter(f => (f.sedeId ?? DEFAULT_SEDE_ID) === sedeId)
    .sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale));
}

/** Fail-closed: un fornitore di un'altra sede non esiste. */
export function fornitoreDiSedeById(id: number, sedeId: number): Fornitore | null {
  const f = fornitori.find(x => x.id === id);
  if (!f) return null;
  return (f.sedeId ?? DEFAULT_SEDE_ID) === sedeId ? f : null;
}
