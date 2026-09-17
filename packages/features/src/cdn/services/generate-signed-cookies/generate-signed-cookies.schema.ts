import { z } from 'zod';

export const generateSignedCookiesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GenerateSignedCookiesInput = z.infer<
  typeof generateSignedCookiesSchema
>;
