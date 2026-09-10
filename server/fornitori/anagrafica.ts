// L'anagrafica dei fornitori dell'azienda.
//
// Sta qui e non nel router perché la leggono anche il riconoscitore
// (`riconoscimento.ts`) e il pre-filtro della posta
// (`comunicazioni/comunicazioni.ts`): passare dal router — che importa
// `fornitori/archivio.ts`, che importa `comunicazioni` — sarebbe un ciclo.
// Modulo foglia: da qui non si importa niente di dominio.

import { persistedStore } from "../_core/persistence";
import { DEFAULT_SEDE_ID } from "../routers/sedi";

export type CanaleFornitore = "mail" | "portale" | "altro";

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
  /**
   * Le parole e i domini con cui si riconosce questo fornitore nel testo di un
   * documento o nel dominio di una mail. È la parte che fino al 10/09/2026
   * viveva nella costante `FORNITORI_NOTI` di `shared/fornitori.ts`.
   */
  chiavi: string[];
  /** Come gli si ordina (spec ordini §3, D-E). */
  canale: CanaleFornitore;
  /**
   * I domini del PORTALE con cui si ordina da lui: `antenore.biz` per Wnd. Un
   * portale non è un fornitore, è un canale: riconduce al produttore.
   */
  portaleDomini: string[];
  referenteCommerciale?: string;
  scontistica?: number; // % sconto
  note?: string;
  attivo: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** I default dei campi aggiunti il 10/09/2026, applicati ai record salvati prima. */
export function applicaBackfillFornitori(righe: readonly unknown[]): void {
  for (const riga of righe as any[]) {
    if (riga.sedeId === undefined) riga.sedeId = 1;
    if (!Array.isArray(riga.chiavi)) riga.chiavi = [];
    if (riga.canale !== "mail" && riga.canale !== "portale" && riga.canale !== "altro") {
      riga.canale = "mail";
    }
    if (!Array.isArray(riga.portaleDomini)) riga.portaleDomini = [];
  }
}

export const storeFornitori = persistedStore<Fornitore>("fornitori", loaded => {
  applicaBackfillFornitori(loaded);
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
