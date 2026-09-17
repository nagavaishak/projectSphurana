import { createProductBrandRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a product brand.
 *
 * DERIVED from the canonical wire contract (`createProductBrandRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it. The server schema is therefore the wire schema PLUS `organizationId` — it
 * can never be laxer than what the client is told to send, so the two cannot
 * drift. Field rules (`.min(1)`, nullability) live in the contract; do not
 * restate them here.
 */
export const createProductBrandSchema = createProductBrandRequestBase.extend({
  organizationId: z.string().min(1),
});

export type CreateProductBrandInput = z.infer<typeof createProductBrandSchema>;
