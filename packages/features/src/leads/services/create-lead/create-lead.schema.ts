import { createLeadRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a new lead.
 *
 * DERIVED from the canonical wire contract (`createLeadRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it. The server schema is therefore the wire schema PLUS fields —
 * it can never be laxer than what the client is told to send, so the two cannot
 * drift. Field rules (`.min(1)`, `.email()`, `.default(…)`) live in the
 * contract; do not restate them here.
 */
export const createLeadSchema = createLeadRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * "Home branch" — the branch this customer was first captured at.
   * Server-injected from the validated `X-Location-Id` header. It is a
   * FILTERING convenience, never ownership: `listLeads` also matches on where
   * the person actually has appointments.
   */
  primaryLocationId: z.string().min(1).optional(),
});

/**
 * Input type inferred from schema
 */
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
