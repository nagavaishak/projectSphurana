import { z } from 'zod';

/**
 * Input for `handleReviewTurn` — one turn of the per-post review thread.
 */
export const handleReviewTurnSchema = z.object({
  itemId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Becomes the minted assets' uploadedById when a swap needs a new clip. */
  userId: z.string().min(1),
  /**
   * What the user asked for, verbatim ("less salesy", "get rid of clip 1").
   * Capped well above a realistic instruction but short of an essay — this is a
   * chat turn, not a brief.
   */
  instruction: z.string().min(1).max(500),
});

export type HandleReviewTurnInput = z.infer<typeof handleReviewTurnSchema>;

/**
 * What the model returns: EXACTLY ONE action, plus what to say about it.
 *
 * A discriminated union rather than a bag of optional fields, so "rewrite the
 * caption AND drop a clip" cannot be expressed in a single turn. That is a
 * deliberate limit: the two have different costs (one is free, the other is a
 * re-render) and different undo paths, and a turn that quietly did both would
 * make the thread's history unreadable.
 *
 * Clip indices are 1-BASED here because that is how the owner says it — "clip
 * 2" — and converting at the boundary keeps the off-by-one in one place instead
 * of in the prompt.
 */
export const reviewTurnActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('caption'),
    caption: z.string().min(20).max(2200),
    reply: z.string().min(1).max(400),
    suggestedRule: z
      .object({
        title: z.string().min(1).max(80),
        content: z.string().min(1).max(280),
      })
      .nullable()
      .optional(),
  }),
  z.object({
    kind: z.literal('clips'),
    reply: z.string().min(1).max(400),
    operations: z
      .array(
        z.discriminatedUnion('op', [
          z.object({
            op: z.literal('remove'),
            clipNumber: z.number().int().min(1),
          }),
          z.object({
            op: z.literal('swap'),
            clipNumber: z.number().int().min(1),
            /**
             * What the owner wants INSTEAD, in their words — "something with
             * the treatment room in it".
             *
             * Without it a swap is "give me a different clip", and the picker
             * hands back the first of an arbitrary pool. Omitted when they
             * named no criteria ("change the second clip"), which is a real
             * answer: they get a different clip and can say more.
             */
            description: z.string().max(200).optional(),
          }),
        ])
      )
      .min(1)
      .max(10),
  }),
  z.object({
    kind: z.literal('text'),
    reply: z.string().min(1).max(400),
    /**
     * The template field to change and its new value. `field` is the key inside
     * the active organic template config (e.g. `lines`, `items`) — never a
     * dotted path, so it cannot reach out of that object.
     */
    field: z.string().min(1).max(60),
    /** Replacing one entry of a string[] field; omitted for scalar fields. */
    index: z.number().int().min(0).optional(),
    value: z.string().min(1).max(400),
  }),
  /**
   * PROPOSE a re-roll of the rendered asset. Nothing is spent by this turn.
   *
   * This is how a GRAPHIC changes its words. A video's on-screen text is data
   * in `draftConfig`, so `text` patches it for free; a graphic's text is pixels
   * the image model painted, and there is no field to patch — the only way to
   * change it is to generate again. The thread used to answer "unsupported,
   * regenerate the image separately", which refused a thing the system can do
   * and sent the owner out of the workspace to do it by hand.
   *
   * Held rather than fired because a re-roll costs a render and replaces what
   * is on screen. The note and slide land on the SLOT; the owner presses the
   * button the reply points at.
   */
  z.object({
    kind: z.literal('regenerate'),
    reply: z.string().min(1).max(400),
    /**
     * What to change, and where. Each note is capped at 280 to match
     * `regenerateBatchItemSchema.reason`, where it is ultimately spent.
     *
     *   [{ slideIndex: null, note }]      the whole asset — a video, a single
     *                                     graphic, or EVERY slide of a deck
     *   [{ slideIndex: 1, note }]         one slide; the others are preserved
     *   [{ slideIndex: 0 }, { 1 }, …]     a different instruction per slide,
     *                                     in ONE render
     *
     * A list because the carousel refiner already runs one model call per
     * slide, so per-slide instructions cost exactly what refining the whole
     * deck costs — the only thing ever shared was one instruction string.
     */
    /**
     * What the re-roll is CHANGING, so the renderer holds everything else
     * fixed. Stated here rather than guessed downstream: the inference shim
     * reads any instruction without an asset id as `copy`, which pins the
     * PICTURE — so "put my logo in the top right" was delivered to the model
     * alongside "do not change the imagery" and could only fail.
     */
    intent: z.enum(['copy', 'image', 'branding', 'full']).optional(),
    edits: z
      .array(
        z.object({
          slideIndex: z.number().int().min(0).nullable(),
          /**
           * `refine` re-renders that slide with `note`; `remove` drops it.
           * A removal costs no model call — the surviving slides are already
           * rendered and are carried across untouched.
           */
          op: z.enum(['refine', 'remove']).default('refine'),
          note: z.string().max(280).optional(),
        })
      )
      .min(1)
      .max(10)
      // `slideIndex: null` is "the whole thing", so it cannot coexist with
      // targeted entries: "make them all warmer AND slide 2 says X" has no
      // defined precedence, and guessing one would silently do the wrong half.
      .refine(
        (edits) =>
          edits.every((e) => e.slideIndex === null) ||
          edits.every((e) => e.slideIndex !== null),
        {
          message:
            'Either target the whole asset or name slides — not both in one turn',
        }
      ),
  }),
  z.object({
    kind: z.literal('unsupported'),
    reply: z.string().min(1).max(400),
  }),
]);

