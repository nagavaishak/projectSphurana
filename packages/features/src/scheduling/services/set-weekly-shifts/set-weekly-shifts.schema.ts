import {
  intervalsOverlap,
  setWeeklyShiftsRequestBase,
  shiftIntervalRequestSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`.
 *
 * The interval schema and the overlap predicate are body INVARIANTS, so they
 * live in the contract and are re-exported here under their historic names for
 * the services and tests that already import them.
 */
export const shiftIntervalSchema = shiftIntervalRequestSchema;

export type ShiftInterval = z.infer<typeof shiftIntervalSchema>;

export { intervalsOverlap };

export const setWeeklyShiftsSchema = setWeeklyShiftsRequestBase.extend({
  organizationId: z.string().min(1),
  /** Route param on `PUT /shifts/weekly/:practitionerId`. */
  practitionerId: z.string().min(1),
});

export type SetWeeklyShiftsInput = z.infer<typeof setWeeklyShiftsSchema>;
