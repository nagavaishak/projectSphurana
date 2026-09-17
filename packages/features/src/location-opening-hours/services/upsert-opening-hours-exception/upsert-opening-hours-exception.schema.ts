import { z } from 'zod';

export const upsertOpeningHoursExceptionBaseSchema = z.object({
  organizationId: z.string().min(1),
  locationId: z.string().min(1),
  /** YYYY-MM-DD (location-local date). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  closed: z.boolean(),
  /** Minutes from midnight. Required when closed=false. */
  fromMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  toMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  createdById: z.string().min(1),
});

export const upsertOpeningHoursExceptionSchema =
  upsertOpeningHoursExceptionBaseSchema.refine(
    (d) =>
      d.closed ||
      (typeof d.fromMinutes === 'number' &&
        typeof d.toMinutes === 'number' &&
        d.toMinutes > d.fromMinutes),
    {
      message:
        'When closed=false, fromMinutes and toMinutes are required (and toMinutes > fromMinutes)',
      path: ['toMinutes'],
    }
  );

export type UpsertOpeningHoursExceptionInput = z.infer<
  typeof upsertOpeningHoursExceptionSchema
>;
