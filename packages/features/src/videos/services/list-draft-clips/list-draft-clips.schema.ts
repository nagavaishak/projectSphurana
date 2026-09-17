import { z } from 'zod';

/**
 * Input for `listDraftClips` — fetch the chat-native tray for a video draft.
 * Cross-org isolation: service joins through the parent video and filters
 * `video.organizationId`, so a foreign org's videoId returns NOT_FOUND.
 */
export const listDraftClipsSchema = z.object({
  videoId: z.string().uuid(),
  organizationId: z.string().min(1),
});

export type ListDraftClipsInput = z.infer<typeof listDraftClipsSchema>;
