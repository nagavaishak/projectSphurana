import { campaignChannelRequestZ } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { segmentFilterSchema } from '../_shared/segment-filter.schema.js';

/**
 * Drive the composer's mail-merge preview: fetch the first N eligible leads for
 * a segment + channel so the preview can page through REAL recipients (their
 * first name and merge fields), not a single fixed sample.
 *
 * `filterJson` reuses the persisted segment-filter shape; `channel` narrows
 * eligibility to the surface being previewed.
 */
export const listSampleRecipientsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  filterJson: segmentFilterSchema,
  channel: campaignChannelRequestZ,
  limit: z.number().int().min(1).max(50).default(12),
});

export type ListSampleRecipientsInput = z.infer<
  typeof listSampleRecipientsSchema
>;
