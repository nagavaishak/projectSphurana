import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const summariseConversationsThisWeekInputSchema = z.object({
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      'ISO datetime for the start of the window. Defaults to 7 days ago.'
    ),
  until: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('ISO datetime for the end of the window. Defaults to now.'),
});

/**
 * `GET /conversations/summary/this-week` — `SummariseConversationsThisWeekOutput`.
 *
 * Pure SQL aggregation with no backing row, so there is no atom to anchor to and
 * no projection in `packages/contracts/src/responses/`; hand-modelled from
 * `summarise-this-week.service.ts`.
 *
 * `responseTime` is `number`, NOT `number | null` as the interface this replaces
 * claimed: both percentiles are `COALESCE(..., 0)::bigint::int`, and the service
 * documents zeros-over-nulls as deliberate ("cleaner for the model to format").
 * `topIntents` is always empty until intent tagging lands on
 * `conversation_message` — never fabricated.
 */
const summariseConversationsThisWeekResponseSchema = z.object({
  timeframe: z.object({ since: z.string(), until: z.string() }),
  counts: z.object({
    totalThreads: z.number(),
    openThreads: z.number(),
    escalatedThreads: z.number(),
    closedThreads: z.number(),
  }),
  byChannel: z.object({
    whatsapp: z.number(),
    facebook_messenger: z.number(),
    instagram_dm: z.number(),
  }),
  topIntents: z.array(z.object({ intent: z.string(), count: z.number() })),
  responseTime: z.object({ p50Ms: z.number(), p95Ms: z.number() }),
  oldestPending: z
    .object({
      conversationId: z.string(),
      customerName: z.string().nullable(),
      hoursPending: z.number(),
    })
    .nullable(),
});

type SummariseConversationsThisWeekOutput = z.infer<
  typeof summariseConversationsThisWeekResponseSchema
>;

/**
 * `customerConversations_summariseConversationsThisWeek` — weekly digest of
 * customer conversation activity.
 *
 * Wraps the W-C09-services aggregation behind a thin HTTP endpoint
 * (`GET /conversations/summary/this-week`). Returns structured rollup data
 * — counts, by-channel breakdown, response-time percentiles, the oldest
 * still-pending thread. The model formats the prose; the service does not.
 *
 * `topIntents` ships empty until intent tagging lands on conversation_message
 * (C-13 territory) — never fabricated.
 */
export const summariseConversationsThisWeekTool = defineTool<
  z.infer<typeof summariseConversationsThisWeekInputSchema>,
  SummariseConversationsThisWeekOutput
>({
  feature: 'customer-conversations',
  action: 'summariseConversationsThisWeek',
  description:
    'Weekly digest of customer conversations: total/open/escalated/closed ' +
    'counts, channel breakdown, response-time percentiles, and the oldest ' +
    'still-pending thread. Defaults to the trailing 7 days; pass since/until ' +
    'for a custom window. Returns structured data — you write the prose.',
  inputSchema: summariseConversationsThisWeekInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Aggregating customer conversations' },
  additionalAllowedPaths: [/^conversations\/summary\/this-week$/],
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    if (input.since) params.set('since', input.since);
    if (input.until) params.set('until', input.until);
    const qs = params.toString();
    const data = await ctx.apiFetch(
      `conversations/summary/this-week${qs ? `?${qs}` : ''}`,
      { schema: summariseConversationsThisWeekResponseSchema }
    );
    return { data };
  },
});
