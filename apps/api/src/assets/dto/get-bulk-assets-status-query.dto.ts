import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Query params for `GET /assets/bulk-status`.
 *
 * The feature schema carries a `.refine()` (batchId OR assetIds), which makes
 * it a `ZodEffects` that cannot be `.omit()`ed, so the query shape is declared
 * here and the feature schema still validates the assembled input in the
 * service. `organizationId` comes from the session either way.
 *
 * `assetIds` arrives comma-separated so a caller can ask about a whole upload
 * in one request. Express also hands back an array when the param repeats, so
 * both forms are normalised here.
 */
const MAX_ASSET_IDS = 100;

const getBulkAssetsStatusQuerySchema = z
  .object({
    batchId: z.string().min(1).optional(),
    assetIds: z
      .preprocess(
        (value) => {
          if (value === undefined || value === '') return undefined;
          const raw = Array.isArray(value) ? value : [value];
          const ids = raw
            .flatMap((entry) => String(entry).split(','))
            .map((id) => id.trim())
            .filter(Boolean);
          return ids.length > 0 ? ids : undefined;
        },
        z.array(z.string().min(1)).max(MAX_ASSET_IDS)
      )
      .optional(),
  })
  .refine((data) => data.batchId || data.assetIds, {
    message: 'Either batchId or assetIds must be provided',
  });

export class GetBulkAssetsStatusQueryDto extends createZodDto(
  getBulkAssetsStatusQuerySchema
) {}
