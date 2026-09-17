import type { UpdateFaceGroupInput } from '@borradh-workspace/api-client/types';
import { updateFaceGroupRequestSchema } from '@borradh-workspace/contracts';

/**
 * Typed intent + the ONE builder for `PUT face-groups/:id`.
 *
 * Every surface that renames / retags a face group (the batch review card, the
 * onboarding before/after step's name blur, its service picker) hands over just
 * the changed fields; this builder is the single place the partial wire body is
 * shaped, so the surfaces cannot drift.
 *
 * The intent no longer carries `isExcluded`: no surface ever set it, no server
 * schema has ever accepted it, and it was silently stripped by the API DTO. See
 * the contract's doc comment.
 */
export interface UpdateFaceGroupIntent {
  clientName?: string;
  serviceId?: string | null;
}

/** The canonical `PUT face-groups/:id` contract, under its historical name. */
export const updateFaceGroupBodySchema = updateFaceGroupRequestSchema;

export function buildUpdateFaceGroupPayload(
  intent: UpdateFaceGroupIntent
): UpdateFaceGroupInput {
  return updateFaceGroupBodySchema.parse({
    clientName: intent.clientName,
    serviceId: intent.serviceId,
  });
}
