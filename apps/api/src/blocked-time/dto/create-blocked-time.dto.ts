import { createBlockedTimeRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /blocked-time. The canonical wire schema — `organizationId`
 * and `createdById` are injected by the controller and are not in it.
 */
export class CreateBlockedTimeDto extends createZodDto(
  createBlockedTimeRequestSchema
) {}
