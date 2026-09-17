import { acceptBatchItemRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /content-batches/items/:itemId/accept.
 * `itemId`, `organizationId`, `createdById` are filled from path + session by
 * the controller — only the optional caption / scheduledAt / targetPageIds
 * overrides arrive from the client.
 */
export class AcceptBatchItemDto extends createZodDto(
  acceptBatchItemRequestSchema
) {}
