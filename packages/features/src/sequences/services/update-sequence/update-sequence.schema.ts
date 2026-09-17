import { z } from 'zod';

export const updateSequenceSchema = z.object({
  id: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  triggerOnNewLead: z.boolean().optional(),
  scheduleNextDay: z.boolean().optional(),
  nodes: z.array(z.any()).optional(),
  edges: z.array(z.any()).optional(),
  settings: z.record(z.string(), z.any()).optional(),
  setupCompleted: z.boolean().optional(),
});

export type UpdateSequenceInput = z.infer<typeof updateSequenceSchema>;
