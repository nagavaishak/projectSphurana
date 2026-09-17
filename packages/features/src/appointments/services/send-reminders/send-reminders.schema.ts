import { z } from 'zod';

export const sendRemindersSchema = z.object({
  batchSize: z.number().int().min(1).max(100).default(50),
});

export type SendRemindersInput = z.input<typeof sendRemindersSchema>;
