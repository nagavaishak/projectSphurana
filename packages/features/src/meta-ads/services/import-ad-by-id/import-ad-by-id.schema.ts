import { z } from 'zod';

export const importAdByIdSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  metaAdId: z.string().min(1, 'Meta ad ID is required'),
});

export type ImportAdByIdInput = z.infer<typeof importAdByIdSchema>;

export interface ImportAdByIdData {
  /** Local `meta_ad.id` for the (possibly just-imported) ad. */
  internalAdId: string;
  /** Meta campaign id the ad belongs to, when Meta returned one. */
  metaCampaignId: string | null;
  /** True when this call created the row, false when it already existed. */
  imported: boolean;
}
