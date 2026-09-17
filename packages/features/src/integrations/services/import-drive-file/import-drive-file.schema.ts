import { z } from 'zod';

export const importDriveFileSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  accountId: z.string().min(1, 'Account ID is required'),
  fileId: z.string().min(1, 'File ID is required'),
  // Optional asset metadata
  name: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

export type ImportDriveFileInput = z.infer<typeof importDriveFileSchema>;
