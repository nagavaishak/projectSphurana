import {
  type SocialPost,
  graphicSchema,
  socialPostSchema,
  videoAtomSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const createSocialPostDraftInputSchema = z.object({
  title: z.string().min(1).max(200).describe('Internal title for the post'),
  caption: z.string().max(2200).optional().describe('Post caption text'),
  mediaType: z.enum(['image', 'video']).describe('Type of media to post'),
  videoId: z.string().min(1).optional().describe('Video ID if posting a video'),
  graphicId: z
    .string()
    .min(1)
    .optional()
    .describe('Graphic ID if posting an image'),
  platforms: z
    .array(z.enum(['facebook', 'instagram']))
    .min(1)
    .describe('Target platforms'),
});

/**
 * `GET /videos/:id` — the two media fields this tool reads.
 *
 * Deliberately NOT `videoWithCreatorSchema`: that models the full `video` row,
 * while `getVideo` runs a narrow `select({...})` that omits `usageType`,
 * `schemaVersion`, `processingStage`, `synthesisSeed`, `serviceId`, `offerId`,
 * `variationId`, `stageStartedAt` and `deletedAt` — all required there — so
 * parsing against it would throw on every call. `.pick()`ing the two columns
 * that ARE in the projection is both correct today and independent of whatever
 * that contract is fixed to say.
 */
const videoMediaSchema = videoAtomSchema.pick({
  blobUrl: true,
  thumbnailUrl: true,
});

interface CreateSocialPostDraftOutput {
  postId: string;
  title: SocialPost['title'];
  status: string;
  platforms: string[];
}

/**
 * `social-posts_createSocialPostDraft` — create a new draft social post.
 *
 * Not destructive in the confirmation sense — drafts are safe to create since
 * nothing is published until `schedulePost` or `publishPostNow` is called.
 * The factory wraps this for telemetry and input validation.
 */
export const createSocialPostDraftTool = defineTool<
  z.infer<typeof createSocialPostDraftInputSchema>,
  CreateSocialPostDraftOutput
>({
  feature: 'social-posts',
  action: 'createSocialPostDraft',
  description:
    'Create a new social media post as a draft. Takes the caption, media ' +
    'reference, and target platforms. The post is created in draft status for ' +
    'review. Call this BEFORE asking the user to confirm scheduling or publishing.',
  inputSchema: createSocialPostDraftInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Creating post draft' },
  additionalAllowedPaths: [
    /^social-posts$/,
    /^videos\/[a-zA-Z0-9_-]+$/,
    /^graphics\/[a-zA-Z0-9_-]+$/,
  ],
  execute: async (input, ctx) => {
    let mediaUrl: string | undefined;
    let thumbnailUrl: string | undefined;

    if (input.videoId) {
      const v = await ctx.apiFetch(`videos/${input.videoId}`, {
        schema: videoMediaSchema,
      });
      mediaUrl = v.blobUrl ?? undefined;
      thumbnailUrl = v.thumbnailUrl ?? undefined;
    } else if (input.graphicId) {
      const g = await ctx.apiFetch(`graphics/${input.graphicId}`, {
        schema: graphicSchema,
      });
      mediaUrl = g.outputs?.[0]?.url;
    }

    if (!mediaUrl) {
      throw new Error(
        'Could not resolve media URL. Ensure the video or graphic exists and has been rendered.'
      );
    }

    const result = await ctx.apiFetch('social-posts', {
      schema: socialPostSchema,
      method: 'POST',
      body: {
        title: input.title,
        caption: input.caption,
        mediaType: input.mediaType,
        mediaUrl,
        thumbnailUrl,
        videoId: input.videoId,
        graphicId: input.graphicId,
        platforms: input.platforms,
        status: 'draft',
      },
    });

    return {
      data: {
        postId: result.id,
        title: result.title,
        status: 'draft',
        platforms: input.platforms,
      },
    };
  },
});
