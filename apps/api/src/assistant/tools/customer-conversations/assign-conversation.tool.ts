import {
  type ConversationResponse,
  conversationSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import { confirmationCard } from '../_shared/confirmation-card.js';

// ---------------------------------------------------------------------------
// confirmAssignConversation — first half
// ---------------------------------------------------------------------------

interface ConfirmAssignInput {
  conversationId: string;
  assignToUserId: string;
}

interface ConfirmAssignOutput {
  confirmationToken?: string;
  conversationId: string;
  assignToUserId?: string;
  expiresAt?: string;
  customerName?: string | null;
  platform?: string;
  assignToUserName?: string | null;
  /** No-op when the conversation is already assigned to the same user. */
  alreadyAssigned?: boolean;
  error?: string;
}

/**
 * `customerConversations_confirmAssignConversation` — propose assigning a
 * customer conversation to a specific teammate.
 *
 * Confirm half of the destructive two-tool flow (mirrors W-C05 D-1). The
 * teammate lookup uses the existing `/conversations/:id/assign` endpoint
 * downstream — we don't enrich the user lookup here because the tool
 * doesn't have a `/users/:id` whitelist; the operator's UI shows the
 * userId, and the conversation summary surfaces the existing
 * `assignedToId` for context.
 */
export const confirmAssignConversationTool = defineTool<
  ConfirmAssignInput,
  ConfirmAssignOutput
>({
  feature: 'customer-conversations',
  action: 'confirmAssignConversation',
  description:
    'Ask the user to confirm assigning a customer conversation to a ' +
    'teammate. Returns a confirmationToken + a summary (customer name, ' +
    'platform, target userId). Pass the token back to ' +
    'executeAssignConversation. If the conversation is already assigned ' +
    'to the same user, no token is issued — surface that.',
  inputSchema: z.object({
    conversationId: z.string().min(1),
    assignToUserId: z
      .string()
      .min(1)
      .describe('User ID of the teammate to assign the conversation to.'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Preparing assignment confirmation',
    confirmationRenderer: 'customer-conversation-confirm:assign',
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
          'Conversation lookup failed before assignment confirmation',
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

    if (conversation.assignedToId === input.assignToUserId) {
      return {
        data: {
          conversationId: input.conversationId,
          customerName: conversation.externalUserName,
          platform: conversation.platform,
          alreadyAssigned: true,
        },
      };
    }

    try {
      const token = await ctx.createConfirmation({
        action: 'assign_conversation',
        resourceId: input.conversationId,
        payload: { assignToUserId: input.assignToUserId },
      });
      return {
        presentation: confirmationCard({
          action: 'assign_conversation',
          resourceId: input.conversationId,
          token: token.id,
          expiresAt: token.expiresAt,
          title: `Assign ${conversation.externalUserName ?? 'this conversation'}?`,
          fields: [
            { label: 'Assign to', value: input.assignToUserId },
            ...(conversation.platform
              ? [{ label: 'Platform', value: conversation.platform }]
              : []),
          ],
          executeToolName: 'customer_conversations_executeAssignConversation',
          confirmLabel: 'Assign',
        }),
        data: {
          confirmationToken: token.id,
          conversationId: input.conversationId,
          assignToUserId: input.assignToUserId,
          expiresAt: token.expiresAt.toISOString(),
          customerName: conversation.externalUserName,
          platform: conversation.platform,
          assignToUserName: null,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue(
          'Failed to issue assign-conversation confirmation token',
          { error }
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
// executeAssignConversation — second half
// ---------------------------------------------------------------------------

interface ExecuteAssignInput {
  conversationId: string;
  assignToUserId: string;
  confirmationToken: string;
}

interface ExecuteAssignOutput {
  conversationId?: string;
  assignedToId?: string | null;
  message?: string;
  error?: string;
}

/**
 * `customerConversations_executeAssignConversation` — perform the assignment
 * after the operator approves.
 */
export const executeAssignConversationTool = defineTool<
  ExecuteAssignInput,
  ExecuteAssignOutput
>({
  feature: 'customer-conversations',
  action: 'executeAssignConversation',
  description:
    'Assign a customer conversation to a teammate after the user has ' +
    'approved via confirmAssignConversation. Requires the confirmationToken.',
  inputSchema: z.object({
    conversationId: z.string().min(1),
    assignToUserId: z.string().min(1),
    confirmationToken: z.string().min(1),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Assigning conversation' },
  additionalAllowedPaths: [/^conversations\/[a-zA-Z0-9_-]+\/assign$/],
  execute: async (input, ctx) => {
    const verification = await ctx.verifyConfirmation({
      token: input.confirmationToken,
      action: 'assign_conversation',
      resourceId: input.conversationId,
    });
    if (!verification.valid) {
      return {
        data: {
          conversationId: input.conversationId,
          error: `Confirmation is no longer valid (${verification.reason}). Please re-run confirmAssignConversation.`,
        },
        presentation: {
          type: 'confirmation_expired',
          reason: verification.reason,
        },
      };
    }

    try {
      // The endpoint returns the updated conversation row verbatim.
      const data = await ctx.apiFetch(
        `conversations/${input.conversationId}/assign`,
        {
          method: 'POST',
          body: { assignToUserId: input.assignToUserId },
          schema: conversationSchema,
        }
      );
      return {
        data: {
          conversationId: input.conversationId,
          assignedToId: data.assignedToId ?? input.assignToUserId,
          message: 'Conversation assigned.',
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Conversation assignment API call failed', { error });
      }
      return {
        data: {
          conversationId: input.conversationId,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to assign conversation.',
        },
      };
    }
  },
});
