import { describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getTroubleshootState } from './get-troubleshoot-state.service.js';

function makeDb(findFirst: ReturnType<typeof vi.fn>) {
  return {
    query: { campaignTroubleshootState: { findFirst } },
  };
}

const validInput = {
  organizationId: 'org-1',
  metaCampaignId: 'cmp-1',
};

describe('getTroubleshootState', () => {
  it('returns the row when one exists', async () => {
    const row = {
      id: 'row-1',
      organizationId: 'org-1',
      metaCampaignId: 'cmp-1',
      currentRound: 'offer_adjusted',
    };
    const findFirst = vi.fn().mockResolvedValueOnce(row);
    const result = await getTroubleshootState(
      makeDb(findFirst) as never,
      validInput
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it('returns null (not NOT_FOUND) when no row exists', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(undefined);
    const result = await getTroubleshootState(
      makeDb(findFirst) as never,
      validInput
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    const findFirst = vi.fn();
    const result = await getTroubleshootState(makeDb(findFirst) as never, {
      organizationId: '',
      metaCampaignId: 'cmp-1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the query throws', async () => {
    const findFirst = vi.fn().mockRejectedValueOnce(new Error('db down'));
    const result = await getTroubleshootState(
      makeDb(findFirst) as never,
      validInput
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
