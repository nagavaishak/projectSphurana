import {
  segmentPreviewResponseSchema,
  segmentSchema,
} from '@borradh-workspace/contracts';
import { allLeadStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const createSegmentInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(120)
    .describe(
      'Human-readable segment name, e.g. "Quiet 30+ days" or "Won clients".'
    ),
  statuses: z
    .array(z.enum(allLeadStatusValues))
    .optional()
    .describe('Only include leads with one of these statuses. Omit for all.'),
  sources: z
    .array(z.string().max(60))
    .optional()
    .describe(
      'Only include leads from these sources (e.g. facebook_lead_form, manual, webform). Omit for all.'
    ),
  tags: z
    .array(z.string().max(60))
    .optional()
    .describe('Only include leads carrying one of these tags.'),
  lastContactedBefore: z
    .string()
    .datetime()
    .optional()
    .describe(
      'Only leads NOT contacted since this ISO datetime — e.g. 30 days ago for a re-engagement blast.'
    ),
  createdFrom: z
    .string()
    .datetime()
    .optional()
    .describe('Only leads created on/after this ISO datetime.'),
  createdTo: z
    .string()
    .datetime()
    .optional()
    .describe('Only leads created on/before this ISO datetime.'),
  isDynamic: z
    .boolean()
    .default(true)
    .describe(
      'true (default): re-evaluate the filter at send time. false: freeze the audience as it is now.'
    ),
});

interface CreateSegmentOutput {
  segmentId: string;
  name: string;
  isDynamic: boolean;
  /** Leads currently matching the filter. */
  total: number;
  /** Matching leads reachable on at least one channel. */
  reachable: number;
  perChannel: Record<string, number>;
}

/**
 * `campaigns_createSegment` — save a reusable audience segment.
 *
 * Non-destructive: a segment sends nothing by itself; it only defines who a
 * campaign *would* go to. Backed by `POST /campaigns/segments`, then the
 * audience preview so the model can immediately report real reach ("that's
 * 42 contacts, 30 reachable on WhatsApp") instead of a bare id.
 */
export const createSegmentTool = defineTool<
  z.infer<typeof createSegmentInputSchema>,
  CreateSegmentOutput
>({
  feature: 'campaigns',
  action: 'createSegment',
  description:
    'Create a saved audience segment for messaging campaigns from filters ' +
    '(lead status, source, tags, created window, last-contacted cutoff). ' +
    'Returns the new segmentId plus live reach counts per channel. Use when ' +
    'no existing segment fits — check `campaigns_segments_list` first. A ' +
    'segment sends nothing by itself.',
  inputSchema: createSegmentInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Creating audience segment' },
  additionalAllowedPaths: [
    /^campaigns\/segments$/,
    /^campaigns\/segments\/preview$/,
  ],
  execute: async (input, ctx) => {
    const filterJson: Record<string, unknown> = {};
    if (input.statuses?.length) filterJson.status = input.statuses;
    if (input.sources?.length) filterJson.source = input.sources;
    if (input.tags?.length) filterJson.tags = input.tags;
    if (input.lastContactedBefore)
      filterJson.lastContactedBefore = input.lastContactedBefore;
    if (input.createdFrom) filterJson.createdFrom = input.createdFrom;
    if (input.createdTo) filterJson.createdTo = input.createdTo;

    const segment = await ctx.apiFetch('campaigns/segments', {
      schema: segmentSchema,
      method: 'POST',
      body: {
        name: input.name,
        filterJson,
        isDynamic: input.isDynamic,
      },
    });

    const preview = await ctx.apiFetch('campaigns/segments/preview', {
      schema: segmentPreviewResponseSchema,
      method: 'POST',
      body: { filterJson },
    });

    return {
      data: {
        segmentId: segment.id,
        name: segment.name,
        isDynamic: segment.isDynamic,
        total: preview.total,
        reachable: preview.reachable,
        perChannel: preview.channels,
      },
    };
  },
});
