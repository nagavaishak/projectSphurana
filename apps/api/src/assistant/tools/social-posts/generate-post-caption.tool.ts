import {
  type AiSocialPostContent,
  generatedContentSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const generatePostCaptionInputSchema = z.object({
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
});

/**
 * `POST /ai-content/generate` NESTS the copy under `content` — reading
 * `caption` off the top level yields `undefined` (the defect that shipped in
 * `meta_ads_generateAdCopy`). `generatedContentSchema` is the discriminated
 * union that makes the envelope explicit, so the nesting can't be lost again.
 */
interface GeneratePostCaptionOutput {
  caption: AiSocialPostContent['caption'];
  hashtags: AiSocialPostContent['hashtags'];
}

export const generatePostCaptionTool = defineTool<
  z.infer<typeof generatePostCaptionInputSchema>,
  GeneratePostCaptionOutput
>({
  feature: 'social-posts',
  action: 'generatePostCaption',
  description:
    'AI-generate a social media caption with hashtags for a video or image. ' +
    'Uses the organization brand voice and service context. Returns caption + hashtags. ' +
    'Provide either videoId or graphicId.',
  inputSchema: generatePostCaptionInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Generating caption' },
  additionalAllowedPaths: [/^ai-content\/generate$/],
  execute: async (input, ctx) => {
    let mediaType: 'video' | 'image';
    let mediaId: string;

    if (input.videoId) {
      mediaType = 'video';
      mediaId = input.videoId;
    } else if (input.graphicId) {
      mediaType = 'image';
      mediaId = input.graphicId;
    } else {
      throw new Error('Either videoId or graphicId is required');
    }

    const result = await ctx.apiFetch('ai-content/generate', {
      schema: generatedContentSchema,
      method: 'POST',
      body: {
        mediaType,
        mediaId,
        contentType: 'social-post',
        platform: input.platform,
        serviceIds: input.serviceIds,
      },
    });

    if (result.contentType !== 'social-post') {
      throw new Error(
        'Unexpected content type returned from caption generator'
      );
    }

    return {
      data: {
        caption: result.content.caption,
        hashtags: result.content.hashtags,
      },
    };
  },
});
