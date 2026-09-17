import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CalculateOvertimePayInput,
  calculateOvertimePaySchema,
} from './calculate-overtime-pay.schema.js';

export interface OvertimeDayBreakdown {
  /** Local calendar date (YYYY-MM-DD) in the input timezone. */
  date: string;
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
}

export interface OvertimePayResult {
  totalWorkedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  regularPayCents: number;
  overtimePayCents: number;
  totalPayCents: number;
  days: OvertimeDayBreakdown[];
}

const MS_PER_MINUTE = 60_000;

/** Local calendar date key (YYYY-MM-DD) for an instant in a timezone. */
const dayKey = (date: Date, timeZone: string): string =>
  // en-CA formats as YYYY-MM-DD
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/** ISO-week key (Monday-based) for a YYYY-MM-DD day key. */
const weekKey = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
};

/** Merged break minutes within the entry window. */
const breakMinutes = (
  entryStart: number,
  entryEnd: number,
  breaks: { breakStart: Date; breakEnd: Date | null }[]
): number => {
  const clipped = breaks
    .map((b) => ({
      start: Math.max(b.breakStart.getTime(), entryStart),
      end: Math.min(b.breakEnd?.getTime() ?? entryEnd, entryEnd),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const b of clipped) {
    const start = Math.max(b.start, cursor);
    if (b.end > start) {
      total += b.end - start;
      cursor = b.end;
    }
  }
  return total / MS_PER_MINUTE;
};

/**
 * Pure overtime/pay calculation over a set of closed time entries
 * (contract §1.1.8 wage config semantics):
 *
 * - Worked minutes per entry = (clockOut − clockIn) − break minutes.
 * - Entries are bucketed by the local calendar date of their clock-in.
 * - `regularWorkHoursPer='day'`: overtime = minutes beyond the threshold per
 *   day; `'week'`: per Monday-based week (days within a week contribute
 *   overtime proportionally after the weekly threshold is crossed, in
 *   chronological order).
 * - `overtimeType='multiplier'`: overtime rate = hourlyRate × multiplier;
 *   `'hourly_rate'`: the fixed overtime rate.
 * - `overtimeEnabled=false` or null regularWorkHours ⇒ everything regular.
 * - `compensationType='none'` ⇒ minutes computed, pay all zero.
 *
 * Pure, synchronous — no trackedResult (no I/O).
 */
export const calculateOvertimePay = (
  input: CalculateOvertimePayInput
): Result<OvertimePayResult> => {
  const parsed = calculateOvertimePaySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { wageConfig, entries, timezone } = parsed.data;

  // Validate config consistency for paid configs
  const paysHourly = wageConfig.compensationType === 'hourly';
  if (paysHourly && wageConfig.hourlyRateCents === null) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'hourlyRateCents is required for hourly compensation'
      )
    );
  }

  const overtimeActive =
    wageConfig.overtimeEnabled && wageConfig.regularWorkHours !== null;

  if (paysHourly && overtimeActive) {
    if (wageConfig.overtimeType === null) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'overtimeType is required when overtime is enabled'
        )
      );
    }
    if (
      wageConfig.overtimeType === 'multiplier' &&
      wageConfig.overtimeMultiplier === null
    ) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'overtimeMultiplier is required for multiplier overtime'
        )
      );
    }
    if (
      wageConfig.overtimeType === 'hourly_rate' &&
      wageConfig.overtimeHourlyRateCents === null
    ) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'overtimeHourlyRateCents is required for hourly-rate overtime'
        )
      );
    }
  }

  try {
    // ---- bucket worked minutes per local day -------------------------------
    const workedByDay = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.clockOut) continue; // still open — nothing settled
      const start = entry.clockIn.getTime();
      const end = entry.clockOut.getTime();
      if (end <= start) continue;
      const worked =
        (end - start) / MS_PER_MINUTE - breakMinutes(start, end, entry.breaks);
      if (worked <= 0) continue;
      const key = dayKey(entry.clockIn, timezone);
      workedByDay.set(key, (workedByDay.get(key) ?? 0) + worked);
    }

    const sortedDays = [...workedByDay.keys()].sort();
    const thresholdMinutes = overtimeActive
      ? (wageConfig.regularWorkHours as number) * 60
      : Number.POSITIVE_INFINITY;

    const days: OvertimeDayBreakdown[] = [];

    if (!overtimeActive || wageConfig.regularWorkHoursPer === 'day') {
      for (const date of sortedDays) {
        const worked = workedByDay.get(date) as number;
        const overtime = Math.max(0, worked - thresholdMinutes);
        days.push({
          date,
          workedMinutes: worked,
          regularMinutes: worked - overtime,
          overtimeMinutes: overtime,
        });
      }
    } else {
      // weekly threshold: walk days chronologically within each week
      const weekWorked = new Map<string, number>();
      for (const date of sortedDays) {
        const worked = workedByDay.get(date) as number;
        const wk = weekKey(date);
        const before = weekWorked.get(wk) ?? 0;
        const after = before + worked;
        weekWorked.set(wk, after);
        const overtime =
          Math.max(0, after - thresholdMinutes) -
          Math.max(0, before - thresholdMinutes);
        days.push({
          date,
          workedMinutes: worked,
          regularMinutes: worked - overtime,
          overtimeMinutes: overtime,
        });
      }
    }

    const totalWorkedMinutes = days.reduce((s, d) => s + d.workedMinutes, 0);
    const regularMinutes = days.reduce((s, d) => s + d.regularMinutes, 0);
    const overtimeMinutes = days.reduce((s, d) => s + d.overtimeMinutes, 0);

    let regularPayCents = 0;
    let overtimePayCents = 0;
    if (paysHourly) {
      const hourlyRate = wageConfig.hourlyRateCents as number;
      const overtimeRate =
        wageConfig.overtimeType === 'hourly_rate'
          ? (wageConfig.overtimeHourlyRateCents as number)
          : hourlyRate * (wageConfig.overtimeMultiplier ?? 1);
      regularPayCents = Math.round((regularMinutes / 60) * hourlyRate);
      overtimePayCents = Math.round((overtimeMinutes / 60) * overtimeRate);
    }

    return ok({
      totalWorkedMinutes,
      regularMinutes,
      overtimeMinutes,
      regularPayCents,
      overtimePayCents,
      totalPayCents: regularPayCents + overtimePayCents,
      days,
    });
  } catch (error) {
    // Intl throws RangeError on invalid timezone ids
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        error instanceof RangeError
          ? 'Invalid timezone'
          : 'Failed to calculate overtime pay'
      )
    );
  }
};
