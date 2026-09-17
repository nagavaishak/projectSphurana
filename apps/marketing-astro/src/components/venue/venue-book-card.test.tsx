// @vitest-environment jsdom

import type { VenueConfig } from '@borradh-workspace/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, render, screen } from '@testing-library/react';

import { VenueBookCard } from './venue-book-card';

/**
 * The venue page has ALREADY resolved a branch — its name, hours and address
 * are that branch's. Its Book CTA used to point at the ORG-level `/book`, so a
 * customer reading Cork's address clicked Book and was quoted, offered hours
 * for, and booked into the org's default branch. These two cases are that bug
 * and its only safe fallback.
 */

const venue = (
  location?: Partial<VenueConfig['location']>,
  hasOtherLocations = false
): Pick<VenueConfig, 'organization' | 'location' | 'hasOtherLocations'> => ({
  hasOtherLocations,
  organization: {
    name: 'Sharp Cuts',
    slug: 'sharp cuts/ie',
    logo: null,
    timezone: 'Europe/Dublin',
    reschedulingNoticeRequiredHours: null,
    noShowOrLateCancelFeeCents: null,
  },
  location: {
    id: 'loc-1',
    slug: 'cork',
    name: 'Sharp Cuts Cork',
    about: null,
    amenities: [],
    addressLine1: '12 Oliver Plunkett St',
    addressLine2: null,
    city: 'Cork',
    county: null,
    postalCode: null,
    country: 'ie',
    latitude: null,
    longitude: null,
    openingHours: null,
    ...location,
  },
});

// RTL only auto-cleans under `globals: true`, which this app does not set —
// without this the second case renders into the first one's DOM and the CTA
// lookup fails with "multiple elements found". Same note as ../booking/test-render.
afterEach(() => cleanup());

const bookHref = () =>
  (
    screen.getByRole('link', { name: /book now/i }) as HTMLAnchorElement
  ).getAttribute('href');

const allHref = () =>
  (
    screen.queryByRole('link', {
      name: /view all locations/i,
    }) as HTMLAnchorElement | null
  )?.getAttribute('href') ?? null;

describe('VenueBookCard — the Book CTA carries the branch', () => {
  it('links into the branch the page is showing', () => {
    render(<VenueBookCard venue={venue() as VenueConfig} />);

    // Both segments encoded — a slug is user-controlled text, and the org slug
    // here contains a space and a slash precisely to prove it is not spliced.
    expect(bookHref()).toBe('/sites/sharp%20cuts%2Fie/l/cork/book');
  });

  it('addresses a slug-less branch by id instead of falling back to the org', () => {
    // THE CASE THAT INVERTED, and it was not an edge case: `slug` is nullable
    // and the backfill has not run, so pre-backfill EVERY branch took the old
    // fallback. The comment in the component promised the CTA carries the
    // branch; for every real org it silently did not.
    render(<VenueBookCard venue={venue({ slug: null }) as VenueConfig} />);

    expect(bookHref()).toBe('/sites/sharp%20cuts%2Fie/l/loc-1/book');
  });
});

describe('VenueBookCard — getting back out to the other branches', () => {
  it('offers "View all locations" when there is somewhere else to go', () => {
    render(<VenueBookCard venue={venue(undefined, true) as VenueConfig} />);

    expect(allHref()).toBe('/sites/sharp%20cuts%2Fie/book');
  });

  it('offers nothing of the sort on a single-branch clinic', () => {
    // The chooser would 302 straight back to this page — a control that looks
    // like a choice and is not one.
    render(<VenueBookCard venue={venue() as VenueConfig} />);

    expect(allHref()).toBeNull();
  });
});
