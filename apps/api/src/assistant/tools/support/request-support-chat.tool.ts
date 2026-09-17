import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

interface RequestSupportChatResponse {
  uiState: 'support-chat-opened';
  /** The reason Claire passed in (or a default). Echoed back so the UI card
   *  can show the user what was sent to support. */
  reason: string;
  /** Whether a new Intercom conversation was actually created on this call.
   *  False if the Claire conversation was already handed off — the UI still
   *  shows the "Open chat" button so the user can reopen the existing one. */
  created: boolean;
  /** Set when Intercom isn't configured (e.g. local dev without
   *  `INTERCOM_ACCESS_TOKEN`). The UI shows a fallback message. */
  notConfigured?: boolean;
}

/**
 * `POST /assistant/conversations/:id/handoff` — `RequestClaireHandoffResult`.
 *
 * Computed (an Intercom round-trip plus a status flip), so there is no atom to
 * anchor to; hand-modelled from `request-claire-handoff.service.ts`. `reason` is
 * a CODE, not prose — the only value the service emits is
 * `'intercom_not_configured'`, and it is present only when nothing was created.
 */
const handoffResponseSchema = z.object({
  conversationId: z.string(),
  intercomConversationId: z.string().nullable(),
  created: z.boolean(),
  reason: z.string().optional(),
});

/**
 * `support_requestSupportChat` — hand off the conversation to a live agent.
 *
 * Non-destructive from Claire's POV: there's no money or content at stake,
 * and the action is idempotent (re-clicking just reopens the existing
 * Intercom thread). The actual back-and-forth happens inside the Intercom
 * messenger, not the Claire UI — this tool just (a) flips the Claire
 * conversation to `escalated`, (b) seeds a new Intercom conversation with
 * the recent transcript so the agent has context.
 *
 * Claire should call this when:
 *   - the owner asks for a human / says "talk to support" / "this isn't
 *     working" after she has reasonably tried;
 *   - she's hit something that's explicitly outside her scope (legal, tax,
 *     billing disputes, employment, medical advice outside cosmetic
 *     treatments);
 *   - she has tried twice on something and is still stuck.
 *
 * Claire should NOT call this for trivial questions she can answer, and
 * should always tell the owner one short sentence about why she's bringing
 * the team in before calling it.
 */
export const requestSupportChatTool = defineTool<
  { reason: string },
  RequestSupportChatResponse
>({
  feature: 'support',
  action: 'requestSupportChat',
  description:
    'Hand the current conversation off to a live Borradh support agent. ' +
    'Creates a support thread in Intercom seeded with the recent ' +
    'conversation transcript so the agent picks up with context. The ' +
    "owner then continues the chat inside Intercom's messenger — not " +
    "this thread. Use when the owner asks for a human, you've hit " +
    'something outside your scope (legal/tax/billing/employment/medical ' +
    "outside cosmetic treatments), or you've tried twice and are still " +
    'stuck. Pass a one-line `reason` summarising what the owner needs.',
  inputSchema: z.object({
    reason: z
      .string()
      .min(1)
      .max(500)
      .describe(
        'One-line summary of what the owner needs help with. Shown above ' +
          'the transcript to the support agent. Plain language, not a tool ' +
          'name.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Bringing in the team' },
  additionalAllowedPaths: [
    /^assistant\/conversations\/[a-zA-Z0-9_-]+\/handoff$/,
  ],
  execute: async (input, ctx) => {
    const response = await ctx.apiFetch(
      `assistant/conversations/${ctx.conversationId}/handoff`,
      {
        schema: handoffResponseSchema,
        method: 'POST',
        body: { reason: input.reason },
      }
    );

    return {
      presentation: {
        type: 'support_chat' as const,
        reason: input.reason,
        created: response.created,
        notConfigured: response.reason === 'intercom_not_configured',
      },
      data: {
        uiState: 'support-chat-opened',
        reason: input.reason,
        created: response.created,
        notConfigured: response.reason === 'intercom_not_configured',
      },
    };
  },
});
