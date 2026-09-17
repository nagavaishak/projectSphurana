import { patchVideoDraftConfigRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

/**
 * The typed INTENT for patching a video draft's b-roll clip selection. The
 * assistant's video-draft-preview card passes this; only
 * {@link buildPatchVideoDraftConfigPayload} turns it into the wire body.
 */
export interface PatchVideoDraftConfigInput {
  videoId: string;
  /** Ordered asset ids for the b-roll strip (index === order). */
  clipAssetIds: string[];
  /**
   * Whether saving should also re-queue a render. Defaults to FALSE: selecting
   * or removing a clip is an edit, not an implicit render request — this lets a
   * user drop a still-processing clip immediately instead of the save failing
   * after the server has already stored it. (The server's own default is true,
   * so the builder must send this explicitly.)
   */
  requeueRender?: boolean;
}

/**
 * The wire body for `PATCH /videos/:id/draft-config` — the canonical contract
 * from `@borradh-workspace/contracts`, re-exported under its historical name.
 *
 * It is a PARTIAL draft-config patch (deep-merged server-side), so only the
 * touched keys are sent. `.strict()` guards the envelope. `videoId` is the
 * route param, not part of the body.
 */
export const patchVideoDraftConfigBodySchema =
  patchVideoDraftConfigRequestSchema;

export type PatchVideoDraftConfigBody = z.infer<
  typeof patchVideoDraftConfigBodySchema
>;

export function buildPatchVideoDraftConfigPayload(
  input: PatchVideoDraftConfigInput
): PatchVideoDraftConfigBody {
  return patchVideoDraftConfigBodySchema.parse({
    patch: {
      bRollClips: input.clipAssetIds.map((assetId, order) => ({
        assetId,
        order,
      })),
    },
    requeueRender: input.requeueRender ?? false,
  });
}
