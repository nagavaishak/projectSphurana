import { createSupplierRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a supplier.
 *
 * DERIVED from the canonical wire contract (`createSupplierRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected
 * `organizationId` onto it. Field rules live in the contract.
 */
export const createSupplierSchema = createSupplierRequestBase.extend({
  organizationId: z.string().min(1),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
