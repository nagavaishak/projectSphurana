import {
  AuthenticationError as AnthropicAuthenticationError,
  RateLimitError as AnthropicRateLimitError,
} from '@anthropic-ai/sdk';

jest.mock(
  '@borradh-workspace/ai',
  () => ({
    classifyStreamError: (error: unknown) => {
      const err = error as {
        message?: string;
        status?: number;
        type?: string;
      };
      const httpStatus = err.status;
      const message = error instanceof Error ? error.message : String(error);

      if (httpStatus === 429 || httpStatus === 529) {
        return {
          category: 'transient',
          httpStatus,
          apiErrorType: err.type,
          message,
        };
      }

      if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403) {
        return {
          category: 'terminal',
          httpStatus,
          apiErrorType: err.type,
          message,
        };
      }

      return {
        category: 'unknown',
        httpStatus,
        apiErrorType: err.type,
        message,
      };
    },
  }),
  { virtual: true }
);

jest.mock(
  '@borradh-workspace/observability',
  () => ({
    captureAiGeneration: jest.fn(),
    logError: jest.fn(),
  }),
  { virtual: true }
);

import type { Anthropic } from '@borradh-workspace/ai';
import type { AssistantToolsContext } from '../tool-factory/index.js';
import { buildAnthropicToolList, runToolLoop } from './manual-tool-loop';

function createThrowingStream(error: Error) {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        throw error;
      },
    }),
    finalMessage: async () => {
      throw error;
    },
  };
}

function createTextStream(text: string) {
  const events: unknown[] = [
    {
      type: 'message_start',
      message: { id: 'msg_1', role: 'assistant', content: [] },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ];

  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    finalMessage: async () => ({
      id: 'msg_1',
      type: 'message' as const,
      role: 'assistant' as const,
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  };
}

function createMockClient(stream: unknown) {
  return {
    messages: {
      stream: jest.fn().mockReturnValue(stream),
    },
  } as unknown as Anthropic;
}

const baseParams = {
  model: 'claude-sonnet-4-6' as const,
  system: [{ type: 'text' as const, text: 'You are a test assistant.' }],
  initialMessages: [
    { role: 'user' as const, content: 'Hello' },
  ] as Anthropic.MessageParam[],
  toolMap: new Map(),
  toolCtx: {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    toolCallCounter: 0,
    maxToolCalls: 25,
  } as unknown as AssistantToolsContext,
  maxTokens: 1024,
  logger: {
    error: jest.fn(),
    log: jest.fn(),
  },
};

describe('runToolLoop', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('stream error signal', () => {
    it('yields streamError with category transient on RateLimitError', async () => {
      const rateErr = new AnthropicRateLimitError(
        429,
        { error: { type: 'rate_limit_error', message: 'Rate limited' } },
        'Rate limited',
        new Headers()
      );
      const emitFn = jest.fn();
      const client = createMockClient(createThrowingStream(rateErr));

      const result = await runToolLoop({
        ...baseParams,
        client,
        emit: emitFn,
      });

      expect(result.streamError).toBeDefined();
      expect(result.streamError?.category).toBe('transient');
      expect(result.streamError?.httpStatus).toBe(429);
      expect(result.finalText).toBe('');
      expect(result.toolParts).toEqual([]);
    });

    it('yields streamError when messages.stream throws synchronously', async () => {
      const rateErr = new AnthropicRateLimitError(
        429,
        { error: { type: 'rate_limit_error', message: 'Rate limited' } },
        'Rate limited',
        new Headers()
      );
      const emitFn = jest.fn();
      const client = {
        messages: {
          stream: jest.fn(() => {
            throw rateErr;
          }),
        },
      } as unknown as Anthropic;

      const result = await runToolLoop({
        ...baseParams,
        client,
        emit: emitFn,
      });

      expect(result.streamError?.category).toBe('transient');
      expect(result.streamError?.httpStatus).toBe(429);
      expect(result.finalText).toBe('');
      expect(result.toolParts).toEqual([]);
    });

    it('yields streamError with category terminal on AuthenticationError', async () => {
      const authErr = new AnthropicAuthenticationError(
        401,
        { error: { type: 'authentication_error', message: 'Invalid key' } },
        'Invalid key',
        new Headers()
      );
      const emitFn = jest.fn();
      const client = createMockClient(createThrowingStream(authErr));

      const result = await runToolLoop({
        ...baseParams,
        client,
        emit: emitFn,
      });

      expect(result.streamError).toBeDefined();
      expect(result.streamError?.category).toBe('terminal');
      expect(result.streamError?.httpStatus).toBe(401);
    });

    it('does not yield streamError on a normal text-only turn', async () => {
      const emitFn = jest.fn();
      const client = createMockClient(createTextStream('Hello there!'));

      const result = await runToolLoop({
        ...baseParams,
        client,
        emit: emitFn,
      });

      expect(result.streamError).toBeUndefined();
      expect(result.finalText).toBe('Hello there!');
      expect(result.stopReason).toBe('end_turn');
    });

    it('emits error and finish-step events when stream throws', async () => {
      const rateErr = new AnthropicRateLimitError(
        429,
        { error: { type: 'rate_limit_error', message: 'Rate limited' } },
        'Rate limited',
        new Headers()
      );
      const emitFn = jest.fn();
      const client = createMockClient(createThrowingStream(rateErr));

      await runToolLoop({
        ...baseParams,
        client,
        emit: emitFn,
      });

      const emittedTypes = emitFn.mock.calls.map(
        (call: unknown[]) => (call[0] as { type: string }).type
      );
      expect(emittedTypes).toContain('start-step');
      expect(emittedTypes).toContain('error');
      expect(emittedTypes).toContain('finish-step');

      const errorEvent = emitFn.mock.calls.find(
        (call: unknown[]) => (call[0] as { type: string }).type === 'error'
      );
      expect((errorEvent?.[0] as { errorText: string }).errorText).toContain(
        'Something went wrong'
      );
    });
  });
});

describe('buildAnthropicToolList', () => {
  it('returns empty array for empty toolMap', () => {
    expect(buildAnthropicToolList(new Map())).toEqual([]);
  });
});
