import {
  segmentPreviewResponseSchema,
  segmentSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const previewAudienceInputSchema = z.object({
  segmentId: z
    .string()
    .min(1)
    .describe(
      'ID of the saved segment to preview (from `campaigns_segments_list`).'
    ),
  channels: z
    .array(z.enum(['email', 'sms', 'whatsapp']))
    .min(1)
    .default(['email', 'sms', 'whatsapp'])
    .describe(
      'Channels to compute reachability for. Default: all three channels.'
    ),
});

interface PreviewAudienceOutput {
  segmentId: string;
  segmentName: string;
  /** Leads matching the segment filter. */
  total: number;
  /** Leads reachable on at least one requested channel. */
  reachable: number;
  /** Reachable count per channel (consent + contact + not suppressed). */
  perChannel: Record<string, number>;
}

/**
 * `campaigns_previewAudience` — count who a segment would actually reach.
 *
 * Read-only. Resolves the segment's saved filter (`GET
 * /campaigns/segments/:id`) then runs the audience preview (`POST
 * /campaigns/segments/preview`). Per-channel counts account for consent,
 * available contact details, and the org's suppression list — so the model
 * can say "this reaches 120 of 150 contacts on WhatsApp" before a launch.
 */
export const previewAudienceTool = defineTool<
  z.infer<typeof previewAudienceInputSchema>,
  PreviewAudienceOutput
>({
  feature: 'campaigns',
  action: 'previewAudience',
  description:
    'Preview how many contacts a saved audience segment would actually reach ' +
    'per channel (respecting consent, contact details, and opt-outs). Use ' +
    'BEFORE launching a messaging campaign so the user knows the real reach. ' +
    'Read-only.',
  inputSchema: previewAudienceInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Previewing audience' },
  additionalAllowedPaths: [
    /^campaigns\/segments\/[a-zA-Z0-9_-]+$/,
    /^campaigns\/segments\/preview$/,
  ],
  execute: async (input, ctx) => {
    const segment = await ctx.apiFetch(
      `campaigns/segments/${input.segmentId}`,
      { schema: segmentSchema }
    );

    const preview = await ctx.apiFetch('campaigns/segments/preview', {
      schema: segmentPreviewResponseSchema,
      method: 'POST',
      body: {
        filterJson: segment.filterJson,
        channels: input.channels,
      },
    });

    return {
      data: {
        segmentId: segment.id,
        segmentName: segment.name,
        total: preview.total,
        reachable: preview.reachable,
        perChannel: preview.channels,
      },
    };
  },
});
