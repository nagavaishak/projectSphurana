import { segmentListResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const listSegmentsInputSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(50)
    .describe('Page size, capped at 100. Default 50.'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Pagination offset. Use to fetch the next page.'),
});

interface ListSegmentsOutput {
  segments: Array<{ id: string; name: string; isDynamic: boolean }>;
  pageCount: number;
  limit: number;
  offset: number;
}

/**
 * `campaigns_segments_list` — list saved audience segments for the org.
 *
 * Read-only. Backed by `GET /campaigns/segments`. Segments are the saved
 * audience definitions a campaign sends to; the model uses this to pick a
 * `segmentId` when creating a campaign ("who can I send this to?").
 */
export const listSegmentsTool = defineTool<
  z.infer<typeof listSegmentsInputSchema>,
  ListSegmentsOutput
>({
  feature: 'campaigns',
  action: 'segments_list',
  description:
    'List the saved audience segments for the organization. Segments define ' +
    'who a messaging campaign is sent to. Use this to find a `segmentId` ' +
    'before creating a campaign. Read-only.',
  inputSchema: listSegmentsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing audience segments' },
  additionalAllowedPaths: [/^campaigns\/segments$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    params.set('limit', String(input.limit));
    params.set('offset', String(input.offset));

    const data = await ctx.apiFetch(`campaigns/segments?${params.toString()}`, {
      schema: segmentListResponseSchema,
    });

    return {
      data: {
        segments: data.items.map((s) => ({
          id: s.id,
          name: s.name,
          isDynamic: s.isDynamic,
        })),
        pageCount: data.items.length,
        limit: data.limit,
        offset: data.offset,
      },
    };
  },
});
