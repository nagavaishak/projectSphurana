import { createSaleRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /sales` body. Validated against the CANONICAL wire contract, not
 * `createSaleSchema.omit({…})` — the feature schema IS that contract plus the
 * server-injected `organizationId` / `createdById`, so omitting them back out
 * was a round-trip that also lost `.strict()`.
 */
export class CreateSaleDto extends createZodDto(createSaleRequestSchema) {}
