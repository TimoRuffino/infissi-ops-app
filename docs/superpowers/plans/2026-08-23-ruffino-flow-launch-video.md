# Ruffino Flow Launch Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a deterministic 30-second vertical Ruffino Flow launch video that presents the multisite CRM and Tars using authentic product UI, synthetic data, original audio, and no production data.

**Architecture:** A self-contained Remotion composition lives under `marketing/ruffino-flow-launch/` and imports no server stores or tRPC clients. Pure timeline, motion, privacy, and audio helpers are tested with Vitest; React scenes use static promotional data and render through Remotion to H.264/AAC plus a cover image.

**Tech Stack:** React 19, TypeScript 5.9, Remotion 4, Vitest, `@remotion/bundler`, `@remotion/renderer`, `ffprobe-static`, SVG, PCM WAV.

**Spec:** `docs/superpowers/specs/2026-08-23-ruffino-flow-launch-video-design.md`

## Global Constraints

- Master is exactly 1080x1920, 30 fps, 900 frames, H.264 video with AAC stereo audio.
- User confirmed Ruffino Flow is a one-person company, eligible for Remotion's free commercial license as of 23 August 2026.
- The visual direction is Editorial Intelligence: mineral white, graphite, signal yellow, and a restrained coral-orange-yellow thread.
- Use Plus Jakarta Sans and authentic Ruffino Flow component geometry; no AI-generated UI, glass-heavy styling, glitch, particles, or neural-network imagery.
- No production database, Railway endpoint, secret, customer name, valid phone number, valid email address, or real monetary record may enter the composition.
- Tars must be shown as proposing a motivated action from verifiable sources, never autonomously changing business data.
- The final frame must remain stable for at least 60 frames and show `Ruffino Flow`, `Il CRM con un cervello.`, and `Richiedi una demo`.
- `marketing/ruffino-flow-launch/output/` is local-only and ignored by Git.
- Existing CRM commands `pnpm check`, `pnpm test`, and `pnpm build` must remain green.

---

### Task 1: Remotion foundation and deterministic timeline

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Create: `marketing/ruffino-flow-launch/src/index.ts`
- Create: `marketing/ruffino-flow-launch/src/Root.tsx`
- Create: `marketing/ruffino-flow-launch/src/timeline.ts`
- Create: `marketing/ruffino-flow-launch/src/timeline.test.ts`
- Create: `marketing/ruffino-flow-launch/src/LaunchVideo.tsx`

**Interfaces:**
- Produces: `VIDEO = {fps: 30, width: 1080, height: 1920, durationInFrames: 900}`.
- Produces: `SCENES: readonly SceneDefinition[]`, where `SceneDefinition` is `{id: SceneId; from: number; duration: number}`.
- Produces: Remotion composition id `RuffinoFlowLaunch`.

- [ ] **Step 1: Install one aligned Remotion toolchain and ffprobe**

Run:

```bash
pnpm add -D remotion @remotion/cli @remotion/bundler @remotion/renderer ffprobe-static
```

Verify all Remotion packages resolve to the same version:

```bash
pnpm list remotion @remotion/cli @remotion/bundler @remotion/renderer ffprobe-static
```

Expected: one version line per package and the four Remotion packages share the same version.

- [ ] **Step 2: Write the failing timeline test**

Create `timeline.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {SCENES, VIDEO, validateTimeline} from "./timeline";

describe("promo timeline", () => {
  it("fills exactly 30 seconds without gaps or overlaps", () => {
    expect(VIDEO).toEqual({fps: 30, width: 1080, height: 1920, durationInFrames: 900});
    expect(validateTimeline(SCENES)).toEqual({ok: true, endFrame: 900});
  });

  it("keeps the final brand frame visible for two seconds", () => {
    expect(SCENES.at(-1)).toEqual({id: "launch", from: 810, duration: 90});
  });
});
```

- [ ] **Step 3: Run the test and confirm the missing module failure**

Run:

```bash
pnpm vitest run marketing/ruffino-flow-launch/src/timeline.test.ts
```

Expected: FAIL because `./timeline` does not exist.

- [ ] **Step 4: Implement the timeline and composition shell**

Create `timeline.ts` with these exact scene boundaries:

