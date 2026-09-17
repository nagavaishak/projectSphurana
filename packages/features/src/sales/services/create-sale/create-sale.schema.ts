import { createSaleRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for opening a sale.
 *
 * DERIVED from the canonical wire contract (`createSaleRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it. The server schema is therefore the wire schema PLUS fields — it can never
 * be laxer than what the client is told to send, so the two cannot drift. The
 * field rules for `leadId` live in the contract; do not restate them here.
 * `locationId` is NOT a wire field — it is injected from the validated
 * `X-Location-Id` header by the controller.
 */
export const createSaleSchema = createSaleRequestBase.extend({
  organizationId: z.string().min(1),
  createdById: z.string().min(1),
  // Server-injected, NOT part of the wire contract. The branch a sale books to
  // comes from the guard-validated `X-Location-Id` header; see the note on
  // `createSaleRequestBase`.
  locationId: z.string().min(1).optional(),
});

export type CreateSaleInput = z.input<typeof createSaleSchema>;
