import {
  type RangePreset,
  describeToday,
  resolveDateOnly,
  resolveDateTime,
  resolveRangePreset,
} from '@borradh-workspace/features/shared';
import { ApiFetchError } from '../../tool-factory/api-fetch.js';

/**
 * Date-expression resolution for Claire's date-bearing tools (Phase 3, Claire
 * reliability overhaul).
 *
 * The model NEVER does date arithmetic. It passes the user's words through
 * verbatim ("tomorrow", "valid for 2 weeks", "until August 7th", or a plain
 * `YYYY-MM-DD`); these helpers resolve them against the real server clock in
 * the ORG timezone (`ctx.timezone`) and hand back an absolute value the tool
 * then echoes to the user. This kills the class of bugs where the model
 * resolved dates against its 2025 training prior (register #158 pre-expired
 * offers, #208 a booking a year in the past, #193 "this week" against 2025).
 *
 * On an unresolvable expression we throw an {@link ApiFetchError} with status
 * 400: the tool factory treats 4xx as an EXPECTED client error (no Sentry
 * noise) and passes the message through to the model verbatim, and the message
 * quotes today's date so the model can self-correct in-turn.
 */

/** The valid relative range presets, re-exported for tool input schemas. */
export {
  RANGE_PRESETS,
  type RangePreset,
} from '@borradh-workspace/features/shared';

function unresolvable(expression: string, timezone: string): ApiFetchError {
  return new ApiFetchError(
    `Couldn't work out the date "${expression}". Today is ${describeToday({
      timezone,
    })}. Give an explicit date (YYYY-MM-DD or full ISO datetime) or a clear phrase like "tomorrow", "in 2 weeks", or "August 7th".`,
    400
  );
}

/**
 * Resolve a date/datetime expression to a UTC instant (ISO string) in the org
 * timezone. `edge` decides how a date-only expression maps to an instant:
 * `'start'` → 00:00, `'end'` → 23:59 (validity windows — "valid until August
 * 7th" means the END of that day). Absolute ISO datetimes pass through.
 *
 * @throws ApiFetchError(400) with a today-quoting message when unresolvable.
 */
export function resolveToolDateTime(
  expression: string,
  timezone: string,
  edge: 'start' | 'end'
): string {
  const iso = resolveDateTime(expression, { timezone, edge });
  if (!iso) throw unresolvable(expression, timezone);
  return iso;
}

/**
 * Resolve a date expression to a single `YYYY-MM-DD` calendar date in the org
 * timezone. Ranges collapse to their start date.
 *
 * @throws ApiFetchError(400) with a today-quoting message when unresolvable.
 */
export function resolveToolDate(expression: string, timezone: string): string {
  const date = resolveDateOnly(expression, { timezone });
  if (!date) throw unresolvable(expression, timezone);
  return date;
}

/**
 * Resolve a relative range preset (`this_week`, `last_7_days`, …) to an
 * inclusive `{ since, until }` calendar-date window in the org timezone.
 * Presets are a closed set, so this never fails.
 */
export function resolveToolRangePreset(
  preset: RangePreset,
  timezone: string
): { since: string; until: string } {
  return resolveRangePreset(preset, { timezone });
}
