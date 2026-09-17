import { createDepositRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for opening a deposit checkout.
 *
 * DERIVED from the canonical wire contract `createDepositRequestBase`
 * (packages/contracts/src/requests/deposits.ts) — this schema IS the wire body
 * plus the server-injected `organizationId`, so it can never be laxer than what
 * the API accepts, and the two cannot drift. MONEY: `amountCents` (integer
 * minor units) and `currency` (`.default('usd')`) are defined in the contract;
 * change them THERE so wire and server move together.
 */
export const createDepositRequestSchema = createDepositRequestBase.extend({
  /** From the active-org session, never sent by the client. */
  organizationId: z.string().min(1),
});

export type CreateDepositRequestInput = z.infer<
  typeof createDepositRequestSchema
>;
