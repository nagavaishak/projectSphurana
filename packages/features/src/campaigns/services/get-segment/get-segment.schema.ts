import { z } from 'zod';

export const getSegmentSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  id: z.string().min(1, 'Segment ID is required'),
});

export type GetSegmentInput = z.infer<typeof getSegmentSchema>;
