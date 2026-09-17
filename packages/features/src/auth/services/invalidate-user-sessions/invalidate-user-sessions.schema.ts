import { z } from 'zod';

export const invalidateUserSessionsSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type InvalidateUserSessionsInput = z.infer<
  typeof invalidateUserSessionsSchema
>;
