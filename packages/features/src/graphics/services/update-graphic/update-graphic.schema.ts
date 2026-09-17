import { z } from 'zod';

/**
 * Input for `updateGraphic` — mutates simple metadata on a graphic row
 * (title, status, canvas dimensions). Editor scene saves go through
 * `updateGraphicScene` instead, which writes to `graphic.fabricScene`.
 */
export const updateGraphicSchema = z.object({
  id: z.string().min(1, 'Graphic ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  title: z.string().min(1).optional(),
  aspectRatio: z
    .enum(['1:1', '9:16', '16:9', '4:5', '4:3', '1.91:1'])
    .optional(),
  canvasWidth: z.number().int().min(100).max(4096).optional(),
  canvasHeight: z.number().int().min(100).max(4096).optional(),
  status: z.enum(['draft', 'rendering', 'ready', 'failed']).optional(),
});

export type UpdateGraphicInput = z.infer<typeof updateGraphicSchema>;
