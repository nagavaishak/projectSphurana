import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import {
  clearBudgetFailure,
  flagBudgetFailure,
  resolveBudgetFailureInterlock,
} from './budget-failure-interlock.service.js';

const findFirst = vi.fn();
const mockDb = {
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
  query: { assistantConversation: { findFirst } },
};

const base = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  metaCampaignId: 'mc-1',
};

describe('budget-failure interlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.returning.mockResolvedValue([{ id: 'conv-1' }]);
  });

  it('flagBudgetFailure writes the campaign onto the conversation', async () => {
    const result = await flagBudgetFailure(mockDb as never, base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.flagged).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('resolve returns blocked:false when nothing is flagged', async () => {
    findFirst.mockResolvedValueOnce({ budgetFailureCampaignIds: [] });
    const result = await resolveBudgetFailureInterlock(mockDb as never, {
      ...base,
      acknowledged: false,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.blocked).toBe(false);
  });

  it('resolve BLOCKS when the campaign is flagged and not acknowledged', async () => {
    findFirst.mockResolvedValueOnce({ budgetFailureCampaignIds: ['mc-1'] });
    const result = await resolveBudgetFailureInterlock(mockDb as never, {
      ...base,
      acknowledged: false,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.blocked).toBe(true);
    // A blocked resolve must NOT clear the flag.
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('resolve clears and permits when the owner acknowledges', async () => {
    findFirst.mockResolvedValueOnce({ budgetFailureCampaignIds: ['mc-1'] });
    const result = await resolveBudgetFailureInterlock(mockDb as never, {
      ...base,
      acknowledged: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blocked).toBe(false);
      expect(result.data.cleared).toBe(true);
    }
    // Clearing writes the campaign back out of the array.
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('clearBudgetFailure removes the campaign', async () => {
    const result = await clearBudgetFailure(mockDb as never, base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cleared).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });
});
