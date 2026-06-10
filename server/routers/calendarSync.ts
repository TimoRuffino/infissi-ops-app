import { randomBytes } from "crypto";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getInterventiStore } from "./interventi";
import { getCommessaById } from "./commesse";
import { getClienteById } from "./clienti";

// ── Google Calendar sync via subscribable ICS feeds ──────────────────────────
//
// Why ICS and not full OAuth: Google Calendar can "Add by URL" any public
// iCal feed and auto-refreshes it. That gives a working, zero-setup one-way
// sync (app → Google) for as many calendars as the operator wants — one feed
// per intervento type plus an "all" feed. No Google Cloud project, no consent
// screen, no token storage for Google.
//
// Security: each sede gets an unguessable token in the feed URL. The token is
// the only credential Google sends (it fetches anonymously), so it doubles as
// a bearer secret — rotate it to revoke all existing subscriptions.

type CalendarToken = {
  sedeId: number;
  token: string;
  createdAt: Date;
};

const _store = persistedStore<CalendarToken>("calendar_tokens", () => {});
const tokens = _store.items;

function genToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Get (creating if needed) the feed token for a sede. */
function tokenForSede(sedeId: number): string {
  let row = tokens.find((t) => t.sedeId === sedeId);
  if (!row) {
    row = { sedeId, token: genToken(), createdAt: new Date() };
    tokens.push(row);
    _store.save();
  }
  return row.token;
}

/** Resolve a feed token back to its sede id (null when unknown). */
export function sedeForToken(token: string): number | null {
  const row = tokens.find((t) => t.token === token);
  return row ? row.sedeId : null;
}

// The feeds exposed to the operator. `tipo` null = all interventi.
export const CALENDAR_FEEDS = [
  { key: "tutti", label: "Tutti gli appuntamenti", tipo: null as string | null },
  { key: "rilievo", label: "Rilievi", tipo: "rilievo" },
  { key: "posa", label: "Pose", tipo: "posa" },
  { key: "assistenza", label: "Assistenza", tipo: "assistenza" },
  { key: "altro", label: "Altro", tipo: "altro" },
] as const;

const TIPO_LABEL: Record<string, string> = {
  rilievo: "Rilievo",
  posa: "Posa",
  assistenza: "Assistenza",
  altro: "Intervento",
};

// ── ICS rendering ───────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Local wall-clock stamp "YYYYMMDDTHHMMSS" (paired with TZID=Europe/Rome).
function icsLocal(date: string, time?: string | null): string {
  const [y, m, d] = (date ?? "").split("-").map((x) => parseInt(x, 10));
  let hh = 9;
  let mm = 0;
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    const [h, mi] = time.split(":").map((x) => parseInt(x, 10));
    hh = h;
    mm = mi;
  }
  return `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
}

// Add minutes to a "YYYYMMDDTHHMMSS" stamp (default appointment length 60').
function addMinutes(stamp: string, minutes: number): string {
  const y = +stamp.slice(0, 4);
  const mo = +stamp.slice(4, 6);
  const d = +stamp.slice(6, 8);
  const h = +stamp.slice(9, 11);
  const mi = +stamp.slice(11, 13);
  const dt = new Date(y, mo - 1, d, h, mi + minutes);
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}${pad(dt.getMinutes())}00`;
}

function icsEscape(s: string): string {
  return (s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold long lines to 75 octets per RFC 5545 (cheap char-based approximation).
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
    i += 73;
  }
  return out.join("\r\n");
}

function nowStampUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(
    d.getUTCDate()
  )}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// Minimal Europe/Rome VTIMEZONE so Google honours local times + DST.
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Rome",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/**
 * Build an ICS document for one sede + feed. `feedKey` selects the type
 * filter; unknown keys default to "tutti".
 */
export function buildIcs(sedeId: number, feedKey: string): string {
  const feed =
    CALENDAR_FEEDS.find((f) => f.key === feedKey) ?? CALENDAR_FEEDS[0];
  const interventi = getInterventiStore().filter(
    (i: any) =>
      i.sedeId === sedeId &&
      i.stato !== "annullato" &&
      i.dataPianificata &&
      (feed.tipo == null || i.tipo === feed.tipo)
  );

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ruffino Flow//Calendario//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Ruffino Flow — ${feed.label}`,
    "X-WR-TIMEZONE:Europe/Rome",
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
    ...VTIMEZONE,
  ];

  const stampNow = nowStampUtc();

  for (const i of interventi) {
    const commessa = i.commessaId ? getCommessaById(i.commessaId) : null;
    const cliente =
      commessa?.clienteId != null ? getClienteById(commessa.clienteId) : null;
    const nomeCliente = cliente
      ? `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim()
      : commessa?.cliente ?? "";

    const start = icsLocal(i.dataPianificata, i.oraInizio);
    const end = i.oraFine
      ? icsLocal(i.dataPianificata, i.oraFine)
      : addMinutes(start, 60);

    const tipoLabel = TIPO_LABEL[i.tipo] ?? "Intervento";
    const summary = [tipoLabel, nomeCliente].filter(Boolean).join(" — ");
    const indirizzo =
      i.indirizzo ||
      commessa?.indirizzo ||
      (cliente?.indirizzoLavoro ?? cliente?.indirizzo) ||
      "";
    const descParts = [
      commessa?.codice ? `Commessa ${commessa.codice}` : "",
      i.note ? `Note: ${i.note}` : "",
    ].filter(Boolean);

    lines.push(
      "BEGIN:VEVENT",
      `UID:intervento-${i.id}@ruffino-flow`,
      `DTSTAMP:${stampNow}`,
      `DTSTART;TZID=Europe/Rome:${start}`,
      `DTEND;TZID=Europe/Rome:${end}`,
      fold(`SUMMARY:${icsEscape(summary || tipoLabel)}`),
      indirizzo ? fold(`LOCATION:${icsEscape(indirizzo)}`) : "",
      descParts.length ? fold(`DESCRIPTION:${icsEscape(descParts.join("\n"))}`) : "",
      `STATUS:${i.stato === "completato" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n") + "\r\n";
}

// ── tRPC router ──────────────────────────────────────────────────────────────

export const calendarSyncRouter = router({
  // Feed metadata for the current sede: the token + the per-feed paths.
  // The client composes absolute URLs from window.location.origin.
  feeds: protectedProcedure.query(({ ctx }) => {
    const sedeId = ctx.sedeId ?? 1;
    const token = tokenForSede(sedeId);
    return {
      token,
      feeds: CALENDAR_FEEDS.map((f) => ({
        key: f.key,
        label: f.label,
        path: `/api/ics/${token}/${f.key}.ics`,
      })),
    };
  }),

  // Invalidate every existing subscription by minting a new token.
  rotateToken: protectedProcedure.mutation(({ ctx }) => {
    const sedeId = ctx.sedeId ?? 1;
    const idx = tokens.findIndex((t) => t.sedeId === sedeId);
    const fresh = genToken();
    if (idx === -1) {
      tokens.push({ sedeId, token: fresh, createdAt: new Date() });
    } else {
      tokens[idx] = { ...tokens[idx], token: fresh, createdAt: new Date() };
    }
    _store.save();
    return { token: fresh };
  }),
});

const _feedKeys = z.enum(["tutti", "rilievo", "posa", "assistenza", "altro"]);
export type FeedKey = z.infer<typeof _feedKeys>;
