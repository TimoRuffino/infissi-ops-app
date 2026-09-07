// Il worker dell'archivio fornitori (07/09/2026): ogni dieci minuti mette
// in archivio le conferme d'ordine arrivate per mail dai fornitori, le
// legge e collega da sole quelle la cui commessa è una sola. Le altre
// restano «da collegare», con il motivo scritto, e le decide una persona
// dalla pagina Fornitori.
//
// Costa quanto le letture: al massimo `LETTURE_PER_GIRO` file nuovi per
// giro e per sede (le scansioni passano dal modello, con il governor), e il
// testo letto resta in memoria dodici ore.

import { sediAttiveDelTenant } from "../routers/sedi";
import { perOgniTenantAttivo } from "../tenants/giri";
import { dipendenzeArchivioFornitoriReali, eseguiGiroArchivioFornitori } from "./archivio";

const RITARDO_BOOT_MS = 60_000;
const INTERVALLO_MS = 10 * 60_000;
// 25 per giro (07/09/2026): al primo avvio l'archivio ha trovato 351
// conferme arretrate e a otto per giro ci avrebbe messo sette ore. I PDF
// con testo non costano niente; le scansioni passano dal governor.
export const LETTURE_PER_GIRO = 25;

export function archivioFornitoriAttivo(): boolean {
  return (process.env.ARCHIVIO_FORNITORI ?? "on").trim().toLowerCase() !== "off";
}

const inCorso = new Set<number>();

/**
 * Un giro per ogni azienda attiva, nel suo contesto, e dentro ognuna le sue
 * sedi attive (WS2 §5.3): `eseguiGiroArchivioFornitori` legge e scrive store
 * per tenant (`fornitori_archivio`, comunicazioni, commesse, fascicoli), che
 * fuori da un contesto lancerebbero «senza tenant nel contesto» a ogni tick.
 * `sediAttiveDelTenant` conserva il filtro `sede.attiva` di prima; un errore
 * di un'azienda non ferma le altre (come già un errore di una sede).
 */
export async function giroTutteLeSedi(): Promise<void> {
  await perOgniTenantAttivo("archivio-fornitori", async tenantId => {
    for (const sede of sediAttiveDelTenant(tenantId)) {
      if (inCorso.has(sede.id)) continue;
      inCorso.add(sede.id);
      try {
        const esito = await eseguiGiroArchivioFornitori({
          sedeId: sede.id,
          limite: LETTURE_PER_GIRO,
          deps: dipendenzeArchivioFornitoriReali(sede.id, {
            massimoLetture: LETTURE_PER_GIRO,
          }),
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
  });
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
