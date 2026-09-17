import { placeholderTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { csvList } from '../../../shared/csv-list.js';
import { assetSourceValues } from '../../../shared/index.js';

/**
 * List Assets Input Schema
 */
export const listAssetsInputSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  type: z.enum(['video', 'image']).optional(),
  source: z.enum(assetSourceValues).optional(),
  tags: csvList(z.string()).optional(),
  // Free-text search over the asset display name and the original uploaded
  // filename. Backs Claire's asset-reference resolution — "use my Endosphere
  // photo" resolves to a real asset id via this instead of the model guessing
  // one (Phase 7, #37). Case-insensitive substring match on either column.
  search: z.string().trim().min(1).optional(),
  // Filter by placeholder type (finds assets that have this type in their placeholderTypes array)
  placeholderType: z.enum(placeholderTypeValues).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export type ListAssetsInput = z.infer<typeof listAssetsInputSchema>;
