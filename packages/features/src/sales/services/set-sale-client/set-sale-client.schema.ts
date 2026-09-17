import { setSaleClientRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for attaching (or clearing, with `leadId: null`) the client on a sale.
 *
 * DERIVED from the canonical wire contract (`setSaleClientRequestBase` in
 * `@borradh-workspace/contracts`) — wire -> server, so the nullable-but-not-
 * optional `leadId` rule has exactly one description.
 */
export const setSaleClientSchema = setSaleClientRequestBase.extend({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
});

export type SetSaleClientInput = z.infer<typeof setSaleClientSchema>;
