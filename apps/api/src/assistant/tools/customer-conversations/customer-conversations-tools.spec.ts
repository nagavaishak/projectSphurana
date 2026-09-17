// Mock the heavy transitive chain before importing tool-factory. Same
// precedent as leads-tools.spec.ts / offers-tools.spec.ts / W-C02-D's
// hard-blocks.spec.ts — features/database barrels pull cuid2 + t3-env
// (ESM-only) which swc-jest doesn't transform.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));

jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: {},
}));

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  trackedResult: <T>(_name: string, fn: () => Promise<T>) => fn(),
}));

// Intercept the Anthropic client call inside `draftReply` so the test
// doesn't reach for a network. The shape mirrors @anthropic-ai/sdk's
// `messages.create` response — the tool only reads `content[].text`.
const mockMessagesCreate = jest.fn();
jest.mock('@borradh-workspace/ai', () => ({
  createAnthropicClient: () => ({
    messages: { create: mockMessagesCreate },
  }),
}));

import { logError, logWarning } from '@borradh-workspace/observability';
import { ApiFetchError } from '../../tool-factory/index.js';
import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import {
  confirmAssignConversationTool,
  executeAssignConversationTool,
} from './assign-conversation.tool.js';
import { draftReplyTool } from './draft-reply.tool.js';
import {
  confirmEscalateToHumanTool,
  executeEscalateToHumanTool,
} from './escalate-to-human.tool.js';
import { customerConversationsTools } from './index.js';
import { listOpenConversationsTool } from './list-open-conversations.tool.js';
import { summariseConversationTool } from './summarise-conversation.tool.js';
import { summariseConversationsThisWeekTool } from './summarise-conversations-this-week.tool.js';

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
  runHardBlocks?: AssistantToolsContext['runHardBlocks'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-system-1',
    apiFetch,
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks:
      overrides.runHardBlocks ??
      (jest.fn(async () => ({ pass: true })) as never),
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
  };
}

