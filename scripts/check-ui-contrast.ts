import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ContrastKind = "text" | "large-text" | "boundary" | "focus";

export interface ContrastPair {
  name: string;
  foreground: string;
  background: string;
  threshold: 3 | 4.5;
  kind: ContrastKind;
}

export interface ContrastResult extends ContrastPair {
  ratio: number;
  passed: boolean;
}

function rgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    throw new Error(`Colore non valido: ${hex}`);
  }
  return [0, 2, 4].map(offset =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16)
  ) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [red, green, blue] = rgb(hex).map(channel => {
    const srgb = channel / 255;
    return srgb <= 0.04045
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  return (lighter + 0.05) / (darker + 0.05);
}

export function auditContrastPairs(
  pairs: readonly ContrastPair[]
): ContrastResult[] {
  return pairs.map(pair => {
    const ratio = contrastRatio(pair.foreground, pair.background);
    return { ...pair, ratio, passed: ratio >= pair.threshold };
  });
}

const text = (
  name: string,
  foreground: string,
  background: string
): ContrastPair => ({
  name,
  foreground,
  background,
  threshold: 4.5,
  kind: "text",
});

const boundary = (
  name: string,
  foreground: string,
  background: string,
  kind: "boundary" | "focus" = "boundary"
): ContrastPair => ({
  name,
  foreground,
  background,
  threshold: 3,
  kind,
});

export const DOCUMENTED_CONTRAST_PAIRS: readonly ContrastPair[] = [
  text("light · ink / surface", "#20171B", "#FFFFFF"),
  text("light · ink / canvas", "#20171B", "#F7F5F6"),
  text("light · muted / surface", "#71656A", "#FFFFFF"),
  text("light · on-brand / brand", "#FFFFFF", "#8B1E3F"),
  text("light · brand-soft-ink / brand-soft", "#6E1733", "#F7E5EB"),
  text("light · on-mora / mora", "#FFFFFF", "#5B468E"),
  text("light · on-focal / anchor", "#FFFFFF", "#241821"),
  text("light · success / success-soft", "#237353", "#E5F3ED"),
  text("light · warning / warning-soft", "#A84B32", "#FBE9E3"),
  text("light · danger / danger-soft", "#B4233D", "#F9E4E8"),
  text("light · info / info-soft", "#3B5FA6", "#E7ECF7"),
  text("light · on-success / success", "#FFFFFF", "#237353"),
  text("light · on-warning / warning", "#FFFFFF", "#A84B32"),
  text("light · on-danger / danger", "#FFFFFF", "#B4233D"),
  text("light · on-info / info", "#FFFFFF", "#3B5FA6"),
  text("light · focal gradient stop 1", "#FFFFFF", "#3A1725"),
  text("light · focal gradient stop 2", "#FFFFFF", "#6C2448"),
  text("light · focal gradient stop 3", "#FFFFFF", "#884B79"),
  boundary("light · control / surface", "#8A7A82", "#FFFFFF"),
  boundary("light · control / canvas", "#8A7A82", "#F7F5F6"),
  boundary("light · focus / surface", "#5B468E", "#FFFFFF", "focus"),
  boundary("light · focus / canvas", "#5B468E", "#F7F5F6", "focus"),

  text("dark · ink / surface", "#FCF8F9", "#201B20"),
  text("dark · ink / canvas", "#FCF8F9", "#151216"),
  text("dark · muted / surface", "#BDAFB5", "#201B20"),
  text("dark · on-brand / brand", "#32101B", "#F09AB2"),
  text("dark · brand-soft-ink / brand-soft", "#FFB8CB", "#451A2A"),
  text("dark · on-mora / mora", "#231A3A", "#B6A6E8"),
  text("dark · on-focal / anchor", "#FFFFFF", "#2A1721"),
  text("dark · success / success-soft", "#70C9A5", "#17342A"),
  text("dark · warning / warning-soft", "#F49A7A", "#3D231C"),
  text("dark · danger / danger-soft", "#FF9BAB", "#3F1C25"),
  text("dark · info / info-soft", "#AFC2FF", "#202A47"),
  text("dark · on-success / success", "#10251D", "#70C9A5"),
  text("dark · on-warning / warning", "#35170E", "#F49A7A"),
  text("dark · on-danger / danger", "#351019", "#FF9BAB"),
  text("dark · on-info / info", "#17213B", "#AFC2FF"),
  text("dark · focal gradient stop 1", "#FFFFFF", "#2A1721"),
  text("dark · focal gradient stop 2", "#FFFFFF", "#522039"),
  text("dark · focal gradient stop 3", "#FFFFFF", "#6B4163"),
  boundary("dark · control / surface", "#7B6B73", "#201B20"),
  boundary("dark · control / raised", "#7B6B73", "#2A2228"),
  boundary("dark · focus / surface", "#B6A6E8", "#201B20", "focus"),
  boundary("dark · focus / canvas", "#B6A6E8", "#151216", "focus"),
];

export function runContrastAudit(): number {
  const results = auditContrastPairs(DOCUMENTED_CONTRAST_PAIRS);
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      `${status}  ${result.ratio.toFixed(2)}:1 / ${result.threshold.toFixed(1)}:1  ${result.name}`
    );
  }

  const failures = results.filter(result => !result.passed);
  console.log(
    `\n${results.length - failures.length}/${results.length} coppie conformi.`
  );
  return failures.length === 0 ? 0 : 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runContrastAudit();
}
