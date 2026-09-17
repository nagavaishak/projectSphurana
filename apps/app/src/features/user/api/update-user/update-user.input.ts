import { z } from 'zod';

/**
 * Intent for updating a user — all fields optional. `PUT users/:id` is reached
 * from two surfaces (the settings/index profile card and the user-settings
 * profile tab); today both only edit `name`, but the intent covers every
 * user-editable field so the single {@link buildUpdateUserPayload} builder
 * owns the wire shape and the two surfaces can never drift.
 *
 * `organizationId` used to be here. It was never set by a surface and never
 * accepted by the server — changing the active org is `PATCH
 * organization/active`, a different endpoint with different authorization.
 */
export const updateUserInputSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  email: z.string().email('Invalid email format').optional(),
  image: z.string().url('Invalid image URL').optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;
