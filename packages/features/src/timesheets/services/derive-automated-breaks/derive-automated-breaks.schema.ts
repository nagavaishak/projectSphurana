import { z } from 'zod';

/**
 * Input for the pure automated-break derivation (contract §1.5): the unpaid
 * blocked_time occurrences overlapping a closed entry window become
 * `source='auto'` break rows.
 *
 * `occurrences` are expanded blocked_time occurrences (recurrence already
 * applied by the caller — the expansion code path lives with the scheduling
 * domain).
 */
export const deriveAutomatedBreaksSchema = z
  .object({
    clockIn: z.coerce.date(),
    clockOut: z.coerce.date(),
    occurrences: z.array(
      z.object({
        start: z.coerce.date(),
        end: z.coerce.date(),
        paid: z.boolean(),
      })
    ),
  })
  .refine((v) => v.clockOut.getTime() > v.clockIn.getTime(), {
    message: 'clockOut must be after clockIn',
  });

export type DeriveAutomatedBreaksInput = z.input<
  typeof deriveAutomatedBreaksSchema
>;
