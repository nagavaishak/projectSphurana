import { conversationSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const sendReplyInputSchema = z.object({
  conversationId: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, 'Invalid ID format')
    .describe(
      'Customer conversation ID — must be the exact `id` returned by ' +
        '`customerConversations_listOpenConversations`. NEVER invent IDs.'
    ),
  messageText: z
    .string()
    .min(1)
    .max(2000)
    .describe('The message text to send to the customer. Plain text only.'),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface SendReplyOutput {
  conversationId: string;
  messageSent: string;
  customerName: string | null;
  platform: string;
}

/** Hard blocks applied to the outgoing message before operator confirmation. */
const SEND_REPLY_HARD_BLOCKS = [
  'noSurgicalPricingInChat',
  'noFabricatedResultClaims',
  'noPomBrandNamesInAdCopy',
] as const;

/**
 * `customerConversations_sendReply` — send a message to a customer.
 *
 * Destructive (writes to DB and delivers via Meta/WhatsApp API). Uses the
 * factory two-call confirmation flow so the operator always reviews what will
 * be sent before delivery. Hard-blocks run against `messageText` before the
 * confirmation is issued — if any fire, the send is blocked entirely.
 *
 * Typical flow:
 *   1. Operator (or model) calls `draftReply` → gets a suggested draft.
 *   2. Operator reviews the draft and instructs Claire to send it.
 *   3. Model calls `sendReply` with the final text → confirmation required.
 *   4. Operator confirms → model calls `sendReply` again with token → sent.
 */
export const sendReplyTool = defineTool<
  z.infer<typeof sendReplyInputSchema>,
  SendReplyOutput
>({
  feature: 'customer-conversations',
  action: 'sendReply',
  description:
    'Send a message to a customer in an existing conversation. ' +
    'Requires operator confirmation. Hard-blocked against surgical pricing, ' +
    'fabricated result claims, and POM brand names. ' +
    'Use `draftReply` to generate a suggested message first, then call this ' +
    'tool with the final approved text. ' +
    'NEVER call this without the operator explicitly directing a send.',
  inputSchema: sendReplyInputSchema,
  destructive: true,
  destructiveAction: 'send_reply',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Sending reply' },
  additionalAllowedPaths: [
    /^conversations\/[a-zA-Z0-9_-]+$/,
    /^conversations\/[a-zA-Z0-9_-]+\/messages$/,
  ],
  summarizeForConfirmation: async (input, ctx) => {
    const hbResult = await ctx.runHardBlocks(
      SEND_REPLY_HARD_BLOCKS,
      { draft: input.messageText, conversationId: input.conversationId },
      ctx
    );
    if (!hbResult.pass) {
      throw new Error(`Hard block: ${hbResult.code} — ${hbResult.message}`);
    }

    const conversation = await ctx.apiFetch(
      `conversations/${input.conversationId}`,
      { schema: conversationSchema }
    );
    const recipientLabel = conversation.externalUserName
      ? `${conversation.externalUserName} (${conversation.platform})`
      : `customer on ${conversation.platform}`;

    return {
      title: `Send message to ${recipientLabel}`,
      fields: [
        { label: 'Recipient', value: recipientLabel },
        {
          label: 'Message',
          value:
            input.messageText.length > 200
              ? `${input.messageText.slice(0, 200)}…`
              : input.messageText,
        },
      ],
      resourceId: input.conversationId,
      payload: {
        conversationId: input.conversationId,
        messageText: input.messageText,
      },
    };
  },
  execute: async (input, ctx) => {
    const conversation = await ctx.apiFetch(
      `conversations/${input.conversationId}`,
      { schema: conversationSchema }
    );

    await ctx.apiFetch(`conversations/${input.conversationId}/messages`, {
      method: 'POST',
      body: {
        content: input.messageText,
        role: 'operator',
        origin: 'claire',
      },
    });

    return {
      data: {
        conversationId: input.conversationId,
        messageSent: input.messageText,
        customerName: conversation.externalUserName,
        platform: conversation.platform,
      },
    };
  },
});
