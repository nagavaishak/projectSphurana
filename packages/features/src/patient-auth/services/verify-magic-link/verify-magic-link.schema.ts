import { z } from 'zod';

export const verifyMagicLinkSchema = z.object({
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  token: z.string().min(1, 'Token is required'),
});

export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;
