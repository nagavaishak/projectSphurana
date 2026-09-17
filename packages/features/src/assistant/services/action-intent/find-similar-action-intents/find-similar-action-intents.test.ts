import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../../shared/index.js';
import { findSimilarActionIntents } from './find-similar-action-intents.service.js';

const mockDb = {
  query: {
    claireActionIntent: {
      findMany: vi.fn(),
    },
  },
};

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'intent-1',
  organizationId: 'org-1',
  conversationId: 'conv-1',
  action: 'create_campaign',
  normalizedKey: 'botox september promo',
  resourceId: 'meta-camp-1',
  displayName: 'Botox — September promo',
  metadata: { objective: 'OUTCOME_ENGAGEMENT', serviceIds: ['svc-botox'] },
  createdAt: new Date('2026-07-29T10:00:00.000Z'),
  ...over,
});

describe('findSimilarActionIntents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    const result = await findSimilarActionIntents(mockDb as never, {
      organizationId: '',
      action: 'create_campaign',
      name: 'Botox',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('flags a near-identical campaign name as a candidate', async () => {
    mockDb.query.claireActionIntent.findMany.mockResolvedValueOnce([row()]);

    const result = await findSimilarActionIntents(mockDb as never, {
      organizationId: 'org-1',
      action: 'create_campaign',
      name: 'Botox September promo',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.candidates).toHaveLength(1);
      const [candidate] = result.data.candidates;
      expect(candidate?.resourceId).toBe('meta-camp-1');
      expect(candidate?.similarity).toBeGreaterThanOrEqual(0.5);
      expect(candidate?.matchReasons).toContain('same name');
    }
  });

  it('does NOT flag an unrelated name with no shared objective/service', async () => {
    mockDb.query.claireActionIntent.findMany.mockResolvedValueOnce([
      row({
        normalizedKey: 'summer skin booster clinic',
        metadata: { objective: 'OUTCOME_LEADS', serviceIds: ['svc-skin'] },
      }),
    ]);

    const result = await findSimilarActionIntents(mockDb as never, {
      organizationId: 'org-1',
      action: 'create_campaign',
      name: 'Lip filler winter promo',
      objective: 'OUTCOME_ENGAGEMENT',
      serviceIds: ['svc-lip'],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.candidates).toHaveLength(0);
  });

  it('flags a match on same objective + same service even when the name differs', async () => {
    mockDb.query.claireActionIntent.findMany.mockResolvedValueOnce([
      row({
        normalizedKey: 'autumn special offer',
        displayName: 'Autumn special offer',
        metadata: {
          objective: 'OUTCOME_ENGAGEMENT',
          serviceIds: ['svc-botox'],
        },
      }),
    ]);

    const result = await findSimilarActionIntents(mockDb as never, {
      organizationId: 'org-1',
      action: 'create_campaign',
      name: 'Completely different wording',
      objective: 'OUTCOME_ENGAGEMENT',
      serviceIds: ['svc-botox'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.candidates).toHaveLength(1);
      expect(result.data.candidates[0]?.matchReasons).toEqual(
        expect.arrayContaining(['same objective', 'same service'])
      );
    }
  });

  it('sorts candidates by descending similarity and caps to the limit', async () => {
    mockDb.query.claireActionIntent.findMany.mockResolvedValueOnce([
      row({ id: 'a', normalizedKey: 'botox promo' }),
      row({ id: 'b', normalizedKey: 'botox september promo' }),
    ]);

    const result = await findSimilarActionIntents(mockDb as never, {
      organizationId: 'org-1',
      action: 'create_campaign',
      name: 'Botox September promo',
      limit: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.candidates).toHaveLength(1);
      expect(result.data.candidates[0]?.id).toBe('b');
    }
  });
});
