import { z } from 'zod';

/** Strip accidental JSON-style quotes from deep-linked campaign IDs. */
export function normalizeAdCampaignId(
  raw: string | undefined
): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^["']+|["']+$/g, '');
}

export const newAdSearchSchema = z.object({
  campaignId: z.preprocess(
    (val) => normalizeAdCampaignId(typeof val === 'string' ? val : undefined),
    z.string().optional()
  ),
  videoId: z.string().optional(),
});

export type NewAdSearch = z.infer<typeof newAdSearchSchema>;

export const adNewVideoFormatSearchSchema = z.object({
  campaignId: z.preprocess(
    (val) => normalizeAdCampaignId(typeof val === 'string' ? val : undefined),
    z.string().min(1, 'Campaign is required')
  ),
});

export type AdNewVideoFormatSearch = z.infer<
  typeof adNewVideoFormatSearchSchema
>;

export const createVideoSearchSchema = z
  .object({
    source: z.enum(['ads']).optional(),
    campaignId: z.string().optional(),
    allowStockFootage: z
      .preprocess((val) => val === true || val === 'true', z.boolean())
      .optional(),
  })
  .transform((data) => ({
    source: data.source,
    campaignId: normalizeAdCampaignId(data.campaignId),
    allowStockFootage: data.allowStockFootage,
  }));

export type CreateVideoSearch = z.infer<typeof createVideoSearchSchema>;
