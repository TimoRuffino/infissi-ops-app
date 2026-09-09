import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  APP_ROUTE_CONTRACT,
  registeredRoutePaths,
  routeContractForLocation,
} from "./routeContract";

const APP_SOURCE = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const MANIFEST_SOURCE = readFileSync(
  new URL(
    "../../../docs/design/modular-control/route-manifest.md",
    import.meta.url
  ),
  "utf8"
);

const EXPECTED_PATHS = [
  "/fatture/:id/stampa",
  "/commesse/:id/limiti/stampa",
  "/invito/:token",
  "/",
  "/clienti",
  "/clienti/:id",
  "/kanban",
  "/magazzino",
  "/conferme-ordine",
  "/pagamenti",
  "/economia",
  "/fatturazione",
  "/fatturazione/:id",
  "/marginalita",
  "/commesse",
  "/commesse/:id",
  "/commesse/:commessaId/aperture/:aperturaId/rilievo",
  "/verbale/:interventoId",
  "/planning",
  "/ticket",
  "/garanzie",
  "/squadre",
  "/fornitori",
  "/preventivatori",
  "/preventivatori/fivizzanese/persiane",
  "/preventivatori/punto-del-serramento/persiane",
  "/produzione/*?",
  "/reclami",
  "/archivio",
  "/utenti",
  "/sedi",
  "/messaggi/email",
  "/messaggi/whatsapp",
  "/chat",
  "/notifiche",
  "/comunicazioni",
  "/conoscenza",
  "/integrazioni",
  "/tars",
  "/piattaforma",
  "/piattaforma/:slug",
  "/404",
  "*",
] as const;

function manifestRoutePaths(markdown: string): string[] {
  return markdown
    .split("\n")
    .map(line =>
      /^\|\s*([^|]+?)\s*\|/.exec(line)?.[1]?.trim().replaceAll("\\*", "*")
    )
    .filter((path): path is string =>
      Boolean(path && (path === "*" || path.startsWith("/")))
    );
}

