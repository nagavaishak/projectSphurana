import type {
  LocationOpeningHours,
  LocationScheduleResult,
  OpeningHoursException,
} from '@borradh-workspace/api-client/types';

import type { TWorkingHours } from '@/components/calendar/types';

const FULL_DAY: TWorkingHours[number] = { from: 0, to: 0 };

/**
 * Pick the effective weekly schedule for "today" — the location's standing
 * schedule wins, falling back to the org default. Each day key is hours
 * (not minutes); we convert from the API representation (minutes from
 * midnight) to TWorkingHours' hour-based shape used by the time grid.
 */
export function scheduleToWorkingHours(
  schedule: LocationScheduleResult | null
): TWorkingHours {
  const minutes = schedule?.openingHours ?? schedule?.organizationDefault ?? {};

  const out: TWorkingHours = {
    0: { ...FULL_DAY },
    1: { ...FULL_DAY },
    2: { ...FULL_DAY },
    3: { ...FULL_DAY },
    4: { ...FULL_DAY },
    5: { ...FULL_DAY },
    6: { ...FULL_DAY },
  };

  for (const [dowStr, range] of Object.entries(minutes)) {
    const dow = Number(dowStr);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) continue;
    if (!range) continue;
    out[dow] = {
      from: Math.floor(range.from / 60),
      to: Math.ceil(range.to / 60),
    };
  }

  return out;
}

/**
 * Resolve a specific date's effective opening hours (in minutes), taking
 * exceptions into account. Returns null when closed.
 */
export function resolveDateOpening(
  date: Date,
  schedule: LocationScheduleResult | null
): {
  fromMinutes: number;
  toMinutes: number;
  closed: boolean;
  source: 'exception' | 'standing' | 'org-default';
} {
  const ymd = formatDate(date);
  const exception = schedule?.exceptions.find(
    (e: OpeningHoursException) => e.date === ymd
  );
  if (exception) {
    if (
      exception.closed ||
      exception.fromMinutes == null ||
      exception.toMinutes == null
    ) {
      return {
        fromMinutes: 540,
        toMinutes: 1020,
        closed: true,
        source: 'exception',
      };
    }
    return {
      fromMinutes: exception.fromMinutes,
      toMinutes: exception.toMinutes,
      closed: false,
      source: 'exception',
    };
  }
  const dow = String(date.getDay());
  const standing: LocationOpeningHours | null = schedule?.openingHours ?? null;
  const fallback: LocationOpeningHours | null =
    schedule?.organizationDefault ?? null;
  const row = standing?.[dow] ?? fallback?.[dow];
  if (!row || row.from === row.to) {
    return {
      fromMinutes: 540,
      toMinutes: 1020,
      closed: true,
      source: standing?.[dow] !== undefined ? 'standing' : 'org-default',
    };
  }
  return {
    fromMinutes: row.from,
    toMinutes: row.to,
    closed: false,
    source: standing?.[dow] !== undefined ? 'standing' : 'org-default',
  };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
