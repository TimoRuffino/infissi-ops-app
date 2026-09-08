import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
// Registra il resolver del tenant (server/tenants/contestoCorrente.ts, Task
// 6) PRIMA di importare l'albero dei router: alcuni moduli (es.
// routers/timeline.ts, `seedDemo()`) toccano un persistedStore per-tenant al
// semplice import, non dentro `startServer()`. Registrare il resolver più
// tardi — dentro `startServer()`, come farebbe una import dinamica — è
// troppo tardi: quell'accesso lancerebbe «senza resolver del tenant» ben
// prima che `startServer()` inizi a girare. Da Fix round 1 (Task 7)
// `contestoCorrente.ts` è una foglia del grafo dei moduli: la registrazione
// avviene comunque al primo import del modulo, da qualunque punto arrivi
// (es. `_core/trpc.ts`, che importa `conTenant` da lì) — questa riga resta
// solo per garantirne l'ordine PRIMA dell'albero dei router, in questo file.
import "../tenants/contestoCorrente";
import { appRouter } from "../routers";
// Lo store `fic_pagamenti_links` vive in un modulo che i router importano
// solo in modo dinamico (per spezzare un ciclo): senza questa import statica
// il suo persistedStore si registrava DOPO bootstrapAll, restava «non
// caricato» e ogni salvataggio veniva rinviato per sempre (04/09/2026: un
// «save deferred» al secondo per ore, link mai scritti su Postgres).
import "../routers/ficPagamenti";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { serveWellKnown } from "./wellKnown";
import { bootstrapAll } from "./persistence";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Tenant (WS2, spec §3.5): il resolver del tenant corrente si registra da
  // sé quando il modulo si importa (server/tenants/contestoCorrente.ts); lo
  // richiamiamo qui esplicitamente solo per leggibilità dell'ordine di boot.
  // Poi, in tre tempi, prima di wiring dei router e di mettersi in ascolto:
  //   1. `preparaTenants` — control plane: schema, cache, seed della riga
  //      `tenants` predefinita. Gli store dei tenant non esistono ancora.
  //   2. `bootstrapAll({ tenantIds, backfill: true })` — carica gli store di
  //      ogni tenant noto (anche i sospesi: restano leggibili). SOLO qui
  //      `backfill: true`: il server timbra `tenantId` sui record che ne
  //      sono privi e risalva; gli script chiamano `bootstrapAll()` nudo e
  //      non scrivono mai (Ruling R6).
  //   3. `completaTenants` — tocca gli store: proprietario di ripiego,
  //      comandi in attesa, ciclo ogni 30 s.
  const { impostaResolverTenant } = await import("./persistence");
  const { tenantCorrente } = await import("../tenants/contestoCorrente");
  impostaResolverTenant(tenantCorrente);
  const { preparaTenants, completaTenants } = await import("../tenants/boot");
  const tenantIds = await preparaTenants();
  await bootstrapAll({ tenantIds, backfill: true });
  await completaTenants();

  // Historical timeline rows predate automatic board synchronization. This
  // forward-only reconciliation is idempotent and keeps every existing
  // commessa at least at its most advanced completed milestone. It reads
  // per-tenant stores (`timeline_steps`, `commesse`) outside any request,
  // quindi al boot va ripetuta per ogni tenant attivo, nel suo contesto
  // (Ruling R8): senza, `tenantCorrente()` non ha nulla da risolvere e la
  // lettura dello store lancerebbe «senza tenant nel contesto». Con
  // l'interruttore spento, o un control plane vuoto, `perOgniTenantAttivo`
  // gira una sola volta per il tenant 1: comportamento di oggi invariato.
  const { reconcileTimelineBoardStates } = await import("../routers/timeline");
  const { perOgniTenantAttivo } = await import("../tenants/giri");
  await perOgniTenantAttivo("timeline", async tenantId => {
    const timelineSync = reconcileTimelineBoardStates();
    if (timelineSync.aggiornate > 0) {
      console.log(
        `[timeline] tenant ${tenantId}: board riallineato: ${timelineSync.aggiornate}/${timelineSync.analizzate} commesse avanzate`
      );
    }
  });

  // Action cases use dedicated relational tables. In production schema
  // failures must stop startup instead of silently degrading to memory.
  const { getActionCaseRepository } = await import(
    "../actionCenter/repository"
  );
  await getActionCaseRepository().ensureSchema();
  const { startActionCenterScheduler } = await import(
    "../actionCenter/scheduler"
  );
  startActionCenterScheduler();

  // Osservatore Tars (T6): schema additivo, solo con storage autorevole.
  const osservazioni = await import("../tars/proattivita/repository");
  if (osservazioni.repositoryOsservazioniAutorevoleDisponibile()) {
    await osservazioni.repositoryOsservazioniCorrente().ensureSchema();
  }
  // Archivio Tars: DDL additivo E riparazione one-time delle righe jsonb
  // doppio-codificate (01/09/2026). Al boot, non al primo click sull'app:
  // una riparazione dati non deve dipendere dal traffico per applicarsi.
  const { ensureTarsSchema } = await import("../tars/archivio");
  await ensureTarsSchema();
  // Smistamento comunicazioni (02/09/2026): schema additivo e worker,
  // fail-closed su flag e storage autorevole.
  const smistamento = await import("../tars/smistamento/repository");
  if (smistamento.repositorySmistamentoAutorevoleDisponibile()) {
    await smistamento.repositorySmistamentoCorrente().ensureSchema();
  }
  const { startSmistamentoWorker } = await import("../tars/smistamento/worker");
  startSmistamentoWorker();
  const { startAnalisiAziendaWorker } = await import("../tars/analisi/worker");
  startAnalisiAziendaWorker();
  const { startFollowupPreventiviWorker } = await import("../tars/followup/worker");
  startFollowupPreventiviWorker();
  // Costo fornitore dalla conferma d'ordine (03/09/2026): il flusso vivo lo
  // registra all'archiviazione; il worker legge le conferme già nei
  // fascicoli e le scansioni che aspettano l'OCR. Il suo avvio conta le
  // conferme da leggere per tenant attivo (Ruling R8) prima di loggare,
  // quindi si attende: `await`ed come `completaTenants`/il riallineamento
  // della timeline qui sopra.
  const { startCostoDaConfermaWorker } = await import(
    "../commesse/costoDaConfermaWorker"
  );
  await startCostoDaConfermaWorker();
  // Conferme d'ordine certe (mail già collegata alla commessa + file che si
  // dichiara conferma): archiviate da sole, per tutte le commesse da «Da
  // ordinare» in poi; le dubbie restano proposte nella Situazione di Tars.
  const { startConfermeAutoArchivioWorker } = await import(
    "../tars/documenti/confermeAutoArchivio"
  );
  startConfermeAutoArchivioWorker();
  // Archivio fornitori: ogni conferma arrivata da un fornitore entra in
  // archivio, viene letta e — se la commessa è una sola — collegata da sola;
  // le altre aspettano una persona sulla pagina Fornitori (07/09/2026).
  const { startArchivioFornitoriWorker } = await import(
    "../fornitori/archivioWorker"
  );
  startArchivioFornitoriWorker();

  const { getBusinessEventRepository } = await import("../events/repository");
  await getBusinessEventRepository().ensureSchema();
  const { getPolicyRepository } = await import("../authz/repository");
  await getPolicyRepository().ensureSchema();
  const { getNotificationRepository } = await import(
    "../notifications/repository"
  );
  await getNotificationRepository().ensureSchema();
  const { getReminderRepository } = await import("../reminders/repository");
  await getReminderRepository().ensureSchema();
  const { startReminderWorker } = await import("../reminders/worker");
  startReminderWorker();
  const { startNotificationPgBridge } = await import("../notifications/sse");
  await startNotificationPgBridge();
  const { startEventWorkers } = await import("../events/worker");
  startEventWorkers();

  // Colonna `tenant_id` sulle tabelle relazionali per sede (Task 12):
  // additiva, riempita da un trigger che legge lo specchio `tenant_sedi`. Va
  // QUI, in coda agli `ensureSchema()` qui sopra (che creano quelle tabelle)
  // e dopo `completaTenants` (che ha allineato lo specchio). Solo DDL, con
  // `lock_timeout`: le tabelle assenti o occupate vengono saltate e
  // segnalate, e le prende il boot successivo. Il backfill delle righe già a
  // terra è più giù, dopo il `listen`.
  const { applicaSchemaTabelleTenant, avviaBackfillTabelleTenant, avviaRicalcoloStorageIniziale } = await import(
    "../tenants/boot"
  );
  await applicaSchemaTabelleTenant();

  // Il processo serve le richieste e fa girare i lavori di fondo — riconcilia
  // il Centro Azioni, smista le comunicazioni col modello, legge la posta —
  // nello stesso thread. La sonda dice quando quel lavoro tiene fermo il
  // ciclo: è il tempo che ogni richiesta in arrivo passa in coda prima ancora
  // di essere letta, e non comparirebbe in nessun cronometro per procedura.
  const { avviaSondaLoop } = await import("./osservabilita");
  avviaSondaLoop();

  // Nightly backup to Google Drive (00:00 Europe/Rome).
  const { startBackupScheduler } = await import("./driveBackup");
  startBackupScheduler();

  // Fatture in Cloud → clienti sync (every 6h when enabled).
  const { startFicScheduler } = await import("../routers/fattureInCloud");
  startFicScheduler();

  // Sonda degli stati SdI delle fatture emesse (ogni 15 minuti).
  const { startSondaFattureWorker } = await import("../fatture/sonda");
  startSondaFattureWorker();

  // Ingestione posta IMAP (ogni 5 minuti, solo per le caselle attive).
  const { avviaPollerMail } = await import("../comunicazioni/imap");
  avviaPollerMail();

  const app = express();
  const server = createServer(app);

  // Behind Railway/any TLS-terminating proxy: trust the first hop so
  // req.protocol reflects the original https (OAuth redirect URIs, cookies).
  app.set("trust proxy", 1);

  // Baseline security headers on every response. Kept dependency-free
  // (no helmet) and deliberately without a Content-Security-Policy — a
  // strict CSP needs per-app tuning (Vite, blob: file previews, the Maps
  // proxy) and is tracked as a separate follow-up.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    if (process.env.NODE_ENV === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=15552000; includeSubDomains"
      );
    }
    next();
  });

  // ── Webhook WhatsApp (Meta) ─────────────────────────────────────────────
  // Montato PRIMA di express.json: la firma HMAC di Meta si verifica sui
  // byte grezzi del corpo, e un parser JSON li avrebbe già consumati e
  // ri-serializzati (spazi e ordine delle chiavi cambiano → firma non
  // valida). Anonimo per necessità — è Meta a chiamare — ma ogni POST
  // passa dalla verifica della firma prima di essere guardato.
  // Ogni corpo sta in `./rotteAnonime` (senza utente non c'è tenant nel
  // contesto: il proprietario si cerca in ogni tenant attivo) ed è avvolto in
  // un try/catch. Express 4 non cattura la promise rifiutata di un handler
  // `async`: senza, una lettura che lancia — es. uno store per tenant toccato
  // fuori contesto — abbatterebbe il processo, e Meta e i calendari riprovano:
  // un ciclo di riavvii. Nei log mai il payload, mai un token.
  app.get("/api/webhook/whatsapp", async (req, res) => {
    try {
      const { verifyTokenDiQualcheTenant } = await import("./rotteAnonime");
      const mode = String(req.query["hub.mode"] ?? "");
      const token = String(req.query["hub.verify_token"] ?? "");
      const challenge = String(req.query["hub.challenge"] ?? "");
      if (mode === "subscribe" && (await verifyTokenDiQualcheTenant(token))) {
        res.status(200).type("text/plain").send(challenge);
        return;
      }
      res.sendStatus(403);
    } catch (e: any) {
      console.error("[whatsapp-webhook] handshake:", e?.message ?? e);
      if (!res.headersSent) res.sendStatus(500);
    }
  });

  app.post(
    "/api/webhook/whatsapp",
    express.raw({ type: "*/*", limit: "10mb" }),
    async (req, res) => {
      try {
        const { mittenteWebhookWhatsApp, ingestisciWebhookWhatsApp } =
          await import("./rotteAnonime");
        const raw: Buffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(String(req.body ?? ""));
        const firma = req.get("x-hub-signature-256");

        // Di chi è la firma: `mittenteWebhookWhatsApp` prova gli app secret di
        // ogni tenant e di ogni sede senza leggere una riga del payload.
        const mittente = await mittenteWebhookWhatsApp(raw, firma);
        if (!mittente) {
          console.warn("[whatsapp] webhook con firma non valida, ignorato");
          res.sendStatus(403);
          return;
        }

        // A Meta si risponde 200 subito: l'elaborazione lenta farebbe
        // scattare i suoi retry e duplicherebbe il lavoro (l'insert è
        // idempotente, ma inutile pagarlo due volte).
        res.sendStatus(200);
        try {
          const payload = JSON.parse(raw.toString("utf8"));
          const n = await ingestisciWebhookWhatsApp(mittente, payload);
          if (n > 0) console.log(`[whatsapp] ${n} messaggi ricevuti`);
        } catch (e: any) {
          // Dopo il 200 l'errore si registra e basta: rilanciare non
          // cambierebbe la risposta, e Meta non deve riprovare.
          console.error("[whatsapp] webhook:", e?.message ?? e);
        }
      } catch (e: any) {
        // Prima del 200: non possiamo dire che la firma era valida. Il 500
        // fa riprovare Meta, che è quel che serve se l'errore è passeggero.
        console.error("[whatsapp-webhook] consegna:", e?.message ?? e);
        if (!res.headersSent) res.sendStatus(500);
      }
    }
  );

  // Il file manuale arriva come body binario su una rotta autenticata prima
  // del parser. In questo modo 250 MiB non diventano ~334 MiB di base64/JSON;
  // un solo upload grande per processo protegge inoltre la memoria del server.
  const { registerCommessaFileRoutes } = await import("./commessaFileRoutes");
  registerCommessaFileRoutes(app);
  const { registerAllegatoMailRoutes } = await import("./allegatoMailRoutes");
  registerAllegatoMailRoutes(app);
  // Le pagine rese per le anteprime delle evidenze («Dove l'ho letto»):
  // stessa famiglia di guardie del file, dietro FLAG_ANTEPRIME_EVIDENZE.
  const { registerAnteprimaRoutes } = await import("./anteprimaRoutes");
  registerAnteprimaRoutes(app);

  // Gli endpoint JSON (tRPC compreso) mantengono il limite storico.
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  const { createNotificationSseHandler } = await import("../notifications/sse");
  app.get("/api/events/notifications", createNotificationSseHandler());
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // ── ICS calendar feeds (Google Calendar "Add by URL") ───────────────────
  // GET /api/ics/:token/:feed.ics → text/calendar for the sede the token
  // belongs to. Anonymous (the token is the bearer secret); no CSRF/cookies.
  app.get("/api/ics/:token/:feed", async (req, res) => {
    try {
      const { feedIcsPerToken } = await import("./rotteAnonime");
      const feed = await feedIcsPerToken(req.params.token, req.params.feed);
      if (!feed) {
        res.status(404).type("text/plain").send("Feed non trovato");
        return;
      }
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${feed.nomeFile}"`
      );
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(feed.corpo);
    } catch (e: any) {
      // Google ripassa da solo al prossimo giro: meglio un 500 registrato che
      // un processo caduto. Mai il token nel log.
      console.error("[ics] feed:", e?.message ?? e);
      if (!res.headersSent) res.status(500).type("text/plain").send("Feed non disponibile");
    }
  });
  // ── Google Drive backup — OAuth callback ────────────────────────────────────
  // Anonymous by necessity (Google redirects the browser here), but it only
  // accepts one-shot states issued to direzione via backup.oauthStartUrl.
  app.get("/api/oauth/gdrive/callback", async (req, res) => {
    const { handleOAuthCallback } = await import("./driveBackup");
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const redirectUri = `${req.protocol}://${req.get("host")}/api/oauth/gdrive/callback`;
    try {
      if (!code) throw new Error(String(req.query.error ?? "Codice mancante"));
      await handleOAuthCallback(code, state, redirectUri);
      res.redirect("/integrazioni?gdrive=ok");
    } catch (e: any) {
      console.error("[backup] OAuth callback failed:", e?.message);
      res.redirect("/integrazioni?gdrive=errore");
    }
  });

  // ── Fatture in Cloud — OAuth callback ─────────────────────────────────────
  // The one-shot state is issued only to an authenticated direzione user and
  // carries the active sede plus the exact redirect URI used for the exchange.
  app.get("/api/oauth/fic/callback", async (req, res) => {
    // Anche l'import dinamico sta nel try: un modulo che lancia al
    // caricamento non deve abbattere il processo (Express 4 non cattura il
    // rifiuto di un handler async). Il tenant lo dichiara
    // `handleFicOAuthCallback`, che sa da quale sede è partito lo state.
    try {
      const { handleFicOAuthCallback } = await import(
        "../routers/fattureInCloud"
      );
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      if (!code) throw new Error(String(req.query.error ?? "Codice mancante"));
      await handleFicOAuthCallback(code, state);
      res.redirect("/integrazioni?fic=ok");
    } catch (e: any) {
      console.error("[fic-oauth] callback fallita:", e?.message ?? e);
      if (!res.headersSent) res.redirect("/integrazioni?fic=errore");
    }
  });

  // ── CSRF: same-origin check on /api/trpc ────────────────────────────────
  // Cookie-auth means a cross-origin POST from a malicious page could
  // attempt CSRF. The browser sets `Origin` on cross-origin POSTs; we
  // require it to match the request `Host`. Requests without `Origin`
  // (server-to-server, curl) are allowed.
  app.use("/api/trpc", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        // malformed Origin — reject.
      }
      if (originHost !== req.headers.host) {
        res.status(403).json({ error: "Cross-origin request blocked" });
        return;
      }
    }
    next();
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Verifiche di dominio: prima della SPA, che risponde a tutto.
  serveWellKnown(app);

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Il backfill di `tenant_id` gira dopo il listen, a lotti, così il primo
    // deploy spento non tiene il server fuori dalla porta (Ruling R14);
    // `pnpm tenant verifica` dice se restano righe a NULL.
    void avviaBackfillTabelleTenant();
    // Il ledger dello storage (WS3) si popola in sottofondo, una volta per
    // azienda: dopo, lo tengono aggiornato put e delete.
    void avviaRicalcoloStorageIniziale(tenantIds);
  });
}

startServer().catch(console.error);
