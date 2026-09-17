import type { WorkingHours } from '@borradh-workspace/database';
import {
  isUniqueViolation,
  userColorValues,
} from '@borradh-workspace/database';
import { z } from 'zod';

/**
 * Field-level building blocks shared by the resource + category schemas, so
 * create and update can never drift on what a valid capacity or spec record is.
 */

/** Categories and resources share one display-name bound. */
export const resourceNameSchema = z.string().min(1, 'Name is required').max(80);

export const resourceDescriptionSchema = z.string().max(500);

/** Same palette as practitioners — the rooms calendar renders them side by side. */
export const resourceColorSchema = z.enum(userColorValues);

/** How many appointments may occupy one resource at once (Zenoti-style). */
export const resourceCapacitySchema = z.number().int().min(1).max(20);

export const sortOrderSchema = z.number().int().min(0);

const MAX_SPEC_ENTRIES = 20;
const MAX_SPEC_FIELD_LENGTH = 60;

/** Clinic-defined, display-only key/values ("Device": "Lumenis M22"). */
export const resourceSpecsSchema = z
  .record(
    z.string().min(1).max(MAX_SPEC_FIELD_LENGTH),
    z.string().max(MAX_SPEC_FIELD_LENGTH)
  )
  .refine((specs) => Object.keys(specs).length <= MAX_SPEC_ENTRIES, {
    message: `At most ${MAX_SPEC_ENTRIES} specs are allowed`,
  });

const workingHoursDaySchema = z
  .object({
    from: z.number().int().min(0).max(1440),
    to: z.number().int().min(0).max(1440),
  })
  .refine((day) => day.from < day.to, {
    message: 'Working hours must start before they end',
  });

/**
 * Day-of-week ('0' = Sunday … '6' = Saturday) → minutes-from-midnight range.
 * JSON object keys are always strings; the cast re-labels the inferred record
 * as the jsonb shape the column stores, exactly as the practitioner schemas do.
 *
 * Null/absent means "always available" — deliberately unlike Boulevard, where
 * forgetting to give a room a schedule silently makes every slot unbookable.
 */
export const resourceWorkingHoursSchema = z.record(
  z.string().regex(/^[0-6]$/, 'Day must be 0-6'),
  workingHoursDaySchema
) as unknown as z.ZodType<WorkingHours>;

/**
 * Per-service cleanup buffer the resource stays held for after the appointment
 * ends. Null clears it; 0..240 in 5-minute steps mirrors every other duration
 * field in the product.
 */
export const turnaroundMinutesSchema = z
  .number()
  .int()
  .min(0)
  .max(240)
  .refine((minutes) => minutes % 5 === 0, {
    message: 'Turnaround must be a multiple of 5 minutes',
  });

/** The partial unique index behind "a category name is unique per org". */
export const RESOURCE_CATEGORY_NAME_CONSTRAINT =
  'resource_category_org_name_unique';

/**
 * A check-then-insert is never atomic, so a concurrent request can always win
 * the race and leave us holding the unique violation. Map it to the same domain
 * outcome the pre-check would have produced.
 */
export function isCategoryNameConflict(error: unknown): boolean {
  if (isUniqueViolation(error, RESOURCE_CATEGORY_NAME_CONSTRAINT)) return true;
  const message = error instanceof Error ? error.message : '';
  return message.includes(RESOURCE_CATEGORY_NAME_CONSTRAINT);
}

/** "3 resources" / "1 resource" — CONFLICT messages name the count. */
export function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}
