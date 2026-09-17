import { regenerateBatchItemSchema } from '@borradh-workspace/features/content-batches';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /content-batches/items/:id/regenerate.
 * `itemId`, `organizationId`, `createdById` are filled from path + session
 * by the controller — only `reason` arrives from the client.
 */
export class RegenerateBatchItemDto extends createZodDto(
  regenerateBatchItemSchema.omit({
    itemId: true,
    organizationId: true,
    createdById: true,
  })
) {}
