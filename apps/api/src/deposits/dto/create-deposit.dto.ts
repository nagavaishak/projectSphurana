import { createDepositRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /deposits` body. Validated against the CANONICAL wire contract, not
 * `createDepositRequestSchema.omit({ organizationId: true })` from the features
 * package — the feature schema IS that contract plus `organizationId`, so
 * omitting it back out was a round-trip that also lost `.strict()`. The
 * controller injects `organizationId` from the active-org session.
 */
export class CreateDepositDto extends createZodDto(
  createDepositRequestSchema
) {}
