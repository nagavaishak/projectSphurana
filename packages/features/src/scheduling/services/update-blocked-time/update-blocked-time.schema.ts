import { updateBlockedTimeRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { blockedTimeEditScopeValues } from '../../models/scheduling.types.js';

/**
 * DERIVED from the wire contract — see
 * `packages/contracts/src/requests/scheduling.ts`.
 *
 * Adds only controller-injected context: `id` (route param), `organizationId`
 * (session), `createdById` (`@CurrentUser`) and `scope` (the `?scope=` query
 * param, defaulted by `BlockedTimeScopePipe`). None of them are body fields,
 * which is exactly why they live here and not in the contract.
 */
export const updateBlockedTimeBaseSchema = updateBlockedTimeRequestBase.extend({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  /**
   * Edit scope for recurring series (contract §3.2). Non-recurring series are
   * always treated as 'all'. Travels as a QUERY param, not in the body.
   */
  scope: z.enum(blockedTimeEditScopeValues).default('all'),
  /** Required for scope='following' to attribute the new series. */
  createdById: z.string().min(1).optional(),
});

export const updateBlockedTimeSchema = updateBlockedTimeBaseSchema.refine(
  (d) => !(d.startDate && d.endDate) || d.endDate > d.startDate,
  { message: 'endDate must be after startDate', path: ['endDate'] }
);

export type UpdateBlockedTimeInput = z.infer<typeof updateBlockedTimeSchema>;
