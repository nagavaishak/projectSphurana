import type { UpdateVideoInput } from '@borradh-workspace/api-client/types';
import { updateVideoRequestSchema } from '@borradh-workspace/contracts';

/**
 * The wire body for `PUT /videos/:id` — the canonical contract from
 * `@borradh-workspace/contracts`, re-exported under its historical name.
 *
 * `.strict()` on the TOP level so an extra or misspelled top-level field is a
 * parse error, not a silent strip — this is what stops the update surfaces
 * (video-creation-form, script-step, teleprompter-recorder, new-post-dialog,
 * video-draft-preview) from drifting apart on the request envelope. `id` is the
 * route param, not part of the body.
 *
 * `draftConfig` is a SHALLOW partial of the full config: a nested object you
 * send REPLACES the stored one, so every key of e.g. `captions` must be
 * present. It is now validated client-side against the same schema the server
 * uses, rather than being an opaque passthrough.
 */
export const updateVideoBodySchema = updateVideoRequestSchema;

export function buildUpdateVideoPayload(
  input: UpdateVideoInput & { id: string }
): UpdateVideoInput {
  const { id: _id, ...body } = input;
  // Validate against the contract, but return the caller's object so the
  // request keeps its precise api-client type.
  updateVideoBodySchema.parse(body);
  return body;
}
