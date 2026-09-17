import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { vi } from 'vitest';
import {
  isBookingLocationAddressable,
  resolveBookingLocation,
} from './resolve-booking-location.service.js';

/**
 * Which branch a PUBLIC booking call means.
 *
 * The property under test is that a branch is addressable BEFORE the slug
 * backfill runs. `organization_location.slug` is nullable and every production
 * row is currently null, so a slug-only lookup meant the public chooser could
 * never link to anything and every customer was silently resolved into the
 * org's primary branch — the exact defect the branch work exists to close.
 */
describe('resolveBookingLocation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => vi.clearAllMocks());

  /** The WHERE clause the lookup actually built. */
  const capturedWhere = (): { sql: string; params: unknown[] } => {
    const config = mockDb.query.organizationLocation.findFirst.mock
      .calls[0]?.[0] as { where?: SQL } | undefined;
    expect(config?.where).toBeDefined();
    return new PgDialect().sqlToQuery(config?.where as SQL);
  };

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'loc_cork',
    slug: 'cork',
    name: 'Cork',
    country: 'ie',
    openingHours: null,
    addressLine1: '1 Patrick Street',
    addressLine2: null,
    city: 'Cork',
    county: null,
    postalCode: null,
    ...over,
  });

  it('matches the handle against the slug OR the id', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(row());

    await resolveBookingLocation(mockDb as never, 'org_1', 'cork');

    const { sql, params } = capturedWhere();
    expect(sql).toContain('"slug" = $');
    expect(sql).toContain('"id" = $');
    expect(sql).toMatch(/ or /i);
    // The handle is bound once per arm; the org scope is bound too.
    expect(params).toContain('cork');
    expect(params).toContain('org_1');
  });

  it('scopes BOTH arms to the org, so a foreign id resolves to nothing', async () => {
    // A branch id is a public URL segment. Without the org scope on the id arm,
    // pasting another tenant's id into the path would serve that tenant's
    // branch — its name, address and hours — from this org's page.
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      undefined as never
    );

    const result = await resolveBookingLocation(
      mockDb as never,
      'org_1',
      'loc_belonging_to_org_2'
    );

    const { sql } = capturedWhere();
    expect(sql).toContain('"organization_id" = $');
    // The org predicate is ANDed OUTSIDE the or(), not folded into one arm.
    expect(sql.indexOf('"organization_id"')).toBeLessThan(sql.indexOf(' or '));
    expect(result).toBeNull();
  });

  it('resolves a branch that has no slug yet, by id', async () => {
    // Production's current state for every row.
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      row({ slug: null })
    );

    const result = await resolveBookingLocation(
      mockDb as never,
      'org_1',
      'loc_cork'
    );

    expect(result?.id).toBe('loc_cork');
    expect(result?.slug).toBeNull();
  });

  it('falls back to the org default when given no handle at all', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(row());

    await resolveBookingLocation(mockDb as never, 'org_1');

    const config = mockDb.query.organizationLocation.findFirst.mock
      .calls[0]?.[0] as { where?: SQL; orderBy?: unknown[] } | undefined;
    const { sql } = new PgDialect().sqlToQuery(config?.where as SQL);
    // No handle to match, so neither arm is built — just the org scope.
    expect(sql).not.toContain('"slug" = $');
    expect(sql).not.toContain('"id" = $');
    // Ordered so "the default branch" is one branch, not whichever came back.
    expect(config?.orderBy?.length).toBeGreaterThan(0);
  });

  it('ranks a slug match above an id match on the SAME handle', async () => {
    // Degenerate but decidable: an org that named one branch after another's
    // id. The slug wins, so a link keeps meaning what its author typed.
    // Ordering on the PREDICATE, because `desc(slug)` is NULLS FIRST in
    // Postgres and would rank the slug-less row first.
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(row());

    await resolveBookingLocation(mockDb as never, 'org_1', 'cork');

    const config = mockDb.query.organizationLocation.findFirst.mock
      .calls[0]?.[0] as { orderBy?: SQL[] } | undefined;
    const order = config?.orderBy?.[0];
    expect(order).toBeDefined();
    const { sql } = new PgDialect().sqlToQuery(order as SQL);
    expect(sql).toContain('"slug" = $');
    expect(sql.toLowerCase()).toContain('desc');
  });
});

/**
 * The guard that survived the change, narrowed.
 *
 * It used to ask "does this branch have a slug". That is now always yes. The
 * question that remains is whether the ROW names a branch at all — every
 * pre-backfill appointment has `location_id = NULL`, and there is nothing to
 * put in a URL for those.
 */
describe('isBookingLocationAddressable', () => {
  it('is true for a branch we know, whatever its slug', () => {
    expect(isBookingLocationAddressable({ id: 'loc_cork' }, 3)).toBe(true);
  });

  it('is FALSE for a row with no branch on a multi-branch org', () => {
    // Omitting the segment resolves the org's DEFAULT branch, so offering an
    // online reschedule here would show one branch's diary and book into it
    // without the customer ever choosing.
    expect(isBookingLocationAddressable(null, 3)).toBe(false);
  });

  it('is true for a row with no branch when the org has only one', () => {
    // Not a loophole: the default IS that branch. There is nothing else it
    // could resolve to.
    expect(isBookingLocationAddressable(null, 1)).toBe(true);
    expect(isBookingLocationAddressable(null, 0)).toBe(true);
  });
});
