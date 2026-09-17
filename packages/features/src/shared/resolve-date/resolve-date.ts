/**
 * Shared date-expression resolver — the single time source for every
 * date-bearing surface (assistant tools, chatbots, API validation messages).
 *
 * Design principle (Claire reliability overhaul, Phase 3): **the model never
 * does date arithmetic.** The server's real clock plus the organisation's
 * IANA timezone are the only time source; callers pass the user's words
 * ("tomorrow", "in 2 weeks", "until August 7th") through verbatim and this
 * module resolves them to absolute dates/datetimes.
 *
 * Pure functions — no I/O, no Result wrapper (same convention as the other
 * `shared/` helpers, e.g. `timezone.ts`, `business-hours.ts`). Unresolvable
 * expressions return `null`; callers decide whether that is an error.
 */

import { zonedDateString, zonedWallTimeToUtc } from '../timezone.js';

/** Outcome of resolving one expression. */
export type ResolvedDate =
  /** A single calendar date (org-timezone wall date). */
  | { kind: 'date'; date: string }
  /** A precise instant. `iso` is the UTC instant; `date` its org-tz wall date. */
  | { kind: 'datetime'; iso: string; date: string }
  /** An inclusive calendar-date range (org-timezone wall dates). */
  | { kind: 'range'; start: string; end: string };

export interface ResolveDateOptions {
  /** IANA org timezone, e.g. "Europe/Dublin". */
  timezone: string;
  /** Injectable clock for tests. Defaults to the real clock. */
  now?: Date;
}

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

// ── Calendar-date helpers (pure YYYY-MM-DD arithmetic, timezone-free) ───────

