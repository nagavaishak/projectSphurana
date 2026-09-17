import { createServiceRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a new organization service.
 *
 * DERIVED from the canonical wire contract: `createServiceRequestBase` in
 * `packages/contracts/src/requests/catalog.ts` is the SOURCE, and this is that
 * object plus the one field the SERVER injects — `organizationId`, taken from
 * the active-org session and never sent by the client.
 *
 * Because the server schema literally IS the wire schema plus a field, it can
 * never be laxer than the contract and no drift is possible. Add or change a
 * client-supplied field IN THE CONTRACT, not here — including its `.default()`,
 * which is now visible to both sides. Pricing (`priceType` / `priceCents`) is a
 * locked model; read the contract's header before touching it.
 */
export const createServiceSchema = createServiceRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
