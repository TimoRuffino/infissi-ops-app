import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
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
  // Load persisted stores before wiring routers / listening.
  await bootstrapAll();

  // Historical timeline rows predate automatic board synchronization. This
  // forward-only reconciliation is idempotent and keeps every existing
  // commessa at least at its most advanced completed milestone.
  const { reconcileTimelineBoardStates } = await import("../routers/timeline");
  const timelineSync = reconcileTimelineBoardStates();
  if (timelineSync.aggiornate > 0) {
    console.log(
      `[timeline] board riallineato: ${timelineSync.aggiornate}/${timelineSync.analizzate} commesse avanzate`
    );
  }

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
  // fascicoli e le scansioni che aspettano l'OCR.
  const { startCostoDaConfermaWorker } = await import(
    "../commesse/costoDaConfermaWorker"
  );
  startCostoDaConfermaWorker();
  // Conferme d'ordine certe (mail già collegata alla commessa + file che si
  // dichiara conferma): archiviate da sole, per tutte le commesse da «Da
  // ordinare» in poi; le dubbie restano proposte nella Situazione di Tars.
  const { startConfermeAutoArchivioWorker } = await import(
    "../tars/documenti/confermeAutoArchivio"
  );
  startConfermeAutoArchivioWorker();

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
  app.get("/api/webhook/whatsapp", async (req, res) => {
    const { verifyTokenValido } = await import("../comunicazioni/whatsapp");
    const mode = String(req.query["hub.mode"] ?? "");
    const token = String(req.query["hub.verify_token"] ?? "");
    const challenge = String(req.query["hub.challenge"] ?? "");
    if (mode === "subscribe" && verifyTokenValido(token)) {
      res.status(200).type("text/plain").send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  app.post(
    "/api/webhook/whatsapp",
    express.raw({ type: "*/*", limit: "10mb" }),
    async (req, res) => {
      const {
        verificaFirma,
        ingestisciWebhook,
        configWhatsApp,
        appSecretPer,
        tutteLeAppWhatsApp,
      } = await import("../comunicazioni/whatsapp");
      const { decryptSecret } = await import("./secretBox");
      const raw: Buffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(String(req.body ?? ""));
      const firma = req.get("x-hub-signature-256");

      // Il payload dice a quale numero appartiene, ma leggerlo prima di
      // verificare significherebbe fidarsi: si prova invece la firma con
      // ogni app secret disponibile — quello del numero o, con l'Embedded
      // Signup, quello a livello di app.
      const segreti = new Set<string>();
      for (const c of configWhatsApp) {
        if (!c.attiva) continue;
        const s = appSecretPer(c);
        if (s) segreti.add(s);
      }
      // L'endpoint è uno per tutte le sedi: si provano gli app secret di
      // ognuna. Chi non ha la chiave giusta non passa la firma, ed è tutto
      // ciò che serve — nessun payload viene letto prima di questo punto.
      for (const a of tutteLeAppWhatsApp()) {
        if (!a.appSecretCifrato) continue;
        try {
          segreti.add(decryptSecret(a.appSecretCifrato));
        } catch {
          /* chiave di cifratura assente o cambiata */
        }
      }
      const valida = Array.from(segreti).some(s =>
        verificaFirma(raw, firma, s)
      );
      if (!valida) {
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
        const n = await ingestisciWebhook(payload);
        if (n > 0) console.log(`[whatsapp] ${n} messaggi ricevuti`);
      } catch (e: any) {
        console.error("[whatsapp] webhook:", e?.message ?? e);
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
    const { sedeForToken, buildIcs } = await import("../routers/calendarSync");
    const sedeId = sedeForToken(req.params.token);
    if (sedeId == null) {
      res.status(404).type("text/plain").send("Feed non trovato");
      return;
    }
    const feedKey = (req.params.feed || "tutti.ics").replace(/\.ics$/i, "");
    const body = buildIcs(sedeId, feedKey);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="ruffino-${feedKey}.ics"`
    );
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(body);
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
    const { handleFicOAuthCallback } = await import(
      "../routers/fattureInCloud"
    );
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    try {
      if (!code) throw new Error(String(req.query.error ?? "Codice mancante"));
      await handleFicOAuthCallback(code, state);
      res.redirect("/integrazioni?fic=ok");
    } catch (e: any) {
      console.error("[fic] OAuth callback failed:", e?.message);
      res.redirect("/integrazioni?fic=errore");
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
  });
}

startServer().catch(console.error);
