import { chatCompletion } from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { normalizeLead } from './normalize-lead.service.js';

// `@borradh-workspace/ai` is aliased to the canonical mock (vite.config.ts), so
// NEVER `vi.mock` it — import the symbol and drive it with `vi.mocked()`. The
// canonical mock already provides `chatCompletion` / `initAIClient` /
// `isAIClientInitialized` (→ true) as shared `vi.fn()`s.
const mockChat = vi.mocked(chatCompletion);

const ORG = '550e8400-e29b-41d4-a716-446655440000';

describe('normalizeLead', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await normalizeLead({
      organizationId: '',
      phone: '087 684 6467',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('skips the model entirely when no fields are provided', async () => {
    const result = await normalizeLead({ organizationId: ORG });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('returns cleaned fields from the model', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        firstName: 'Sarah',
        phone: '+353876846467',
      }),
      finishReason: 'stop',
    });

    const result = await normalizeLead({
      organizationId: ORG,
      firstName: 'sarah',
      phone: '087 684 6467',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe('Sarah');
      expect(result.data.phone).toBe('+353876846467');
    }
  });

  it('never adds fields the user did not provide', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        firstName: 'Sarah',
        email: 'invented@example.com',
      }),
      finishReason: 'stop',
    });

    const result = await normalizeLead({
      organizationId: ORG,
      firstName: 'sarah',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe('Sarah');
      expect(result.data.email).toBeUndefined();
    }
  });

  it('falls back to the original fields when the model fails', async () => {
    mockChat.mockRejectedValueOnce(new Error('model down'));

    const result = await normalizeLead({
      organizationId: ORG,
      phone: '087 684 6467',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe('087 684 6467');
  });

  it('falls back to the original fields on malformed model output', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ phone: 12345 }),
      finishReason: 'stop',
    });

    const result = await normalizeLead({
      organizationId: ORG,
      phone: '087 684 6467',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe('087 684 6467');
  });
});
