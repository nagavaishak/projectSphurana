import { z } from 'zod';

/**
 * The card a tool result asks the chat to render.
 *
 * WHY THIS EXISTS. The renderer used to dispatch on the TOOL NAME — 33
 * `toolName === '…'` branches over 140 tools. A tool without a branch rendered
 * nothing, or fell through to whichever branch happened to match first, and the
 * failure was always silent. Three shipped bugs came straight out of that:
 *
 *   - `patchDraftVideo` fell through to a generic title-over-one-field card, so
 *     the owner was told "approve on the card" with no approval on screen.
 *   - `regenerateItem` had no branch at all: Claire announced "confirm on the
 *     card above" over nothing.
 *   - `confirmSchedulePost` and `confirmPublishNow` had branches long after the
 *     tools themselves were merged away — dead UI for tools that cannot run.
 *
 * So the tool now NAMES its card, and the renderer is a lookup. A new tool
 * picks an existing `type` and renders correctly on the first call; a tool with
 * no card renders nothing, which is a decision rather than an accident.
 *
 * The renderer PARSES this rather than casting it. A tool that emits a card
 * with the wrong shape gets caught here instead of at the first undefined
 * property inside a component.
 */

const fieldSchema = z.object({ label: z.string(), value: z.string() });

/** Shared by every confirmation, whatever the body looks like. */
export const confirmationCardSchema = z.object({
  type: z.literal('confirmation_required'),
  /** The `claire_confirmation_action` this token authorises. */
  action: z.string(),
  resourceId: z.string().optional(),
  /**
   * Echoed back by the model on the second call. The card never calls the tool
   * itself — it sends the owner's answer as a message, and the model is what
   * holds the token.
   */
  token: z.string().optional(),
  expiresAt: z.string().optional(),
  summary: z
    .object({
      title: z.string().optional(),
      fields: z.array(fieldSchema).optional(),
    })
    .optional(),
  /** The tool that will run once confirmed. */
  executeToolName: z.string().optional(),
  /**
   * Optional richer body. Falls back to the summary field list when the
   * frontend has no component under this name — an unknown renderer degrades to
   * a plain confirmation rather than to nothing.
   */
  renderer: z.string().optional(),
  /** Verb for the confirm button. "Launch", "Pause", "Render" — not "Confirm". */
  confirmLabel: z.string().optional(),
});

export const toolCardSchema = z.discriminatedUnion('type', [
  confirmationCardSchema,

  /**
   * Render nothing, on purpose.
   *
   * The suppression cases are real: an offer video created only as a creative
   * for a draft ad has its own combined card further down the turn, and showing
   * the raw creative first would ask the owner to approve a video twice. The
   * renderer used to work this out by reading `input.suppressCard` for three
   * named tools — the tool knowing its own output is not worth showing, but the
   * knowledge living on the other side of the wire.
   */
  z.object({ type: z.literal('none') }),

  /**
   * The ordered clip list with the approval attached — one card, four entry
   * points (create, edit clips, patch, review). Addressed by ITEM id: the item
   * is what survives the fork an approved edit causes.
   */
  z.object({
    type: z.literal('content_clips'),
    itemId: z.string(),
    /** The cut this card was emitted against, so an older card goes stale. */
    attemptId: z.string().optional(),
    renderCount: z.number().optional(),
    title: z.string().optional(),
    serviceId: z.string().nullable().optional(),
    minClipCount: z.number().optional(),
  }),

  /** A render is running. Self-polling; swaps to the video when it lands. */
  z.object({
    type: z.literal('video_status'),
    videoId: z.string(),
    status: z.string().optional(),
    progress: z.number().optional(),
    processingStage: z.string().optional(),
    title: z.string().optional(),
    blobUrl: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    durationMs: z.number().optional(),
  }),

  /**
   * A video draft with no content item behind it. Degraded path — opening the
   * item failed — kept so the draft is not lost with it.
   */
  z.object({
    type: z.literal('video_draft'),
    videoId: z.string(),
    title: z.string().optional(),
    fields: z.array(fieldSchema).optional(),
    serviceId: z.string().nullable().optional(),
    clipAssetIds: z.array(z.string()).optional(),
    minClipCount: z.number().optional(),
    textFrames: z
      .array(
        z.object({
          id: z.string(),
          text: z.string(),
          style: z
            .enum(['default', 'question', 'answer', 'disclaimer', 'cta'])
            .optional(),
        })
      )
      .optional(),
  }),

  /** A graphic proposed but not yet generated — the owner picks before paying. */
  z.object({
    type: z.literal('graphic_draft'),
    itemId: z.string().optional(),
    attemptId: z.string().optional(),
    serviceId: z.string(),
    category: z.string(),
    kind: z.string().optional(),
    topicSummary: z.string().optional(),
    title: z.string().optional(),
    fields: z.array(fieldSchema).optional(),
  }),

  /** A graphic being generated. Self-polling, same as `video_status`. */
  z.object({
    type: z.literal('graphic_status'),
    graphicId: z.string(),
    itemId: z.string().optional(),
    status: z.string().optional(),
    title: z.string().optional(),
  }),

  /**
   * The rich ad card. `preview` stays unparsed here: it is the existing
   * `AdPreviewProps` tree, owned by the ad renderer, and re-declaring it in the
   * contract would be two definitions to keep in step instead of one.
   */
  z.object({
    type: z.literal('ad_preview'),
    preview: z.unknown(),
  }),

  z.object({
    type: z.literal('campaign_preview'),
    campaignId: z.string(),
  }),

  /** Pick clips by eye from a grid — a person's job, not the model's. */
  z.object({
    type: z.literal('asset_picker'),
    assets: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string().optional(),
        duration: z.union([z.number(), z.string()]).nullable().optional(),
        blobUrl: z.string().nullable().optional(),
        thumbnailUrl: z.string().nullable().optional(),
        tags: z.array(z.string()).nullable().optional(),
      })
    ),
    total: z.number().optional(),
  }),

  z.object({
    type: z.literal('qr_code'),
    recordingUrl: z.string(),
    instructions: z.string().optional(),
  }),

  /**
   * A caption, after it changed. Free, instant and already applied — there is
   * nothing to approve, but there IS something to show.
   *
   * Its own card rather than the generic created one: that renders fields as a
   * right-aligned definition list with `truncate`, which is right for "Format:
   * Portrait" and wrong for a paragraph. A clipped caption reads as broken, and
   * the alternative — leaving Claire to type the caption out in chat — is both
   * the narration she is told to avoid and the one form of evidence the owner
   * cannot check.
   */
  z.object({
    type: z.literal('caption_updated'),
    caption: z.string(),
  }),

  /** A reply drafted for the operator to send, edit or discard. */
  z.object({
    type: z.literal('draft_reply'),
    conversationId: z.string(),
    draft: z.string(),
    customerName: z.string().nullable().optional(),
    platform: z.string().optional(),
  }),

  z.object({
    type: z.literal('support_chat'),
    reason: z.string().optional(),
    created: z.boolean().optional(),
    notConfigured: z.boolean().optional(),
  }),
]);

export type ToolCard = z.infer<typeof toolCardSchema>;
export type ConfirmationCard = z.infer<typeof confirmationCardSchema>;
export type ToolCardType = ToolCard['type'];
