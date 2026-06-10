import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
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

  const app = express();
  const server = createServer(app);

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

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
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
