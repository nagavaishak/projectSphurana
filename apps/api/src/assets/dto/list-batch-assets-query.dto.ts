import { listBatchAssetsSchema } from '@borradh-workspace/features/assets';
import { createZodDto } from 'nestjs-zod';

/**
 * Query params for `GET /assets/batch/:batchId`. `batchId` is a route param and
 * `organizationId` comes from the session, so both are omitted.
 */
export class ListBatchAssetsQueryDto extends createZodDto(
  listBatchAssetsSchema.omit({ batchId: true, organizationId: true })
) {}
