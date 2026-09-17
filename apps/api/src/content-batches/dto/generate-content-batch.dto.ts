import { generateMonthlyBatchSchema } from '@borradh-workspace/features/content-batches';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /content-batches/generate.
 *
 * `organizationId` is taken from the active-organization session, and
 * `createdById` is taken from the authenticated user — neither is accepted
 * from the client. Everything else (the optional `periodMonth` override
 * and the `graphicCount` / `videoCount` knobs) comes from the request body.
 *
 * When body fields are omitted the underlying feature schema applies its
 * defaults (6 graphics, 6 videos, current UTC month).
 */
export class GenerateContentBatchDto extends createZodDto(
  generateMonthlyBatchSchema.omit({
    organizationId: true,
    createdById: true,
  })
) {}
