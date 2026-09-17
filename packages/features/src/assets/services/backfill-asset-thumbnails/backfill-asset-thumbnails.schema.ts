import { z } from 'zod';

export const ASSET_THUMBNAIL_QUEUE = 'asset-thumbnail';

export const assetThumbnailJobPayloadSchema = z.object({
  assetId: z.string().min(1),
  organizationId: z.string().min(1),
  blobUrl: z.string().min(1),
});

export type AssetThumbnailJobPayload = z.infer<
  typeof assetThumbnailJobPayloadSchema
>;

export const backfillAssetThumbnailsSchema = z.object({
  organizationId: z.string().min(1).optional(),
});

export type BackfillAssetThumbnailsInput = z.infer<
  typeof backfillAssetThumbnailsSchema
>;
