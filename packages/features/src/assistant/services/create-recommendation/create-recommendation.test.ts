import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { createRecommendation } from './create-recommendation.service.js';

const mockDb = {
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
};

const navInput = {
  organizationId: 'org-1',
  kind: 'lead_unreplied_2h' as const,
  title: 'A lead is waiting',
  body: 'Reply to keep the conversation warm.',
  primaryAction: {
    label: 'Reply',
    type: 'navigate' as const,
    target: '/inbox/conv-1',
  },
};

describe('createRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
  });

  it('creates a navigate recommendation', async () => {
    const row = { id: 'rec-1', kind: 'lead_unreplied_2h', state: 'active' };
    mockDb.returning.mockResolvedValueOnce([row]);

    const result = await createRecommendation(mockDb as never, navInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('rec-1');
    }
  });

  it('creates a tour recommendation with payload', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'rec-2' }]);

    const result = await createRecommendation(mockDb as never, {
      organizationId: 'org-1',
      kind: 'prompt_create_first_ad',
      title: 'Ready to create your first ad',
      body: 'I can help.',
      primaryAction: {
        label: 'Accept',
        type: 'tour',
        target: 'create_ad',
        payload: { suggestedService: 'microneedling', suggestedPrice: '€125' },
      },
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryAction: expect.objectContaining({ type: 'tour' }),
      })
    );
  });

  it('creates an informational (none-type) recommendation', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'rec-3' }]);

    const result = await createRecommendation(mockDb as never, {
      organizationId: 'org-1',
      kind: 'content_no_post_14_days',
      title: 'Your ad is learning',
      body: 'Leave it alone.',
      primaryAction: { label: 'Got it', type: 'none' },
    });

    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR for missing title', async () => {
    const result = await createRecommendation(mockDb as never, {
      ...navInput,
      title: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for invalid kind', async () => {
    const result = await createRecommendation(mockDb as never, {
      ...navInput,
      // @ts-expect-error deliberately invalid kind
      kind: 'not_a_real_kind',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await createRecommendation(mockDb as never, navInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
