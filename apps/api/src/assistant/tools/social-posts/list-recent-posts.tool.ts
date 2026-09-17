import {
  type SocialPost,
  listSocialPostsResponseSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const listRecentPostsInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Max posts to return (default: 10)'),
  status: z
    .enum([
      'draft',
      'scheduled',
      'publishing',
      'published',
      'partial',
      'failed',
    ])
    .optional()
    .describe('Filter by post status'),
});

interface ListRecentPostsOutput {
  posts: Array<{
    id: string;
    title: SocialPost['title'];
    caption: SocialPost['caption'];
    status: SocialPost['status'];
    platforms: SocialPost['platforms'];
    mediaType: SocialPost['mediaType'];
    scheduledAt: SocialPost['scheduledAt'];
    publishedAt: SocialPost['publishedAt'];
    createdAt: SocialPost['createdAt'];
  }>;
  total: number;
}

export const listRecentPostsTool = defineTool<
  z.infer<typeof listRecentPostsInputSchema>,
  ListRecentPostsOutput
>({
  feature: 'social-posts',
  action: 'listRecentPosts',
  description:
    'List recent social media posts for the organization. Shows title, ' +
    'status, target platforms, scheduled/published times. Use this to see ' +
    'what content has been posted or is upcoming.',
  inputSchema: listRecentPostsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Loading posts' },
  additionalAllowedPaths: [/^social-posts$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    if (input.limit) params.set('limit', String(input.limit));
    if (input.status) params.set('status', input.status);
    const qs = params.toString();

    const data = await ctx.apiFetch(`social-posts${qs ? `?${qs}` : ''}`, {
      schema: listSocialPostsResponseSchema,
    });

    return {
      data: {
        posts: data.items.map((p) => ({
          id: p.id,
          title: p.title,
          caption: p.caption,
          status: p.status,
          platforms: p.platforms,
          mediaType: p.mediaType,
          scheduledAt: p.scheduledAt,
          publishedAt: p.publishedAt,
          createdAt: p.createdAt,
        })),
        total: data.total,
      },
    };
  },
});
