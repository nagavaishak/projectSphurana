import { z } from 'zod';

const MAX_RANGE_DAYS = 370;

export const listShiftsBaseSchema = z.object({
  organizationId: z.string().min(1),
  from: z.coerce.date(),
  to: z.coerce.date(),
  locationId: z.string().min(1).optional(),
  practitionerId: z.string().min(1).optional(),
});

export const listShiftsSchema = listShiftsBaseSchema
  .refine((d) => d.to >= d.from, {
    message: 'to must be on or after from',
    path: ['to'],
  })
  .refine(
    (d) =>
      (d.to.getTime() - d.from.getTime()) / (24 * 60 * 60 * 1000) <=
      MAX_RANGE_DAYS,
    { message: `range must be at most ${MAX_RANGE_DAYS} days`, path: ['to'] }
  );

export type ListShiftsInput = z.infer<typeof listShiftsSchema>;
