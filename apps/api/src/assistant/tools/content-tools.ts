import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import type { AssistantToolsContext } from './index.js';

export function createContentTools(ctx: AssistantToolsContext): ToolSet {
  return {
    listRecentPosts: tool({
      description:
        'List recent social media posts for the organization. Shows title, status, ' +
        'target platforms, scheduled/published times. Use this to see what content ' +
        'has been posted or is upcoming.',
      inputSchema: z.object({
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
      }),
      execute: async ({ limit, status }) => {
        try {
          const params = new URLSearchParams();
          if (limit) params.set('limit', String(limit));
          if (status) params.set('status', status);
          const qs = params.toString();

          const data = await ctx.apiFetch<{
            items: Array<{
              id: string;
              title: string | null;
              caption: string | null;
              status: string;
              platforms: unknown;
              mediaType: string | null;
              scheduledAt: string | null;
              publishedAt: string | null;
              createdAt: string;
            }>;
            total: number;
          }>(`social-posts${qs ? `?${qs}` : ''}`);

          return {
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
          };
        } catch (error) {
          return {
            error:
              error instanceof Error ? error.message : 'Failed to list posts',
          };
        }
      },
    }),

    generatePostCaption: tool({
      description:
        'AI-generate a social media caption with hashtags for a video or image. ' +
        'Uses the organization brand voice and service context. Returns caption + hashtags.',
      inputSchema: z.object({
        videoId: z
          .string()
          .min(1)
          .optional()
          .describe('Video ID to generate caption for'),
        graphicId: z
          .string()
          .min(1)
          .optional()
          .describe('Graphic/image ID to generate caption for'),
        platform: z
          .enum(['facebook', 'instagram'])
          .optional()
          .describe('Target platform for tone optimization'),
        serviceIds: z
          .array(z.string().min(1))
          .optional()
          .describe('Service IDs for context matching'),
      }),
      execute: async ({ videoId, graphicId, platform, serviceIds }) => {
        let mediaType: 'video' | 'image';
        let mediaId: string;

        if (videoId) {
          mediaType = 'video';
          mediaId = videoId;
        } else if (graphicId) {
          mediaType = 'image';
          mediaId = graphicId;
        } else {
          return { error: 'Either videoId or graphicId is required' };
        }

        try {
          const result = await ctx.apiFetch<{
            contentType: string;
            content: {
              caption: string;
              hashtags: string[];
            };
          }>('ai-content/generate', {
            method: 'POST',
            body: {
              mediaType,
              mediaId,
              contentType: 'social-post',
              platform,
              serviceIds,
            },
          });

          if (result.contentType !== 'social-post') {
            return { error: 'Unexpected content type returned' };
          }

          return {
            caption: result.content.caption,
            hashtags: result.content.hashtags,
          };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : 'Failed to generate caption',
          };
        }
      },
    }),

    suggestPostingTime: tool({
      description:
        'Analyze past social post engagement to suggest the best times to post. ' +
        'If fewer than 5 published posts exist, returns industry-default recommendations. ' +
        'Returns 2-3 suggested posting windows with reasoning.',
      inputSchema: z.object({
        platform: z
          .enum(['facebook', 'instagram'])
          .optional()
          .describe('Specific platform to optimize for'),
      }),
      execute: async ({ platform }) => {
        try {
          const params = new URLSearchParams();
          if (platform) params.set('platform', platform);
          const qs = params.toString();

          const data = await ctx.apiFetch<{
            dataSource: string;
            postsAnalyzed: number;
            note?: string;
            suggestions: Array<{
              platform?: string;
              day?: string;
              days?: string[];
              timeRange: string;
              postsInWindow?: number;
              reasoning: string;
            }>;
          }>(`social-posts/suggest-timing${qs ? `?${qs}` : ''}`);

          return data;
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : 'Failed to suggest posting time',
          };
        }
      },
    }),

    createSocialPostDraft: tool({
      description:
        'Create a new social media post as a draft. Takes the caption, media reference, ' +
        'and target platforms. The post is created in draft status for review. ' +
        'Call this BEFORE asking the user to confirm scheduling or publishing.',
      inputSchema: z.object({
        title: z.string().describe('Internal title for the post'),
        caption: z.string().optional().describe('Post caption text'),
        mediaType: z.enum(['image', 'video']).describe('Type of media to post'),
        videoId: z
          .string()
          .min(1)
          .optional()
          .describe('Video ID if posting a video'),
        graphicId: z
          .string()
          .min(1)
          .optional()
          .describe('Graphic ID if posting an image'),
        platforms: z
          .array(z.enum(['facebook', 'instagram']))
          .min(1)
          .describe('Target platforms'),
      }),
      execute: async ({
        title,
        caption,
        mediaType,
        videoId,
        graphicId,
        platforms,
      }) => {
        let mediaUrl: string | undefined;
        let thumbnailUrl: string | undefined;

        try {
          if (videoId) {
            const v = await ctx.apiFetch<{
              blobUrl: string | null;
              thumbnailUrl: string | null;
            }>(`videos/${videoId}`);
            mediaUrl = v.blobUrl ?? undefined;
            thumbnailUrl = v.thumbnailUrl ?? undefined;
          } else if (graphicId) {
            const g = await ctx.apiFetch<{
              outputs: Array<{ url: string }> | null;
            }>(`graphics/${graphicId}`);
            mediaUrl = g.outputs?.[0]?.url;
          }

          if (!mediaUrl) {
            return {
              error:
                'Could not resolve media URL. Ensure the video or graphic exists and has been rendered.',
            };
          }

          const result = await ctx.apiFetch<{
            id: string;
            title: string | null;
            status: string;
          }>('social-posts', {
            method: 'POST',
            body: {
              title,
              caption,
              mediaType,
              mediaUrl,
              thumbnailUrl,
              videoId,
              graphicId,
              platforms,
              status: 'draft',
            },
          });

          return {
            postId: result.id,
            title: result.title,
            status: 'draft',
            platforms,
          };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : 'Failed to create social post draft',
          };
        }
      },
    }),

    updateSocialPostDraft: tool({
      description:
        'Update a draft social post. Use this when the user wants to edit the caption, ' +
        'change target platforms, or update the title before scheduling or publishing.',
      inputSchema: z.object({
        postId: z.string().min(1).describe('The draft post ID to update'),
        caption: z.string().optional().describe('New caption text'),
        title: z.string().optional().describe('New internal title'),
        platforms: z
          .array(z.enum(['facebook', 'instagram']))
          .min(1)
          .optional()
          .describe('Updated target platforms'),
      }),
      execute: async ({ postId, caption, title, platforms }) => {
        const updateData: Record<string, unknown> = {};
        if (caption !== undefined) updateData.caption = caption;
        if (title !== undefined) updateData.title = title;
        if (platforms !== undefined) updateData.platforms = platforms;

        try {
          const result = await ctx.apiFetch<{
            id: string;
            title: string | null;
            caption: string | null;
            platforms: unknown;
            status: string;
          }>(`social-posts/${postId}`, {
            method: 'PUT',
            body: updateData,
          });

          return {
            postId: result.id,
            title: result.title,
            caption: result.caption,
            platforms: result.platforms,
            status: result.status,
          };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : 'Failed to update social post',
          };
        }
      },
    }),
  };
}
