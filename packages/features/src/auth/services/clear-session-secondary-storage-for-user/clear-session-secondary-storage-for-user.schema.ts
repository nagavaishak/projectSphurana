import { z } from 'zod';

export const clearSessionSecondaryStorageForUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type ClearSessionSecondaryStorageForUserInput = z.infer<
  typeof clearSessionSecondaryStorageForUserSchema
>;
