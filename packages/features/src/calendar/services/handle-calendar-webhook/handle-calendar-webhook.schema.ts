import { z } from 'zod';

export const handleCalendarWebhookSchema = z.object({
  channelId: z.string().min(1),
  resourceState: z.string().min(1),
  resourceId: z.string().min(1),
  channelToken: z.string().optional(),
});

export type HandleCalendarWebhookInput = z.infer<
  typeof handleCalendarWebhookSchema
>;
