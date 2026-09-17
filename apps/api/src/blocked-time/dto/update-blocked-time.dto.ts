import { updateBlockedTimeRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for PUT /blocked-time/:id. `scope` travels as a query param; id,
 * organizationId and createdById come from route/session context — none of
 * them are in the canonical wire schema.
 */
export class UpdateBlockedTimeDto extends createZodDto(
  updateBlockedTimeRequestSchema
) {}
