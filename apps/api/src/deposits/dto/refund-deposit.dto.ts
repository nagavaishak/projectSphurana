import { refundDepositRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /deposits/:id/refund` body. Validated against the CANONICAL wire
 * contract rather than the hand-declared copy of the Stripe reason enum that
 * used to live here — the features-package `refundDepositSchema` is that same
 * contract plus `depositId` and `organizationId`, which the controller injects
 * from the route param and the active-org session.
 */
export class RefundDepositDto extends createZodDto(
  refundDepositRequestSchema
) {}