export type ReviewTurnAction = z.infer<typeof reviewTurnActionSchema>;

/**
 * Kept as its own export: the caption path is still the common case and its
 * shape is what the caption tests assert against.
 */
export const refinedCaptionOutputSchema = reviewTurnActionSchema;

export interface ReviewThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  captionSnapshot: string | null;
  createdAt: string;
}

/**
 * A staged clip edit, as the UI describes it back to the owner.
 *
 * `relist` has no `clipNumber` because it does not address a position — it is
 * the whole list, staged from the clip list editor, where the owner reordered
 * and added by hand. Naming a clip number for it would invent a target the
 * owner never picked.
 */
export type StagedClipEdit =
  | {
      op: 'swap';
      /** 1-based, matching what the owner said and what the tray shows. */
      clipNumber: number;
      /** The replacement that was resolved at staging time. */
      assetId?: string;
    }
  | { op: 'remove'; clipNumber: number }
  | { op: 'relist'; clipCount: number };

export interface StagedVideoEdits {
  clips: StagedClipEdit[];
  /** Human-readable summary of any on-screen text change, for the thread. */
  textChanges: string[];
}

export interface ReviewTurnResponse {
  caption: string;
  messages: ReviewThreadMessage[];
  suggestedRule: { title: string; content: string } | null;
  /**
   * Video edits waiting on the owner to commit. Null when the turn changed
   * nothing about the video. Applying them is a separate, explicit action —
   * every commit is a re-render.
   */
  stagedEdits: StagedVideoEdits | null;
  /** Re-renders this item's edits have already cost. Visible, not capped. */
  renderCount: number;
  /**
   * A re-roll Claire has PROPOSED and the owner has not confirmed. Null when
   * this turn proposed none.
   *
   * Returned as well as persisted: the thread renders the confirm from this,
   * and the slot carries it so the button survives a refresh — a proposal the
   * reply points at must outlive the page that showed it.
   */
  pendingRegenerate:
    | {
        slideIndex: number | null;
        op: 'refine' | 'remove';
        note?: string;
        intent?: 'copy' | 'image' | 'branding' | 'full';
      }[]
    | null;
}
