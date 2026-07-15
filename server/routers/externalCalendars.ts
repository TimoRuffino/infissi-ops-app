import { randomBytes } from "crypto";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

// ── Import external Google calendars into the CRM calendar (read-only) ────────
//
// The operator pastes the "Secret address in iCal format" of each Google
// calendar (Google Calendar → settings of the calendar → Integra calendario).
// The server fetches those ICS URLs (avoids browser CORS), parses + expands
// recurring events for the requested window, and the Planning view overlays
// them as read-only entries alongside the CRM interventi.

type ExternalSource = {
  id: string;
  sedeId: number;
  nome: string;
  icsUrl: string;
  color: string;
  attivo: boolean;
  createdAt: Date;
};

const _store = persistedStore<ExternalSource>("external_calendars", () => {});
const sources = _store.items;

const PALETTE = [
  "#2563eb",
  "#0e9384",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#15803d",
  "#dc2626",
];

// ── ICS parsing ───────────────────────────────────────────────────────────

type ParsedEvent = {
  uid: string;
  summary: string;
  location: string;
  start: { date: string; time: string | null; allDay: boolean };
  durationMin: number;
  rrule: string | null;
  exdates: string[]; // YYYY-MM-DD
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Unfold RFC5545 lines (continuation lines start with space or tab).
function unfold(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// Convert a UTC ICS datetime (…Z) to Europe/Rome local date + HH:MM.
function utcToRome(y: number, mo: number, d: number, h: number, mi: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// Parse a DTSTART/DTEND value (+ params) → date/time/allDay.
function parseDt(
  value: string,
  params: Record<string, string>
): { date: string; time: string | null; allDay: boolean } {
  const v = value.trim();
  // DATE (all-day): "YYYYMMDD"
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    return {
      date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`,
      time: null,
      allDay: true,
    };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) {
    // Unknown format → treat the leading 8 digits as a date.
    const d8 = v.replace(/[^0-9]/g, "").slice(0, 8);
    return {
      date: `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`,
      time: null,
      allDay: true,
    };
  }
  const [, y, mo, d, h, mi, , z] = m;
  if (z === "Z") {
    const r = utcToRome(+y, +mo, +d, +h, +mi);
    return { date: r.date, time: r.time, allDay: false };
  }
  // Local / TZID — treat as wall-clock (Google exports Europe/Rome for IT users).
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, allDay: false };
}

function minutesBetween(
  a: { date: string; time: string | null },
  b: { date: string; time: string | null }
): number {
  const av = new Date(`${a.date}T${a.time ?? "00:00"}:00`);
  const bv = new Date(`${b.date}T${b.time ?? "00:00"}:00`);
  const diff = Math.round((bv.getTime() - av.getTime()) / 60000);
  return diff > 0 ? diff : 60;
}

function parseIcs(text: string): ParsedEvent[] {
  const lines = unfold(text);
  const events: ParsedEvent[] = [];
  let cur: any = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { uid: "", summary: "", location: "", rrule: null, exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && cur._start) {
        events.push({
          uid: cur.uid || randomBytes(6).toString("hex"),
          summary: cur.summary || "(senza titolo)",
          location: cur.location || "",
          start: cur._start,
          durationMin: cur._end
            ? minutesBetween(cur._start, cur._end)
            : cur._start.allDay
            ? 24 * 60
            : 60,
          rrule: cur.rrule,
          exdates: cur.exdates,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const cidx = line.indexOf(":");
    if (cidx === -1) continue;
    const left = line.slice(0, cidx);
    const value = line.slice(cidx + 1);
    const [name, ...paramParts] = left.split(";");
    const params: Record<string, string> = {};
    for (const p of paramParts) {
      const eq = p.indexOf("=");
      if (eq !== -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    const key = name.toUpperCase();
    if (key === "UID") cur.uid = value.trim();
    else if (key === "SUMMARY") cur.summary = unescapeText(value);
    else if (key === "LOCATION") cur.location = unescapeText(value);
    else if (key === "DTSTART") cur._start = parseDt(value, params);
    else if (key === "DTEND") cur._end = parseDt(value, params);
    else if (key === "RRULE") cur.rrule = value.trim();
    else if (key === "EXDATE") {
      for (const part of value.split(",")) {
        const p = parseDt(part, params);
        cur.exdates.push(p.date);
      }
    }
  }
  return events;
}

// ── RRULE expansion (within a [from,to] window) ──────────────────────────────

const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Expand one event into concrete dates (YYYY-MM-DD) within [from,to].
function expandDates(ev: ParsedEvent, fromD: Date, toD: Date): string[] {
  const startParts = ev.start.date.split("-").map((x) => parseInt(x, 10));
  const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);

  if (!ev.rrule) {
    return ev.start.date >= ymd(fromD) && ev.start.date <= ymd(toD)
      ? [ev.start.date]
      : [];
  }

  // Parse RRULE.
  const rule: Record<string, string> = {};
  for (const part of ev.rrule.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1) rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = rule.FREQ;
  const interval = Math.max(1, parseInt(rule.INTERVAL ?? "1", 10) || 1);
  const count = rule.COUNT ? parseInt(rule.COUNT, 10) : null;
  let until: Date | null = null;
  if (rule.UNTIL) {
    const u = rule.UNTIL.replace(/[^0-9]/g, "");
    until = new Date(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8));
  }
  const byday = (rule.BYDAY ?? "")
    .split(",")
    .map((x) => x.replace(/[-+0-9]/g, ""))
    .filter(Boolean);

  const ex = new Set(ev.exdates);
  const out: string[] = [];
  let emitted = 0;
  const MAX_ITER = 1500;

  const pushIfInWindow = (d: Date) => {
    const s = ymd(d);
    if (ex.has(s)) return true; // counts toward COUNT but skipped
    if (until && d > until) return false;
    if (d >= fromD && d <= toD) out.push(s);
    return true;
  };

  if (freq === "WEEKLY" && byday.length) {
    // Iterate week by week from the DTSTART week.
    let weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // back to Sunday
    let iter = 0;
    outer: while (iter < MAX_ITER) {
      for (const code of byday) {
        const dow = WEEKDAY.indexOf(code);
        if (dow === -1) continue;
        const occ = new Date(weekStart);
        occ.setDate(occ.getDate() + dow);
        if (occ < startDate) continue;
        if (count != null && emitted >= count) break outer;
        if (until && occ > until) break outer;
        if (occ > toD) break outer;
        const ok = pushIfInWindow(occ);
        emitted++;
        if (!ok) break outer;
      }
      weekStart.setDate(weekStart.getDate() + 7 * interval);
      iter++;
      if (weekStart > toD && (count == null)) break;
    }
    return out;
  }

  // DAILY / WEEKLY(no byday) / MONTHLY / YEARLY: step from DTSTART.
  let cursor = new Date(startDate);
  let iter = 0;
  while (iter < MAX_ITER) {
    if (count != null && emitted >= count) break;
    if (until && cursor > until) break;
    if (cursor > toD) break;
    const ok = pushIfInWindow(cursor);
    emitted++;
    if (!ok) break;
    if (freq === "DAILY") cursor.setDate(cursor.getDate() + interval);
    else if (freq === "WEEKLY") cursor.setDate(cursor.getDate() + 7 * interval);
    else if (freq === "MONTHLY") cursor.setMonth(cursor.getMonth() + interval);
    else if (freq === "YEARLY") cursor.setFullYear(cursor.getFullYear() + interval);
    else break; // unknown freq
    iter++;
  }
  return out;
}

// ── Per-source fetch + cache ─────────────────────────────────────────────────

// ── SSRF guard ───────────────────────────────────────────────────────────────
// The server fetches operator-supplied URLs. Without a guard a malicious URL
// could probe the internal network (localhost, Railway metadata, RFC1918).
// Only allow https to public-looking hostnames.
function assertSafeIcsUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL iCal non valido");
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && process.env.NODE_ENV === "development")) {
    throw new Error("Sono ammessi solo URL https");
  }
  const host = u.hostname.toLowerCase();
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    (isIp &&
      (/^(10|127|0)\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^169\.254\./.test(host))) ||
    host.includes(":") // raw IPv6
  ) {
    throw new Error("Host non consentito");
  }
}

type Cached = { fetchedAt: number; events: ParsedEvent[]; error?: string };
const cache = new Map<string, Cached>();
const TTL_MS = 10 * 60 * 1000;

async function getEvents(source: ExternalSource): Promise<Cached> {
  const hit = cache.get(source.id);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;
  try {
    // Google publishes ICS over https; webcal:// is just https.
    const url = source.icsUrl.replace(/^webcal:\/\//i, "https://");
    assertSafeIcsUrl(url);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const events = parseIcs(text);
    const fresh: Cached = { fetchedAt: Date.now(), events };
    cache.set(source.id, fresh);
    return fresh;
  } catch (e: any) {
    const fresh: Cached = {
      fetchedAt: Date.now(),
      events: hit?.events ?? [],
      error: e?.message ?? "fetch error",
    };
    cache.set(source.id, fresh);
    return fresh;
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

function maskIcsUrl(url: string): string {
  if (url.length <= 42) return url;
  return url.slice(0, 34) + "…" + url.slice(-8);
}

export const externalCalendarsRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return sources
      .filter((s) => s.sedeId === ctx.sedeId)
      .map((s) => ({
        id: s.id,
        nome: s.nome,
        // The private Google address is a bearer secret — show only enough
        // to recognize it.
        icsUrl: maskIcsUrl(s.icsUrl),
        color: s.color,
        attivo: s.attivo,
        status: cache.get(s.id)?.error ? "error" : cache.get(s.id) ? "ok" : "pending",
        error: cache.get(s.id)?.error ?? null,
      }));
  }),

  add: protectedProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        icsUrl: z.string().min(8),
        color: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      assertSafeIcsUrl(input.icsUrl.replace(/^webcal:\/\//i, "https://"));
      const sedeId = ctx.sedeId ?? 1;
      const used = sources.filter((s) => s.sedeId === sedeId).length;
      const src: ExternalSource = {
        id: randomBytes(8).toString("hex"),
        sedeId,
        nome: input.nome,
        icsUrl: input.icsUrl.trim(),
        color: input.color || PALETTE[used % PALETTE.length],
        attivo: true,
        createdAt: new Date(),
      };
      sources.push(src);
      _store.save();
      return { id: src.id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        nome: z.string().optional(),
        color: z.string().optional(),
        attivo: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const idx = sources.findIndex(
        (s) => s.id === input.id && s.sedeId === ctx.sedeId
      );
      if (idx === -1) throw new Error("Calendario non trovato");
      const { id, ...up } = input;
      sources[idx] = { ...sources[idx], ...up };
      _store.save();
      return { success: true };
    }),

  remove: protectedProcedure
    .input(z.string())
    .mutation(({ input, ctx }) => {
      const idx = sources.findIndex(
        (s) => s.id === input && s.sedeId === ctx.sedeId
      );
      if (idx === -1) throw new Error("Calendario non trovato");
      cache.delete(sources[idx].id);
      sources.splice(idx, 1);
      _store.save();
      return { success: true };
    }),

  // Force-refresh all of the sede's sources (clears their cache).
  refresh: protectedProcedure.mutation(({ ctx }) => {
    for (const s of sources) if (s.sedeId === ctx.sedeId) cache.delete(s.id);
    return { success: true };
  }),

  // Merged + expanded events for the sede within [from,to] (inclusive).
  events: protectedProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input, ctx }) => {
      const fromD = new Date(input.from + "T00:00:00");
      const toD = new Date(input.to + "T23:59:59");
      const mine = sources.filter(
        (s) => s.sedeId === ctx.sedeId && s.attivo
      );
      const cachedAll = await Promise.all(mine.map((s) => getEvents(s)));

      const out: any[] = [];
      mine.forEach((src, i) => {
        for (const ev of cachedAll[i].events) {
          const dates = expandDates(ev, fromD, toD);
          for (const date of dates) {
            out.push({
              id: `${src.id}:${ev.uid}:${date}`,
              sourceId: src.id,
              sourceNome: src.nome,
              color: src.color,
              titolo: ev.summary,
              location: ev.location,
              dataPianificata: date,
              oraInizio: ev.start.time,
              oraFine:
                ev.start.time && !ev.start.allDay
                  ? addMinutesToTime(ev.start.time, ev.durationMin)
                  : null,
              allDay: ev.start.allDay,
              external: true as const,
            });
          }
        }
      });
      return out;
    }),
});

function addMinutesToTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const total = h * 60 + m + minutes;
  const hh = Math.floor((total % 1440) / 60);
  const mm = total % 60;
  return `${pad(hh)}:${pad(mm)}`;
}
