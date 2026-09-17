/**
 * What a VIDEO regeneration is TRYING to change — declared, not inferred.
 *
 * The sibling of `image-generation/regeneration-intent.ts`, and it exists for
 * the same reason: one regenerate path serves several intents, and tuning it
 * for one silently degrades another.
 *
 * WHAT WAS ACTUALLY BROKEN HERE
 * -----------------------------
 * The graphics path was fixed first; videos were left with half a solution.
 * `plan-video-detail` already reuses the caption and the video idea on a
 * regenerate, and rewrites on-screen copy from `priorCopy` — but it re-claims
 * the B-ROLL from scratch every time. There is no field anywhere in the video
 * pipeline that carries the previous clips forward.
 *
 * That makes every video regenerate a footage re-roll, whatever was asked for:
 *
 *   - Clip selection is a least-recently-used claim that STAMPS `lastUsedAt`
 *     as it claims. The original render pushed its clips to the back of the
 *     queue, so a regenerate is not merely allowed to pick different footage —
 *     it is steered away from the footage it just used.
 *   - "Make the headline shorter" therefore returns a different video, not the
 *     same video with a shorter headline. Exactly the complaint that
 *     `421b634d6` fixed for graphics.
 *   - Once a stock bank is seeded the drift widens: a regenerate months later
 *     draws from a larger pool than the original did.
 *
 * The inverse is also unavailable. "Use different footage" cannot be asked for
 * without also re-writing the copy, because the only lever is
 * `refinementInstruction`, which feeds the copy writer.
 *
 * So the intent is declared, and what each intent PRESERVES lives in one table
 * below rather than in conditionals spread through the planner.
 *
 * WHY THE AXES DIFFER FROM GRAPHICS
 * ---------------------------------
 * A graphic amendment is expressed by choosing which reference IMAGES reach
 * the model. A video is assembled, not drawn: the levers are which clips are
 * claimed, whether copy is rewritten or carried verbatim, and whether the
 * template stays pinned. Same shape of solution, different inputs — so this is
 * a parallel module rather than a shared one.
 */

/** What this video regeneration is changing. */
export type VideoRegenerationIntent =
  /** The on-screen words. Footage, template and caption must not move. */
  | 'copy'
  /** The b-roll. Copy, template and caption must not move. */
  | 'footage'
  /** Everything — a fresh plan, not an amendment. */
  | 'full';

/**
 * What a regeneration carries forward from the previous render.
 *
 * Every flag exists because preserving it, or not, decides whether a
 * capability works. They are not stylistic preferences.
 */
export interface VideoAmendmentInputs {
  /**
   * Re-use the previous render's exact clip asset ids.
   *
   * Absent, the planner re-claims from the service's rotation pool — and
   * because claiming stamps `lastUsedAt`, it will actively avoid the clips the
   * original used. This is the single flag that decides whether a copy edit is
   * an edit or a re-roll.
   */
  reuseClips: boolean;
  /**
   * Rewrite the on-screen copy from `priorCopy` plus the user's instruction.
   *
   * A surgical edit, not a fresh write: without `priorCopy` a request to
   * change the headline also reissues the body and the CTA.
   */
  refineCopy: boolean;
  /**
   * Carry the previous on-screen copy across UNCHANGED.
   *
   * Required for `footage` — the copy is not what is being changed, and
   * regenerating it would make a footage swap silently reword the video. Note
   * this is distinct from `refineCopy`: one rewrites deliberately, the other
   * refuses to touch it.
   */
  reuseCopyVerbatim: boolean;
  /**
   * Keep the post caption. Regenerating it would clobber edits the user made
   * in the review dialog, which is why the planner already reuses it.
   */
  reuseCaption: boolean;
  /**
   * Keep the video idea (hook, angle, beats). Re-planning it changes what the
   * video is ABOUT, which no amendment intends.
   */
  reuseIdea: boolean;
  /**
   * Pin the template and variation.
   *
   * Template choice otherwise hashes the fresh video id, so an amendment would
   * drift to a different layout — the same defect `regenerate-graphic` pins
   * `templateSlug` to avoid. A different template also implies a different
   * clip count, which would make `reuseClips` unsatisfiable.
   */
  pinTemplate: boolean;
}

/**
 * The single source of truth for what each intent preserves.
 *
 * Read this table to answer "why did that regenerate change X?", and change it
 * — rather than a conditional in the planner — to alter behaviour.
 */
const INTENT_INPUTS: Record<VideoRegenerationIntent, VideoAmendmentInputs> = {
  copy: {
    reuseClips: true,
    refineCopy: true,
    reuseCopyVerbatim: false,
    reuseCaption: true,
    reuseIdea: true,
    pinTemplate: true,
  },
  footage: {
    // The point of the intent: release the previous clips so the LRU claim
    // returns something else. No explicit exclusion list is needed — the
    // original render stamped them as most-recently-used, so they sort last.
    reuseClips: false,
    refineCopy: false,
    reuseCopyVerbatim: true,
    reuseCaption: true,
    reuseIdea: true,
    pinTemplate: true,
  },
  full: {
    reuseClips: false,
    refineCopy: false,
    reuseCopyVerbatim: false,
    reuseCaption: false,
    reuseIdea: false,
    pinTemplate: false,
  },
};

export function inputsForVideoIntent(
  intent: VideoRegenerationIntent
): VideoAmendmentInputs {
  return INTENT_INPUTS[intent];
}

/**
 * Work out the intent when a caller hasn't declared one.
 *
 * A COMPATIBILITY SHIM for callers that predate the explicit field, not the
 * mechanism — the point of this module is that intent is stated. New callers
 * should pass it.
 *
 * Deliberately conservative: an instruction with no clip ids means the words
 * are the subject, which is the overwhelmingly common case from the review
 * dialog. Without `priorClipIds` a `copy` intent cannot honour `reuseClips`
 * anyway, so it degrades to today's behaviour rather than silently claiming to
 * preserve footage it was never given.
 */
export function inferVideoRegenerationIntent(args: {
  /** Clip ids from the previous render, if the caller carried them. */
  hasPriorClipIds: boolean;
  /** True when the caller explicitly asked for different footage. */
  requestedFootageChange?: boolean;
  refinementInstruction?: string;
}): VideoRegenerationIntent {
  if (args.requestedFootageChange) return 'footage';
  if (!args.hasPriorClipIds) return 'full';
  if (args.refinementInstruction?.trim()) return 'copy';
  return 'full';
}
