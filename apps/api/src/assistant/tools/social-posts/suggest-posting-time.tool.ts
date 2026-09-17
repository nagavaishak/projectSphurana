import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const suggestPostingTimeInputSchema = z.object({
  platform: z
    .enum(['facebook', 'instagram'])
    .optional()
    .describe('Specific platform to optimize for'),
});

/**
 * `GET /social-posts/suggest-timing` — `SuggestPostingTimeResult`.
 *
 * Fully computed from published-post timestamps (no backing row), so there is no
 * atom to anchor to; hand-modelled from `suggest-posting-time.service.ts`.
 *
 * `dataSource` is one of two literals, not free text — the industry-defaults
 * branch and the historical branch are the only two returns, and which one ran
 * is the thing the model has to say out loud.
 */
const postingTimeSuggestionSchema = z.object({
  platform: z.string().optional(),
  day: z.string().optional(),
  days: z.array(z.string()).optional(),
  timeRange: z.string(),
  postsInWindow: z.number().optional(),
  reasoning: z.string(),
});

const suggestPostingTimeResponseSchema = z.object({
  dataSource: z.enum(['industry_defaults', 'historical']),
  postsAnalyzed: z.number(),
  note: z.string().optional(),
  suggestions: z.array(postingTimeSuggestionSchema),
});

type SuggestPostingTimeResponse = z.infer<
  typeof suggestPostingTimeResponseSchema
>;

export const suggestPostingTimeTool = defineTool<
  z.infer<typeof suggestPostingTimeInputSchema>,
  SuggestPostingTimeResponse
>({
  feature: 'social-posts',
  action: 'suggestPostingTime',
  description:
    'Analyze past social post engagement to suggest the best times to post. ' +
    'If fewer than 5 published posts exist, returns industry-default recommendations. ' +
    'Returns 2-3 suggested posting windows with reasoning.',
  inputSchema: suggestPostingTimeInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Analyzing post timing' },
  additionalAllowedPaths: [/^social-posts\/suggest-timing$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    if (input.platform) params.set('platform', input.platform);
    const qs = params.toString();

    const data = await ctx.apiFetch(
      `social-posts/suggest-timing${qs ? `?${qs}` : ''}`,
      { schema: suggestPostingTimeResponseSchema }
    );

    return { data };
  },
});
