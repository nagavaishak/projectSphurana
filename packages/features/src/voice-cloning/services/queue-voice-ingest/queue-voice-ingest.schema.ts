import { z } from 'zod';

export const VOICE_INGEST_QUEUE = 'voice-ingest';

export const queueVoiceIngestSchema = z.object({
  organizationId: z.string().min(1),
  metaAdsPageId: z.string().min(1),
  triggerReason: z.enum(['page_connect', 'scheduled_refresh', 'manual']),
});

export type QueueVoiceIngestInput = z.infer<typeof queueVoiceIngestSchema>;

export interface VoiceIngestJobPayload {
  organizationId: string;
  metaAdsPageId: string;
  triggerReason: 'page_connect' | 'scheduled_refresh' | 'manual';
  queuedAt: string;
}
