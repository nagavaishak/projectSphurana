import { z } from 'zod';

export const togglePageChatbotSchema = z.object({
  organizationId: z.string().min(1),
  pageId: z.string().min(1),
  enabled: z.boolean(),
});

export type TogglePageChatbotInput = z.infer<typeof togglePageChatbotSchema>;
