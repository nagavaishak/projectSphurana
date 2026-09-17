import {
  createAnthropicClient,
  getAnthropicClient,
} from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

// The service reaches `client.messages.create` two levels deep. Drive it via a
// stable `vi.fn()` wired into the canonical AI-client getters in `beforeEach`,
// so behaviour is re-established per test (isolate-safe).
const mockMessagesCreate = vi.fn();

import { ErrorCodes } from '../../../shared/index.js';
import {
  classifyIntent,
  clearClassifyIntentCache,
} from './classify-intent.service.js';

function modelResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
  };
}

const baseInput = {
  userMessage: 'launch an ad',
  organizationId: 'org-1',
};

describe('classifyIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearClassifyIntentCache();
    const client = { messages: { create: mockMessagesCreate } };
    vi.mocked(getAnthropicClient).mockReturnValue(client as never);
    vi.mocked(createAnthropicClient).mockReturnValue(client as never);
  });

  it('returns the model-classified skill IDs on a clean response', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse('{"skillIds": ["create-ad"], "confidence": 0.92}')
    );

    const result = await classifyIntent(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillIds).toEqual(['create-ad']);
      expect(result.data.confidence).toBeCloseTo(0.92);
    }
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('classifies "show me my appointments" → ["manage-appointments"]', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse('{"skillIds": ["manage-appointments"], "confidence": 0.85}')
    );

    const result = await classifyIntent({
      ...baseInput,
      userMessage: 'show me my appointments',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillIds).toEqual(['manage-appointments']);
    }
  });

  it('returns ["default"] for "hi" small talk', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse('{"skillIds": ["default"], "confidence": 0.5}')
    );

    const result = await classifyIntent({
      ...baseInput,
      userMessage: 'hi',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillIds).toEqual(['default']);
    }
  });

  it('falls back to ["default"] when the model returns garbage', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse('not json at all, just prose')
    );

    const result = await classifyIntent(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillIds).toEqual(['default']);
      expect(result.data.confidence).toBe(0);
    }
  });

  it('falls back to ["default"] when the model returns an unknown skill ID', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse('{"skillIds": ["bogus-skill"], "confidence": 0.9}')
    );

    const result = await classifyIntent(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillIds).toEqual(['default']);
    }
  });

  it('rejects mixed-validity skill arrays (one bad ID → default)', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse(
        '{"skillIds": ["create-ad", "bogus-skill"], "confidence": 0.9}'
      )
    );

    const result = await classifyIntent(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillIds).toEqual(['default']);
    }
  });

  it('strips ```json fences before parsing', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse(
        '```json\n{"skillIds": ["create-ad"], "confidence": 0.8}\n```'
      )
    );

    const result = await classifyIntent(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillIds).toEqual(['create-ad']);
    }
  });

  it('clamps confidence into [0, 1]', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse('{"skillIds": ["create-ad"], "confidence": 5}')
    );

    const result = await classifyIntent(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.confidence).toBe(1);
    }
  });

  it('cache hit on identical message does NOT re-invoke Anthropic', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse('{"skillIds": ["create-ad"], "confidence": 0.9}')
    );

    const first = await classifyIntent(baseInput);
    const second = await classifyIntent(baseInput);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('case-insensitive cache key — same message different casing hits the same entry', async () => {
    mockMessagesCreate.mockResolvedValueOnce(
      modelResponse('{"skillIds": ["create-ad"], "confidence": 0.9}')
    );

    await classifyIntent(baseInput);
    await classifyIntent({ ...baseInput, userMessage: 'LAUNCH AN AD' });

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back to ["default"] when the Anthropic client throws', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('network down'));

    const result = await classifyIntent(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillIds).toEqual(['default']);
    }
  });

  it('returns VALIDATION_ERROR for empty message', async () => {
    const result = await classifyIntent({
      ...baseInput,
      userMessage: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await classifyIntent({
      ...baseInput,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
