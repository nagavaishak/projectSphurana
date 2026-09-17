import { assetContentTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { csvList } from '../../../shared/csv-list.js';

export const listBatchAssetsSchema = z.object({
  batchId: z.string().min(1, 'Batch ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  contentType: z.enum(assetContentTypeValues).optional(),
  contentTypeIn: csvList(z.enum(assetContentTypeValues)).optional(),
  contentTypeNotIn: csvList(z.enum(assetContentTypeValues)).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export type ListBatchAssetsInput = z.infer<typeof listBatchAssetsSchema>;
