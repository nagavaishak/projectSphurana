import { z } from 'zod';

export const getEffectiveOpeningHoursBaseSchema = z.object({
  organizationId: z.string().min(1),
  locationId: z.string().min(1),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
});

export const getEffectiveOpeningHoursSchema =
  getEffectiveOpeningHoursBaseSchema.refine(
    (d) => d.windowEnd >= d.windowStart,
    {
      message: 'windowEnd must be >= windowStart',
      path: ['windowEnd'],
    }
  );

export type GetEffectiveOpeningHoursInput = z.infer<
  typeof getEffectiveOpeningHoursSchema
>;
