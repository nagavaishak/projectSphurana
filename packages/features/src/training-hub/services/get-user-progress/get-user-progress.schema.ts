import { z } from 'zod';

export const getUserProgressSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type GetUserProgressInput = z.infer<typeof getUserProgressSchema>;