```ts
export const VIDEO = {fps: 30, width: 1080, height: 1920, durationInFrames: 900} as const;

export type SceneId =
  | "hook"
  | "multisite"
  | "communications"
  | "operations"
  | "finance"
  | "continuity"
  | "tars"
  | "launch";

export type SceneDefinition = Readonly<{id: SceneId; from: number; duration: number}>;

export const SCENES: readonly SceneDefinition[] = [
  {id: "hook", from: 0, duration: 90},
  {id: "multisite", from: 90, duration: 90},
  {id: "communications", from: 180, duration: 150},
  {id: "operations", from: 330, duration: 150},
  {id: "finance", from: 480, duration: 90},
  {id: "continuity", from: 570, duration: 60},
  {id: "tars", from: 630, duration: 180},
  {id: "launch", from: 810, duration: 90},
] as const;

export function validateTimeline(scenes: readonly SceneDefinition[]) {
  let cursor = 0;
  for (const scene of scenes) {
    if (scene.from !== cursor || scene.duration <= 0) return {ok: false as const, endFrame: cursor};
    cursor += scene.duration;
  }
  return {ok: cursor === VIDEO.durationInFrames, endFrame: cursor};
}
```

Register `<Composition id="RuffinoFlowLaunch" component={LaunchVideo} ...VIDEO />` in `Root.tsx`, call `registerRoot(RemotionRoot)` in `index.ts`, and render a mineral background placeholder in `LaunchVideo.tsx`.

- [ ] **Step 5: Add workspace scripts and output ignore**

Add to `package.json`:

```json
"promo:studio": "remotion studio marketing/ruffino-flow-launch/src/index.ts",
"promo:render": "tsx marketing/ruffino-flow-launch/scripts/render.ts",
"promo:check": "tsx marketing/ruffino-flow-launch/scripts/check-output.ts"
```

Add to `.gitignore`:

```gitignore
marketing/ruffino-flow-launch/output/
marketing/ruffino-flow-launch/public/audio/*.wav
```

- [ ] **Step 6: Run the timeline test and TypeScript check**

Run:

```bash
pnpm vitest run marketing/ruffino-flow-launch/src/timeline.test.ts
pnpm check
```

Expected: both PASS.

- [ ] **Step 7: Commit the foundation**

```bash
git add package.json pnpm-lock.yaml .gitignore marketing/ruffino-flow-launch/src
git commit -m "feat(marketing): scaffold launch video"
```

---

### Task 2: Editorial theme and reusable motion primitives

**Files:**
- Create: `marketing/ruffino-flow-launch/src/theme.ts`
- Create: `marketing/ruffino-flow-launch/src/motion.ts`
- Create: `marketing/ruffino-flow-launch/src/motion.test.ts`
- Create: `marketing/ruffino-flow-launch/src/components/KineticTitle.tsx`
- Create: `marketing/ruffino-flow-launch/src/components/ProductFrame.tsx`
- Create: `marketing/ruffino-flow-launch/src/components/FlowThread.tsx`
- Create: `marketing/ruffino-flow-launch/src/components/SceneCanvas.tsx`

**Interfaces:**
- Produces: `THEME`, `SAFE_AREA`, `enterProgress()`, `exitProgress()`, and `sceneOpacity()`.
- Produces: layout components shared by every scene.

- [ ] **Step 1: Write failing motion boundary tests**

```ts
import {describe, expect, it} from "vitest";
import {enterProgress, exitProgress, sceneOpacity} from "./motion";

describe("promo motion", () => {
  it("clamps entrances and exits", () => {
    expect(enterProgress(-1, 12)).toBe(0);
    expect(enterProgress(6, 12)).toBeCloseTo(0.5);
    expect(enterProgress(20, 12)).toBe(1);
    expect(exitProgress(20, 30, 8)).toBe(0);
    expect(exitProgress(29, 30, 8)).toBe(1);
  });

  it("keeps the launch scene fully visible through its last frame", () => {
    expect(sceneOpacity(89, 90, false)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run `pnpm vitest run marketing/ruffino-flow-launch/src/motion.test.ts`.

Expected: FAIL because `./motion` does not exist.

- [ ] **Step 3: Implement theme and pure motion helpers**

Use these immutable tokens in `theme.ts`:

```ts
export const THEME = {
  mineral: "#F3F1EC",
  paper: "#FFFFFF",
  graphite: "#171717",
  muted: "#676159",
  line: "#D7D3CA",
  signal: "#FFD31E",
  coral: "#FF315D",
  orange: "#FF742F",
  success: "#28A86B",
  blue: "#3578F6",
} as const;

