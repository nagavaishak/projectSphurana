/**
 * The entry decision, pinned.
 *
 * These three rules decide whether a customer is asked which branch they want,
 * sent straight to one, or quietly booked into the org's default — and getting
 * the last one wrong is the bug the whole phase exists to fix. So they are
 * asserted here rather than left to be re-read out of two `.astro` frontmatters.
 */
import type { ListBookingLocationsResponse } from '@borradh-workspace/contracts';
import { describe, expect, it } from 'vitest';
import { decideBookingEntry } from './_booking-locations';

type Branch = ListBookingLocationsResponse['locations'][number];

const branch = (over: Partial<Branch>): Branch => ({
  id: 'loc_1',
  slug: 'dublin',
  name: 'Dublin',
  addressLine1: '12 Baggot Street',
  addressLine2: null,
  city: 'Dublin',
  county: null,
  postalCode: null,
  country: 'ie',
  latitude: null,
  longitude: null,
  openingHours: null,
  photo: null,
  isPrimary: true,
  ...over,
});

const payload = (locations: Branch[]): ListBookingLocationsResponse => ({
  organizationName: 'Glow Clinic',
  organizationSlug: 'glow',
  organizationLogo: null,
  locations,
});

describe('decideBookingEntry', () => {
  it('shows the chooser for two or more branches', () => {
    const entry = decideBookingEntry(
      payload([
        branch({ id: 'loc_1', slug: 'dublin' }),
        branch({ id: 'loc_2', slug: 'cork', isPrimary: false }),
      ])
    );

    expect(entry.kind).toBe('chooser');
    if (entry.kind !== 'chooser') return;
    expect(entry.payload.locations.map((l) => l.slug)).toEqual([
      'dublin',
      'cork',
    ]);
    // The rest of the payload survives — the card header renders from it.
    expect(entry.payload.organizationName).toBe('Glow Clinic');
  });

  it('302s past a one-option chooser', () => {
    const entry = decideBookingEntry(payload([branch({ slug: 'dublin' })]));
    expect(entry).toEqual({ kind: 'single', branch: expect.anything() });
    if (entry.kind !== 'single') return;
    expect(entry.branch.segment).toBe('dublin');
  });

  it('offers a slug-less branch, addressed by its id', () => {
    // THE RULE THAT INVERTED. This used to filter such branches out, because
    // the API resolved a branch by slug only. It now resolves `slug ?? id`, so
    // a branch with no slug is a normal card with a working link — and the
    // chooser shows three, not one.
    const entry = decideBookingEntry(
      payload([
        branch({ id: 'loc_1', slug: 'dublin' }),
        branch({ id: 'loc_2', slug: null, isPrimary: false }),
        branch({ id: 'loc_3', slug: '', isPrimary: false }),
      ])
    );

    expect(entry.kind).toBe('chooser');
    if (entry.kind !== 'chooser') return;
    expect(entry.payload.locations.map((l) => l.segment)).toEqual([
      'dublin',
      'loc_2',
      'loc_3',
    ]);
  });

  it('shows the chooser when NO branch has a slug yet', () => {
    // Production's CURRENT state — the slug backfill has not run, so every row
    // is null. Under the old rule this fell through to the unscoped wizard,
    // which meant the chooser existed but no real org could ever see it: a
    // multi-branch clinic silently kept booking everyone into its primary
    // branch. This assertion is the one that would have caught that.
    const entry = decideBookingEntry(
      payload([
        branch({ id: 'loc_1', slug: null }),
        branch({ id: 'loc_2', slug: null, isPrimary: false }),
      ])
    );

    expect(entry.kind).toBe('chooser');
    if (entry.kind !== 'chooser') return;
    expect(entry.payload.locations.map((l) => l.segment)).toEqual([
      'loc_1',
      'loc_2',
    ]);
  });

  it('302s a single slug-less branch to its id, not past the branch entirely', () => {
    const entry = decideBookingEntry(
      payload([branch({ id: 'loc_9', slug: null })])
    );
    expect(entry.kind).toBe('single');
    if (entry.kind !== 'single') return;
    expect(entry.branch.segment).toBe('loc_9');
  });

  it('falls through to the unscoped wizard for a zero-location org', () => {
    expect(decideBookingEntry(payload([]))).toEqual({ kind: 'branchless' });
  });

  it('falls through rather than failing closed when the call did not come back', () => {
    // A 404, a 5xx and a timeout all arrive here as null. Booking still works;
    // it just cannot offer a choice.
    expect(decideBookingEntry(null)).toEqual({ kind: 'branchless' });
  });
});
