// Porta nello storage i media WhatsApp arrivati PRIMA che il CRM li
// conservasse (08/09/2026). È una corsa contro il tempo: Meta tiene i media
// circa trenta giorni, poi non li dà più a nessuno. Quello che si salva oggi
// resta per sempre; quello che scade non torna.
//
//   npx tsx scripts/backfill-media-whatsapp.ts            # dry-run
//   npx tsx scripts/backfill-media-whatsapp.ts --apply    # scarica e salva
//   npx tsx scripts/backfill-media-whatsapp.ts --apply --limite 50
//
// DA DOVE. Dentro il servizio va tutto da sé. Da fuori (`railway run`) la
// variabile `DATABASE_URL` punta a `postgres.railway.internal`, un host che
// esiste solo nella rete privata di Railway: serve `DATABASE_PUBLIC_URL`.
// Se non ce l'hai, la stessa cosa la fa il tasto «Conserva ora» nella scheda
// WhatsApp delle impostazioni, che gira dentro il servizio.
//
// Idempotente: un allegato che ha già i byte viene saltato, e un media che
// Meta non dà più viene contato come perso senza fermare gli altri.

export {}; // modulo: sotto ci sono import dinamici e await di primo livello

const interno = /\.railway\.internal/.test(process.env.DATABASE_URL ?? "");
const dentroRailway = !!process.env.RAILWAY_ENVIRONMENT;
if (interno && !dentroRailway) {
  if (process.env.DATABASE_PUBLIC_URL) {
    // L'indirizzo pubblico del database: stesso database, strada diversa.
    process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
    console.log("[media] uso DATABASE_PUBLIC_URL: da qui l'host interno non si risolve.");
  } else {
    console.error(
      "DATABASE_URL punta all'host interno di Railway (postgres.railway.internal),\n" +
        "che da questo computer non si risolve: lo script leggerebbe zero messaggi.\n\n" +
        "Due strade:\n" +
        "  • il tasto «Conserva ora» nella scheda WhatsApp delle impostazioni\n" +
        "    (gira dentro il servizio, dove database e storage ci sono già);\n" +
        "  • esporta DATABASE_PUBLIC_URL (variabile del servizio Postgres) e\n" +
        "    rilancia questo script."
    );
    process.exit(1);
  }
}

const { bootstrapAll, flushAll } = await import("../server/_core/persistence");
// Registra gli store (side effect dei moduli router).
await import("../server/routers");
const { listComunicazioni } = await import("../server/comunicazioni/comunicazioni");
const { conservaMediaWhatsApp, configWhatsApp } = await import(
  "../server/comunicazioni/whatsapp"
);
const { getSediStore } = await import("../server/routers/sedi");
const { storageDurevole } = await import("../server/_core/fileStorage");
const { conTenant } = await import("../server/tenants/contestoCorrente");
const { TENANT_PREDEFINITO_ID } = await import("../server/tenants/costanti");

function argomentoNumerico(nome: string): number | null {
  const trovato = process.argv.find(arg => arg.startsWith(`--${nome}=`));
  if (!trovato) return null;
  const valore = Number(trovato.split("=")[1]);
  return Number.isFinite(valore) ? valore : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const indiceLimite = process.argv.indexOf("--limite");
  const limite =
    indiceLimite >= 0 ? Number(process.argv[indiceLimite + 1]) || 500 : 500;
  // Ogni store è per azienda: senza contesto il persistence rifiuta l'accesso.
  const tenantId = argomentoNumerico("tenant") ?? TENANT_PREDEFINITO_ID;

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

  // Tutto il lavoro gira nel contesto dell'azienda: gli store, lo storage e
  // le comunicazioni sono per tenant (WS1/WS2), e fuori dal contesto il
  // persistence rifiuta l'accesso invece di indovinare.
  await conTenant(tenantId, async () => {
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
  });

  console.log("\n════ MEDIA WHATSAPP ════");
  console.log(`Modalità:    ${apply ? "APPLY" : "DRY-RUN (nessuna scrittura)"}`);
  console.log(`Azienda:     tenant ${tenantId}`);
  console.log(`Da salvare:  ${daSalvare}`);
  if (apply) {
    console.log(`Salvati:     ${esitoTotale.salvati}`);
    console.log(`Saltati:     ${esitoTotale.saltati}`);
    console.log(`Non più su Meta o falliti: ${esitoTotale.errori}`);
  } else {
    console.log("Rilancia con --apply per scaricarli da Meta e conservarli.");
  }

  await flushAll();
  // Gli store tengono vivi timer e pool: il lavoro è finito, si esce.
  process.exit(process.exitCode ?? 0);
}

main().catch(errore => {
  console.error(errore);
  process.exit(1);
});