export const SAFE_AREA = {top: 180, right: 96, bottom: 230, left: 96} as const;
```

Implement clamped linear progress in `motion.ts`; `sceneOpacity()` skips the exit fade when `holdToEnd` is true. Components must use `useCurrentFrame()` and `interpolate()` only, never wall-clock timers or CSS keyframes.

- [ ] **Step 4: Build shared visual components**

`SceneCanvas` fixes dimensions and safe-area padding. `KineticTitle` accepts:

```ts
type KineticTitleProps = {
  lines: readonly string[];
  accentLine?: number;
  startFrame?: number;
  align?: "left" | "center";
};
```

`ProductFrame` accepts `{children, x, y, width, height, rotate?, scale?}` and uses an 8px radius maximum. `FlowThread` accepts `{progress, from, to}` and renders a 4px restrained gradient line.

- [ ] **Step 5: Run focused tests and check**

```bash
pnpm vitest run marketing/ruffino-flow-launch/src/motion.test.ts
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit the visual system**

```bash
git add marketing/ruffino-flow-launch/src
git commit -m "feat(marketing): add promo motion system"
```

---

### Task 3: Synthetic product data and privacy gate

**Files:**
- Create: `marketing/ruffino-flow-launch/src/data/demo.ts`
- Create: `marketing/ruffino-flow-launch/src/privacy.ts`
- Create: `marketing/ruffino-flow-launch/src/privacy.test.ts`

**Interfaces:**
- Produces: `PROMO_DATA` used by every product surface.
- Produces: `assertPromoDataSafe(value: unknown): void` used by tests and render script.

- [ ] **Step 1: Write the failing privacy tests**

```ts
import {describe, expect, it} from "vitest";
import {PROMO_DATA} from "./data/demo";
import {assertPromoDataSafe} from "./privacy";

describe("promo privacy", () => {
  it("accepts the synthetic dataset", () => {
    expect(() => assertPromoDataSafe(PROMO_DATA)).not.toThrow();
  });

  it("rejects usable contact details", () => {
    expect(() => assertPromoDataSafe({email: "cliente@gmail.com"})).toThrow(/email reale/i);
    expect(() => assertPromoDataSafe({phone: "+39 333 1234567"})).toThrow(/telefono reale/i);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run `pnpm vitest run marketing/ruffino-flow-launch/src/privacy.test.ts`.

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the unmistakably synthetic dataset**

Use only these promotional identities and values:

```ts
export const PROMO_DATA = {
  company: "Ruffino Flow Demo",
  sites: ["Sede Levante", "Sede Centro", "Sede Ponente"],
  customer: "Cliente Demo",
  project: "Commessa Demo 024",
  email: "cliente@example.invalid",
  phone: "+39 000 000 0000",
  invoice: "FT-DEMO-024",
  amount: "12.480,00 euro",
  appointment: "Posa programmata · 09:30",
  tarsPriority: "Commessa pronta per avanzare",
  tarsReason: "Fattura collegata, documenti presenti, appuntamento confermato.",
  sources: ["WhatsApp", "Email", "FiC", "Calendario", "Cliente", "Commessa", "Post-vendita"],
} as const;
```

- [ ] **Step 4: Implement recursive privacy validation**

Serialize the value, reject emails whose domain is not `.invalid`, reject Italian phone-like sequences except `+39 000 000 0000`, and reject the known production strings `La Spezia`, `Ruffino Timothy`, `Facci Alessandro`, and `Lenzo Stefano`. Error messages must name only the violation category, never echo the value.

- [ ] **Step 5: Run privacy and full existing tests**

```bash
pnpm vitest run marketing/ruffino-flow-launch/src/privacy.test.ts
pnpm test
```

Expected: privacy tests PASS and the existing suite remains green.

- [ ] **Step 6: Commit the privacy gate**

```bash
git add marketing/ruffino-flow-launch/src/data marketing/ruffino-flow-launch/src/privacy.ts marketing/ruffino-flow-launch/src/privacy.test.ts
git commit -m "test(marketing): guard promo data privacy"
```

---

### Task 4: Authentic CRM promotional surfaces

**Files:**
- Create: `marketing/ruffino-flow-launch/src/ui/CrmShell.tsx`
- Create: `marketing/ruffino-flow-launch/src/ui/DashboardSurface.tsx`
- Create: `marketing/ruffino-flow-launch/src/ui/CommunicationsSurface.tsx`
- Create: `marketing/ruffino-flow-launch/src/ui/OperationsSurface.tsx`
- Create: `marketing/ruffino-flow-launch/src/ui/FinanceSurface.tsx`
- Create: `marketing/ruffino-flow-launch/src/ui/ContinuitySurface.tsx`
- Create: `marketing/ruffino-flow-launch/src/ui/TarsSurface.tsx`
- Create: `marketing/ruffino-flow-launch/src/ui/surfaces.test.tsx`
- Create: `marketing/ruffino-flow-launch/public/logo.svg`

**Interfaces:**
- Each surface is a pure React component with optional `progress: number` and no network access.
- `CrmShell` supplies the authentic sidebar, top bar, venue selector, and product chrome.

- [ ] **Step 1: Copy the approved product logo asset**

Copy `client/public/logo.svg` to `marketing/ruffino-flow-launch/public/logo.svg` without modifying the source asset.

- [ ] **Step 2: Write the failing static-markup test**

```tsx
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {CommunicationsSurface} from "./CommunicationsSurface";
import {FinanceSurface} from "./FinanceSurface";
import {TarsSurface} from "./TarsSurface";

