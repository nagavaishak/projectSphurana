import { listSocialPostsResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const deleteSocialPostDraftInputSchema = z.object({
  postId: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, 'Invalid ID format')
    .describe(
      'UUID of the post to delete. Must be in "draft", "scheduled", or "failed" status.'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

const DELETABLE_STATUSES = ['draft', 'scheduled', 'failed'] as const;

interface DeleteSocialPostDraftOutput {
  postId: string;
  deleted: boolean;
}

/**
 * `social_posts_deleteSocialPostDraft` — delete a social post draft or
 * scheduled post that has not yet been published.
 *
 * Posts in "draft", "scheduled", or "failed" status can be deleted.
 * Published or currently-publishing posts cannot be removed via this tool
 * and must be managed from the Content Calendar or Meta directly.
 *
 * Destructive (DB write). Uses the factory two-call confirmation flow.
 */
export const deleteSocialPostDraftTool = defineTool<
  z.infer<typeof deleteSocialPostDraftInputSchema>,
  DeleteSocialPostDraftOutput
>({
  feature: 'social-posts',
  action: 'deleteSocialPostDraft',
  description:
    'Delete a social post draft, scheduled post, or failed post that has not been published. ' +
    'Posts in "draft", "scheduled", or "failed" status can be deleted. ' +
    'Published posts cannot be deleted here — manage those from the Content Calendar. ' +
    'Requires operator confirmation. ' +
    'Use `listRecentPosts` to find the post ID first.',
  inputSchema: deleteSocialPostDraftInputSchema,
  destructive: true,
  destructiveAction: 'delete_social_post_draft',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Deleting post draft' },
  additionalAllowedPaths: [/^social-posts$/, /^social-posts\/[a-zA-Z0-9_-]+$/],
  summarizeForConfirmation: async (input, ctx) => {
    const data = await ctx.apiFetch('social-posts?limit=100', {
      schema: listSocialPostsResponseSchema,
    });
    const post = data.items.find((p) => p.id === input.postId);

    if (!post) {
      throw new Error(
        `Post not found (id: ${input.postId}). Use \`listRecentPosts\` to find the correct ID.`
      );
    }

    const isDeletable = (DELETABLE_STATUSES as readonly string[]).includes(
      post.status
    );
    if (!isDeletable) {
      throw new Error(
        `Cannot delete post — it is in "${post.status}" status. Only draft, scheduled, or failed posts can be deleted here.`
      );
    }

    const label =
      post.title ??
      (post.caption
        ? post.caption.slice(0, 60) + (post.caption.length > 60 ? '…' : '')
        : 'Untitled post');

    return {
      title: `Delete post "${label}"`,
      fields: [
        { label: 'Post', value: label },
        { label: 'Status', value: post.status },
      ],
      resourceId: input.postId,
      payload: { postId: input.postId },
    };
  },
  execute: async (input, ctx) => {
    await ctx.apiFetch(`social-posts/${input.postId}`, { method: 'DELETE' });

    return {
      data: {
        postId: input.postId,
        deleted: true,
      },
    };
  },
});
