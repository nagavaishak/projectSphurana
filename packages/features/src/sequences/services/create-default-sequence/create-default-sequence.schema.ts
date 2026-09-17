import { z } from 'zod';

export const createDefaultSequenceSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().min(1, 'Created by user ID is required'),
});

export type CreateDefaultSequenceInput = z.infer<
  typeof createDefaultSequenceSchema
>;