describe("promo CRM surfaces", () => {
  it("shows the integrations and the Tars evidence chain", () => {
    const html = [
      renderToStaticMarkup(<CommunicationsSurface progress={1} />),
      renderToStaticMarkup(<FinanceSurface progress={1} />),
      renderToStaticMarkup(<TarsSurface progress={1} />),
    ].join(" ");
    for (const label of ["WhatsApp", "Email", "FiC", "Commessa Demo 024", "Priorità di oggi", "Fonti"]) {
      expect(html).toContain(label);
    }
  });
});
```

- [ ] **Step 3: Run the surface test and verify failure**

Run `pnpm vitest run marketing/ruffino-flow-launch/src/ui/surfaces.test.tsx`.

Expected: FAIL because the surface modules do not exist.

- [ ] **Step 4: Implement the shared CRM shell**

Match the real product's dense operational layout: graphite sidebar, mineral workspace, Plus Jakarta Sans, 8px maximum radius, semantic status colors, Lucide icons, and compact tables. Use `PROMO_DATA`; do not import any page, tRPC hook, store, or server module.

- [ ] **Step 5: Implement six focused surfaces**

Required visible facts:

```ts
export const REQUIRED_SURFACE_COPY = {
  dashboard: ["Tutte le sedi", "Commesse attive", "Scadenze oggi"],
  communications: ["WhatsApp", "Email", "Cliente Demo", "Commessa Demo 024"],
  operations: ["Cliente", "Commessa", "Cantiere", "Planning", "Post-vendita"],
  finance: ["FT-DEMO-024", "Collegata alla commessa", "Pagamento registrato"],
  continuity: ["Backup completato", "Storage verificato", "Copia Drive aggiornata"],
  tars: ["Priorità di oggi", "Commessa pronta per avanzare", "Fonti", "Proposta da approvare"],
} as const;
```

The communications view must look like grouped conversations, not individual message rows. The Tars view must show the reason and evidence chips.

- [ ] **Step 6: Run surface, privacy, and TypeScript checks**

```bash
pnpm vitest run marketing/ruffino-flow-launch/src/ui/surfaces.test.tsx marketing/ruffino-flow-launch/src/privacy.test.ts
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit the product surfaces**

```bash
git add marketing/ruffino-flow-launch/public marketing/ruffino-flow-launch/src/ui
git commit -m "feat(marketing): build promo CRM surfaces"
```

---

### Task 5: Eight-scene launch composition

**Files:**
- Create: `marketing/ruffino-flow-launch/src/scenes/HookScene.tsx`
- Create: `marketing/ruffino-flow-launch/src/scenes/MultisiteScene.tsx`
- Create: `marketing/ruffino-flow-launch/src/scenes/CommunicationsScene.tsx`
- Create: `marketing/ruffino-flow-launch/src/scenes/OperationsScene.tsx`
- Create: `marketing/ruffino-flow-launch/src/scenes/FinanceScene.tsx`
- Create: `marketing/ruffino-flow-launch/src/scenes/ContinuityScene.tsx`
- Create: `marketing/ruffino-flow-launch/src/scenes/TarsScene.tsx`
- Create: `marketing/ruffino-flow-launch/src/scenes/LaunchScene.tsx`
- Create: `marketing/ruffino-flow-launch/src/copy.ts`
- Modify: `marketing/ruffino-flow-launch/src/LaunchVideo.tsx`
- Create: `marketing/ruffino-flow-launch/src/LaunchVideo.test.tsx`

