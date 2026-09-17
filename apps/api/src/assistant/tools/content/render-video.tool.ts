import { contentItemStateSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { describeRenderBlocked } from '../../ports/reason-messages.js';
import { defineTool } from '../../tool-factory/index.js';

const RENDER_HARD_BLOCKS = ['noFabricatedResultClaims'] as const;

interface RenderVideoOutput {
  itemId?: string;
  videoId?: string;
  status?: string;
  error?: string;
}

/**
 * `content_renderVideo` — spend a render on the post the owner is looking at.
 *
 * ONE TOOL, where there were two. `queueVideoExport` asked and
 * `executeVideoExport` did it, split because — in the words of the tool it
 * replaces — collapsing them "would require re-invocation, which the current
 * frontend doesn't support." That was true when it was written. It is not now:
 * every confirmation in the app re-invokes through a message carrying the
 * token, which is exactly what the factory's own `destructive: true` flow does.
 * The reason for the split was removed and the split outlived it.
 *
 * WHY THIS IS NOT PART OF `patchContent`. The factory declares confirmation per
 * TOOL, not per call. `patchContent` is non-destructive because a caption
 * rewrite is free, instant and reversible, and asking permission for it would
 * be a dialog between someone and the sentence they just dictated. A render
 * costs money. One tool doing both would have to either confirm every caption
 * change or spend a render without asking — and the second is the failure the
 * approval card was built to close, when a plain text edit re-rendered
 * immediately and told the owner "re-rendering now" with no say in it.
 *
 * Addressed by the ITEM, like every other content tool. The item is what
 * follows the fork an edit causes, so it is the only id that still means the
 * same thing after one.
 *
 * This is for "yes, render it" said in CHAT. The card's own Accept is the more
 * common path and does not come through here — it commits staged edits
 * directly, as one render for the whole set of changes.
 */
export const renderVideoTool = defineTool<
  { itemId: string; confirmationToken?: string },
  RenderVideoOutput
>({
  feature: 'content',
  action: 'renderVideo',
  description:
    'Render the video on a post — spends one render. Use when the owner says ' +
    'to go ahead ("yes", "render it", "make it") about a draft they can see. ' +
    'Takes the ITEM id from your active context. Do NOT call this after a ' +
    'change: an edit returns a card carrying its own Accept, and pressing it ' +
    'is what starts the render. Do not call it after a create either unless ' +
    'they asked for the render in the same breath.',
  inputSchema: z.object({
    itemId: z
      .string()
      .min(1)
      .describe('The POST being rendered — the content item id.'),
  }),
  // Money. The factory issues the token, mounts the card, and refuses a second
  // call that does not carry it back.
  destructive: true,
  destructiveAction: 'queue_video_export',
  policy: 'member',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Starting the render' },
  hardBlocks: RENDER_HARD_BLOCKS,
  additionalAllowedPaths: [
    /^content-batches\/items\/[a-zA-Z0-9_-]+\/state$/,
  ] as const,
  summarizeForConfirmation: async (input) => ({
    resourceId: input.itemId,
    title: 'Render this video?',
    fields: [
      { label: 'Cost', value: 'One render. It takes a couple of minutes.' },
    ],
  }),
  execute: async (input, ctx) => {
    // Which video is live on this post. Read rather than asked for, so the tool
    // cannot be pointed at a cut the owner already replaced.
    let state: z.infer<typeof contentItemStateSchema>;
    try {
      state = await ctx.apiFetch(
        `content-batches/items/${input.itemId}/state`,
        {
          schema: contentItemStateSchema,
        }
      );
    } catch (error) {
      return {
        data: {
          error:
            `Could not load this post (itemId used: ${input.itemId} — it must be the ITEM id, not the video id). ${
              error instanceof Error ? error.message : ''
            }`.trim(),
        },
      };
    }

    if (state.kind !== 'video') {
      return {
        data: {
          itemId: state.itemId,
          error:
            'This post is a graphic — graphics render as they are created, so ' +
            'there is nothing to start here.',
        },
      };
    }
    if (!state.assetId) {
      return {
        data: {
          itemId: state.itemId,
          error:
            'This post has no video yet — it is still a proposal. Accept it on ' +
            'the card first.',
        },
      };
    }

    const result = await ctx.ports.videos.export(state.assetId);

    if (result.status === 'blocked') {
      // A refusal is a first-class outcome, not an exception: the port names
      // WHY, so Claire relays something the owner can act on instead of a
      // sanitized HTTP message. Only a genuine server fault is worth Sentry —
      // "the video isn't a draft" is an answer, not an incident.
      if (result.reason.kind === 'server_error') {
        ctx.reportIssue('Failed to queue video export', {
          extra: { videoId: state.assetId, reason: result.reason },
        });
      }
      return {
        data: {
          itemId: state.itemId,
          videoId: state.assetId,
          error: describeRenderBlocked(result.reason),
        },
      };
    }

    return {
      // The self-polling card, mounted the moment the queue accepts — so nobody
      // has to also call a status tool to find out what happened.
      presentation: {
        type: 'video_status' as const,
        videoId: state.assetId,
        status: 'queued',
      },
      data: {
        itemId: state.itemId,
        videoId: state.assetId,
        // "Queued", never "rendered". The render has been ACCEPTED; whether it
        // completes is what getVideoStatus is for.
        status: 'queued',
      },
    };
  },
});
