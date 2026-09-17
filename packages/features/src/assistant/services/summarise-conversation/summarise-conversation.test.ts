import {
  createAnthropicClient,
  getAnthropicClient,
} from '@borradh-workspace/ai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

import * as getConversationModule from '../get-conversation/get-conversation.service.js';
import * as writeKnowledgeEntryModule from '../write-knowledge-entry/write-knowledge-entry.service.js';

// The service reaches `client.messages.create` two levels deep. Drive it via a
// stable `vi.fn()` wired into the canonical AI-client getters in `beforeEach`,
// so behaviour is re-established per test (isolate-safe).
const mockMessagesCreate = vi.fn();

// The two downstream services are stubbed with restored `vi.spyOn`s, NOT
// `vi.mock`. Under `isolate: false` the worker shares one module graph, so a
// hoisted factory leaks into every later file AND silently misses whenever an
// earlier file already imported the real module.
let mockGetConversation: MockInstance;
let mockWriteKnowledgeEntry: MockInstance;

import { ErrorCodes, FeatureError } from '../../../shared/index.js';
import {
  clearSummariseConversationRateLimit,
  summariseConversation,
} from './summarise-conversation.service.js';

const baseInput = {
  conversationId: 'conv-1',
  organizationId: 'org-1',
  userId: 'user-1',
};

function modelResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function makeConversation(
  overrides?: Partial<{
    messages: Array<{
      id: string;
      role: string;
      content: string | null;
      toolCalls: unknown;
      toolResults: unknown;
      attachments: unknown;
      createdAt: Date;
    }>;
  }>
) {
  const messages = overrides?.messages ?? [
    {
      id: 'm1',
      role: 'user',
      content: 'Help me launch a new ad campaign for our hydration treatment.',
      toolCalls: null,
      toolResults: null,
      attachments: null,
      createdAt: new Date('2026-04-25T09:00:00Z'),
    },
    {
      id: 'm2',
      role: 'assistant',
      content:
        "Done — drafted the campaign and queued it for your review. I've also noted you prefer warmer creative tones.",
      toolCalls: null,
      toolResults: null,
      attachments: null,
      createdAt: new Date('2026-04-25T09:00:01Z'),
    },
  ];
  return {
    success: true as const,
    data: {
      id: 'conv-1',
      title: 'Launch hydration ad',
      status: 'active' as const,
      escalatedAt: null,
      escalationReason: null,
      loadedSkillIds: [],
      skillRegistryVersion: 1,
      createdAt: new Date('2026-04-25T09:00:00Z'),
      updatedAt: new Date('2026-04-25T09:00:01Z'),
      messages,
    },
  };
}

