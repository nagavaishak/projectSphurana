import { z } from 'zod';

/**
 * Schema for getting a voice script by ID
 */
export const getVoiceScriptSchema = z.object({
  id: z.string().min(1, 'Voice script ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Schema for getting the default voice script for an organization
 */
export const getDefaultVoiceScriptSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetVoiceScriptInput = z.infer<typeof getVoiceScriptSchema>;
export type GetDefaultVoiceScriptInput = z.infer<
  typeof getDefaultVoiceScriptSchema
>;
