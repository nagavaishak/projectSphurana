import { updateLeadRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for updating a lead.
 *
 * DERIVED from the canonical wire contract `updateLeadRequestBase`
 * (packages/contracts/src/requests/leads.ts) — this schema IS the wire body
 * plus the server-injected context, so it can never be laxer than what the API
 * accepts, and the two cannot drift. Add or change a client-supplied field in
 * the CONTRACT, not here; only server-injected fields belong in the `.extend()`.
 */
export const updateLeadSchema = updateLeadRequestBase.extend({
  /** Route param `:id`. */
  id: z.string().min(1, 'Lead ID is required'),
  /** From the active-org session, never sent by the client. */
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
