import { z } from 'zod';

export const settleBatchStatusSchema = z.object({
  batchId: z.string().min(1),
});

export type SettleBatchStatusInput = z.infer<typeof settleBatchStatusSchema>;

/**
 * Either id identifies the asset whose render just reached a terminal state.
 * Exactly one is required — the caller knows which kind it rendered.
 */
export const settleBatchForAssetSchema = z
  .object({
    graphicId: z.string().min(1).optional(),
    videoId: z.string().min(1).optional(),
  })
  .refine((v) => !!v.graphicId !== !!v.videoId, {
    message: 'Pass exactly one of graphicId or videoId',
  });

export type SettleBatchForAssetInput = z.infer<
  typeof settleBatchForAssetSchema
>;
