import {
  type ConversationResponse,
  conversationMessageAtomSchema,
  conversationSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const summariseConversationInputSchema = z.object({
  conversationId: z
    .string()
    .min(1)
    .describe(
      'Customer conversation ID — must be the exact `id` returned by ' +
        '`customerConversations_listOpenConversations` (a 24-char cuid2 ' +
        'like `aw1ztjcvnkjry95q6lpffj5v`). NEVER invent slug-style IDs ' +
        '(e.g. `daniel-cerasi-whatsapp`) or pass a customer name.'
    ),
  messageLimit: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(20)
    .describe(
      'Cap on messages pulled into the summary. Long threads get ' +
        'truncated to the most recent N (default 20).'
    ),
});

/**
 * `GET /conversations/:id/messages` — `.pick()`ed to the five fields read below.
 *
 * NOT `listMessagesResponseSchema`: that contract declares `{ items, limit,
 * offset }` while `listMessages` returns `ok({ items, total })`. It would both
 * reject every real response AND strip the `total` this tool needs. Reported —
 * fix the contract or the service, never loosen it.
 *
 * Note `total` is `messages.length` (the page size), not the thread total — see
 * `listMessages`, which returns `ok({ items: messages, total: messages.length })`.
 * `truncated` below can therefore never be true; left as-is because correcting
 * it is a service change, not a contract one.
 */
const messageEntrySchema = conversationMessageAtomSchema.pick({
  role: true,
  content: true,
  createdAt: true,
  sentAt: true,
});

type MessageEntry = z.infer<typeof messageEntrySchema>;

const messageListResponseSchema = z.object({
  items: z.array(messageEntrySchema),
  total: z.number(),
});

interface SummariseConversationOutput {
  conversation: ConversationResponse;
  messageCount: number;
  truncated: boolean;
  totalMessages: number;
  /**
   * True when every returned message is older than 7 days. Surface this to
   * the operator ("thread is dormant — last activity was X days ago")
   * rather than treating the thread as empty.
   */
  allMessagesOlderThanSevenDays: boolean;
  messages: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  /**
   * Whether a disclosure system message exists in the thread (per
   * shared-spec D2a — Claire-Lead must disclose AI on first contact).
   * Surfaced so the operator can verify when relevant. Only set when
   * confirmed; never fabricated.
   */
  aiDisclosureFound: boolean;
  /**
   * Structured sentiment derived from customer (non-operator, non-system)
   * messages in the thread.
   *   -1 = negative (complaint, frustration, cancellation intent)
   *    0 = neutral / indeterminate
   *    1 = positive (satisfaction, gratitude, enthusiasm)
   * Computed via keyword heuristics — not an LLM call. Surface to the
   * operator as a quick triage signal, not a definitive diagnosis.
   */
  sentimentScore: -1 | 0 | 1;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const NEGATIVE_TERMS =
  /\b(cancel|cancellation|refund|complaint|unhappy|disappointed|frustrated|angry|terrible|awful|worst|rude|disgusting|unacceptable|waste|useless|horrible|scam|fraud|never again|demand|escalate|lawyer|chargeback|dispute)\b/i;
const POSITIVE_TERMS =
  /\b(thank|thanks|grateful|appreciate|excellent|amazing|fantastic|wonderful|great|love|perfect|happy|pleased|satisfied|recommend|brilliant|awesome|outstanding|impressive|delighted)\b/i;

function computeSentimentScore(messages: MessageEntry[]): -1 | 0 | 1 {
  // `user` is the ONLY customer-side role — `message_role` is
  // bot | user | agent | system. The `|| m.role === 'customer'` this replaces
  // could never match; the asserted `role: string` hid that from `tsc`.
  const customerText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');

  if (!customerText.trim()) return 0;

  const negativeHits = (customerText.match(NEGATIVE_TERMS) ?? []).length;
  const positiveHits = (customerText.match(POSITIVE_TERMS) ?? []).length;

  if (negativeHits > positiveHits) return -1;
  if (positiveHits > negativeHits) return 1;
  return 0;
}

/**
 * `customerConversations_summariseConversation` — pull a single thread's
 * recent activity for the operator.
 *
 * Read-only. Truncates to either the last `messageLimit` messages OR the
 * messages from the last 7 days, whichever is shorter. Long threads can
 * have thousands of messages; never dumps everything into the model.
 *
 * The disclosure check (`aiDisclosureFound`) scans for system messages
 * matching Claire-Lead's first-contact disclosure pattern. Surfaces a
 * confirmable signal; the operator decides what to do with it.
 */
export const summariseConversationTool = defineTool<
  z.infer<typeof summariseConversationInputSchema>,
  SummariseConversationOutput
>({
  feature: 'customer-conversations',
  action: 'summariseConversation',
  description:
    'Pull a customer conversation thread (last N messages, capped by ' +
    '`messageLimit`) so you can summarise it for the operator. Returns the ' +
    'conversation row plus the message list. NEVER dumps the whole thread. ' +
    'When `allMessagesOlderThanSevenDays` is true, surface that to the ' +
    'operator ("the thread is dormant, last activity was X days ago") — ' +
    "don't claim the messages are missing or out of sync. " +
    'Returns `sentimentScore` (-1 negative, 0 neutral, 1 positive) derived ' +
    'from customer messages — use as a triage signal, not a diagnosis. ' +
    'PREREQUISITE: Call `customerConversations_listOpenConversations` first ' +
    "and pass one of its returned `id` values as `conversationId`. Don't " +
    'invent IDs from customer names or platform slugs.',
  inputSchema: summariseConversationInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Reading conversation' },
  additionalAllowedPaths: [
    /^conversations\/[a-zA-Z0-9_-]+$/,
    /^conversations\/[a-zA-Z0-9_-]+\/messages$/,
  ],
  execute: async (input, ctx) => {
    const [conversation, messagesResponse] = await Promise.all([
      ctx.apiFetch(`conversations/${input.conversationId}`, {
        schema: conversationSchema,
      }),
      ctx.apiFetch(
        `conversations/${input.conversationId}/messages?limit=${input.messageLimit}`,
        { schema: messageListResponseSchema }
      ),
    ]);

    // Surface whether the thread is dormant rather than silently dropping
    // older messages. A short conversation (2–3 messages) older than a week
    // would otherwise return `messageCount: 0` and the model would assume
    // the thread is empty / not synced — exactly the failure mode we hit
    // when summarising a stale WhatsApp lead.
    const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
    const allMessagesOlderThanSevenDays =
      messagesResponse.items.length > 0 &&
      messagesResponse.items.every((m) => {
        const t = m.sentAt ?? m.createdAt;
        return new Date(t).getTime() < sevenDaysAgo;
      });

    const truncated = messagesResponse.items.length < messagesResponse.total;
    const aiDisclosureFound = messagesResponse.items.some(
      (m) =>
        m.role === 'system' &&
        /(?:I'?m an AI|automated|bot|virtual assistant)/i.test(m.content)
    );
    const sentimentScore = computeSentimentScore(messagesResponse.items);

    return {
      data: {
        conversation,
        messageCount: messagesResponse.items.length,
        truncated,
        totalMessages: messagesResponse.total,
        allMessagesOlderThanSevenDays,
        messages: messagesResponse.items.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.sentAt ?? m.createdAt,
        })),
        aiDisclosureFound,
        sentimentScore,
      },
    };
  },
});
