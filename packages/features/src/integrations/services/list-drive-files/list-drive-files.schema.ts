import { z } from 'zod';

export const listDriveFilesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  accountId: z.string().min(1, 'Account ID is required'),
  folderId: z.string().optional().default('root'),
  pageSize: z.coerce.number().min(1).max(100).optional().default(50),
  pageToken: z.string().optional(),
  query: z.string().optional(),
  videoOnly: z.boolean().optional().default(true),
});

export type ListDriveFilesInput = z.infer<typeof listDriveFilesSchema>;
