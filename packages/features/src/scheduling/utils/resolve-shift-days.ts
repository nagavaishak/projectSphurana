import type { Shift } from '@borradh-workspace/database';
import type {
  ResolvedShiftDay,
  ResolvedShiftInterval,
} from '../models/scheduling.types.js';

/** Format a Date as local YYYY-MM-DD (shift dates are timezone-naive). */
function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function toInterval(row: Shift): ResolvedShiftInterval {
  return {
    shiftId: row.id,
    startMinutes: row.startMinutes ?? 0,
    endMinutes: row.endMinutes ?? 0,
    locationId: row.locationId,
  };
}

/**
 * Resolve raw shift rows into per-practitioner per-date days for a window,
 * applying the frozen override semantics (contract §1.1.6): if ANY override
 * rows exist for (practitioner, date), they replace ALL weekly rows for that
 * practitioner on that date's weekday; a single `isOff=true` override row
 * means "no shift this day".
 *
 * Only days with at least one applicable row are emitted (a practitioner
 * with no weekly pattern and no override for a weekday simply isn't working).
 */
export function resolveShiftDays(
  rows: Shift[],
  from: Date,
  to: Date
): ResolvedShiftDay[] {
  const weeklyByPractitioner = new Map<string, Map<number, Shift[]>>();
  const overridesByPractitioner = new Map<string, Map<string, Shift[]>>();
  const practitionerIds = new Set<string>();

  for (const row of rows) {
    practitionerIds.add(row.practitionerId);
    if (row.date !== null) {
      let byDate = overridesByPractitioner.get(row.practitionerId);
      if (!byDate) {
        byDate = new Map();
        overridesByPractitioner.set(row.practitionerId, byDate);
      }
      const list = byDate.get(row.date) ?? [];
      list.push(row);
      byDate.set(row.date, list);
    } else if (row.dayOfWeek !== null) {
      let byDow = weeklyByPractitioner.get(row.practitionerId);
      if (!byDow) {
        byDow = new Map();
        weeklyByPractitioner.set(row.practitionerId, byDow);
      }
      const list = byDow.get(row.dayOfWeek) ?? [];
      list.push(row);
      byDow.set(row.dayOfWeek, list);
    }
  }

  const results: ResolvedShiftDay[] = [];

  for (const practitionerId of practitionerIds) {
    const weekly = weeklyByPractitioner.get(practitionerId);
    const overrides = overridesByPractitioner.get(practitionerId);

    const cursor = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate()
    );
    const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());

    while (cursor <= end) {
      const dateStr = toDateString(cursor);
      const dayOfWeek = cursor.getDay();
      const overrideRows = overrides?.get(dateStr);

      if (overrideRows && overrideRows.length > 0) {
        const isOff = overrideRows.some((r) => r.isOff);
        results.push({
          practitionerId,
          date: dateStr,
          dayOfWeek,
          isOff,
          source: 'override',
          intervals: isOff
            ? []
            : overrideRows
                .map(toInterval)
                .sort((a, b) => a.startMinutes - b.startMinutes),
        });
      } else {
        const weeklyRows = weekly?.get(dayOfWeek);
        if (weeklyRows && weeklyRows.length > 0) {
          results.push({
            practitionerId,
            date: dateStr,
            dayOfWeek,
            isOff: false,
            source: 'weekly',
            intervals: weeklyRows
              .map(toInterval)
              .sort((a, b) => a.startMinutes - b.startMinutes),
          });
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }
  }

  results.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.practitionerId.localeCompare(b.practitionerId)
  );

  return results;
}
