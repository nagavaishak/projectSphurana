import { z } from 'zod';

export const syncWhatsappTemplatesSchema = z.object({
  organizationId: z.string().min(1),
  /**
   * Force a refresh from Meta. When false the cached rows are returned as-is
   * unless the cache is empty (first use), in which case a sync runs anyway.
   */
  refresh: z.boolean().default(false),
});

export type SyncWhatsappTemplatesInput = z.input<
  typeof syncWhatsappTemplatesSchema
>;
