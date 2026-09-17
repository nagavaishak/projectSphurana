import { chatCompletion } from '@borradh-workspace/ai';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { createNormalizedLead } from './create-normalized-lead.service.js';

// `@borradh-workspace/ai` is aliased to the canonical mock (vite.config.ts), so
// NEVER `vi.mock` it — import the symbol and drive it with `vi.mocked()`.
const mockChat = vi.mocked(chatCompletion);

describe('createNormalizedLead', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    firstName: 'sarah',
    phone: '087 684 6467',
  };

  const seedInsert = () => {
    // create-lead: no duplicate, then the insert returns the row.
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockImplementationOnce(async () => [
      { id: 'lead_123', organizationId: 'org_123' },
    ]);
  };

  it('persists the model-cleaned identity fields', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        firstName: 'Sarah',
        phone: '+353876846467',
      }),
      finishReason: 'stop',
    } as never);
    seedInsert();

    const result = await createNormalizedLead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
    const values = mockDb.values.mock.calls[0]?.[0];
    expect(values).toMatchObject({
      firstName: 'Sarah',
      phone: '+353876846467',
    });
  });

  it('falls back to the raw input when the model fails', async () => {
    // Normalisation is best-effort — it must never block creation.
    mockChat.mockRejectedValueOnce(new Error('model down'));
    seedInsert();

    const result = await createNormalizedLead(mockDb as never, validInput);

    expect(result.success).toBe(true);
    const values = mockDb.values.mock.calls[0]?.[0];
    expect(values).toMatchObject({
      firstName: 'sarah',
      phone: '087 684 6467',
    });
  });

  it('returns VALIDATION_ERROR without calling the model', async () => {
    const result = await createNormalizedLead(mockDb as never, {
      organizationId: 'org_123',
      firstName: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
