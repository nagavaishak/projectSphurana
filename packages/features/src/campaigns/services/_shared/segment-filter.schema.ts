import { segmentFilterRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

/**
 * The persisted audience-filter shape (stored as `segment.filterJson`).
 *
 * DERIVED from the wire contract — see `segmentFilterRequestSchema` in
 * `packages/contracts/src/requests/campaigns.ts`. Re-exported under its original
 * name so create / update / preview keep validating identically.
 */
export const segmentFilterSchema = segmentFilterRequestSchema;

export type SegmentFilterInput = z.infer<typeof segmentFilterSchema>;
