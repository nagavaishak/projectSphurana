import { organizationLocation } from '@borradh-workspace/database';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { asc } from 'drizzle-orm';
import { vi } from 'vitest';
import { resolveDefaultLocation } from './resolve-default-location.service.js';

/**
 * "Which branch does a location-less entry point belong to" is now answered in
 * one place, because three surfaces answer it and they must agree: the public
 * venue page prices against it, the general booking form prices against it,
 * and `submitGeneralBooking` stamps the appointment with it. If they disagreed,
 * a customer could be quoted one branch's price and land on another's diary.
 */
describe('resolveDefaultLocation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the resolved location', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-primary',
      country: 'IE',
    });

    const result = await resolveDefaultLocation(mockDb as never, 'org-1');

    expect(result).toEqual({ id: 'loc-primary', country: 'IE' });
  });

  it('orders by isPrimary DESC, sortOrder ASC, then id — so a total tie is still deterministic', async () => {
    // The bug this replaces filtered on `isPrimary = true` with no tie-break,
    // so an org that never set the flag resolved NOTHING and silently fell
    // through to a default currency. The ordering must be a preference, not a
    // filter.
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-a',
      country: 'IE',
    });

    await resolveDefaultLocation(mockDb as never, 'org-1');

    const call = mockDb.query.organizationLocation.findFirst.mock.calls[0][0];
    // THREE keys, not two. The third is the one that matters for correctness:
    // both `isPrimary` and `sortOrder` default to `false` / `0` and no database
    // constraint enforces one primary per org, so an org with none set ties
    // completely — and without a final key Postgres may return a different row
    // per call. The booking form would then price against one branch while the
    // submit, a separate request, files the appointment at another.
    expect(call.orderBy).toHaveLength(3);
    // Compared against the real `asc(id)` — drizzle's ordering objects
    // stringify to "[object Object]", so a text match would pass on anything.
    expect(call.orderBy.at(-1)).toEqual(asc(organizationLocation.id));
    // No `where` on isPrimary — only the org predicate.
    expect(String(call.where)).not.toContain('is_primary');
  });

  it('returns null for an org with no locations rather than throwing', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      undefined as never
    );

    await expect(
      resolveDefaultLocation(mockDb as never, 'org-1')
    ).resolves.toBeNull();
  });
});
