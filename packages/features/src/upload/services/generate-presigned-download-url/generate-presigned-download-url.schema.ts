import { z } from 'zod';

export const generatePresignedDownloadUrlSchema = z.object({
  key: z
    .string()
    .min(1, 'Key is required')
    .refine(
      (val) =>
        !val.split('/').some((segment) => segment === '..' || segment === '.'),
      { message: 'Key must not contain path traversal sequences' }
    ),
  bucket: z.string().optional(),
  expiresIn: z.number().min(60).max(86400).optional(),
  userId: z.string().min(1),
  organizationId: z.string().optional(),
});

export type GeneratePresignedDownloadUrlInput = z.infer<
  typeof generatePresignedDownloadUrlSchema
>;
