import { describe, expect, it } from 'vitest';
import {
  BRANCH_SEGMENT,
  branchBookingPath,
  branchDirectionsUrl,
  branchSegmentFor,
  branchVenuePath,
  formatBranchAddress,
  summariseOpeningHours,
} from './location-chooser';

const ADDRESS = {
  addressLine1: '12 Baggot Street',
  addressLine2: null,
  city: 'Dublin',
  county: 'Dublin',
  postalCode: 'D02 X285',
};

describe('formatBranchAddress', () => {
  it('joins the present parts and drops the empty ones', () => {
    expect(formatBranchAddress(ADDRESS)).toBe(
      '12 Baggot Street, Dublin, Dublin, D02 X285'
    );
  });

  it('drops whitespace-only parts rather than emitting ", , "', () => {
    expect(
      formatBranchAddress({
        ...ADDRESS,
        addressLine2: '   ',
        county: null,
        postalCode: null,
      })
    ).toBe('12 Baggot Street, Dublin');
  });
});

describe('summariseOpeningHours', () => {
  it('collapses a run of identical days into one row', () => {
    const weekday = { from: 540, to: 1080 };
    const rows = summariseOpeningHours({
      '1': weekday,
      '2': weekday,
      '3': weekday,
      '4': weekday,
      '5': weekday,
      '6': { from: 600, to: 960 },
    });

    expect(rows).toEqual([
      { days: 'Mon – Fri', hours: '9:00 am – 6:00 pm' },
      { days: 'Sat', hours: '10:00 am – 4:00 pm' },
      { days: 'Sun', hours: 'Closed' },
    ]);
  });

  it('does not merge days that only LOOK adjacent in the map key order', () => {
    // Monday and Wednesday share hours, Tuesday does not. Week order is what
    // decides adjacency, so this must be three rows, not "Mon – Wed".
    const rows = summariseOpeningHours({
      '1': { from: 540, to: 1080 },
      '2': { from: 600, to: 1080 },
      '3': { from: 540, to: 1080 },
    });

    expect(rows.slice(0, 3)).toEqual([
      { days: 'Mon', hours: '9:00 am – 6:00 pm' },
      { days: 'Tue', hours: '10:00 am – 6:00 pm' },
      { days: 'Wed', hours: '9:00 am – 6:00 pm' },
    ]);
  });

  it('returns no rows at all when hours are absent', () => {
    expect(summariseOpeningHours(null)).toEqual([]);
    expect(summariseOpeningHours({})).toEqual([]);
  });

  it('renders midnight and noon on the right side of the meridiem', () => {
    const rows = summariseOpeningHours({ '1': { from: 0, to: 720 } });
    expect(rows[0]).toEqual({
      days: 'Mon',
      hours: '12:00 am – 12:00 pm',
    });
  });
});

describe('branchSegmentFor', () => {
  it('prefers the slug — it is the readable, shareable form', () => {
    expect(branchSegmentFor({ id: 'ib0go2zlh69el', slug: 'cork' })).toBe(
      'cork'
    );
  });

  // THE POINT OF THE FALLBACK. `organization_location.slug` is nullable until
  // the backfill runs, and pre-backfill EVERY row is null — so without this a
  // branch had no public address at all and the chooser never appeared for
  // anyone.
  it('falls back to the id when the branch has no slug yet', () => {
    expect(branchSegmentFor({ id: 'ib0go2zlh69el', slug: null })).toBe(
      'ib0go2zlh69el'
    );
  });

  it('treats an empty slug as absent, not as a valid segment', () => {
    // An empty segment would build `/l//book`, which routes nowhere.
    expect(branchSegmentFor({ id: 'ib0go2zlh69el', slug: '' })).toBe(
      'ib0go2zlh69el'
    );
  });
});

describe('branchBookingPath', () => {
  // The branch is a PREFIX, not a suffix inside /book: one convention has to
  // cover the venue page too, or /venue keeps having no branch concept.
  it('puts the branch ahead of the surface, behind the reserved segment', () => {
    expect(branchBookingPath('cork')).toBe(`/${BRANCH_SEGMENT}/cork/book`);
  });

  it('carries a service through the pick', () => {
    expect(branchBookingPath('cork', 'svc_1')).toBe(
      `/${BRANCH_SEGMENT}/cork/book/svc_1`
    );
  });

  it('encodes both segments', () => {
    expect(branchBookingPath('st patrick/s', 'a b')).toBe(
      `/${BRANCH_SEGMENT}/st%20patrick%2Fs/book/a%20b`
    );
  });

  it('addresses a slug-less branch by id, end to end', () => {
    const branch = { id: 'ib0go2zlh69el', slug: null };
    expect(branchBookingPath(branchSegmentFor(branch))).toBe(
      `/${BRANCH_SEGMENT}/ib0go2zlh69el/book`
    );
  });
});

describe('branchVenuePath', () => {
  // Same segment, same position — a customer moving between a branch's venue
  // page and its booking flow must not have the scope change under them.
  it('shares the branch segment with the booking path', () => {
    expect(branchVenuePath('cork')).toBe(`/${BRANCH_SEGMENT}/cork/venue`);
  });

  it('encodes the segment', () => {
    expect(branchVenuePath('st patrick/s')).toBe(
      `/${BRANCH_SEGMENT}/st%20patrick%2Fs/venue`
    );
  });
});

describe('branchDirectionsUrl', () => {
  it('prefers coordinates', () => {
    const url = branchDirectionsUrl({
      ...ADDRESS,
      latitude: 53.33,
      longitude: -6.24,
    });
    expect(url).toContain('destination=53.33%2C-6.24');
  });

  it('falls back to the text address', () => {
    const url = branchDirectionsUrl({
      ...ADDRESS,
      latitude: null,
      longitude: null,
    });
    expect(url).toContain('12%20Baggot%20Street');
  });

  it('is null when there is nothing to navigate to', () => {
    expect(
      branchDirectionsUrl({
        addressLine1: '',
        addressLine2: null,
        city: '',
        county: null,
        postalCode: null,
        latitude: null,
        longitude: null,
      })
    ).toBeNull();
  });
});