**Interfaces:**
- Each scene receives `{durationInFrames: number}` and reads only its local Remotion frame.
- `LaunchVideo` maps `SCENES` to Remotion `<Sequence>` elements.
- Produces: `SCENE_COPY`, the single source of truth for approved titles, payoff, and CTA.

- [ ] **Step 1: Write the failing composition-copy test**

```tsx
import {describe, expect, it} from "vitest";
import {SCENE_COMPONENTS} from "./LaunchVideo";
import {SCENE_COPY} from "./copy";

describe("launch composition", () => {
  it("registers one component for every timeline scene", () => {
    expect(Object.keys(SCENE_COMPONENTS)).toEqual([
      "hook", "multisite", "communications", "operations",
      "finance", "continuity", "tars", "launch",
    ]);
  });

  it("contains the approved launch promise and CTA", () => {
    expect(SCENE_COPY.launch).toEqual({
      title: ["RUFFINO FLOW"],
      support: "Il CRM con un cervello.",
      cta: "Richiedi una demo",
    });
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run `pnpm vitest run marketing/ruffino-flow-launch/src/LaunchVideo.test.tsx`.

Expected: FAIL because `SCENE_COMPONENTS` does not exist.

- [ ] **Step 3: Implement the exact approved on-screen titles**

Create `copy.ts` with these titles, with line breaks chosen for the 9:16 safe area:

```ts
export const SCENE_COPY = {
  hook: {title: ["NON TI SERVE", "UN ALTRO", "GESTIONALE."], support: "Ti serve una regia per tutta l'azienda."},
  multisite: {title: ["UNA REGIA.", "TUTTE LE SEDI."], support: "Persone, permessi e operatività nel contesto giusto."},
  communications: {title: ["OGNI CONVERSAZIONE", "TROVA IL SUO CONTESTO."], support: "WhatsApp ed email diventano parte del lavoro."},
  operations: {title: ["DAL PRIMO CONTATTO", "AL POST-VENDITA."], support: "Un unico percorso operativo."},
  finance: {title: ["FATTURE E DATI", "SEMPRE ALLINEATI."], support: "Documenti, pagamenti e commesse si riconciliano."},
  continuity: {title: ["IL LAVORO", "RESTA PROTETTO."], support: "Backup automatici e storage verificato."},
  tars: {title: ["TARS INCROCIA TUTTO.", "E TI DICE DOVE AGIRE."], support: "Priorità motivate. La decisione resta tua."},
  launch: {title: ["RUFFINO FLOW"], support: "Il CRM con un cervello.", cta: "Richiedi una demo"},
} as const;
```

Each scene shows one product surface and one title. The FlowThread enters in Communications, persists through Finance, and terminates at the evidence chips in Tars.

- [ ] **Step 4: Compose the timeline**

Export `SCENE_COMPONENTS: Record<SceneId, ComponentType<{durationInFrames: number}>>`. In `LaunchVideo`, map `SCENES` to `<Sequence key={id} from={from} durationInFrames={duration}>` and pass `durationInFrames={duration}` to each scene. Set `premountFor={30}` to avoid first-frame layout changes.

- [ ] **Step 5: Run composition and full promo tests**

```bash
pnpm vitest run marketing/ruffino-flow-launch/src
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Open Remotion Studio for a timeline smoke test**

Run `pnpm promo:studio` and verify composition `RuffinoFlowLaunch` is listed as 1080x1920, 30 fps, 900 frames. Scrub frames 0, 90, 180, 330, 480, 570, 630, 810, and 899; every frame must be nonblank.

- [ ] **Step 7: Commit the composition**

```bash
git add marketing/ruffino-flow-launch/src
git commit -m "feat(marketing): compose launch narrative"
```

---

### Task 6: Original soundtrack and deterministic audio generation

**Files:**
- Create: `marketing/ruffino-flow-launch/scripts/wav.ts`
- Create: `marketing/ruffino-flow-launch/scripts/generate-audio.ts`
- Create: `marketing/ruffino-flow-launch/scripts/wav.test.ts`
- Create: `marketing/ruffino-flow-launch/public/audio/.gitkeep`
- Modify: `marketing/ruffino-flow-launch/src/LaunchVideo.tsx`

