import { addSaleItemRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /sales/:id/items` body. Validated against the CANONICAL wire contract,
 * which carries the cross-field refinement (gift-card-only fields, exactly one
 * polymorphic FK) — the previous `.omit()` off the feature schema dropped both
 * the refinement and `.strict()`, leaving the DTO a permissive object and the
 * service the only real check. The service still re-runs the full schema.
 */
export class AddSaleItemDto extends createZodDto(addSaleItemRequestSchema) {}
