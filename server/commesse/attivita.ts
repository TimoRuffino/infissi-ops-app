// Quando una commessa ha visto l'ultimo FATTO reale.
//
// `commesse.updatedAt` non serve a questo: i lavori di fondo (riconcilia
// timeline, sincronizza il pattuito, aggiorna i contatti dal cliente) lo
// riscrivono in blocco, e in produzione risultava che nessuna commessa
// fosse ferma da più di sette giorni mentre alcune non si muovevano da
// tre mesi (segnalazione della direzione, 03/09/2026: «Tars continua a
// fare proposte di commesse vecchie mesi»).
//
// Un fatto reale è: la creazione, un documento nel fascicolo, una
// transizione di stato, uno step di timeline completato, una
// comunicazione collegata, un intervento pianificato.

import { getDocumentiDiCommessa } from "../routers/preventiviContratti";
import { getInterventiStore } from "../routers/interventi";
import { stepsDiCommessa } from "../routers/timeline";
import { storeTransizioniCommessa } from "./transizioni";

export type AttivitaCommessa = {
  commessaId: number;
  ultimaAttivita: Date;
  giorni: number;
  fonte: "creazione" | "documento" | "transizione" | "timeline" | "comunicazione" | "intervento";
};

function piuRecente(
  corrente: { quando: number; fonte: AttivitaCommessa["fonte"] },
  candidato: unknown,
  fonte: AttivitaCommessa["fonte"]
): { quando: number; fonte: AttivitaCommessa["fonte"] } {
  if (!candidato) return corrente;
  const t = new Date(candidato as any).getTime();
  if (Number.isNaN(t) || t <= corrente.quando) return corrente;
  return { quando: t, fonte };
}

/**
 * L'ultima attività di UNA commessa. `ultimaComunicazione` arriva da chi
 * chiama (una sola aggregazione per tutte le commesse, non una query per
 * riga): qui non si tocca il database.
 */
export function ultimaAttivitaCommessa(
  commessa: { id: number; createdAt?: Date | string | null },
  ultimaComunicazione?: Date | string | null,
  adesso: Date = new Date()
): AttivitaCommessa {
  let migliore = {
    quando: new Date(commessa.createdAt ?? adesso).getTime(),
    fonte: "creazione" as AttivitaCommessa["fonte"],
  };
  if (Number.isNaN(migliore.quando)) migliore = { quando: 0, fonte: "creazione" };

  for (const documento of getDocumentiDiCommessa(commessa.id)) {
    migliore = piuRecente(migliore, documento.createdAt, "documento");
  }
  for (const transizione of storeTransizioniCommessa.items as any[]) {
    if (transizione.commessaId !== commessa.id) continue;
    migliore = piuRecente(migliore, transizione.createdAt ?? transizione.at, "transizione");
  }
  for (const step of stepsDiCommessa(commessa.id)) {
    migliore = piuRecente(migliore, step.dataCompletamento, "timeline");
  }
  for (const intervento of getInterventiStore() as any[]) {
    if (intervento.commessaId !== commessa.id) continue;
    migliore = piuRecente(migliore, intervento.data, "intervento");
  }
  migliore = piuRecente(migliore, ultimaComunicazione, "comunicazione");

  const ultimaAttivita = new Date(migliore.quando);
  return {
    commessaId: commessa.id,
    ultimaAttivita,
    giorni: Math.max(
      0,
      Math.floor((adesso.getTime() - migliore.quando) / 86_400_000)
    ),
    fonte: migliore.fonte,
  };
}
