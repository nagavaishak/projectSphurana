import { z } from 'zod';

export const ASSET_PROBE_QUEUE = 'asset-probe';

export const assetProbeJobPayloadSchema = z.object({
  assetId: z.string().min(1),
  organizationId: z.string().min(1),
  blobUrl: z.string().min(1),
});

export type AssetProbeJobPayload = z.infer<typeof assetProbeJobPayloadSchema>;

export const backfillAssetProbesSchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export type BackfillAssetProbesInput = z.infer<
  typeof backfillAssetProbesSchema
>;

export const reprobeAssetSchema = z.object({
  assetId: z.string().min(1),
  organizationId: z.string().min(1).optional(),
});

export type ReprobeAssetInput = z.infer<typeof reprobeAssetSchema>;
