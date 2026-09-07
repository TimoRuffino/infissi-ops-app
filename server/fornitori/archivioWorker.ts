// Il worker dell'archivio fornitori (07/09/2026): ogni dieci minuti mette
// in archivio le conferme d'ordine arrivate per mail dai fornitori, le
// legge e collega da sole quelle la cui commessa è una sola. Le altre
// restano «da collegare», con il motivo scritto, e le decide una persona
// dalla pagina Fornitori.
//
// Costa quanto le letture: al massimo `LETTURE_PER_GIRO` file nuovi per
// giro e per sede (le scansioni passano dal modello, con il governor), e il
// testo letto resta in memoria dodici ore.

import { getSediStore } from "../routers/sedi";
import { eseguiGiroArchivioFornitori } from "./archivio";

const RITARDO_BOOT_MS = 60_000;
const INTERVALLO_MS = 10 * 60_000;
export const LETTURE_PER_GIRO = 8;

export function archivioFornitoriAttivo(): boolean {
  return (process.env.ARCHIVIO_FORNITORI ?? "on").trim().toLowerCase() !== "off";
}

const inCorso = new Set<number>();

async function giroTutteLeSedi(): Promise<void> {
  for (const sede of getSediStore()) {
    if (!sede.attiva || inCorso.has(sede.id)) continue;
    inCorso.add(sede.id);
    try {
      const esito = await eseguiGiroArchivioFornitori({
        sedeId: sede.id,
        limite: LETTURE_PER_GIRO,
      });
      // Anche un giro senza effetti dice cosa ha visto: l'archivio deve
      // essere leggibile dai log come dalla pagina.
      if (esito.nuove > 0 || esito.lette > 0 || esito.errori > 0) {
        console.info("[archivio-fornitori] giro " + JSON.stringify(esito));
      }
    } catch (errore) {
      console.error(
        "[archivio-fornitori] giro fallito " +
          JSON.stringify({
            sedeId: sede.id,
            message: errore instanceof Error ? errore.message.slice(0, 200) : "unknown",
          })
      );
    } finally {
      inCorso.delete(sede.id);
    }
  }
}

export function startArchivioFornitoriWorker(): void {
  if (!archivioFornitoriAttivo()) {
    console.info("[archivio-fornitori] spento (ARCHIVIO_FORNITORI=off)");
    return;
  }
  const boot = setTimeout(() => void giroTutteLeSedi(), RITARDO_BOOT_MS);
  boot.unref?.();
  const timer = setInterval(() => void giroTutteLeSedi(), INTERVALLO_MS);
  timer.unref?.();
  console.info(
    "[archivio-fornitori] attivo " +
      JSON.stringify({ intervalloMs: INTERVALLO_MS, letturePerGiro: LETTURE_PER_GIRO })
  );
}