describe('customer-conversations tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMessagesCreate.mockReset();
  });

  describe('aggregator', () => {
    it('exports 9 factory-shaped tools', () => {
      expect(customerConversationsTools).toHaveLength(9);
      const names = customerConversationsTools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'customer_conversations_listOpenConversations',
          'customer_conversations_summariseConversation',
          'customer_conversations_summariseConversationsThisWeek',
          'customer_conversations_draftReply',
          'customer_conversations_sendReply',
          'customer_conversations_confirmEscalateToHuman',
          'customer_conversations_executeEscalateToHuman',
          'customer_conversations_confirmAssignConversation',
          'customer_conversations_executeAssignConversation',
        ])
      );
    });

    it('only sendReply is destructive (other tools follow manual confirmation flow per W-C05 D-1)', () => {
      for (const tool of customerConversationsTools) {
        const expected = tool.name === 'customer_conversations_sendReply';
        expect(tool.destructive).toBe(expected);
      }
    });
  });

  describe('listOpenConversations', () => {
    it('uses the factory feature/action prefix in the tool name', () => {
      expect(listOpenConversationsTool.name).toBe(
        'customer_conversations_listOpenConversations'
      );
      expect(listOpenConversationsTool.feature).toBe('customer-conversations');
      expect(listOpenConversationsTool.action).toBe('listOpenConversations');
    });

    it('with explicit status: single fetch, applies platform filter client-side', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'c1',
            externalUserId: 'u1',
            externalUserName: 'Sarah',
            platform: 'whatsapp',
            status: 'agent_handling',
            assignedToId: null,
            lastMessageContent: 'hi',
            lastMessageRole: 'user',
            lastMessageAt: '2026-04-25T09:00:00.000Z',
            createdAt: '2026-04-25T09:00:00.000Z',
          },
          {
            id: 'c2',
            externalUserId: 'u2',
            externalUserName: 'Liam',
            platform: 'facebook_messenger',
            status: 'agent_handling',
            assignedToId: null,
            lastMessageContent: 'hi',
            lastMessageRole: 'user',
            lastMessageAt: '2026-04-25T08:00:00.000Z',
            createdAt: '2026-04-25T08:00:00.000Z',
          },
        ],
        total: 2,
        limit: 20,
        offset: 0,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await listOpenConversationsTool.execute(
        {
          status: 'agent_handling',
          platform: 'whatsapp',
          limit: 20,
          offset: 0,
        },
        ctx
      );

      expect(apiFetch).toHaveBeenCalledTimes(1);
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toContain('status=agent_handling');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as { conversations: unknown[]; total: number };
        // Only the WhatsApp one survives the platform filter.
        expect(data.conversations).toHaveLength(1);
        expect((data.conversations[0] as { id: string }).id).toBe('c1');
      }
    });

    it('without status: fans out across the three open statuses and merges by lastMessageAt desc', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path.includes('status=active')) {
          return {
            items: [
              {
                id: 'c-active',
                externalUserId: 'u',
                externalUserName: null,
                platform: 'whatsapp',
                status: 'active',
                assignedToId: null,
                lastMessageContent: null,
                lastMessageRole: null,
                lastMessageAt: '2026-04-25T07:00:00.000Z',
                createdAt: '2026-04-25T07:00:00.000Z',
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
          };
        }
        if (path.includes('status=bot_handling')) {
          return {
            items: [
              {
                id: 'c-bot',
                externalUserId: 'u',
                externalUserName: null,
                platform: 'whatsapp',
                status: 'bot_handling',
                assignedToId: null,
                lastMessageContent: null,
                lastMessageRole: null,
                lastMessageAt: '2026-04-25T11:00:00.000Z',
                createdAt: '2026-04-25T11:00:00.000Z',
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
          };
        }
        return {
          items: [
            {
              id: 'c-agent',
              externalUserId: 'u',
              externalUserName: null,
              platform: 'whatsapp',
              status: 'agent_handling',
              assignedToId: null,
              lastMessageContent: null,
              lastMessageRole: null,
              lastMessageAt: '2026-04-25T09:00:00.000Z',
              createdAt: '2026-04-25T09:00:00.000Z',
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        };
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await listOpenConversationsTool.execute(
        { limit: 20, offset: 0 },
        ctx
      );

      expect(apiFetch).toHaveBeenCalledTimes(3);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as {
          conversations: { id: string }[];
          total: number;
        };
        // Sorted by lastMessageAt desc: bot (11:00) > agent (09:00) > active (07:00).
        expect(data.conversations.map((c) => c.id)).toEqual([
          'c-bot',
          'c-agent',
          'c-active',
        ]);
        expect(data.total).toBe(3);
      }
    });
  });

  describe('summariseConversation', () => {
    it('returns all messages and surfaces aiDisclosureFound when system message hints', async () => {
      const now = Date.now();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const apiFetch = jest.fn(async (path: string) => {
        if (path.endsWith('/messages?limit=20')) {
          return {
            items: [
              {
                id: 'm1',
                role: 'user',
                content: 'hi there',
                messageType: 'text',
                origin: 'live',
                createdAt: oneDayAgo,
                sentAt: oneDayAgo,
              },
              {
                id: 'm2',
                role: 'system',
                content: "I'm an AI assistant — I'll help you book.",
                messageType: 'text',
                origin: 'system',
                createdAt: tenDaysAgo,
                sentAt: tenDaysAgo,
              },
            ],
            total: 2,
          };
        }
        // Conversation lookup
        return {
          id: 'conv-1',
          externalUserName: 'Sarah',
          externalUserId: 'u',
          platform: 'whatsapp',
          status: 'bot_handling',
          assignedToId: null,
          metadata: {},
          lastMessageAt: oneDayAgo,
          createdAt: tenDaysAgo,
        };
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await summariseConversationTool.execute(
        { conversationId: 'conv-1', messageLimit: 20 },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as {
          messageCount: number;
          truncated: boolean;
          totalMessages: number;
          allMessagesOlderThanSevenDays: boolean;
          aiDisclosureFound: boolean;
        };
        // Both messages returned (no 7-day drop).
        expect(data.messageCount).toBe(2);
        // Items returned == total, so not truncated.
        expect(data.truncated).toBe(false);
        expect(data.totalMessages).toBe(2);
        // Mixed ages — at least one message is recent.
        expect(data.allMessagesOlderThanSevenDays).toBe(false);
        expect(data.aiDisclosureFound).toBe(true);
      }
    });

    it('flags allMessagesOlderThanSevenDays when every message is stale (regression: dormant WhatsApp lead returned 0)', async () => {
      const now = Date.now();
      const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
      const fortyDaysAgo = new Date(
        now - 40 * 24 * 60 * 60 * 1000
      ).toISOString();
      const apiFetch = jest.fn(async (path: string) => {
        if (path.endsWith('/messages?limit=20')) {
          return {
            items: [
              {
                id: 'm1',
                role: 'user',
                content: 'hi can I book?',
                messageType: 'text',
                origin: 'live',
                createdAt: fortyDaysAgo,
                sentAt: fortyDaysAgo,
              },
              {
                id: 'm2',
                role: 'agent',
                content: 'sure, let me check',
                messageType: 'text',
                origin: 'live',
                createdAt: tenDaysAgo,
                sentAt: tenDaysAgo,
              },
            ],
            total: 2,
          };
        }
        return {
          id: 'conv-2',
          externalUserName: 'Daniel',
          externalUserId: 'u',
          platform: 'whatsapp',
          status: 'bot_handling',
          assignedToId: null,
          metadata: {},
          lastMessageAt: tenDaysAgo,
          createdAt: fortyDaysAgo,
        };
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await summariseConversationTool.execute(
        { conversationId: 'conv-2', messageLimit: 20 },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as {
          messageCount: number;
          allMessagesOlderThanSevenDays: boolean;
          messages: unknown[];
        };
        // Messages are returned (not dropped) and the dormant flag is set.
        expect(data.messageCount).toBe(2);
        expect(data.messages).toHaveLength(2);
        expect(data.allMessagesOlderThanSevenDays).toBe(true);
      }
    });
  });

  describe('summariseConversationsThisWeek', () => {
    it('passes since/until to the aggregation endpoint and returns the structured response', async () => {
      const apiFetch = jest.fn(async () => ({
        timeframe: {
          since: '2026-04-18T00:00:00.000Z',
          until: '2026-04-25T00:00:00.000Z',
        },
        counts: {
          totalThreads: 12,
          openThreads: 5,
          escalatedThreads: 2,
          closedThreads: 5,
        },
        byChannel: {
          whatsapp: 7,
          facebook_messenger: 3,
          instagram_dm: 2,
        },
        topIntents: [],
        responseTime: { p50Ms: 4000, p95Ms: 60000 },
        oldestPending: null,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await summariseConversationsThisWeekTool.execute(
        {
          since: '2026-04-18T00:00:00.000Z',
          until: '2026-04-25T00:00:00.000Z',
        },
        ctx
      );

      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toContain('conversations/summary/this-week');
      expect(calledPath).toContain('since=2026-04-18');
      expect(calledPath).toContain('until=2026-04-25');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as { counts: { totalThreads: number } };
        expect(data.counts.totalThreads).toBe(12);
      }
    });
  });

  describe('draftReply', () => {
    function setupApiStubs(): jest.Mock {
      return jest.fn(async (path: string) => {
        if (
          path.startsWith('conversations/conv-1?') === false &&
          path === 'conversations/conv-1'
        ) {
          return {
            id: 'conv-1',
            externalUserName: 'Sarah',
            platform: 'whatsapp',
            status: 'bot_handling',
            metadata: {},
          };
        }
        if (path.includes('/messages')) {
          return {
            items: [
              {
                role: 'user',
                content: 'Can I book Tuesday at 10am?',
                createdAt: '2026-04-24T10:00:00.000Z',
                sentAt: '2026-04-24T10:00:00.000Z',
              },
            ],
            total: 1,
          };
        }
        if (path === 'assistant/context') {
          // The real `GET /assistant/context` shape (`getAssistantContext`).
          // This stub used to return `organizationName` / `toneRegion` and a
          // SCALAR `brandVoice`, none of which the endpoint sends — it mirrored
          // the tool's asserted interface, so reader and mock were wrong
          // together and the suite stayed green. `brandVoice` is a string[].
          return {
            name: 'Glow',
            address: null,
            businessType: 'cosmetic_clinic',
            businessTypeLabel: 'Cosmetic Clinic',
            brandVoice: ['warm and direct'],
            targetAudienceDescription: null,
            credibilityLine: null,
            tagline: null,
            services: [],
            serviceDetails: [],
          };
        }
        throw new Error(`Unexpected path ${path}`);
      });
    }

    it('returns a draft + presentation when validation passes', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Hi Sarah — Tuesday at 10am works great.' },
        ],
      });
      const apiFetch = setupApiStubs();
      const runHardBlocks = jest.fn(async () => ({ pass: true })) as never;
      const ctx = buildCtx({ apiFetch: apiFetch as never, runHardBlocks });

      const result = await draftReplyTool.execute(
        {
          conversationId: 'conv-1',
          intent: 'confirm Tuesday at 10am',
          messageLimit: 10,
        },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as { draft: string };
        expect(data.draft).toContain('Tuesday');
        expect(result.presentation?.type).toBe('draft_reply');
      }
    });

    it('surfaces hard_block_violation when the validator fails on the generated draft', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'Rhinoplasty starts at €3000 — happy to book you in.',
          },
        ],
      });
      const apiFetch = setupApiStubs();
      const runHardBlocks = jest.fn(async () => ({
        pass: false,
        code: 'SURGICAL_PRICING_IN_CHAT',
        message:
          "Surgical clinics don't quote prices in chat. Suggest a phone call instead.",
      })) as never;
      const ctx = buildCtx({ apiFetch: apiFetch as never, runHardBlocks });

      const result = await draftReplyTool.execute(
        {
          conversationId: 'conv-1',
          intent: 'quote the customer',
          messageLimit: 10,
        },
        ctx
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.presentation?.type).toBe('hard_block_violation');
        const data = result.data as {
          hardBlock?: { code: string };
        };
        expect(data.hardBlock?.code).toBe('SURGICAL_PRICING_IN_CHAT');
      }
    });
  });

  describe('confirmEscalateToHuman → executeEscalateToHuman flow', () => {
    it('confirm: looks up conversation, issues a token, returns summary fields', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'conv-1',
        externalUserName: 'Sarah',
        externalUserId: 'u',
        platform: 'whatsapp',
        status: 'bot_handling',
        metadata: {},
        lastMessageAt: '2026-04-25T09:00:00.000Z',
      }));
      const createConfirmation = jest.fn(async () => ({
        id: 'token-esc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await confirmEscalateToHumanTool.execute(
        {
          conversationId: 'conv-1',
          reason: 'user_requested_human',
          reasonDetail: 'Customer asked for a person',
        },
        ctx
      );

      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'escalate_conversation',
        resourceId: 'conv-1',
        payload: {
          reason: 'user_requested_human',
          reasonDetail: 'Customer asked for a person',
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as {
          confirmationToken?: string;
          customerName?: string | null;
        };
        expect(data.confirmationToken).toBe('token-esc');
        expect(data.customerName).toBe('Sarah');
      }
    });

    it('confirm: skips token issuance when conversation is already agent_handling', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'conv-1',
        externalUserName: 'Sarah',
        externalUserId: 'u',
        platform: 'whatsapp',
        status: 'agent_handling',
        metadata: {},
        lastMessageAt: null,
      }));
      const createConfirmation = jest.fn();
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await confirmEscalateToHumanTool.execute(
        { conversationId: 'conv-1', reason: 'manual' },
        ctx
      );

      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as { alreadyEscalated?: boolean };
        expect(data.alreadyEscalated).toBe(true);
      }
    });

    it('execute: verifies token, POSTs to /escalate, returns success banner', async () => {
      const apiFetch = jest.fn(async () => ({ escalated: true }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: null,
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await executeEscalateToHumanTool.execute(
        {
          conversationId: 'conv-1',
          confirmationToken: 'token-esc',
          reason: 'user_requested_human',
        },
        ctx
      );

      expect(verifyConfirmation).toHaveBeenCalledWith({
        token: 'token-esc',
        action: 'escalate_conversation',
        resourceId: 'conv-1',
      });
      const callArgs = apiFetch.mock.calls[0] as unknown[];
      expect(callArgs[0]).toBe('conversations/conv-1/escalate');
      expect((callArgs[1] as { method: string }).method).toBe('POST');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as { escalated?: boolean };
        expect(data.escalated).toBe(true);
      }
    });

    it('execute: returns confirmation_expired when token verification fails', async () => {
      const apiFetch = jest.fn();
      const verifyConfirmation = jest.fn(async () => ({
        valid: false,
        reason: 'expired' as const,
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await executeEscalateToHumanTool.execute(
        {
          conversationId: 'conv-1',
          confirmationToken: 'token-old',
          reason: 'manual',
        },
        ctx
      );

      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.presentation?.type).toBe('confirmation_expired');
      }
    });
  });

  describe('confirmAssignConversation → executeAssignConversation flow', () => {
    it('confirm: issues a token bound to assign_conversation + conversationId', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'conv-1',
        externalUserName: 'Liam',
        externalUserId: 'u',
        platform: 'facebook_messenger',
        status: 'bot_handling',
        assignedToId: null,
      }));
      const createConfirmation = jest.fn(async () => ({
        id: 'token-asn',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await confirmAssignConversationTool.execute(
        { conversationId: 'conv-1', assignToUserId: 'user-2' },
        ctx
      );

      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'assign_conversation',
        resourceId: 'conv-1',
        payload: { assignToUserId: 'user-2' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as { confirmationToken?: string };
        expect(data.confirmationToken).toBe('token-asn');
      }
    });

    it('confirm: no-op when already assigned to the same user', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'conv-1',
        externalUserName: 'Liam',
        externalUserId: 'u',
        platform: 'facebook_messenger',
        status: 'agent_handling',
        assignedToId: 'user-2',
      }));
      const createConfirmation = jest.fn();
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await confirmAssignConversationTool.execute(
        { conversationId: 'conv-1', assignToUserId: 'user-2' },
        ctx
      );

      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as { alreadyAssigned?: boolean };
        expect(data.alreadyAssigned).toBe(true);
      }
    });

    it('execute: verifies token then POSTs to /assign with assignToUserId', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'conv-1',
        assignedToId: 'user-2',
      }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: null,
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await executeAssignConversationTool.execute(
        {
          conversationId: 'conv-1',
          assignToUserId: 'user-2',
          confirmationToken: 'token-asn',
        },
        ctx
      );

      expect(verifyConfirmation).toHaveBeenCalledWith({
        token: 'token-asn',
        action: 'assign_conversation',
        resourceId: 'conv-1',
      });
      const callArgs = apiFetch.mock.calls[0] as unknown[];
      expect(callArgs[0]).toBe('conversations/conv-1/assign');
      expect(
        (
          (callArgs[1] as { body: Record<string, unknown> }).body as Record<
            string,
            unknown
          >
        ).assignToUserId
      ).toBe('user-2');
      expect(result.ok).toBe(true);
    });
  });

  // ─── 4xx over-reporting regression guard ────────────────────────────────────
  // executeAssignConversationTool and executeEscalateToHumanTool both call
  // apiFetch inside their execute catch blocks. A 404 / 409 from the internal
  // API is an expected tool outcome — not a server fault worth reporting.

  describe('4xx reportIssue gating (regression guard for API-9G / ENG-402)', () => {
    it('executeAssignConversationTool: returns message but does NOT report a 4xx', async () => {
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: { conversationId: 'conv-1', assignToUserId: 'user-2' },
      }));
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Conversation not found', 404);
      });
      const result = await executeAssignConversationTool.execute(
        {
          conversationId: 'conv-1',
          assignToUserId: 'user-2',
          confirmationToken: 'tok',
        },
        buildCtx({
          apiFetch: apiFetch as never,
          verifyConfirmation: verifyConfirmation as never,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.error).toBe('Conversation not found');
      }
      expect(logWarning).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it('executeAssignConversationTool: still reports a genuine 5xx', async () => {
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: { conversationId: 'conv-1', assignToUserId: 'user-2' },
      }));
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Internal server error', 500);
      });
      const result = await executeAssignConversationTool.execute(
        {
          conversationId: 'conv-1',
          assignToUserId: 'user-2',
          confirmationToken: 'tok',
        },
        buildCtx({
          apiFetch: apiFetch as never,
          verifyConfirmation: verifyConfirmation as never,
        })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.error).toBe('Internal server error');
      }
      expect(logWarning).toHaveBeenCalledTimes(1);
    });
  });
});
