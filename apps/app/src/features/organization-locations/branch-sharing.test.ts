import { describe, expect, it } from 'vitest';

import { isSharedAcrossBranches } from './branch-sharing';

describe('isSharedAcrossBranches', () => {
  it('treats NO links as every branch — the case a length check misses', () => {
    // Every org's join tables are empty today, so `locationIds.length > 1`
    // would answer "not shared" for every record in production.
    expect(isSharedAcrossBranches({ locationIds: [], totalBranches: 3 })).toBe(
      true
    );
  });

  it('is not shared in a single-branch business, whatever the links say', () => {
    expect(isSharedAcrossBranches({ locationIds: [], totalBranches: 1 })).toBe(
      false
    );
    expect(
      isSharedAcrossBranches({ locationIds: ['loc-1'], totalBranches: 1 })
    ).toBe(false);
  });

  it('is not shared when it is pinned to this one branch only', () => {
    expect(
      isSharedAcrossBranches({ locationIds: ['loc-1'], totalBranches: 3 })
    ).toBe(false);
  });

  it('is shared when pinned to two or more', () => {
    expect(
      isSharedAcrossBranches({
        locationIds: ['loc-1', 'loc-2'],
        totalBranches: 3,
      })
    ).toBe(true);
  });
});
