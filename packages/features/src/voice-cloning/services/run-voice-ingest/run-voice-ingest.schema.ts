import { z } from 'zod';

export const runVoiceIngestSchema = z.object({
  organizationId: z.string().min(1),
  metaAdsPageId: z.string().min(1),
  triggerReason: z.enum(['page_connect', 'scheduled_refresh', 'manual']),
});

export type RunVoiceIngestInput = z.infer<typeof runVoiceIngestSchema>;
