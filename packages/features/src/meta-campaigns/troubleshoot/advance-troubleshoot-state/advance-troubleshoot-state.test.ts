import { describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { advanceTroubleshootState } from './advance-troubleshoot-state.service.js';

interface ExistingRow {
  id: string;
  organizationId: string;
  metaCampaignId: string;
  currentRound: 'none' | 'offer_adjusted' | 'creative_refreshed';
  offersTried: Array<{ note: string; at: string; ref?: string }>;
  creativesTried: Array<{ note: string; at: string; ref?: string }>;
  escalatedAt: Date | null;
  lastDiagnosedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeDb(existing: ExistingRow | undefined) {
  const findFirst = vi.fn().mockResolvedValue(existing);

  // capture what gets written
  const setArg = { value: undefined as unknown };
  const valuesArg = { value: undefined as unknown };

  const update = vi.fn(() => ({
    set: vi.fn((arg: unknown) => {
      setArg.value = arg;
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: existing?.id ?? 'updated' }]),
        })),
      };
    }),
  }));

  const insert = vi.fn(() => ({
    values: vi.fn((arg: unknown) => {
      valuesArg.value = arg;
      return { returning: vi.fn(async () => [{ id: 'inserted' }]) };
    }),
  }));

  return {
    db: {
      query: { campaignTroubleshootState: { findFirst } },
      update,
      insert,
    },
    findFirst,
    update,
    insert,
    setArg,
    valuesArg,
  };
}

function baseExisting(overrides: Partial<ExistingRow> = {}): ExistingRow {
  return {
    id: 'row-1',
    organizationId: 'org-1',
    metaCampaignId: 'cmp-1',
    currentRound: 'none',
    offersTried: [],
    creativesTried: [],
    escalatedAt: null,
    lastDiagnosedAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('advanceTroubleshootState', () => {
  it('inserts a new row on first touch (mark_diagnosed)', async () => {
    const h = makeDb(undefined);
    const result = await advanceTroubleshootState(h.db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      action: 'mark_diagnosed',
    });

    expect(result.success).toBe(true);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled();
    const written = h.valuesArg.value as ExistingRow;
    expect(written.currentRound).toBe('none');
    expect(written.lastDiagnosedAt).toBeInstanceOf(Date);
  });

  it('advances an existing row to offer_adjusted and appends to offersTried', async () => {
    const h = makeDb(baseExisting());
    const result = await advanceTroubleshootState(h.db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      action: 'offer_adjusted',
      note: 'intro price €99 → €69',
      ref: 'offer-123',
    });

    expect(result.success).toBe(true);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.insert).not.toHaveBeenCalled();
    const written = h.setArg.value as ExistingRow;
    expect(written.currentRound).toBe('offer_adjusted');
    expect(written.offersTried).toHaveLength(1);
    expect(written.offersTried[0]).toMatchObject({
      note: 'intro price €99 → €69',
      ref: 'offer-123',
    });
    expect(written.creativesTried).toHaveLength(0);
  });

  it('advances to creative_refreshed and appends to creativesTried, preserving prior offers', async () => {
    const h = makeDb(
      baseExisting({
        currentRound: 'offer_adjusted',
        offersTried: [{ note: 'prior offer', at: '2026-06-02T00:00:00.000Z' }],
      })
    );
    const result = await advanceTroubleshootState(h.db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      action: 'creative_refreshed',
      note: 'fresh before/after video',
    });

    expect(result.success).toBe(true);
    const written = h.setArg.value as ExistingRow;
    expect(written.currentRound).toBe('creative_refreshed');
    expect(written.offersTried).toHaveLength(1); // preserved
    expect(written.creativesTried).toHaveLength(1);
    expect(written.creativesTried[0].note).toBe('fresh before/after video');
  });

  it('escalate is idempotent — keeps the original escalatedAt', async () => {
    const originalEscalation = new Date('2026-06-03T12:00:00.000Z');
    const h = makeDb(baseExisting({ escalatedAt: originalEscalation }));
    const result = await advanceTroubleshootState(h.db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      action: 'escalate',
    });

    expect(result.success).toBe(true);
    const written = h.setArg.value as ExistingRow;
    expect(written.escalatedAt).toBe(originalEscalation);
  });

  it('escalate stamps escalatedAt when not previously escalated', async () => {
    const h = makeDb(baseExisting({ escalatedAt: null }));
    const result = await advanceTroubleshootState(h.db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      action: 'escalate',
    });

    expect(result.success).toBe(true);
    const written = h.setArg.value as ExistingRow;
    expect(written.escalatedAt).toBeInstanceOf(Date);
  });

  it('does not append an attempt when no note is supplied', async () => {
    const h = makeDb(baseExisting());
    await advanceTroubleshootState(h.db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      action: 'offer_adjusted',
    });
    const written = h.setArg.value as ExistingRow;
    expect(written.offersTried).toHaveLength(0);
    expect(written.currentRound).toBe('offer_adjusted');
  });

  it('returns VALIDATION_ERROR for an invalid action', async () => {
    const h = makeDb(undefined);
    const result = await advanceTroubleshootState(h.db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      action: 'not_an_action' as never,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the read throws', async () => {
    const h = makeDb(undefined);
    h.findFirst.mockRejectedValueOnce(new Error('db down'));
    const result = await advanceTroubleshootState(h.db as never, {
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      action: 'mark_diagnosed',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
