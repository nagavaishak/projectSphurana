import { recordStockTakeCountsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /stock-takes/:id/items` body. Validated against the CANONICAL wire
 * contract; `stockTakeId` comes from the route param and `organizationId` from
 * the active-org session.
 */
export class RecordStockTakeCountsDto extends createZodDto(
  recordStockTakeCountsRequestSchema
) {}
