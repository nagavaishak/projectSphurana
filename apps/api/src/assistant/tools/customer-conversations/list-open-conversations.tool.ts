import { conversationAtomSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const listOpenConversationsInputSchema = z.object({
  platform: z
    .enum(['facebook_messenger', 'instagram_dm', 'whatsapp'])
    .optional()
    .describe('Filter by messaging platform.'),
  status: z
    .enum(['active', 'bot_handling', 'agent_handling'])
    .optional()
    .describe(
      'Filter by status. Default returns the union of "open" statuses ' +
        '(bot_handling + agent_handling + active). Use "agent_handling" to ' +
        'see only conversations the operator has taken over.'
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(20)
    .describe('Page size, capped at 50. Default 20.'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Pagination offset.'),
});

/**
 * The inbox-list row, `.pick()`ed from the `conversation` atom plus the two
 * joined last-message preview fields (computed by a `row_number()` subquery,
 * not columns).
 *
 * NOT `listConversationsResponseSchema`, and that is the finding rather than a
 * shortcut. That contract declares each item as the FULL conversation row, but
 * `listConversations`
 * (`packages/features/src/conversations/services/list-conversations`) uses an
 * explicit `db.select({...})` that omits `whatsappAccountId` and `version` —
 * both REQUIRED by the schema — so parsing against it would throw
 * `ApiResponseContractError` on 100% of calls. The frontend hook parses the
 * same endpoint with the same schema in REPORT mode, which is why the drift was
 * logged rather than fatal, and therefore survived. Fix the select or the
 * projection; do not loosen the contract.
 */
const conversationListItemSchema = conversationAtomSchema
  .pick({
    id: true,
    externalUserId: true,
    externalUserName: true,
    platform: true,
    status: true,
    assignedToId: true,
    lastMessageAt: true,
    createdAt: true,
  })
  .extend({
    lastMessageContent: z.string().nullable(),
    lastMessageRole: z.string().nullable(),
  });

type ConversationListItem = z.infer<typeof conversationListItemSchema>;

const conversationListResponseSchema = z.object({
  items: z.array(conversationListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

interface ListOpenConversationsOutput {
  conversations: ConversationListItem[];
  pageCount: number;
  total: number;
  limit: number;
  offset: number;
}

const OPEN_STATUSES = ['active', 'bot_handling', 'agent_handling'] as const;

/**
 * `customerConversations_listOpenConversations` — list customer conversations
 * the operator may need to look at.
 *
 * Read-only. Backed by `GET /conversations` (the customer-facing inbox feed,
 * NOT Claire-Owner conversations). When no `status` filter is given, the
 * tool runs three parallel calls (one per open status) and merges + sorts
 * by lastMessageAt — the underlying endpoint takes a single status value.
 */
export const listOpenConversationsTool = defineTool<
  z.infer<typeof listOpenConversationsInputSchema>,
  ListOpenConversationsOutput
>({
  feature: 'customer-conversations',
  action: 'listOpenConversations',
  description:
    'List customer conversations the operator may need to look at. ' +
    'Defaults to all "open" statuses (bot_handling + agent_handling + ' +
    'active); pass status to narrow. Optional platform filter. Returns the ' +
    'current page; check `total` for the absolute count under the filter.',
  inputSchema: listOpenConversationsInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing customer conversations' },
  additionalAllowedPaths: [/^conversations$/],
  execute: async (input, ctx) => {
    const buildQuery = (status: string) => {
      const params = new URLSearchParams();
      params.set('status', status);
      params.set('limit', String(input.limit));
      params.set('offset', String(input.offset));
      return params.toString();
    };

    if (input.status) {
      const data = await ctx.apiFetch(
        `conversations?${buildQuery(input.status)}`,
        { schema: conversationListResponseSchema }
      );
      const filtered = input.platform
        ? data.items.filter((c) => c.platform === input.platform)
        : data.items;
      return {
        data: {
          conversations: filtered,
          pageCount: filtered.length,
          total: data.total,
          limit: data.limit,
          offset: data.offset,
        },
      };
    }

    // No explicit status — fan out across the three open statuses, merge,
    // sort by lastMessageAt desc, then slice to the requested page.
    const responses = await Promise.all(
      OPEN_STATUSES.map((status) =>
        ctx.apiFetch(`conversations?${buildQuery(status)}`, {
          schema: conversationListResponseSchema,
        })
      )
    );
    const merged = responses.flatMap((r) => r.items);
    const filtered = input.platform
      ? merged.filter((c) => c.platform === input.platform)
      : merged;
    filtered.sort((a, b) => {
      const at = a.lastMessageAt ?? a.createdAt;
      const bt = b.lastMessageAt ?? b.createdAt;
      return bt.localeCompare(at);
    });
    const sliced = filtered.slice(input.offset, input.offset + input.limit);
    const total = responses.reduce((acc, r) => acc + r.total, 0);

    return {
      data: {
        conversations: sliced,
        pageCount: sliced.length,
        total,
        limit: input.limit,
        offset: input.offset,
      },
    };
  },
});
