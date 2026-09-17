import type { z } from 'zod';
import { updateUserSchema } from '../update-user/update-user.schema.js';

/**
 * Input shape for `updateUserProfile`.
 *
 * Identical to `updateUser` — this service is the same write plus the
 * session-cache refresh that has to follow it, so re-using the schema keeps
 * the two from drifting (and keeps validation error messages identical).
 */
export const updateUserProfileSchema = updateUserSchema;

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
