import { updateBatchItemCaptionSchema } from '@borradh-workspace/features/content-batches';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for PATCH /content-batches/items/:itemId/caption — a direct caption
 * write (hand-edit or revert-to-version).
 */
export class UpdateBatchItemCaptionDto extends createZodDto(
  updateBatchItemCaptionSchema.omit({
    itemId: true,
    organizationId: true,
  })
) {}
