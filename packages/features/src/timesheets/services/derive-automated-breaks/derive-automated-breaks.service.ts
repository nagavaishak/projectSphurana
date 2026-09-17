import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DeriveAutomatedBreaksInput,
  deriveAutomatedBreaksSchema,
} from './derive-automated-breaks.schema.js';

export interface DerivedBreak {
  breakStart: Date;
  breakEnd: Date;
}

/**
 * Pure automated-break derivation (contract §1.5): unpaid (`paid=false`)
 * blocked_time occurrences are the break signal. Occurrences are clipped to
 * the entry window, zero-length results dropped, and overlapping/adjacent
 * unpaid intervals merged so at most one break row covers any instant.
 *
 * Pure, synchronous — no trackedResult (no I/O).
 */
export const deriveAutomatedBreaks = (
  input: DeriveAutomatedBreaksInput
): Result<DerivedBreak[]> => {
  const parsed = deriveAutomatedBreaksSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { clockIn, clockOut, occurrences } = parsed.data;
  const windowStart = clockIn.getTime();
  const windowEnd = clockOut.getTime();

  const clipped = occurrences
    .filter((o) => !o.paid)
    .map((o) => ({
      start: Math.max(o.start.getTime(), windowStart),
      end: Math.min(o.end.getTime(), windowEnd),
    }))
    .filter((o) => o.end > o.start)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  return ok(
    merged.map((m) => ({
      breakStart: new Date(m.start),
      breakEnd: new Date(m.end),
    }))
  );
};