**Interfaces:**
- Produces: `encodePcm16Wav(samples: Float32Array, sampleRate: number, channels: 2): Buffer`.
- Produces: `public/audio/ruffino-flow-launch.wav`, exactly 30 seconds at 48 kHz stereo.

- [ ] **Step 1: Write the failing WAV encoder test**

```ts
import {describe, expect, it} from "vitest";
import {encodePcm16Wav} from "./wav";

describe("promo WAV", () => {
  it("writes a one-second 48kHz stereo PCM file", () => {
    const wav = encodePcm16Wav(new Float32Array(48_000 * 2), 48_000, 2);
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(40)).toBe(48_000 * 2 * 2);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run `pnpm vitest run marketing/ruffino-flow-launch/scripts/wav.test.ts`.

Expected: FAIL because `./wav` does not exist.

- [ ] **Step 3: Implement PCM WAV encoding and original cue generation**

Generate a warm 120 BPM pulse using low sine tones, filtered deterministic noise with a fixed seed, dry clicks at scene boundaries, a rising tone from frames 600-630, a Tars impact at frame 630, and a clean logo impact at frame 810. Peak-normalize samples to 0.88 before encoding.

The generator must accept:

```ts
type AudioOptions = {durationSeconds: 30; sampleRate: 48_000; channels: 2; seed: 24082026};
```

and write only to `marketing/ruffino-flow-launch/public/audio/ruffino-flow-launch.wav`.

- [ ] **Step 4: Run tests and generate the soundtrack**

```bash
pnpm vitest run marketing/ruffino-flow-launch/scripts/wav.test.ts
pnpm tsx marketing/ruffino-flow-launch/scripts/generate-audio.ts
```

Expected: PASS and a WAV file larger than 5 MB.

- [ ] **Step 5: Add audio to the composition**

Add `<Audio src={staticFile("audio/ruffino-flow-launch.wav")} volume={0.82} />` once at the `LaunchVideo` root. Do not attach separate Audio elements to scenes.

- [ ] **Step 6: Commit the audio source, not the generated WAV**

```bash
git add marketing/ruffino-flow-launch/scripts marketing/ruffino-flow-launch/public/audio marketing/ruffino-flow-launch/src/LaunchVideo.tsx
git commit -m "feat(marketing): add original promo audio"
```

Expected staged audio asset: `.gitkeep` only. The ignored WAV is regenerated before every render.

---

### Task 7: Render pipeline and automated output verification

**Files:**
- Create: `marketing/ruffino-flow-launch/scripts/render.ts`
- Create: `marketing/ruffino-flow-launch/scripts/check-output.ts`
- Create: `marketing/ruffino-flow-launch/scripts/check-output.test.ts`
- Create: `marketing/ruffino-flow-launch/README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `output/ruffino-flow-launch-9x16.mp4` and `output/ruffino-flow-launch-cover.jpg`.
- Produces: `probeOutput(path): OutputReport` with video, audio, duration, dimensions, and frame-rate facts.

- [ ] **Step 1: Write the failing ffprobe report test**

```ts
import {describe, expect, it} from "vitest";
import {validateOutputReport} from "./check-output";

describe("promo output report", () => {
  it("accepts the exact master contract", () => {
    expect(validateOutputReport({
      width: 1080, height: 1920, fps: 30, durationSeconds: 30,
      videoCodec: "h264", audioCodec: "aac", hasAudio: true,
    })).toEqual([]);
  });

  it("rejects a silent landscape render", () => {
    expect(validateOutputReport({
      width: 1920, height: 1080, fps: 30, durationSeconds: 30,
      videoCodec: "h264", audioCodec: null, hasAudio: false,
    })).toEqual(expect.arrayContaining(["dimensioni", "audio"]));
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run `pnpm vitest run marketing/ruffino-flow-launch/scripts/check-output.test.ts`.

Expected: FAIL because `check-output.ts` does not exist.

- [ ] **Step 3: Implement render orchestration**

In `render.ts`, call the exported audio generator first, then `bundle({entryPoint, publicDir})`, `selectComposition({serveUrl, id: "RuffinoFlowLaunch"})`, `renderMedia({codec: "h264", audioCodec: "aac", crf: 18, composition, serveUrl, outputLocation})`, and `renderStill({composition, serveUrl, frame: 840, imageFormat: "jpeg", output})`. Create `output/` before rendering and call `assertPromoDataSafe(PROMO_DATA)` before bundling.

- [ ] **Step 4: Implement ffprobe validation**

Load `ffprobe-static` through `createRequire(import.meta.url)("ffprobe-static") as string`, then call it through `execFileSync` with `-show_streams -show_format -of json`. Normalize `r_frame_rate` such as `30/1` to numeric fps. `validateOutputReport()` returns category strings and enforces:

```ts
Math.abs(report.durationSeconds - 30) <= 0.2;
report.width === 1080;
report.height === 1920;
Math.abs(report.fps - 30) <= 0.01;
report.videoCodec === "h264";
report.audioCodec === "aac";
report.hasAudio === true;
```

Exit nonzero when categories are returned or either output file is missing.

- [ ] **Step 5: Document exact local commands and privacy limits**

`README.md` must document `pnpm promo:studio`, `pnpm promo:render`, `pnpm promo:check`, output locations, synthetic-data-only policy, and the confirmed one-person free-license condition with a link to `https://www.remotion.dev/docs/license/pricing`.

