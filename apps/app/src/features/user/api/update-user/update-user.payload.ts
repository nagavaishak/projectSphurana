import { updateUserRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

import type { UpdateUserInput } from './update-user.input';

/**
 * The wire body for `PUT users/:id` — the canonical contract from
 * `@borradh-workspace/contracts`, re-exported under its historical name.
 *
 * All fields optional (only what changed is sent) and `.strict()` so an extra
 * or misspelled key is a parse error, not a silent strip. Both edit surfaces
 * pass the shared {@link UpdateUserInput} intent; only this builder assembles
 * the request.
 *
 * `organizationId` is gone: no surface set it, `updateUserProfile` never had
 * such a field, and it was parsed straight back off server-side. Switching the
 * active organization is `PATCH organization/active`.
 */
export const updateUserBodySchema = updateUserRequestSchema;

export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

/**
 * Turns the update-user intent into the strict wire body. Only keys actually
 * present on the intent are emitted, so each surface patches exactly the
 * fields it edits.
 */
export function buildUpdateUserPayload(input: UpdateUserInput): UpdateUserBody {
  const body: Record<string, unknown> = {};

  if ('name' in input) body.name = input.name;
  if ('email' in input) body.email = input.email;
  if ('image' in input) body.image = input.image;

  return updateUserBodySchema.parse(body);
}
