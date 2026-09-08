// Porta nello storage i media WhatsApp arrivati PRIMA che il CRM li
// conservasse (08/09/2026). È una corsa contro il tempo: Meta tiene i media
// circa trenta giorni, poi non li dà più a nessuno. Quello che si salva oggi
// resta per sempre; quello che scade non torna.
//
//   npx tsx scripts/backfill-media-whatsapp.ts            # dry-run
//   npx tsx scripts/backfill-media-whatsapp.ts --apply    # scarica e salva
//   npx tsx scripts/backfill-media-whatsapp.ts --apply --limite 50
//
// Serve DATABASE_URL e lo storage durevole (in produzione: `railway ssh`
// dentro il servizio, dove le variabili ci sono già). Non tocca i messaggi:
// aggiunge solo `storageKey` e `size` agli allegati che ne sono privi.
//
// Idempotente: un allegato che ha già i byte viene saltato, e un media che
// Meta non dà più (410) viene contato come perso senza fermare gli altri.

import { bootstrapAll, flushAll } from "../server/_core/persistence";
// Registra gli store (side effect dei moduli router).
import "../server/routers";
import { listComunicazioni } from "../server/comunicazioni/comunicazioni";
import { conservaMediaWhatsApp, configWhatsApp } from "../server/comunicazioni/whatsapp";
import { getSediStore } from "../server/routers/sedi";
import { storageDurevole } from "../server/_core/fileStorage";

async function main() {
  const apply = process.argv.includes("--apply");
  const indiceLimite = process.argv.indexOf("--limite");
  const limite =
    indiceLimite >= 0 ? Number(process.argv[indiceLimite + 1]) || 500 : 500;

  await bootstrapAll();

  if (apply && !storageDurevole()) {
    console.error(
      "Storage non durevole: i byte finirebbero in JSONB. Esco senza scrivere."
    );
    process.exitCode = 1;
    return;
  }

  let daSalvare = 0;
  const esitoTotale = { salvati: 0, saltati: 0, errori: 0 };

  for (const sede of getSediStore()) {
    const messaggi = await listComunicazioni({
      sedeId: sede.id,
      canale: "whatsapp",
      soloConAllegati: true,
      limit: 200,
    });
    for (const messaggio of messaggi) {
      const mancanti = messaggio.allegati.filter(a => !a.storageKey && a.mediaId);
      if (mancanti.length === 0) continue;
      daSalvare += mancanti.length;
      if (!apply || esitoTotale.salvati >= limite) continue;

      const config = configWhatsApp.find(
        c => c.id === messaggio.casellaId && c.sedeId === messaggio.sedeId
      );
      if (!config) {
        esitoTotale.errori += mancanti.length;
        console.warn(
          `✗ comunicazione ${messaggio.id}: il numero WhatsApp d'origine non è più configurato`
        );
        continue;
      }
      const esito = await conservaMediaWhatsApp(messaggio, config);
      esitoTotale.salvati += esito.salvati;
      esitoTotale.saltati += esito.saltati;
      esitoTotale.errori += esito.errori;
      if (esito.salvati > 0) {
        console.log(
          `✓ comunicazione ${messaggio.id}: ${esito.salvati} media nello storage`
        );
      }
    }
  }

  console.log("\n════ MEDIA WHATSAPP ════");
  console.log(`Modalità:    ${apply ? "APPLY" : "DRY-RUN (nessuna scrittura)"}`);
  console.log(`Da salvare:  ${daSalvare}`);
  if (apply) {
    console.log(`Salvati:     ${esitoTotale.salvati}`);
    console.log(`Saltati:     ${esitoTotale.saltati}`);
    console.log(`Non più su Meta o falliti: ${esitoTotale.errori}`);
  } else {
    console.log("Rilancia con --apply per scaricarli da Meta e conservarli.");
  }

  await flushAll();
}

main().catch(errore => {
  console.error(errore);
  process.exitCode = 1;
});