function parseDateStr(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function formatUtcDate(ms: number): string {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

/** Add whole days to a YYYY-MM-DD calendar date. */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDateStr(date);
  return formatUtcDate(Date.UTC(y, m - 1, d + days));
}

/** Add calendar months (clamped by JS Date semantics) to a YYYY-MM-DD date. */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parseDateStr(date);
  // JS rolls over (Jan 31 + 1mo → Mar 3); clamp to the target month's last day.
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return formatUtcDate(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      Math.min(d, lastDay)
    )
  );
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD calendar date. */
function dayOfWeek(date: string): number {
  const { y, m, d } = parseDateStr(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday of the ISO week containing `date`. */
function mondayOfWeek(date: string): string {
  const dow = dayOfWeek(date);
  // Monday=1 … Sunday=0 → distance back to Monday.
  const back = dow === 0 ? 6 : dow - 1;
  return addDays(date, -back);
}

/** Today's wall-clock calendar date in the org timezone. */
export function todayInTimezone(options: ResolveDateOptions): string {
  return zonedDateString(options.now ?? new Date(), options.timezone);
}

// ── Time-of-day extraction ──────────────────────────────────────────────────

/**
 * Pull a trailing time-of-day off an expression. Returns the remaining date
 * part plus minutes-from-midnight, or null when no unambiguous time exists.
 *
 * Requires am/pm OR a colon so bare trailing digits ("august 7") are never
 * misread as an hour.
 */
function extractTime(
  expr: string
): { datePart: string; minutes: number } | null {
  const match = expr.match(
    /(?:\bat\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i
  );
  if (!match) return null;
  const [full, hourStr, minuteStr, meridiem] = match;
  // Ambiguity guard: without am/pm or minutes this is a day number, not a time.
  if (!meridiem && minuteStr === undefined) return null;
  let hour = Number(hourStr);
  const minute = Number(minuteStr ?? '0');
  if (hour > 23 || minute > 59) return null;
  if (meridiem?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (meridiem?.toLowerCase() === 'am' && hour === 12) hour = 0;
  return {
    datePart: expr.slice(0, expr.length - full.length).trim(),
    minutes: hour * 60 + minute,
  };
}

// ── Date-part grammar ───────────────────────────────────────────────────────

/**
 * Resolve the date-part of an expression to a single date or a range.
 * Returns null when the grammar doesn't match.
 */
function resolveDatePart(
  raw: string,
  options: ResolveDateOptions
):
  | { kind: 'date'; date: string }
  | { kind: 'range'; start: string; end: string }
  | null {
  const today = todayInTimezone(options);
  let expr = raw.toLowerCase().trim();
  // "until August 7th" / "by Friday" / "through next week" — the window
  // qualifier doesn't change the resolved endpoint.
  expr = expr.replace(/^(?:valid\s+)?(?:until|till|through|thru|by|to)\s+/, '');
  expr = expr.replace(/^(?:the|this coming)\s+/, '');

  if (expr === '') return null;
  if (expr === 'today' || expr === 'now') return { kind: 'date', date: today };
  if (expr === 'tomorrow') return { kind: 'date', date: addDays(today, 1) };
  if (expr === 'yesterday') return { kind: 'date', date: addDays(today, -1) };
  if (expr === 'day after tomorrow') {
    return { kind: 'date', date: addDays(today, 2) };
  }

  // ISO calendar date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(expr)) return { kind: 'date', date: expr };

  // "this week" — the calendar week (Mon–Sun) containing today.
  if (expr === 'this week') {
    const start = mondayOfWeek(today);
    return { kind: 'range', start, end: addDays(start, 6) };
  }
  if (expr === 'next week') {
    const start = addDays(mondayOfWeek(today), 7);
    return { kind: 'range', start, end: addDays(start, 6) };
  }
  if (expr === 'this month') {
    const { y, m } = parseDateStr(today);
    const start = formatUtcDate(Date.UTC(y, m - 1, 1));
    return { kind: 'range', start, end: formatUtcDate(Date.UTC(y, m, 0)) };
  }
  if (expr === 'next month') {
    const { y, m } = parseDateStr(today);
    const start = formatUtcDate(Date.UTC(y, m, 1));
    return { kind: 'range', start, end: formatUtcDate(Date.UTC(y, m + 1, 0)) };
  }
  if (expr === 'this weekend') {
    const monday = mondayOfWeek(today);
    return {
      kind: 'range',
      start: addDays(monday, 5),
      end: addDays(monday, 6),
    };
  }

  // "end of the month" / "end of next month" / "end of August" / "end of the
  // week" — the LAST day of the named window. These phrases are advertised
  // verbatim in the offer tool descriptions ("until end of August", "end of
  // the month"), so the grammar must accept them or the tool 400s on its own
  // documented happy path.
  const endOf = expr.match(/^end\s+of\s+(?:the\s+|this\s+)?(.+)$/);
  if (endOf) {
    const inner = endOf[1].trim();
    const { y, m } = parseDateStr(today);
    if (inner === 'month') {
      return { kind: 'date', date: formatUtcDate(Date.UTC(y, m, 0)) };
    }
    if (inner === 'next month') {
      return { kind: 'date', date: formatUtcDate(Date.UTC(y, m + 1, 0)) };
    }
    if (inner === 'week') {
      return { kind: 'date', date: addDays(mondayOfWeek(today), 6) };
    }
    if (inner === 'next week') {
      return { kind: 'date', date: addDays(mondayOfWeek(today), 13) };
    }
    if (inner === 'year') {
      return { kind: 'date', date: formatUtcDate(Date.UTC(y, 12, 0)) };
    }
    const endMonth = MONTH_NAMES[inner];
    if (endMonth) {
      // Last day of that month — the NEXT future occurrence (same rule as
      // bare month-day expressions).
      const thisYear = formatUtcDate(Date.UTC(y, endMonth, 0));
      return {
        kind: 'date',
        date:
          thisYear >= today
            ? thisYear
            : formatUtcDate(Date.UTC(y + 1, endMonth, 0)),
      };
    }
    return null;
  }

  // "in 2 weeks" / "in 3 days" / "in 1 month" / "another 2 weeks" /
  // "2 weeks from now". "another N" is what the extend-offer tool description
  // advertises, so it must resolve.
  const inMatch =
    expr.match(/^(?:in|another)\s+(a|an|\d+)\s+(day|week|month)s?$/) ??
    expr.match(/^(a|an|\d+)\s+(day|week|month)s?\s+from\s+(?:now|today)$/);
  if (inMatch) {
    const n =
      inMatch[1] === 'a' || inMatch[1] === 'an' ? 1 : Number(inMatch[1]);
    const unit = inMatch[2];
    const date =
      unit === 'day'
        ? addDays(today, n)
        : unit === 'week'
          ? addDays(today, n * 7)
          : addMonths(today, n);
    return { kind: 'date', date };
  }

  // "next 2 weeks" / "the next 14 days" / "for the next month" /
  // "valid for 2 weeks" — a forward window starting today.
  const nextWindow =
    expr.match(
      /^(?:for\s+)?(?:the\s+)?next\s+(a|an|\d+)?\s*(day|week|month)s?$/
    ) ?? expr.match(/^(?:valid\s+)?for\s+(a|an|\d+)\s+(day|week|month)s?$/);
  if (nextWindow?.[1]) {
    const n =
      nextWindow[1] === 'a' || nextWindow[1] === 'an'
        ? 1
        : Number(nextWindow[1]);
    const unit = nextWindow[2];
    const end =
      unit === 'day'
        ? addDays(today, n)
        : unit === 'week'
          ? addDays(today, n * 7)
          : addMonths(today, n);
    return { kind: 'range', start: today, end };
  }

  // Day names, with optional "next" prefix: "friday", "next friday".
  const dayMatch = expr.match(/^(next\s+)?([a-z]+)$/);
  if (dayMatch) {
    const idx = DAY_NAMES.indexOf(dayMatch[2] as (typeof DAY_NAMES)[number]);
    if (idx !== -1) {
      const todayDow = dayOfWeek(today);
      let ahead = idx - todayDow;
      if (ahead <= 0) ahead += 7;
      return { kind: 'date', date: addDays(today, ahead) };
    }
  }

  // Month-day (either order, optional ordinal suffix + year):
  // "august 7th", "aug 7", "7th august", "7 august 2026", "august 7, 2026".
  const monthFirst = expr.match(
    /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/
  );
  const dayFirst = expr.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:,?\s+(\d{4}))?$/
  );
  const md = monthFirst
    ? {
        month: MONTH_NAMES[monthFirst[1]],
        day: Number(monthFirst[2]),
        year: monthFirst[3],
      }
    : dayFirst
      ? {
          month: MONTH_NAMES[dayFirst[2]],
          day: Number(dayFirst[1]),
          year: dayFirst[3],
        }
      : null;
  if (md?.month && md.day >= 1 && md.day <= 31) {
    if (md.year) {
      return {
        kind: 'date',
        date: formatUtcDate(Date.UTC(Number(md.year), md.month - 1, md.day)),
      };
    }
    // No year given → the NEXT future occurrence. This is the Phase 3 fix for
    // "until August 7th" resolving into the past (register #158): if the
    // month-day has already passed this year, it means next year.
    const { y } = parseDateStr(today);
    const thisYear = formatUtcDate(Date.UTC(y, md.month - 1, md.day));
    return {
      kind: 'date',
      date:
        thisYear >= today
          ? thisYear
          : formatUtcDate(Date.UTC(y + 1, md.month - 1, md.day)),
    };
  }

  return null;
}

// ── Public resolvers ────────────────────────────────────────────────────────

/**
 * Resolve an absolute ISO date/datetime OR a relative expression to an
 * absolute outcome, from the real clock in the org timezone.
 *
 * Accepts (non-exhaustive): `2026-08-07`, `2026-08-07T14:00:00Z`, `today`,
 * `tomorrow`, `tomorrow 2pm`, `friday`, `next friday`, `in 2 weeks`,
 * `next 2 weeks`, `this week`, `next month`, `until August 7th`, `august 7`.
 *
 * Returns null when the expression can't be resolved — callers surface a
 * structured validation error (which should quote today's date).
 */
export function resolveDateExpression(
  expression: string,
  options: ResolveDateOptions
): ResolvedDate | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;

  // Absolute ISO datetime. With an explicit offset/Z it's already an instant;
  // without one it is org-timezone wall time.
  const isoDateTime = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i
  );
  if (isoDateTime) {
    const [, date, hh, mm, offset] = isoDateTime;
    if (offset) {
      const instant = new Date(trimmed);
      if (Number.isNaN(instant.getTime())) return null;
      return {
        kind: 'datetime',
        iso: instant.toISOString(),
        date: zonedDateString(instant, options.timezone),
      };
    }
    const instant = zonedWallTimeToUtc(
      date,
      Number(hh) * 60 + Number(mm),
      options.timezone
    );
    return { kind: 'datetime', iso: instant.toISOString(), date };
  }

  // Relative/plain-date grammar, with an optional trailing time-of-day.
  const time = extractTime(trimmed);
  if (time) {
    const datePart =
      time.datePart === ''
        ? { kind: 'date' as const, date: todayInTimezone(options) }
        : resolveDatePart(time.datePart, options);
    if (!datePart || datePart.kind !== 'date') return null;
    const instant = zonedWallTimeToUtc(
      datePart.date,
      time.minutes,
      options.timezone
    );
    return {
      kind: 'datetime',
      iso: instant.toISOString(),
      date: datePart.date,
    };
  }

  return resolveDatePart(trimmed, options);
}

