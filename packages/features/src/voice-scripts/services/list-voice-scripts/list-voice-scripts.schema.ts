import { z } from 'zod';

/**
 * Schema for listing voice scripts
 */
export const listVoiceScriptsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export type ListVoiceScriptsInput = z.infer<typeof listVoiceScriptsSchema>;
