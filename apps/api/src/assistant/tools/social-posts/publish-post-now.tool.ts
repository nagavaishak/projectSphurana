import {
  type SocialPost,
  socialPostSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const publishPostNowInputSchema = z.object({
  postId: z
    .string()
    .min(1)
    .describe('The draft post ID to publish immediately'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface PublishPostNowOutput {
  postId: string;
  status: SocialPost['status'];
  publishedAt: SocialPost['publishedAt'];
  platformResults: SocialPost['platformResults'];
}

export const publishPostNowTool = defineTool<
  z.infer<typeof publishPostNowInputSchema>,
  PublishPostNowOutput
>({
  feature: 'social-posts',
  action: 'publishPostNow',
  description:
    'Publish a draft social post immediately. ' +
    'Requires operator confirmation. This triggers immediate delivery to ' +
    'all selected platforms. Use `schedulePost` instead to set a future time.',
  inputSchema: publishPostNowInputSchema,
  destructive: true,
  destructiveAction: 'publish_post',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Publishing post' },
  additionalAllowedPaths: [
    /^social-posts\/[a-zA-Z0-9_-]+$/,
    /^social-posts\/[a-zA-Z0-9_-]+\/publish$/,
  ],
  summarizeForConfirmation: async (input, ctx) => {
    const post = await ctx.apiFetch(`social-posts/${input.postId}`, {
      schema: socialPostSchema,
    });

    const platforms = post.platforms.join(', ');

    const captionPreview =
      typeof post.caption === 'string' && post.caption.length > 100
        ? `${post.caption.slice(0, 100)}…`
        : (post.caption ?? '(no caption)');

    return {
      title: `Publish "${post.title ?? post.id}" now`,
      fields: [
        { label: 'Post', value: post.title ?? post.id },
        { label: 'Caption', value: captionPreview },
        { label: 'Platforms', value: platforms },
        { label: 'Timing', value: 'Immediately' },
      ],
      resourceId: input.postId,
      payload: { postId: input.postId },
    };
  },
  execute: async (input, ctx) => {
    const result = await ctx.apiFetch(`social-posts/${input.postId}/publish`, {
      schema: socialPostSchema,
      method: 'POST',
    });

    return {
      data: {
        postId: input.postId,
        status: result.status,
        publishedAt: result.publishedAt,
        platformResults: result.platformResults,
      },
    };
  },
});
