import { updateUserRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for updating a user.
 *
 * DERIVED from the canonical wire contract (`updateUserRequestBase` in
 * `@borradh-workspace/contracts`) by extending the route param onto it. This is
 * a self-service edit — there is no organization context. Field rules
 * (`.min(2)`, `.email()`, `.url()`) live in the contract; do not restate them.
 */
export const updateUserSchema = updateUserRequestBase.extend({
  id: z.string().min(1, 'User ID is required'),
});

/**
 * Input type inferred from schema
 */
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
