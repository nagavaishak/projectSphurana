import { type Anthropic, createAnthropicClient } from '@borradh-workspace/ai';
import {
  assistantContextResponseSchema,
  conversationMessageAtomSchema,
  conversationSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const draftReplyInputSchema = z.object({
  conversationId: z
    .string()
    .min(1)
    .describe('Customer conversation ID to draft a reply for.'),
  intent: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'What the operator wants the reply to do — e.g. "confirm Tuesday at ' +
        '10am", "explain why we don\'t do Botox here", "ask for their phone ' +
        'number". Drives the draft\'s shape.'
    ),
  contextNotes: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'Optional extra context the operator wants Claire to consider (e.g. ' +
        '"this customer was unhappy last visit"). Plain text.'
    ),
  messageLimit: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(10)
    .describe('How many recent messages to include as context. Default 10.'),
});

/**
 * `GET /conversations/:id/messages` — narrowed to the two fields the transcript
 * below reads.
 *
 * NOT `listMessagesResponseSchema`: that contract declares `{ items, limit,
 * offset }`, and `listMessages`
 * (`packages/features/src/conversations/services/list-messages`) returns
 * `ok({ items, total })`. The endpoint has no `limit`/`offset` at all, so the
 * declared schema rejects every real response. Reported — fix the contract or
 * the service, do not loosen it.
 */
const messageListResponseSchema = z.object({
  items: z.array(
    conversationMessageAtomSchema.pick({ role: true, content: true })
  ),
});

interface DraftReplyOutput {
  conversationId: string;
  draft: string;
  customerName: string | null;
  platform: string;
  /** Human label for the renderer's "Send" button when wired. */
  suggestedSendAction: 'send_message';
}

interface DraftReplyHardBlockOutput {
  conversationId: string;
  draft: string;
  hardBlock: { code: string; message: string };
}

/** Hard blocks that must never appear in a customer-facing draft reply. */
const DRAFT_REPLY_HARD_BLOCKS = [
  'noSurgicalPricingInChat',
  'noFabricatedResultClaims',
  'noPomBrandNamesInAdCopy',
] as const;

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_MAX_TOKENS = 800;

/**
 * `customerConversations_draftReply` — draft a reply the operator can send.
 *
 * Read-only at the data layer (no DB writes; the operator sends from the
 * inbox UI). NEVER auto-sends. The flow:
 *
 *   1. Pull conversation + recent messages via apiFetch.
 *   2. Pull org context (brand voice, businessType) for tone calibration.
 *   3. Call Anthropic with a "draft a reply" prompt — Sonnet 4.6 (quality
 *      matters; not Haiku).
 *   4. Run the three customer-facing hard-blocks against the generated
 *      draft. If any fires, surface the violation; the model retries.
 *   5. Return `presentation: { type: 'draft_reply', conversationId, draft,
 *      suggestedSendAction }` so the rich-content renderer can wire
 *      Send / Edit / Discard buttons. The operator clicks Send; the
 *      backend uses the existing `POST /conversations/:id/messages`
 *      endpoint (NOT this tool).
 */
export const draftReplyTool = defineTool<
  z.infer<typeof draftReplyInputSchema>,
  DraftReplyOutput | DraftReplyHardBlockOutput
>({
  feature: 'customer-conversations',
  action: 'draftReply',
  description:
    'Generate a SUGGESTED reply for the operator to review and send from ' +
    'the inbox UI. NEVER sends the message itself. Reads the recent ' +
    'conversation context + brand voice, drafts a reply, validates it ' +
    'against the hard-blocks (no surgical pricing in chat, no fabricated ' +
    'result claims, no POM brand names), and returns the draft. The ' +
    'operator sends — Claire never auto-sends customer messages.',
  inputSchema: draftReplyInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Drafting reply' },
  additionalAllowedPaths: [
    /^conversations\/[a-zA-Z0-9_-]+$/,
    /^conversations\/[a-zA-Z0-9_-]+\/messages$/,
    /^assistant\/context$/,
  ],
  execute: async (input, ctx) => {
    const [conversation, messagesResponse, assistantContext] =
      await Promise.all([
        ctx.apiFetch(`conversations/${input.conversationId}`, {
          schema: conversationSchema,
        }),
        ctx.apiFetch(
          `conversations/${input.conversationId}/messages?limit=${input.messageLimit}`,
          { schema: messageListResponseSchema }
        ),
        ctx
          .apiFetch('assistant/context', {
            schema: assistantContextResponseSchema,
          })
          .catch(() => null),
      ]);

    // Most recent first → reverse to chronological for the prompt.
    const transcript = [...messagesResponse.items]
      .reverse()
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    // `GET /assistant/context` returns `brandVoice` as a string ARRAY, and has
    // no `brandKit` and no `toneRegion` — all three were asserted here and none
    // exist. The array is the live defect: `[]` is TRUTHY, so the old
    // `?? null` fallback could never fire and an org with no brand voice got
    // `Brand voice: .` in the system prompt instead of the intended default.
    const brandVoice = assistantContext?.brandVoice.join(', ') || null;
    const businessType = assistantContext?.businessType ?? 'unknown';
    const toneRegion = 'ie';

    const systemPrompt = [
      'You are drafting a reply for the operator to review and send to a ' +
        'customer. The operator is the one sending — you are not.',
      `Customer is on platform: ${conversation.platform}.`,
      `Business type: ${businessType}. Tone region: ${toneRegion}.`,
      brandVoice
        ? `Brand voice: ${brandVoice}.`
        : 'Brand voice: warm, professional, plain English.',
      'Hard rules for the draft:',
      '- Never quote prices for surgical procedures in a customer chat.',
      '- Never make outcome guarantees or fabricated results claims.',
      '- Never name a prescription-only medication by brand. Category terms ' +
        'are fine.',
      '- No exclamation marks. Conversational, not formal. Plain text only.',
      'Respond with ONLY the draft text — no preamble, no quotes, no labels.',
    ].join('\n');

    const userPrompt = [
      `Operator's intent for this reply: ${input.intent}`,
      input.contextNotes ? `Operator's notes: ${input.contextNotes}` : '',
      `Customer name: ${conversation.externalUserName ?? '(unknown)'}`,
      'Recent thread (oldest first):',
      transcript || '(no prior messages)',
      'Draft a reply now.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const anthropic = createAnthropicClient();
    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const draft = response.content
      .filter(
        (block: Anthropic.ContentBlock): block is Anthropic.TextBlock =>
          block.type === 'text'
      )
      .map((block: Anthropic.TextBlock) => block.text)
      .join('')
      .trim();

    // Defense in depth — run customer-facing hard-blocks against the draft.
    const hbResult = await ctx.runHardBlocks(
      DRAFT_REPLY_HARD_BLOCKS,
      { draft, conversationId: input.conversationId },
      ctx
    );
    if (!hbResult.pass) {
      return {
        data: {
          conversationId: input.conversationId,
          draft,
          hardBlock: { code: hbResult.code, message: hbResult.message },
        },
        presentation: {
          type: 'hard_block_violation',
          code: hbResult.code,
          message: hbResult.message,
        },
      };
    }

    return {
      data: {
        conversationId: input.conversationId,
        draft,
        customerName: conversation.externalUserName,
        platform: conversation.platform,
        suggestedSendAction: 'send_message' as const,
      },
      presentation: {
        type: 'draft_reply',
        conversationId: input.conversationId,
        draft,
        customerName: conversation.externalUserName,
        platform: conversation.platform,
        suggestedSendAction: 'send_message',
      },
    };
  },
});
