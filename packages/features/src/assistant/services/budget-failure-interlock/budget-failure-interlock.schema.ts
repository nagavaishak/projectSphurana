import { z } from 'zod';

/**
 * Shared shape for the money-truth budget-failure interlock (register #137).
 * Keyed by conversation + org + the Meta campaign whose budget update failed.
 */
export const budgetFailureInterlockSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  conversationId: z.string().min(1, 'Conversation ID is required'),
  metaCampaignId: z.string().min(1, 'Meta campaign ID is required'),
});

export type BudgetFailureInterlockInput = z.infer<
  typeof budgetFailureInterlockSchema
>;

export const resolveBudgetFailureInterlockSchema =
  budgetFailureInterlockSchema.extend({
    /** True when the owner has explicitly said to launch anyway despite the
     *  failed budget change — clears the flag and permits the launch. */
    acknowledged: z.boolean().default(false),
  });

export type ResolveBudgetFailureInterlockInput = z.infer<
  typeof resolveBudgetFailureInterlockSchema
>;
