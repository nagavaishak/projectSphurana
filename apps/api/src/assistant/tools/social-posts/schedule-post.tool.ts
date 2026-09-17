import {
  type SocialPost,
  socialPostSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const schedulePostInputSchema = z.object({
  postId: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, 'Invalid ID format')
    .describe('The draft post ID to schedule'),
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .describe('ISO 8601 date-time for the scheduled publish time'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface SchedulePostOutput {
  postId: string;
  status: SocialPost['status'];
  scheduledAt: string;
}

export const schedulePostTool = defineTool<
  z.infer<typeof schedulePostInputSchema>,
  SchedulePostOutput
>({
  feature: 'social-posts',
  action: 'schedulePost',
  description:
    'Schedule a draft social post to publish at a specific time. ' +
    'Requires operator confirmation. Only works on posts in draft status. ' +
    'Use `listRecentPosts` to find the post ID, then this tool to schedule.',
  inputSchema: schedulePostInputSchema,
  destructive: true,
  destructiveAction: 'schedule_post',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Scheduling post' },
  additionalAllowedPaths: [
    /^social-posts\/[a-zA-Z0-9_-]+$/,
    /^social-posts\/[a-zA-Z0-9_-]+\/publish$/,
  ],
  summarizeForConfirmation: async (input, ctx) => {
    const post = await ctx.apiFetch(`social-posts/${input.postId}`, {
      schema: socialPostSchema,
    });

    // The operator approves or rejects this card on the strength of the time it
    // shows, so the time must be in the business's own zone — `ctx.timezone`,
    // sourced from `organization.timezone`. Rendered without one it comes out
    // in the server's zone (UTC), which for a Los Angeles salon reads seven or
    // eight hours off: an operator asked to confirm "16:00" waves through a
    // post that publishes at 9am.
    //
    // No `timeZoneName` here: Intl throws a TypeError when a component option
    // is combined with `dateStyle`/`timeStyle`, and `timeZoneName` counts as
    // one. `timeZone` itself is exempt, so it composes with the styles fine.
    const scheduledDate = new Date(input.scheduledAt).toLocaleString('en-IE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: ctx.timezone,
    });

    const platforms = post.platforms.join(', ');

    const captionPreview =
      typeof post.caption === 'string' && post.caption.length > 100
        ? `${post.caption.slice(0, 100)}…`
        : (post.caption ?? '(no caption)');

    return {
      title: `Schedule post "${post.title ?? post.id}"`,
      fields: [
        { label: 'Post', value: post.title ?? post.id },
        { label: 'Caption', value: captionPreview },
        { label: 'Platforms', value: platforms },
        { label: 'Scheduled for', value: scheduledDate },
      ],
      resourceId: input.postId,
      payload: { postId: input.postId, scheduledAt: input.scheduledAt },
    };
  },
  execute: async (input, ctx) => {
    await ctx.apiFetch(`social-posts/${input.postId}`, {
      method: 'PUT',
      body: {
        scheduledAt: new Date(input.scheduledAt).toISOString(),
        status: 'scheduled',
      },
    });

    const publishResult = await ctx.apiFetch(
      `social-posts/${input.postId}/publish`,
      { schema: socialPostSchema, method: 'POST' }
    );

    return {
      data: {
        postId: input.postId,
        status: publishResult.status,
        scheduledAt: input.scheduledAt,
      },
    };
  },
});