/**
 * Resolve an expression to a single YYYY-MM-DD calendar date (org timezone).
 * Ranges collapse to their START date. Returns null when unresolvable.
 */
export function resolveDateOnly(
  expression: string,
  options: ResolveDateOptions
): string | null {
  const resolved = resolveDateExpression(expression, options);
  if (!resolved) return null;
  if (resolved.kind === 'range') return resolved.start;
  return resolved.date;
}

/**
 * Resolve an expression to a UTC instant (ISO string).
 *
 * `edge` decides how date-only outcomes map to an instant in the org
 * timezone: `'start'` → 00:00, `'end'` → 23:59 (used for validity windows —
 * "valid until August 7th" means the END of that day). Ranges use the range
 * start for `'start'` and the range end for `'end'` — so "valid for the next
 * 2 weeks" with `edge: 'end'` lands on the window's last day.
 */
export function resolveDateTime(
  expression: string,
  options: ResolveDateOptions & { edge: 'start' | 'end' }
): string | null {
  const resolved = resolveDateExpression(expression, options);
  if (!resolved) return null;
  if (resolved.kind === 'datetime') return resolved.iso;
  const date =
    resolved.kind === 'range'
      ? options.edge === 'end'
        ? resolved.end
        : resolved.start
      : resolved.date;
  const minutes = options.edge === 'end' ? 23 * 60 + 59 : 0;
  return zonedWallTimeToUtc(date, minutes, options.timezone).toISOString();
}

