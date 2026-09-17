import { stageItemClipEditsSchema } from '@borradh-workspace/features/content-batches';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /content-batches/items/:itemId/stage-clips — the whole clip
 * list, in render order, as the clip list editor arranged it.
 */
export class StageItemClipsDto extends createZodDto(
  stageItemClipEditsSchema.omit({
    itemId: true,
    organizationId: true,
  })
) {}
