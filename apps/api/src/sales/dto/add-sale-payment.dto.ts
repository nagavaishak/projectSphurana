import { addSalePaymentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /sales/:id/payments` body. Validated against the CANONICAL wire
 * contract, which carries the tender refinement (gift-card code required for a
 * gift-card tender; `readerType` only on `card_terminal`) and `.strict()`.
 *
 * `createdById` is NOT in the body: the controller stamps it from the session
 * so a tender cannot be attributed to another operator. The service re-runs the
 * full refined schema, where `amountCents` is additionally branded as `Cents`.
 */
export class AddSalePaymentDto extends createZodDto(
  addSalePaymentRequestSchema
) {}
