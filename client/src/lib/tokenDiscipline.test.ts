// Guardia strutturale del design system «Modular Control».
//
// Ogni colore applicativo passa dai token semantici di index.css. Le sole
// deroghe sono colori di identità di terze parti, registrati qui e nella
// documentazione del sistema visivo.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const RADICE_CLIENT = join("client", "src");
const CSS = readFileSync(join(RADICE_CLIENT, "index.css"), "utf8");

function fileSorgente(dir: string, estensioni: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const percorso = join(dir, nome);
    if (statSync(percorso).isDirectory()) {
      out.push(...fileSorgente(percorso, estensioni));
      continue;
    }
    if (!estensioni.has(extname(nome))) continue;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(nome)) continue;
    out.push(percorso);
  }
  return out;
}

const FILE_APPLICAZIONE = fileSorgente(RADICE_CLIENT, new Set([".ts", ".tsx"]));
const FILE_UI = fileSorgente(RADICE_CLIENT, new Set([".css", ".ts", ".tsx"]));
const RADICE_PATTERN = join(RADICE_CLIENT, "components", "patterns");
const CONTRATTI_PATTERN = join(
  "docs",
  "design",
  "modular-control",
  "component-contracts.md"
);

const PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|divide|accent|caret|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g;

const BIANCO_SU_SEMANTICO =
  /\bbg-(?:success|warning|danger|info|brand|structure|focal)(?:\/\d+)?\b[^"'`]*\btext-white\b|\btext-white\b[^"'`]*\bbg-(?:success|warning|danger|info|brand|structure|focal)(?:\/\d+)?\b/g;

const HEX_ARBITRARIO =
  /\b(?:bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/g;
const GRADIENTE_ARBITRARIO =
  /\bbg-gradient-[\w-]+|\bbg-\[(?:image:)?linear-gradient|\bbg-\[image:var\(--gradient-|\[background-image:var\(--gradient-|\bbackgroundImage\s*:|["'`]linear-gradient\(/g;
const DEROGHE_HEX = [
  // Verde ufficiale WhatsApp: identità di terza parte.
  join("client", "src", "components", "WhatsAppCard.tsx"),
  join("client", "src", "components", "WhatsAppButton.tsx"),
];
// La deroga copriva la pagina Fornitori, rimossa il 04/09/2026: niente più
// eccezioni al redesign. Resta la lista, vuota, perché aggiungerne una nuova
// sia una scelta esplicita e non una riga sparsa nei controlli.
const FUORI_SCOPE_UI: string[] = [];

function scansiona(
  regex: RegExp,
  file = FILE_APPLICAZIONE,
  salta: string[] = []
): string[] {
  const violazioni: string[] = [];
  for (const percorso of file) {
    if (salta.includes(percorso)) continue;
    const contenuto = readFileSync(percorso, "utf8");
    contenuto.split("\n").forEach((testo, i) => {
      const match = testo.match(regex);
      if (match) violazioni.push(`${percorso}:${i + 1} → ${match.join(", ")}`);
    });
  }
  return violazioni;
}

function dichiarazioni(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blocco = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!blocco) return {};
  return Object.fromEntries(
    [...blocco[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [
      match[1],
      match[2].trim(),
    ])
  );
}

function normalizzaValori(
  dichiarazioniCss: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dichiarazioniCss).map(([token, valore]) => [
      token,
      valore
        .replace(/\s+/g, " ")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .trim()
        .toLowerCase(),
    ])
  );
}

const PALETTE_CHIARA = {
  "--primitive-chrome": "#D8D5DC",
  "--primitive-canvas": "#F7F5F6",
  "--primitive-surface": "#FFFFFF",
  "--primitive-sunken": "#F2EEF0",
  "--primitive-ink": "#20171B",
  "--primitive-muted": "#71656A",
  "--primitive-border": "#E6DDE0",
  "--primitive-control": "#8A7A82",
  "--primitive-brand": "#8B1E3F",
  "--primitive-on-brand": "#FFFFFF",
  "--primitive-brand-soft": "#F7E5EB",
  "--primitive-brand-soft-ink": "#6E1733",
  "--primitive-mora": "#5B468E",
  "--primitive-anchor": "#241821",
  "--primitive-success": "#237353",
  "--primitive-warning": "#A84B32",
  "--primitive-danger": "#B4233D",
  "--primitive-info": "#3B5FA6",
  "--primitive-focal-gradient":
    "linear-gradient(135deg, #3A1725 0%, #6C2448 56%, #884B79 100%)",
};

const PALETTE_SCURA = {
  "--primitive-chrome": "#0F0D12",
  "--primitive-canvas": "#151216",
  "--primitive-surface": "#201B20",
  "--primitive-sunken": "#171217",
  "--primitive-raised": "#2A2228",
  "--primitive-ink": "#FCF8F9",
  "--primitive-muted": "#BDAFB5",
  "--primitive-border": "#473B42",
  "--primitive-control": "#7B6B73",
  "--primitive-brand": "#F09AB2",
  "--primitive-on-brand": "#32101B",
  "--primitive-brand-soft": "#451A2A",
  "--primitive-brand-soft-ink": "#FFB8CB",
  "--primitive-mora": "#B6A6E8",
  "--primitive-focal-gradient":
    "linear-gradient(135deg, #2A1721 0%, #522039 56%, #6B4163 100%)",
};

describe("contratto cromatico Modular Control", () => {
  it("espone il marker di sistema e i tre livelli di token", () => {
    const chiaro = normalizzaValori(
      dichiarazioni('[data-ui-system="modular-control"]')
    );
    expect(chiaro).toMatchObject(normalizzaValori(PALETTE_CHIARA));
    expect(chiaro).toMatchObject(
      normalizzaValori({
        "--color-workspace": "var(--primitive-canvas)",
        "--color-focal": "var(--primitive-anchor)",
        "--shell-chrome": "var(--color-chrome)",
        "--context-surface": "var(--color-surface)",
        "--table-header-surface": "var(--color-surface-sunken)",
        "--inspector-surface": "var(--color-surface-raised)",
      })
    );
  });

  it("ridefinisce esplicitamente la palette approvata nel quadrante scuro", () => {
    const scuro = normalizzaValori(
      dichiarazioni('[data-ui-system="modular-control"].dark')
    );
    expect(scuro).toMatchObject(normalizzaValori(PALETTE_SCURA));
  });

  it("non conserva marker, firme o nomi del concept rifiutato", () => {
    const firmeRifiutate = [
      ["data", "ui", "v2"].join("-"),
      ["rf", "frame"].join("-"),
      ["rf", "rail"].join("-"),
      ["rf", "reveal"].join("-"),
      ["rf", "latch"].join("-"),
      "Frame" + " & Flow",
      "Officina" + " Digitale",
    ];
    const violazioni = FILE_UI.flatMap(percorso => {
      const contenuto = readFileSync(percorso, "utf8");
      return firmeRifiutate
        .filter(firma => contenuto.includes(firma))
        .map(firma => `${percorso} → ${firma}`);
    });
    expect(violazioni).toEqual([]);
  });
});

describe("disciplina dei token applicativi", () => {
  it("non usa la palette numerica di Tailwind", () => {
    const violazioni = scansiona(PALETTE, FILE_APPLICAZIONE, FUORI_SCOPE_UI);
    expect(
      violazioni,
      `Classi di palette hardcoded trovate (usa i token semantici):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });

  it("non mette testo bianco fisso sopra un colore semantico pieno", () => {
    const violazioni = scansiona(
      BIANCO_SU_SEMANTICO,
      FILE_APPLICAZIONE,
      FUORI_SCOPE_UI
    );
    expect(
      violazioni,
      `text-white su pieno semantico (usa text-on-*):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });

  it("non usa colori arbitrari fuori dalle deroghe di terze parti", () => {
    const violazioni = scansiona(HEX_ARBITRARIO, FILE_APPLICAZIONE, [
      ...DEROGHE_HEX,
      ...FUORI_SCOPE_UI,
    ]);
    expect(
      violazioni,
      `Hex arbitrari nelle classi (usa i token o registra una deroga):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });

  it("confina ogni gradiente applicativo alla variante focal di DataSurface", () => {
    const dataSurface = join(RADICE_PATTERN, "DataSurface.tsx");
    const violazioni = scansiona(GRADIENTE_ARBITRARIO, FILE_APPLICAZIONE, [
      dataSurface,
      ...FUORI_SCOPE_UI,
    ]);
    expect(
      violazioni,
      `Gradienti fuori da DataSurface (usa tone=\"focal\" oppure una superficie piatta):\n${violazioni.join("\n")}`
    ).toEqual([]);
  });

  it("non introduce deroghe hex per le route operative", () => {
    // client/src/components/planning, .../squadre e .../magazzino non
    // esistono ancora: le route della slice li creeranno. La scansione
    // ricorsiva sopra parte da RADICE_CLIENT e li coprirà automaticamente
    // non appena i task successivi li popoleranno, senza bisogno di
    // elencarli qui: readdirSync itera solo le cartelle che esistono, quindi
    // la loro assenza oggi non fa fallire nulla. Questo test blocca
    // eventuali future deroghe hex per i loro componenti noti.
    expect(DEROGHE_HEX).not.toContain(
      join("client", "src", "components", "planning", "PlanningAgenda.tsx")
    );
    expect(DEROGHE_HEX).not.toContain(
      join(
        "client",
        "src",
        "components",
        "squadre",
        "SquadraRosterCard.tsx"
      )
    );
    expect(DEROGHE_HEX).not.toContain(
      join(
        "client",
        "src",
        "components",
        "magazzino",
        "ConsegneAgenda.tsx"
      )
    );
  });
});

describe("contratto dei pattern Modular Control", () => {
  const contrattiFiniti = {
    "PageHeader.tsx": {
      costante: "PAGE_HEADER_VARIANTS",
      valori: ["standard", "record", "workbench", "compact"],
      sezione: "## PageHeader",
    },
    "DataSurface.tsx": {
      costante: "DATA_SURFACE_TONES",
      valori: ["default", "sunken", "focal"],
      sezione: "## DataSurface",
    },
    "StatePanel.tsx": {
      costante: "STATE_PANEL_KINDS",
      valori: [
        "loading",
        "empty",
        "error",
        "permission",
        "unavailable",
        "stale",
      ],
      sezione: "## StatePanel",
    },
    "StickyActionBar.tsx": {
      costante: "STICKY_ACTION_BAR_PLACEMENTS",
      valori: ["responsive", "sticky"],
      sezione: "## StickyActionBar",
    },
    "ContextInspector.tsx": {
      costante: "CONTEXT_INSPECTOR_DESKTOP_MODES",
      valori: ["inline", "overlay"],
      sezione: "## ContextInspector",
    },
  } as const;

  it("mantiene i cinque pattern condivisi come contratti tipizzati e documentati", () => {
    const documentazione = existsSync(CONTRATTI_PATTERN)
      ? readFileSync(CONTRATTI_PATTERN, "utf8")
      : "";
    const violazioni: string[] = [];

    for (const [nome, contratto] of Object.entries(contrattiFiniti)) {
      const percorso = join(RADICE_PATTERN, nome);
      if (!existsSync(percorso)) {
        violazioni.push(`${percorso} → file assente`);
        continue;
      }

      const sorgente = readFileSync(percorso, "utf8");
      if (!sorgente.includes(`export const ${contratto.costante}`)) {
        violazioni.push(`${percorso} → manca ${contratto.costante}`);
      }
      if (!documentazione.includes(contratto.sezione)) {
        violazioni.push(`${CONTRATTI_PATTERN} → manca ${contratto.sezione}`);
      }
      for (const valore of contratto.valori) {
        if (!sorgente.includes(`"${valore}"`)) {
          violazioni.push(`${percorso} → variante ${valore} non tipizzata`);
        }
        if (!documentazione.includes(`\`${valore}\``)) {
          violazioni.push(
            `${CONTRATTI_PATTERN} → variante ${valore} non documentata`
          );
        }
      }
    }

    expect(violazioni).toEqual([]);
  });

  it("richiede nome accessibile e tooltip alle azioni solo-icona dei pattern", () => {
    if (!existsSync(RADICE_PATTERN)) return;

    const violazioni: string[] = [];
    for (const percorso of fileSorgente(
      RADICE_PATTERN,
      new Set([".ts", ".tsx"])
    )) {
      const sorgente = readFileSync(percorso, "utf8");
      const azioniIcona = [
        ...sorgente.matchAll(
          /<(?:Button|button)\b(?=[^>]*\bsize=["']icon(?:-sm|-lg)?["'])[^>]*>/gs
        ),
      ];
      for (const azione of azioniIcona) {
        if (!azione[0].includes("aria-label=")) {
          violazioni.push(`${percorso} → azione solo-icona senza aria-label`);
        }
        if (
          !sorgente.includes("<Tooltip") ||
          !sorgente.includes("<TooltipTrigger") ||
          !sorgente.includes("<TooltipContent")
        ) {
          violazioni.push(`${percorso} → azione solo-icona senza tooltip`);
        }
      }
    }

    expect(violazioni).toEqual([]);
  });
});