describe('summariseConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSummariseConversationRateLimit();
    const client = { messages: { create: mockMessagesCreate } };
    vi.mocked(getAnthropicClient).mockReturnValue(client as never);
    vi.mocked(createAnthropicClient).mockReturnValue(client as never);
    mockGetConversation = vi
      .spyOn(getConversationModule, 'getConversation')
      .mockResolvedValue(undefined as never);
    mockWriteKnowledgeEntry = vi
      .spyOn(writeKnowledgeEntryModule, 'writeKnowledgeEntry')
      .mockResolvedValue({
        success: true,
        data: { knowledgeEntryId: 'ke-summary-1' },
      } as never);
  });

  afterEach(() => {
    mockGetConversation.mockRestore();
    mockWriteKnowledgeEntry.mockRestore();
  });

  it('happy path: 3-message conversation summarises into a knowledge entry', async () => {
    mockGetConversation.mockResolvedValueOnce(
      makeConversation({
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Show me my open customer chats from this morning.',
            toolCalls: null,
            toolResults: null,
            attachments: null,
            createdAt: new Date(),
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Found 3 open chats. The one from Sarah looks urgent.',
            toolCalls: null,
            toolResults: null,
            attachments: null,
            createdAt: new Date(),
          },
          {
            id: 'm3',
            role: 'user',
            content: 'Draft a reply to Sarah.',
            toolCalls: null,
            toolResults: null,
            attachments: null,
            createdAt: new Date(),
          },
        ],
      })
    );
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse(
        'Operator asked Claire to triage this morning open customer chats and draft a reply to one. Claire surfaced 3 open chats and drafted the reply for Sarah.'
      )
    );

    const result = await summariseConversation({} as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBe('ke-summary-1');
      expect(result.data.skipReason).toBeUndefined();
    }
    expect(mockWriteKnowledgeEntry).toHaveBeenCalledTimes(1);
    const writeCall = mockWriteKnowledgeEntry.mock.calls[0][1];
    expect(writeCall).toMatchObject({
      organizationId: 'org-1',
      userId: 'user-1',
      type: 'conversation_summary',
      source: 'auto',
    });
    expect(writeCall.metadata).toEqual({ sourceConversationId: 'conv-1' });
    // Title is derived from the summary's first sentence
    expect(typeof writeCall.title).toBe('string');
    expect(writeCall.title.length).toBeGreaterThan(0);
    expect(writeCall.content).toContain('triage');
  });

  it('hard-block: model summary with fabricated outcome claim is dropped, no knowledge entry written', async () => {
    mockGetConversation.mockResolvedValueOnce(makeConversation());
    // The d2b validator catches "60% reduction" as an outcome_claim, which
    // maps to noFabricatedResultClaims in the conversation-summary filter.
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse(
        'Operator asked about a treatment. Claire guaranteed a 60% reduction in fine lines after one session.'
      )
    );

    const result = await summariseConversation({} as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBeNull();
      expect(result.data.skipReason).toBe('hard_block_tripped');
    }
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('hard-block: POM brand name in summary is dropped, no knowledge entry written', async () => {
    mockGetConversation.mockResolvedValueOnce(makeConversation());
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse(
        'Operator asked about anti-wrinkle. Claire suggested a Botox campaign for the autumn promotion.'
      )
    );

    const result = await summariseConversation({} as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBeNull();
      expect(result.data.skipReason).toBe('hard_block_tripped');
    }
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('writes the embedding via writeKnowledgeEntry (which calls generateEmbedding internally)', async () => {
    mockGetConversation.mockResolvedValueOnce(makeConversation());
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse(
        'Operator asked Claire to set up a hydration ad. Claire drafted it and queued for review.'
      )
    );

    const result = await summariseConversation({} as never, baseInput);

    expect(result.success).toBe(true);
    // The write service is responsible for embedding generation; we verify
    // it was invoked exactly once with the summary content + conv ID metadata.
    expect(mockWriteKnowledgeEntry).toHaveBeenCalledTimes(1);
    const args = mockWriteKnowledgeEntry.mock.calls[0][1];
    expect(args.content).toBeTruthy();
    expect(args.metadata).toEqual({ sourceConversationId: 'conv-1' });
  });

  it('cross-org isolation: summarising conversation from another org returns NOT_FOUND from getConversation', async () => {
    // getConversation enforces (orgId, userId) at the DB layer — a
    // conversation owned by org-A is invisible to org-B; it returns NOT_FOUND.
    // The summariser surfaces that error and never writes anything.
    mockGetConversation.mockResolvedValueOnce({
      success: false,
      error: new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found'),
    });

    const result = await summariseConversation({} as never, {
      conversationId: 'conv-belongs-to-org-A',
      organizationId: 'org-B',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('per-user scoping: writes (orgId, userId) — never (orgId, null) — for conversation summaries', async () => {
    mockGetConversation.mockResolvedValueOnce(makeConversation());
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse(
        'Operator triaged customer chats. Claire surfaced 3 open and drafted a reply.'
      )
    );

    await summariseConversation({} as never, {
      ...baseInput,
      userId: 'user-specific-1',
    });

    expect(mockWriteKnowledgeEntry).toHaveBeenCalledTimes(1);
    const writeCall = mockWriteKnowledgeEntry.mock.calls[0][1];
    expect(writeCall.userId).toBe('user-specific-1');
    expect(writeCall.userId).not.toBeNull();
    expect(writeCall.organizationId).toBe('org-1');
  });

  it('rate-limited: second call within the window does not re-summarise the same conversation', async () => {
    mockGetConversation.mockResolvedValue(makeConversation());
    mockMessagesCreate.mockResolvedValue(
      modelResponse(
        'Operator triaged chats and drafted a reply. Quick session.'
      )
    );

    const first = await summariseConversation({} as never, baseInput);
    const second = await summariseConversation({} as never, baseInput);

    expect(first.success).toBe(true);
    if (first.success) {
      expect(first.data.knowledgeEntryId).toBe('ke-summary-1');
    }
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.data.knowledgeEntryId).toBeNull();
      expect(second.data.skipReason).toBe('rate_limited');
    }
    // Only the first call paid for the conversation read + Anthropic call.
    expect(mockGetConversation).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockWriteKnowledgeEntry).toHaveBeenCalledTimes(1);
  });

  it('rate-limit is per-conversation: a second conversation in the same org-user pair still summarises', async () => {
    mockGetConversation.mockResolvedValue(makeConversation());
    mockMessagesCreate.mockResolvedValue(
      modelResponse('A summary that contains nothing problematic.')
    );

    await summariseConversation({} as never, baseInput);
    const otherConv = await summariseConversation({} as never, {
      ...baseInput,
      conversationId: 'conv-2',
    });

    expect(otherConv.success).toBe(true);
    if (otherConv.success) {
      expect(otherConv.data.skipReason).toBeUndefined();
      expect(otherConv.data.knowledgeEntryId).toBe('ke-summary-1');
    }
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  it('too few messages: a single-message conversation is skipped', async () => {
    mockGetConversation.mockResolvedValueOnce(
      makeConversation({
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'hi',
            toolCalls: null,
            toolResults: null,
            attachments: null,
            createdAt: new Date(),
          },
        ],
      })
    );

    const result = await summariseConversation({} as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBeNull();
      expect(result.data.skipReason).toBe('too_few_messages');
    }
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('empty / SKIP response from the model is treated as a non-error skip, not a failed summary', async () => {
    mockGetConversation.mockResolvedValueOnce(makeConversation());
    mockMessagesCreate.mockResolvedValueOnce(modelResponse('SKIP'));

    const result = await summariseConversation({} as never, baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledgeEntryId).toBeNull();
      expect(result.data.skipReason).toBe('empty_summary');
    }
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('VALIDATION_ERROR for missing conversationId', async () => {
    const result = await summariseConversation({} as never, {
      ...baseInput,
      conversationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  it('Anthropic call failure surfaces EXTERNAL_SERVICE_ERROR; nothing is written', async () => {
    mockGetConversation.mockResolvedValueOnce(makeConversation());
    mockMessagesCreate.mockRejectedValueOnce(new Error('upstream 500'));

    const result = await summariseConversation({} as never, baseInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
    expect(mockWriteKnowledgeEntry).not.toHaveBeenCalled();
  });

  it('write failure does not poison the rate-limit map (next call still attempts)', async () => {
    mockGetConversation.mockResolvedValue(makeConversation());
    mockMessagesCreate.mockResolvedValue(
      modelResponse(
        'Operator drafted a reply with Claires help. Short successful chat.'
      )
    );
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: false,
      error: new FeatureError(ErrorCodes.INTERNAL_ERROR, 'embed failed'),
    });
    mockWriteKnowledgeEntry.mockResolvedValueOnce({
      success: true,
      data: { knowledgeEntryId: 'ke-retry-1' },
    });

    const first = await summariseConversation({} as never, baseInput);
    const second = await summariseConversation({} as never, baseInput);

    expect(first.success).toBe(false);
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.data.knowledgeEntryId).toBe('ke-retry-1');
    }
    expect(mockWriteKnowledgeEntry).toHaveBeenCalledTimes(2);
  });
});
