import {
  type ConversationResponse,
  conversationSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import { confirmationCard } from '../_shared/confirmation-card.js';

const ESCALATION_REASONS = [
  'ai_handoff',
  'needs_follow_up',
  'inappropriate_content',
  'user_requested_human',
  'agent_takeover',
  'manual',
] as const;
type EscalationReason = (typeof ESCALATION_REASONS)[number];

// ---------------------------------------------------------------------------
// confirmEscalateToHuman — first half of the destructive flow
// ---------------------------------------------------------------------------

interface ConfirmEscalateInput {
  conversationId: string;
  reason: EscalationReason;
  reasonDetail?: string;
}

interface ConfirmEscalateOutput {
  confirmationToken?: string;
  conversationId: string;
  expiresAt?: string;
  customerName?: string | null;
  platform?: string;
  reason?: EscalationReason;
  reasonDetail?: string;
  /** Already-escalated conversations are surfaced as a no-op (no token). */
  alreadyEscalated?: boolean;
  error?: string;
}

/**
 * `customerConversations_confirmEscalateToHuman` — propose escalating a
 * customer conversation to the Borradh team.
 *
 * Confirm half of the destructive two-tool flow (mirrors W-C05 D-1 / W-C10
 * D-1 — frontend `addToolOutput({ output: 'approved' | 'rejected' })`
 * pattern requires the split). DB-backed token bound to action +
 * resourceId + payload via `ctx.createConfirmation`.
 *
 * Idempotent at the conversation level: if the conversation is already
 * `agent_handling`, returns `alreadyEscalated: true` without issuing a
 * token. The model surfaces that to the operator instead of asking for an
 * approval that would no-op.
 */
export const confirmEscalateToHumanTool = defineTool<
  ConfirmEscalateInput,
  ConfirmEscalateOutput
>({
  feature: 'customer-conversations',
  action: 'confirmEscalateToHuman',
  description:
    'Ask the user to confirm escalating a customer conversation to the ' +
    'Borradh team. Returns a confirmationToken + a summary of the thread ' +
    '(customer name, platform, last message time). Pass the token back to ' +
    'executeEscalateToHuman to perform the escalation. If the thread is ' +
    'already agent_handling, no token is issued — surface that.',
  inputSchema: z.object({
    conversationId: z.string().min(1).describe('Conversation to escalate.'),
    reason: z
      .enum(ESCALATION_REASONS)
      .describe(
        'Why we are escalating. Use "user_requested_human" when the ' +
          'customer asked, "needs_follow_up" for stuck threads, ' +
          '"agent_takeover" when the operator chose to take it, or ' +
          '"manual" when none of those fit.'
      ),
    reasonDetail: z
      .string()
      .max(500)
      .optional()
      .describe('Plain-text note for the audit log (optional).'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Preparing escalation confirmation',
    confirmationRenderer: 'customer-conversation-confirm:escalate',
  },
  additionalAllowedPaths: [/^conversations\/[a-zA-Z0-9_-]+$/],
  execute: async (input, ctx) => {
    let conversation: ConversationResponse;
    try {
      conversation = await ctx.apiFetch(
        `conversations/${input.conversationId}`,
        { schema: conversationSchema }
      );
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue(
          'Conversation lookup failed before escalation confirmation',
          { error }
        );
      }
      return {
        data: {
          conversationId: input.conversationId,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to load conversation.',
        },
      };
    }

    if (conversation.status === 'agent_handling') {
      return {
        data: {
          conversationId: input.conversationId,
          customerName: conversation.externalUserName,
          platform: conversation.platform,
          alreadyEscalated: true,
        },
      };
    }

    try {
      const token = await ctx.createConfirmation({
        action: 'escalate_conversation',
        resourceId: input.conversationId,
        payload: {
          reason: input.reason,
          reasonDetail: input.reasonDetail,
        },
      });
      return {
        presentation: confirmationCard({
          action: 'escalate_conversation',
          resourceId: input.conversationId,
          token: token.id,
          expiresAt: token.expiresAt,
          title: `Hand ${conversation.externalUserName ?? 'this conversation'} to a person?`,
          fields: [
            { label: 'Reason', value: input.reasonDetail ?? input.reason },
            {
              label: 'Effect',
              value: 'The bot stops replying until someone picks it up.',
            },
          ],
          executeToolName: 'customer_conversations_executeEscalateToHuman',
          confirmLabel: 'Hand over',
        }),
        data: {
          confirmationToken: token.id,
          conversationId: input.conversationId,
          expiresAt: token.expiresAt.toISOString(),
          customerName: conversation.externalUserName,
          platform: conversation.platform,
          reason: input.reason,
          reasonDetail: input.reasonDetail,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue(
          'Failed to issue escalate-to-human confirmation token',
          {
            error,
          }
        );
      }
      return {
        data: {
          conversationId: input.conversationId,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to issue confirmation.',
        },
      };
    }
  },
});

// ---------------------------------------------------------------------------
// executeEscalateToHuman — second half
// ---------------------------------------------------------------------------

interface ExecuteEscalateInput {
  conversationId: string;
  confirmationToken: string;
  reason: EscalationReason;
  reasonDetail?: string;
}

/**
 * `POST /conversations/:id/escalate` — `{ escalated }`.
 *
 * A one-field acknowledgement with no backing table, so there is nothing to
 * anchor to; hand-modelled from `escalateConversation`, whose only success
 * return is `ok({ escalated: true })`.
 */
const escalateResponseSchema = z.object({
  escalated: z.boolean(),
});

interface ExecuteEscalateOutput {
  conversationId?: string;
  escalated?: boolean;
  message?: string;
  error?: string;
}

/**
 * `customerConversations_executeEscalateToHuman` — perform the escalation
 * after the operator has approved via `confirmEscalateToHuman`.
 *
 * Verifies the token + action + resourceId, then POSTs to the customer
 * conversation escalate endpoint. On success returns a banner the model
 * surfaces; on token failure returns `confirmation_expired` so the model
 * re-runs the confirm step.
 */
export const executeEscalateToHumanTool = defineTool<
  ExecuteEscalateInput,
  ExecuteEscalateOutput
>({
  feature: 'customer-conversations',
  action: 'executeEscalateToHuman',
  description:
    'Escalate a customer conversation to the Borradh team after the user ' +
    'has approved via confirmEscalateToHuman. Requires the confirmationToken.',
  inputSchema: z.object({
    conversationId: z.string().min(1),
    confirmationToken: z
      .string()
      .min(1)
      .describe('Token from confirmEscalateToHuman.'),
    reason: z.enum(ESCALATION_REASONS),
    reasonDetail: z.string().max(500).optional(),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Escalating to team' },
  additionalAllowedPaths: [/^conversations\/[a-zA-Z0-9_-]+\/escalate$/],
  execute: async (input, ctx) => {
    const verification = await ctx.verifyConfirmation({
      token: input.confirmationToken,
      action: 'escalate_conversation',
      resourceId: input.conversationId,
    });
    if (!verification.valid) {
      return {
        data: {
          conversationId: input.conversationId,
          error: `Confirmation is no longer valid (${verification.reason}). Please re-run confirmEscalateToHuman.`,
        },
        presentation: {
          type: 'confirmation_expired',
          reason: verification.reason,
        },
      };
    }

    try {
      const data = await ctx.apiFetch(
        `conversations/${input.conversationId}/escalate`,
        {
          schema: escalateResponseSchema,
          method: 'POST',
          body: {
            reason: input.reason,
            reasonDetail: input.reasonDetail,
          },
        }
      );
      return {
        data: {
          conversationId: input.conversationId,
          escalated: data.escalated,
          message: data.escalated
            ? 'This conversation has been passed to the Borradh team.'
            : 'This conversation was already with the team.',
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Conversation escalation API call failed', { error });
      }
      return {
        data: {
          conversationId: input.conversationId,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to escalate conversation.',
        },
      };
    }
  },
});
