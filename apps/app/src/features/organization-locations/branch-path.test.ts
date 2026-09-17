import { describe, expect, it } from 'vitest';

import {
  branchHandle,
  branchIdFromPath,
  branchPath,
  findBranchByHandle,
  stripBranchFromPath,
  swapBranchInPath,
} from './branch-path.js';

describe('branchIdFromPath', () => {
  it('reads the id out of a branch-scoped path', () => {
    expect(branchIdFromPath('/dashboard/l/loc-1/calendar/day')).toBe('loc-1');
  });

  it('reads the id with no sub-path', () => {
    expect(branchIdFromPath('/dashboard/l/loc-1')).toBe('loc-1');
  });

  it('returns null for an org-level path', () => {
    // Settings, billing and locations deliberately sit OUTSIDE the prefix.
    expect(branchIdFromPath('/dashboard/settings/details')).toBeNull();
    expect(branchIdFromPath('/dashboard')).toBeNull();
  });

  it('returns null rather than an empty id for a trailing prefix', () => {
    expect(branchIdFromPath('/dashboard/l/')).toBeNull();
  });

  it('does not mistake a look-alike prefix for a branch path', () => {
    // `/dashboard/leads` starts with `/dashboard/l` — matching on the literal
    // segment and not a character prefix is the whole point.
    expect(branchIdFromPath('/dashboard/leads')).toBeNull();
  });
});

describe('swapBranchInPath', () => {
  it('preserves the sub-path when switching branch', () => {
    // The payoff behaviour: switching while on the week calendar lands on the
    // other branch's week calendar, not its home screen.
    expect(swapBranchInPath('/dashboard/l/loc-1/calendar/week', 'loc-2')).toBe(
      '/dashboard/l/loc-2/calendar/week'
    );
  });

  it('handles a bare branch root', () => {
    expect(swapBranchInPath('/dashboard/l/loc-1', 'loc-2')).toBe(
      '/dashboard/l/loc-2'
    );
  });

  it('returns null on an org-level path, so the user is not moved', () => {
    // Switching branch from mid-way through Settings must not throw the user
    // off the page they are editing.
    expect(swapBranchInPath('/dashboard/settings/details', 'loc-2')).toBeNull();
  });
});

describe('branchPath', () => {
  it('joins with or without a leading slash', () => {
    expect(branchPath('loc-1', '/calendar')).toBe(
      '/dashboard/l/loc-1/calendar'
    );
    expect(branchPath('loc-1', 'calendar')).toBe('/dashboard/l/loc-1/calendar');
  });

  it('builds the branch root with no sub-path', () => {
    expect(branchPath('loc-1')).toBe('/dashboard/l/loc-1');
  });
});

describe('stripBranchFromPath', () => {
  it('normalises a branch path back to its org-level shape', () => {
    // The sidebar matches on `/dashboard/…` prefixes; normalising here keeps
    // the URL shape out of the nav config.
    expect(stripBranchFromPath('/dashboard/l/loc-1/calendar/day')).toBe(
      '/dashboard/calendar/day'
    );
  });

  it('leaves an org-level path untouched', () => {
    expect(stripBranchFromPath('/dashboard/settings')).toBe(
      '/dashboard/settings'
    );
  });

  it('yields bare /dashboard for a branch root', () => {
    expect(stripBranchFromPath('/dashboard/l/loc-1')).toBe('/dashboard');
  });
});

describe('readable URLs (slug or id)', () => {
  const dublin = { id: 'loc_abc123', slug: 'dublin' };
  const unnamed = { id: 'loc_def456', slug: null };

  it('prefers the slug so the URL reads like a place', () => {
    expect(branchHandle(dublin)).toBe('dublin');
    expect(branchPath(branchHandle(dublin), '/calendar')).toBe(
      '/dashboard/l/dublin/calendar'
    );
  });

  it('falls back to the id when the branch has no slug', () => {
    // `organization_location.slug` is NULLABLE — a single-location org never
    // needs one — so demanding a slug would 404 for most orgs.
    expect(branchHandle(unnamed)).toBe('loc_def456');
    expect(branchPath(branchHandle(unnamed), '/calendar')).toBe(
      '/dashboard/l/loc_def456/calendar'
    );
  });

  it('resolves a branch from EITHER its slug or its id', () => {
    // An id-form URL bookmarked before the branch was named must keep working.
    const all = [dublin, unnamed];
    expect(findBranchByHandle(all, 'dublin')).toBe(dublin);
    expect(findBranchByHandle(all, 'loc_abc123')).toBe(dublin);
    expect(findBranchByHandle(all, 'loc_def456')).toBe(unnamed);
    expect(findBranchByHandle(all, 'nope')).toBeUndefined();
  });

  it('does not match a null slug against a missing handle', () => {
    // `slug === handle` with both nullish would otherwise match the wrong row.
    expect(
      findBranchByHandle([unnamed], undefined as unknown as string)
    ).toBeUndefined();
  });

  it('swaps a slug URL to another branch by handle', () => {
    expect(swapBranchInPath('/dashboard/l/dublin/calendar/week', 'cork')).toBe(
      '/dashboard/l/cork/calendar/week'
    );
  });

  it('strips a slug segment the same as an id segment', () => {
    expect(stripBranchFromPath('/dashboard/l/dublin/calendar')).toBe(
      '/dashboard/calendar'
    );
  });
});
