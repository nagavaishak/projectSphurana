import { generateContentRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { GenerateContentInput } from '../types';

/**
 * The wire body for `POST /ai-content/generate`, built in exactly one place.
 *
 * `.strict()` so an extra or missing field is a parse error, not a silent
 * strip — this is what stops the caption-generation surfaces (content-calendar
 * add-content-dialog, mobile content wizard) and the ad customize-step from
 * drifting apart. Every surface passes the shared {@link GenerateContentInput}
 * intent; only the builder below assembles the request. `organizationId` is
 * stamped server-side from the session.
 */
export const generateContentBodySchema = generateContentRequestSchema;

export type GenerateContentBody = z.infer<typeof generateContentBodySchema>;

export function buildGenerateContentPayload(
  input: GenerateContentInput
): GenerateContentBody {
  return generateContentBodySchema.parse({
    mediaType: input.mediaType,
    mediaId: input.mediaId,
    contentType: input.contentType,
    platform: input.platform,
    serviceIds: input.serviceIds,
  });
}
