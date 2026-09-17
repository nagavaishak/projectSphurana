import { z } from 'zod';

export const handleUnsubscribeSchema = z.object({
  token: z.string().min(1, 'token is required'),
});

export type HandleUnsubscribeInput = z.infer<typeof handleUnsubscribeSchema>;
