import { refundPaymentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /payments/:id/refund` body. Validated against the CANONICAL wire
 * contract: only `reason` is client-supplied — there is no amount, the refund
 * is always in full and the payment comes from the route param.
 */
export class RefundPaymentDto extends createZodDto(
  refundPaymentRequestSchema
) {}