- [ ] **Step 6: Run script tests and full TypeScript check**

```bash
pnpm vitest run marketing/ruffino-flow-launch/scripts
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit the render pipeline**

```bash
git add marketing/ruffino-flow-launch/scripts marketing/ruffino-flow-launch/README.md package.json
git commit -m "feat(marketing): add promo render pipeline"
```

---

### Task 8: Final render, visual QA, and delivery

**Files:**
- Generate, do not commit: `marketing/ruffino-flow-launch/output/ruffino-flow-launch-9x16.mp4`
- Generate, do not commit: `marketing/ruffino-flow-launch/output/ruffino-flow-launch-cover.jpg`
- Generate, do not commit: `marketing/ruffino-flow-launch/output/qa/*.png`
- Modify only if a defect is found: relevant file under `marketing/ruffino-flow-launch/src/`

**Interfaces:**
- Consumes: composition `RuffinoFlowLaunch`, synthetic data, original WAV, render and validation scripts.
- Produces: final reviewed MP4 and cover for the user.

- [ ] **Step 1: Run the full promo test suite before rendering**

```bash
pnpm vitest run marketing/ruffino-flow-launch
pnpm check
```

Expected: PASS.

- [ ] **Step 2: Render the master and cover**

```bash
pnpm promo:render
```

Expected: MP4 and JPG are created under `marketing/ruffino-flow-launch/output/` with no render errors.

- [ ] **Step 3: Validate encoded output**

```bash
pnpm promo:check
```

Expected output categories: dimensions PASS, duration PASS, frame rate PASS, H.264 PASS, AAC PASS, audio present PASS.

- [ ] **Step 4: Render representative QA stills**

Render PNG stills at frames `0, 60, 90, 180, 300, 330, 450, 480, 570, 630, 750, 810, 870, 899` into `output/qa/`. Build a 4-column contact sheet from those PNG files.

- [ ] **Step 5: Inspect all representative frames**

Use `view_image` on the contact sheet and original-resolution stills at frames 180, 630, and 870. Verify:

- no blank frame or broken logo;
- all titles inside the 96px horizontal safe area;
- no text overlap or horizontal clipping;
- grouped WhatsApp conversation and email connection are readable;
- invoice-to-project relationship is visible;
- multisite, calendar/planning, backup, and post-sales are represented;
- Tars reason and evidence are visible and do not imply autonomous execution;
- final CTA remains clear at a 390px-wide preview.

- [ ] **Step 6: Correct only observed visual defects and rerender**

For each defect, write the failing frame number in the commit body, adjust the responsible scene or shared primitive, rerun its focused tests, then repeat Steps 2-5. Do not change approved copy or add new scenes during QA.

- [ ] **Step 7: Run the complete CRM regression suite**

```bash
pnpm check
pnpm test
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 8: Commit final source corrections**

```bash
git add marketing/ruffino-flow-launch package.json pnpm-lock.yaml .gitignore
git commit -m "feat(marketing): finish Ruffino Flow launch video"
```

Do not add `marketing/ruffino-flow-launch/output/`.

- [ ] **Step 9: Deliver local artifact links and render facts**

Report clickable absolute paths for the MP4 and JPG, exact duration, dimensions, codecs, frame rate, audio presence, QA still coverage, and the result of `pnpm check`, `pnpm test`, and `pnpm build`.
