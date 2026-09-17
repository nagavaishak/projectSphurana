import { z } from 'zod';
import { segmentFilterSchema } from '../_shared/segment-filter.schema.js';

export const materializeRecipientsSchema = z
  .object({
    organizationId: z.string().min(1, 'Organization ID is required'),
    campaignId: z.string().min(1, 'Campaign ID is required'),
    channels: z.array(z.enum(['email', 'sms', 'whatsapp'])).min(1),
    // Provide exactly one audience source: a saved segment or an inline filter.
    segmentId: z.string().optional(),
    filterJson: segmentFilterSchema.optional(),
  })
  .refine((d) => Boolean(d.segmentId) !== Boolean(d.filterJson), {
    message: 'Provide exactly one of segmentId or filterJson',
  });

export type MaterializeRecipientsInput = z.infer<
  typeof materializeRecipientsSchema
>;
