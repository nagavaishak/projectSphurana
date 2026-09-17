import { parse } from 'date-fns';

import { zonedWallTimeToUtc } from '@/lib/timezone';
import type { TimeOffType } from '@borradh-workspace/api-client/types';
import type { CreateTimeOffInput } from '@borradh-workspace/api-client/types';
import { createTimeOffRequestSchema } from '@borradh-workspace/contracts';

import { buildRRule } from '../../lib/rrule';

/**
 * PAYLOAD BUILDER — create time off (POST /time-off).
 *
 * The dialog passes typed INTENT (form values + the business timezone); this is
 * the ONLY place the wire body is assembled. Wall-clock start/end/until times
 * resolve in `timeZone` (organization.timezone) — never the device's — so the
 * stored instant doesn't shift with the viewer's device zone.
 */

/** The form values the time-off dialog naturally holds. */
export interface TimeOffFormValues {
  practitionerId: string;
  type: TimeOffType;
  /** yyyy-MM-dd, wall-clock in the business timezone. */
  startDate: string;
  /** HH:mm, wall-clock in the business timezone. */
  startTime: string;
  endDate: string;
  endTime: string;
  repeats: boolean;
  repeatUntil?: string;
  description?: string;
  approved: boolean;
}

/** Intent accepted by `useCreateTimeOff().mutate`. */
export interface CreateTimeOffFormInput extends TimeOffFormValues {
  /** organization.timezone — wall-clock times resolve in THIS zone. */
  timeZone: string;
}

/** Wall-clock (business timezone) date + time → real UTC instant. */
function toInstant(date: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(':').map(Number);
  const day = parse(date, 'yyyy-MM-dd', new Date());
  return zonedWallTimeToUtc(day, h || 0, m || 0, timeZone);
}

/**
 * The recurrence + instants + trims shared by create AND update time off. Both
 * operations derive an identical `shared` body from the same form values, so
 * they cannot drift.
 */
export interface TimeOffSharedBody {
  type: TimeOffType;
  startDate: Date;
  endDate: Date;
  allDay: false;
  timezone: string;
  rrule: string | null;
  recurrenceEndDate: Date | null;
  description: string | null;
  approved: boolean;
}

export function buildTimeOffSharedBody(
  input: TimeOffFormValues & { timeZone: string }
): TimeOffSharedBody {
  const { timeZone } = input;
  const startDate = toInstant(input.startDate, input.startTime, timeZone);
  const endDate = toInstant(input.endDate, input.endTime, timeZone);
  const until =
    input.repeats && input.repeatUntil
      ? toInstant(input.repeatUntil, '23:59', timeZone)
      : null;
  const rrule = input.repeats
    ? buildRRule({
        freq: 'WEEKLY',
        interval: 1,
        byWeekdays: [],
        until,
        count: null,
      })
    : null;

  return {
    type: input.type,
    startDate,
    endDate,
    allDay: false,
    timezone: timeZone,
    rrule,
    recurrenceEndDate: until,
    description: input.description?.trim() || null,
    approved: input.approved,
  };
}

/**
 * `.strict()` wire body — an extra/unknown field is a parse error.
 *
 * This is now an ALIAS of the canonical request contract
 * (`packages/contracts/src/requests/scheduling.ts`), which the backend feature
 * schema also derives from. Its date fields are `z.coerce.date()`, so the
 * `Date` instants this builder produces pass through unchanged (the api-client
 * JSON-serializes them to ISO strings, which the same schema accepts on the
 * server).
 */
export const createTimeOffBodySchema = createTimeOffRequestSchema;

/** THE ONLY place a create-time-off API payload is constructed. */
export function buildCreateTimeOffPayload(
  input: CreateTimeOffFormInput
): CreateTimeOffInput {
  return createTimeOffBodySchema.parse({
    practitionerId: input.practitionerId,
    ...buildTimeOffSharedBody(input),
  }) as CreateTimeOffInput;
}
