import { ambienteStaging } from "./ambiente";

/**
 * Le quattro partenze che parlano con servizi esterni veri: backup Google
 * Drive, sync Fatture in Cloud, sonda SdI, poller IMAP. In staging NON
 * partono — un database ripristinato dalla produzione resterebbe altrimenti
 * a leggere caselle vere e a scrivere sul Drive vero entro 60 secondi dal
 * boot. I worker interni (promemoria, eventi, Centro Azioni, comandi
 * tenant) restano fuori da qui e partono ovunque: servono a provare il
 * prodotto.
 */
export async function avviaGiriEsterni(): Promise<boolean> {
  if (ambienteStaging()) {
    console.log(
      "[ambiente] staging: giri esterni spenti (backup Drive, sync FiC, sonda SdI, poller IMAP)"
    );
    return false;
  }
  const { startBackupScheduler } = await import("./driveBackup");
  startBackupScheduler();
  const { startFicScheduler } = await import("../routers/fattureInCloud");
  startFicScheduler();
  const { startSondaFattureWorker } = await import("../fatture/sonda");
  startSondaFattureWorker();
  const { avviaPollerMail } = await import("../comunicazioni/imap");
  avviaPollerMail();
  return true;
}
