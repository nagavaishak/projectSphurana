import { timeEntryStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const listTimeEntriesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  practitionerId: z.string().optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header.
   *
   * `time_entry` has NO `location_id` of its own — a shift is worked by a
   * PERSON and the clock-in row hangs off the practitioner. So the branch is
   * resolved through `practitioner_location`: this branch's timesheet is the
   * timesheet of the people who work here, with the usual "zero join rows =
   * works everywhere" default.
   */
  locationId: z.string().min(1).optional(),
  status: z.enum(timeEntryStatusValues).optional(),
});

export type ListTimeEntriesInput = z.input<typeof listTimeEntriesSchema>;