describe("APP_ROUTE_CONTRACT", () => {
  it("covers every registered App route exactly once, including fallback", () => {
    const contractPaths = APP_ROUTE_CONTRACT.map(route => route.path);

    expect(contractPaths).toEqual(EXPECTED_PATHS);
    expect(new Set(contractPaths).size).toBe(contractPaths.length);
    expect(registeredRoutePaths(APP_SOURCE)).toEqual(EXPECTED_PATHS);
  });

  it("keeps redirects delegated to their canonical helpers", () => {
    expect(
      APP_ROUTE_CONTRACT.find(route => route.path === "/produzione/*?")
    ).toMatchObject({
      kind: "redirect",
      target: "/kanban",
      uxGuard: "produzioneRedirect",
    });
    expect(
      APP_ROUTE_CONTRACT.find(route => route.path === "/comunicazioni")
    ).toMatchObject({
      kind: "redirect",
      target: "/messaggi/email",
      uxGuard: "legacyMessageRedirect",
    });
  });

  it("records the four direction guards without treating them as server authority", () => {
    const guarded = APP_ROUTE_CONTRACT.filter(
      route => route.uxGuard === "RequireDirezione"
    ).map(route => route.path);

    expect(guarded).toEqual([
      "/marginalita",
      "/utenti",
      "/sedi",
      "/conoscenza",
    ]);
    for (const route of APP_ROUTE_CONTRACT.filter(entry =>
      guarded.includes(entry.path)
    )) {
      expect(route.kind).toBe("guarded");
      expect(route.roleRule).toBe("direzione");
      expect(route.serverAuthority).not.toContain("RequireDirezione");
    }
  });

  it("registra la sezione piattaforma come guardia propria, non come ruolo", () => {
    const piattaforma = APP_ROUTE_CONTRACT.filter(
      route => route.uxGuard === "RequirePiattaforma"
    );

    expect(piattaforma.map(route => route.path)).toEqual([
      "/piattaforma",
      "/piattaforma/:slug",
    ]);
    for (const route of piattaforma) {
      expect(route.kind, route.path).toBe("guarded");
      // La capacità di piattaforma non è un ruolo e non è una capability del
      // policy engine: la calcola il server da PLATFORM_ADMIN_EMAILS.
      expect(route.roleRule, route.path).toBeNull();
      expect(route.requiredCapabilities, route.path).toEqual([]);
      expect(route.serverAuthority, route.path).toContain(
        "piattaformaProcedure"
      );
      // Nessuna voce in navigazione: si entra dal menu profilo.
      expect(route.navigation, route.path).toBe("hidden");
    }
  });

  it("tiene la pagina d'invito pubblica e fuori dalla shell", () => {
    const invito = APP_ROUTE_CONTRACT.find(
      route => route.path === "/invito/:token"
    );

    expect(invito?.kind).toBe("page");
    expect(invito?.target).toBe("InvitoPage");
    expect(invito?.requiredCapabilities).toEqual([]);
    expect(invito?.roleRule).toBeNull();
    expect(invito?.serverAuthority).toContain("invitiRouter");
    // Sta prima di DashboardLayout in App.tsx, come le stampe: il layout
    // manderebbe al login chi una password non ce l'ha ancora.
    expect(APP_SOURCE.indexOf('path="/invito/:token"')).toBeLessThan(
      APP_SOURCE.indexOf("<DashboardLayout>")
    );
  });

  it("makes economic shaping and the Tars kill switch explicit", () => {
    expect(
      APP_ROUTE_CONTRACT.find(route => route.path === "/pagamenti")
    ).toMatchObject({
      kind: "page",
      uxGuard: "capability:pagamento.read",
      requiredCapabilities: ["pagamento.read"],
      serverAuthority: "commesseRouter + policy engine",
    });
    expect(
      APP_ROUTE_CONTRACT.find(route => route.path === "/economia")
    ).toMatchObject({
      uxGuard: "capability:economia.read",
      requiredCapabilities: ["economia.read"],
      roleRule: null,
    });
    expect(
      APP_ROUTE_CONTRACT.find(route => route.path === "/marginalita")
    ).toMatchObject({
      uxGuard: "RequireDirezione",
      requiredCapabilities: [],
      roleRule: "direzione",
    });
    expect(
      APP_ROUTE_CONTRACT.find(route => route.path === "/tars")
    ).toMatchObject({
      kind: "page",
      requiredCapabilities: ["tars.use"],
      featureFlag: "FLAG_TARS",
      serverAuthority: "tarsRouter + procedureConInterruttore(tars)",
    });
  });

  it("matches the durable manifest one-for-one", () => {
    const contractPaths = APP_ROUTE_CONTRACT.map(route => route.path);
    const manifestPaths = manifestRoutePaths(MANIFEST_SOURCE);

    expect(manifestPaths).toEqual(contractPaths);
    expect(new Set(manifestPaths).size).toBe(manifestPaths.length);
  });

  it("keeps the removed Produzione page redirect-only", () => {
    expect(APP_SOURCE).not.toMatch(
      /lazy\(\(\) => import\("\.\/pages\/Produzione"\)\)/
    );
    expect(
      APP_ROUTE_CONTRACT.find(route => route.path === "/produzione/*?")
        ?.migrationStatus
    ).toBe("redirect");
  });

  it("resolves static, parameterized, optional-wildcard and fallback locations", () => {
    expect(routeContractForLocation("/kanban")?.path).toBe("/kanban");
    expect(routeContractForLocation("/commesse/42")?.path).toBe(
      "/commesse/:id"
    );
    expect(
      routeContractForLocation("/commesse/42/aperture/7/rilievo")?.path
    ).toBe("/commesse/:commessaId/aperture/:aperturaId/rilievo");
    expect(routeContractForLocation("/produzione")?.path).toBe(
      "/produzione/*?"
    );
    expect(routeContractForLocation("/produzione/legacy?tab=bom")?.path).toBe(
      "/produzione/*?"
    );
    expect(routeContractForLocation("/non-esiste")?.path).toBe("*");
  });
});

// Garanzie e Fornitori sono state rimosse come pagine (04/09/2026). Le
// rotte restano registrate come redirect, così i segnalibri e le notifiche
// già salvate non finiscono su un 404 muto.
describe("superfici rimosse", () => {
  // Fornitori è tornata una pagina il 07/09/2026 (archivio delle conferme
  // d'ordine per fornitore): qui resta solo ciò che è davvero rimosso.
  const redirette = ["/garanzie"];

  it("non hanno più una pagina, ma portano dove il lavoro è rimasto", () => {
    for (const path of redirette) {
      const route = APP_ROUTE_CONTRACT.find(entry => entry.path === path);
      expect(route, path).toBeDefined();
      expect(route?.kind, path).toBe("redirect");
      expect(route?.navigation, path).toBe("redirect");
    }

    expect(
      APP_ROUTE_CONTRACT.find(entry => entry.path === "/garanzie")?.target
    ).toBe("/clienti");
  });

  it("Fornitori è una pagina, e il suo archivio è sede-scoped", () => {
    const route = APP_ROUTE_CONTRACT.find(entry => entry.path === "/fornitori");
    expect(route?.kind).toBe("page");
    expect(route?.target).toBe("Fornitori");
    expect(route?.navigation).toBe("primary");
    expect(route?.requiredCapabilities).toContain("commessa.read");
    expect(route?.serverAuthority).toContain("fornitoriRouter.archivio");
  });
});
