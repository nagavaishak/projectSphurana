import { leadSourceValues, leadStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Schema for exporting leads
 */
export const exportLeadsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  status: z.enum(leadStatusValues).optional(),
  source: z.enum(leadSourceValues).optional(),
  search: z.string().optional(),
});

export type ExportLeadsInput = z.infer<typeof exportLeadsSchema>;
