import { z } from 'zod';
import { blockedTimeEditScopeValues } from '../../models/scheduling.types.js';

export const deleteBlockedTimeSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  /** Delete scope for recurring series; non-recurring always behaves as 'all'. */
  scope: z.enum(blockedTimeEditScopeValues).default('all'),
  /** Required when scope='this' or 'following' on a recurring series. */
  originalStart: z.coerce.date().optional(),
});

export type DeleteBlockedTimeInput = z.infer<typeof deleteBlockedTimeSchema>;
