import type { CreateVideoInput } from '@borradh-workspace/api-client/types';
import { createVideoRequestSchema } from '@borradh-workspace/contracts';

/**
 * The wire body for `POST /videos` — the canonical contract from
 * `@borradh-workspace/contracts`, re-exported under its historical name.
 *
 * `.strict()` on the TOP level so an extra or misspelled top-level field is a
 * parse error, not a silent strip — this is what stops the create surfaces
 * (create-video wizard, create-from-client, ads video-format, new-post-dialog,
 * the socials generate dialogs) from drifting apart on the request envelope.
 *
 * The nested `draftConfig` is now validated too, against the SAME
 * `partialDraftConfigSchema` the server uses — it used to be an opaque
 * passthrough here, so a malformed draft config only surfaced as a 400.
 * `organizationId` and `createdById` are stamped server-side from the session.
 */
export const createVideoBodySchema = createVideoRequestSchema;

export function buildCreateVideoPayload(
  input: CreateVideoInput
): CreateVideoInput {
  // Validate against the contract, but return the caller's object so the
  // request keeps its precise api-client type (and any key the contract's
  // non-strict nested objects would have stripped is preserved verbatim for
  // the server, which parses the same schema).
  createVideoBodySchema.parse({
    title: input.title,
    templateId: input.templateId,
    variationId: input.variationId,
    serviceId: input.serviceId,
    offerId: input.offerId,
    draftConfig: input.draftConfig,
    usageType: input.usageType,
  });
  return input;
}
