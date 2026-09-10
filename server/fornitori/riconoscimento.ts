// Il riconoscitore dei fornitori di UNA sede.
//
// È l'unico posto del server che sa dell'interruttore `fornitoriAzienda` e del
// seed della Ruffino Group: i consumatori chiedono qui e non sanno da dove
// esca l'elenco.
//
// Nessuna cache: si costruisce a ogni chiamata. Una cache di modulo in un CRM
// multi-azienda è il modo classico di far vedere a un'azienda i dati di
// un'altra, e costruirlo costa un `filter` su un elenco di decine di righe.

import {
  SEED_FORNITORI_TENANT_1,
  riconoscitoreFornitori,
  type FornitoreRiconoscibile,
  type Riconoscitore,
} from "@shared/fornitori";
import { interruttoreAttivo } from "../platform/interruttori";
import { fornitoriDiSede } from "./anagrafica";

/** Com'era prima del 10/09/2026: i venticinque della Ruffino Group. */
export function riconoscitoreDiRipiego(): Riconoscitore {
  return riconoscitoreFornitori(SEED_FORNITORI_TENANT_1);
}

/**
 * Un fornitore dell'anagrafica diventa DUE voci riconoscibili quando ha un
 * portale: le sue chiavi, e i domini del portale che riconducono a lui.
 */
function vociDi(f: {
  ragioneSociale: string;
  chiavi?: string[];
  portaleDomini?: string[];
}): FornitoreRiconoscibile[] {
  const voci: FornitoreRiconoscibile[] = [
    { nome: f.ragioneSociale, chiavi: f.chiavi ?? [] },
  ];
  if (f.portaleDomini?.length) {
    voci.push({
      nome: f.ragioneSociale,
      chiavi: f.portaleDomini,
      portaleDi: f.ragioneSociale,
    });
  }
  return voci;
}

export function riconoscitoreDiSede(sedeId: number): Riconoscitore {
  if (!interruttoreAttivo("fornitoriAzienda")) return riconoscitoreDiRipiego();
  const attivi = fornitoriDiSede(sedeId).filter(f => f.attivo !== false);
  return riconoscitoreFornitori(attivi.flatMap(vociDi));
}
