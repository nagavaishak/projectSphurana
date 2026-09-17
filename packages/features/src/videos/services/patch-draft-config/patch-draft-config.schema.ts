import {
  clipOperationSchema,
  patchVideoDraftConfigRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Set the whole clip list, in order — the clip list editor's operation.
 *
 * SERVER-SIDE ONLY, and deliberately not part of
 * `patchVideoDraftConfigRequestBase`. A named `swap`/`remove` is safe for a
 * caller holding a partial view of the list because everything it did not name
 * survives; a whole-list replace has no such guarantee, and Claire — who reads
 * clips as text and never sees the stored array — is exactly the caller that
 * must not be able to send one.
 *
 * The card can, because it renders the stored list: every position it hands
 * back is one the owner looked at. It is also the only way to express a
 * REORDER, which named edits have no vocabulary for.
 *
 * Carries asset ids rather than full clip configs so the caller cannot
 * accidentally drop a clip's `clipType` — the service rebuilds each entry from
 * the stored one it matches.
 */
export const replaceAllClipsOperationSchema = z.object({
  op: z.literal('replace-all'),
  assetIds: z.array(z.string().min(1)).min(1).max(20),
});

/**
 * Patch a draft video's config + optionally re-queue the render.
 *
 * DERIVED from the canonical wire contract
 * (`patchVideoDraftConfigRequestBase` in `@borradh-workspace/contracts`) by
 * extending the server-injected context onto it. `whatsappDelivery` is context,
 * not a body field: it comes from the `@WhatsappDelivery()` request decorator
 * so a Claire-on-WhatsApp edit can push the re-render back to the owner's
 * conversation (they can't poll). A client cannot address someone else's chat.
 */
export const patchDraftConfigSchema = patchVideoDraftConfigRequestBase.extend({
  /**
   * Widened over the wire contract's array by exactly one variant — see
   * `replaceAllClipsOperationSchema` for why that variant stops here and never
   * reaches the endpoint's own body schema.
   */
  clipOperations: z
    .array(z.union([clipOperationSchema, replaceAllClipsOperationSchema]))
    .max(20)
    .optional(),
  videoId: z.string().min(1, 'Video ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  whatsappDelivery: z.object({ conversationId: z.string().min(1) }).optional(),
  /**
   * Fork instead of overwrite when the video already HAS a rendered cut.
   *
   * The default is in-place, and that is right for the wizard: it patches an
   * unrendered draft on every interaction, and copy-on-write there would mint a
   * video row per keystroke for a cut nobody has ever seen.
   *
   * Editing something already rendered is the opposite case. Overwriting
   * destroys the only copy of a video the owner watched and approved, with no
   * way back — the state that made "change this one line" an irreversible act.
   * Callers that represent an owner editing finished work pass this; the
   * discriminator is `blobUrl`, not `status`, because a patch resets status to
   * 'draft' while leaving the previous render's URL in place.
   *
   * Server-side only: a client cannot ask for one or the other, because which
   * behaviour is correct is a property of the flow, not of the request.
   */
  preserveRendered: z.boolean().optional().default(false),
});

export type PatchDraftConfigInput = z.input<typeof patchDraftConfigSchema>;
export type PatchDraftConfigParsed = z.infer<typeof patchDraftConfigSchema>;