// ── Insights range presets ──────────────────────────────────────────────────

/**
 * Relative range presets for insights/list-style tools. Resolved server-side
 * so "this week" can never be computed against the model's training-year
 * prior (register #193).
 */
export const RANGE_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'last_7_days',
  'last_14_days',
  'last_30_days',
  'this_month',
  'last_month',
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

/** Inclusive calendar-date range for a preset, in the org timezone. */
export function resolveRangePreset(
  preset: RangePreset,
  options: ResolveDateOptions
): { since: string; until: string } {
  const today = todayInTimezone(options);
  switch (preset) {
    case 'today':
      return { since: today, until: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { since: y, until: y };
    }
    case 'this_week': {
      const start = mondayOfWeek(today);
      return { since: start, until: addDays(start, 6) };
    }
    case 'last_week': {
      const start = addDays(mondayOfWeek(today), -7);
      return { since: start, until: addDays(start, 6) };
    }
    case 'last_7_days':
      return { since: addDays(today, -6), until: today };
    case 'last_14_days':
      return { since: addDays(today, -13), until: today };
    case 'last_30_days':
      return { since: addDays(today, -29), until: today };
    case 'this_month': {
      const { y, m } = parseDateStr(today);
      return {
        since: formatUtcDate(Date.UTC(y, m - 1, 1)),
        until: formatUtcDate(Date.UTC(y, m, 0)),
      };
    }
    case 'last_month': {
      const { y, m } = parseDateStr(today);
      return {
        since: formatUtcDate(Date.UTC(y, m - 2, 1)),
        until: formatUtcDate(Date.UTC(y, m - 1, 0)),
      };
    }
  }
}

/**
 * `Today is Wednesday 2026-07-29 (Europe/Dublin).` — the advisory line the
 * orchestrator injects into the (uncached) business-context block, and the
 * date quoted in validation-backstop error messages so the model can
 * self-correct in-turn.
 */
export function describeToday(options: ResolveDateOptions): string {
  const now = options.now ?? new Date();
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: options.timezone,
    weekday: 'long',
  }).format(now);
  return `${weekday} ${zonedDateString(now, options.timezone)} (${options.timezone})`;
}
