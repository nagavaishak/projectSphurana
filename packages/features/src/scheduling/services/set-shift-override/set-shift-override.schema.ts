import { setShiftOverrideRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { intervalsOverlap } from '../set-weekly-shifts/set-weekly-shifts.schema.js';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`.
 */
export const setShiftOverrideBaseSchema = setShiftOverrideRequestBase.extend({
  organizationId: z.string().min(1),
  /** Route param on `PUT /shifts/override/:practitionerId`. */
  practitionerId: z.string().min(1),
});

export const setShiftOverrideSchema = setShiftOverrideBaseSchema
  .refine((d) => !d.isOff || d.intervals.length === 0, {
    message: 'intervals must be empty when isOff is true',
    path: ['intervals'],
  })
  .refine((d) => d.isOff || d.intervals.length > 0, {
    message: 'at least one interval is required when isOff is false',
    path: ['intervals'],
  })
  .refine((d) => !intervalsOverlap(d.intervals), {
    message: 'intervals must not overlap',
    path: ['intervals'],
  });

export type SetShiftOverrideInput = z.infer<typeof setShiftOverrideSchema>;
