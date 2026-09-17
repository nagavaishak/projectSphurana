import { z } from 'zod';

export const deleteSegmentSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  id: z.string().min(1, 'Segment ID is required'),
});

export type DeleteSegmentInput = z.infer<typeof deleteSegmentSchema>;
