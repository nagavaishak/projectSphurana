import { refundDepositRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for refunding a paid deposit.
 *
 * DERIVED from the canonical wire contract `refundDepositRequestBase`
 * (packages/contracts/src/requests/deposits.ts). The wire body carries only
 * `reason`; the deposit is identified by the `:id` route param and the org by
 * the session, both added here. MONEY: this is always a FULL refund — there is
 * no amount field, by design.
 */
export const refundDepositSchema = refundDepositRequestBase.extend({
  /** Route param `:id` on `POST /deposits/:id/refund`. */
  depositId: z.string().min(1),
  /** From the active-org session, never sent by the client. */
  organizationId: z.string().min(1),
});

export type RefundDepositInput = z.infer<typeof refundDepositSchema>;
