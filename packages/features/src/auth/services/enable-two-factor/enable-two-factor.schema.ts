import { z } from 'zod';

export const enableTwoFactorSchema = z.object({
  password: z.string(),
});

export type EnableTwoFactorInput = z.infer<typeof enableTwoFactorSchema>;
