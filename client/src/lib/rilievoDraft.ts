export type RilievoDraft = {
  measures: Record<string, string>;
  nodiCritici: string[];
  accessibilita: string[];
  verso: string;
  tipoRilievo: string;
  noteGenerali: string;
};

const EMPTY_DRAFT: RilievoDraft = {
  measures: {},
  nodiCritici: [],
  accessibilita: [],
  verso: "interno",
  tipoRilievo: "tecnico",
  noteGenerali: "",
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

export function parseRilievoDraft(
  raw: string | null | undefined
): RilievoDraft {
  if (!raw) return { ...EMPTY_DRAFT };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...EMPTY_DRAFT, noteGenerali: raw };
    }
    const candidate = parsed as Record<string, unknown>;
    return {
      measures: stringRecord(candidate.measures),
      nodiCritici: stringList(candidate.nodiCritici),
      accessibilita: stringList(candidate.accessibilita),
      verso:
        typeof candidate.verso === "string"
          ? candidate.verso
          : EMPTY_DRAFT.verso,
      tipoRilievo:
        typeof candidate.tipoRilievo === "string"
          ? candidate.tipoRilievo
          : EMPTY_DRAFT.tipoRilievo,
      noteGenerali:
        typeof candidate.noteGenerali === "string"
          ? candidate.noteGenerali
          : EMPTY_DRAFT.noteGenerali,
    };
  } catch {
    return { ...EMPTY_DRAFT, noteGenerali: raw };
  }
}

export function serializeRilievoDraft(draft: RilievoDraft): string {
  return JSON.stringify(draft);
}
