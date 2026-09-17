import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { resolveConversationBranch } from './resolve-conversation-branch.js';

/**
 * Which branch a customer conversation is about.
 *
 * The property under test is RESTRAINT. Every tier is a signal someone gave us;
 * anything else must return null. A fabricated branch is worse than none — it
 * is indistinguishable afterwards from a real one, and it silently changes the
 * price a customer is quoted.
 */
describe('resolveConversationBranch', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => vi.clearAllMocks());

  const singleLocation = (rows: { id: string }[]) => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(rows);
  };

  it('takes the branch from the ad the conversation came from', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      metaCampaignId: 'camp-1',
    });
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      locationId: 'loc-cork',
    });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-cork',
    });

    const result = await resolveConversationBranch(mockDb as never, {
      organizationId: 'org-1',
      adInternalId: 'ad-1',
    });

    expect(result).toBe('loc-cork');
    // The single-branch fallback must not have been consulted — the ad won.
    expect(mockDb.query.organizationLocation.findMany).not.toHaveBeenCalled();
  });

  it('refuses a branch that is not this org, even though the FK accepts it', async () => {
    // A foreign key does NOT enforce tenant isolation: Postgres validates FKs
    // internally, unfiltered by RLS. The branch being real does not make it
    // ours, so ownership is checked explicitly.
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      metaCampaignId: 'camp-1',
    });
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      locationId: 'loc-other-org',
    });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      undefined as never
    );
    singleLocation([{ id: 'loc-a' }, { id: 'loc-b' }]);

    const result = await resolveConversationBranch(mockDb as never, {
      organizationId: 'org-1',
      adInternalId: 'ad-1',
    });

    expect(result).toBeNull();
  });

  it('returns null for a multi-branch org with no ad rather than the default', async () => {
    // THE POINT OF THE WHOLE FUNCTION. `resolveDefaultLocation` would happily
    // answer here, and its answer would be a guess stamped onto the record as
    // though the customer had said it. Null leaves the caller free to ask.
    singleLocation([{ id: 'loc-a' }, { id: 'loc-b' }]);

    const result = await resolveConversationBranch(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result).toBeNull();
  });

  it('resolves the only branch of a single-branch org', async () => {
    // One branch is a FACT, not a guess. Setting it keeps null meaning strictly
    // "we never knew".
    singleLocation([{ id: 'loc-only' }]);

    const result = await resolveConversationBranch(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result).toBe('loc-only');
  });

  it('falls through when the campaign carries no branch', async () => {
    // Campaigns created in Meta Ads Manager are backfilled by
    // ensureCampaignConfig, which does not set a location — so this is the
    // COMMON case for an imported campaign, not an edge case.
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      metaCampaignId: 'camp-1',
    });
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      locationId: null,
    });
    singleLocation([{ id: 'loc-only' }]);

    const result = await resolveConversationBranch(mockDb as never, {
      organizationId: 'org-1',
      adInternalId: 'ad-1',
    });

    expect(result).toBe('loc-only');
  });

  it('falls through when the ad has no campaign', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      metaCampaignId: null,
    });
    singleLocation([{ id: 'loc-a' }, { id: 'loc-b' }]);

    const result = await resolveConversationBranch(mockDb as never, {
      organizationId: 'org-1',
      adInternalId: 'ad-1',
    });

    expect(result).toBeNull();
    expect(mockDb.query.metaCampaignConfig.findFirst).not.toHaveBeenCalled();
  });

  it('returns null for an org with no branches at all', async () => {
    singleLocation([]);

    const result = await resolveConversationBranch(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result).toBeNull();
  });
});
