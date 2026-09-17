import { setSaleTipRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /sales/:id/tip` body. Validated against the CANONICAL wire contract,
 * which carries the tipType/tipPercent/tipAmountCents refinement. The service
 * re-runs the full refined schema.
 */
export class SetSaleTipDto extends createZodDto(setSaleTipRequestSchema) {}
