import {
  type SocialPost,
  socialPostSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const updateSocialPostDraftInputSchema = z.object({
  postId: z.string().min(1).describe('The draft post ID to update'),
  caption: z.string().max(2200).optional().describe('New caption text'),
  title: z.string().min(1).max(200).optional().describe('New internal title'),
  platforms: z
    .array(z.enum(['facebook', 'instagram']))
    .min(1)
    .optional()
    .describe('Updated target platforms'),
});

interface UpdateSocialPostDraftOutput {
  postId: string;
  title: SocialPost['title'];
  caption: SocialPost['caption'];
  platforms: SocialPost['platforms'];
  status: SocialPost['status'];
}

export const updateSocialPostDraftTool = defineTool<
  z.infer<typeof updateSocialPostDraftInputSchema>,
  UpdateSocialPostDraftOutput
>({
  feature: 'social-posts',
  action: 'updateSocialPostDraft',
  description:
    'Update a draft social post. Use this when the operator wants to edit ' +
    'the caption, change target platforms, or update the title before ' +
    'scheduling or publishing. Only works on draft-status posts.',
  inputSchema: updateSocialPostDraftInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating post draft' },
  additionalAllowedPaths: [/^social-posts\/[a-zA-Z0-9_-]+$/],
  execute: async (input, ctx) => {
    const updateData: Record<string, unknown> = {};
    if (input.caption !== undefined) updateData.caption = input.caption;
    if (input.title !== undefined) updateData.title = input.title;
    if (input.platforms !== undefined) updateData.platforms = input.platforms;

    const result = await ctx.apiFetch(`social-posts/${input.postId}`, {
      schema: socialPostSchema,
      method: 'PUT',
      body: updateData,
    });

    return {
      data: {
        postId: result.id,
        title: result.title,
        caption: result.caption,
        platforms: result.platforms,
        status: result.status,
      },
    };
  },
});
