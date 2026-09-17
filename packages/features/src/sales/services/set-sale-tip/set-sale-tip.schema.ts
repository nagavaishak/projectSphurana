import {
  setSaleTipRefinement,
  setSaleTipRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for setting the tip on an open sale.
 *
 * DERIVED from the canonical wire contract (`setSaleTipRequestBase` in
 * `@borradh-workspace/contracts`), extended with the server-injected context
 * and refined with the SAME callback the wire schema uses, so "percent tip with
 * no percent" cannot mean different things on the two sides of the wire.
 */
export const setSaleTipSchema = setSaleTipRequestBase
  .extend({
    organizationId: z.string().min(1),
    saleId: z.string().min(1),
  })
  .superRefine(setSaleTipRefinement);

export type SetSaleTipInput = z.input<typeof setSaleTipSchema>;
