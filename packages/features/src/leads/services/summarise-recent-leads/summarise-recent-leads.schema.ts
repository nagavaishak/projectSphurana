import { z } from 'zod';

export const summariseRecentLeadsTimeframeValues = [
  'today',
  'week',
  'month',
] as const;

export type SummariseRecentLeadsTimeframe =
  (typeof summariseRecentLeadsTimeframeValues)[number];

export const summariseRecentLeadsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  timeframe: z.enum(summariseRecentLeadsTimeframeValues).default('week'),
  limit: z.coerce.number().int().positive().max(20).default(5),
});

export type SummariseRecentLeadsInput = z.infer<
  typeof summariseRecentLeadsSchema
>;
