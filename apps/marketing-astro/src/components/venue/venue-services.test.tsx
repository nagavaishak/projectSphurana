// @vitest-environment jsdom

import type { VenueConfig } from '@borradh-workspace/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanup, render, screen } from '@testing-library/react';

import { VenueServices } from './venue-services';

/**
 * The venue page has ALREADY resolved a branch — every service row it lists is
 * that branch's, at that branch's price. A per-service Book button that drops
 * the branch sends the customer to the chooser and asks them to pick the
 * location they are standing on, right after reading its address and hours.
 *
 * The sticky "Book now" card next door was fixed first and this one was missed,
 * which is exactly why it is pinned here: the two buttons sit on the same page
 * and there is nothing in the types that made them agree.
 */
const service = (over: Partial<VenueConfig['services'][number]> = {}) =>
  ({
    id: 'svc_1',
    name: 'Deluxe Facial',
    description: null,
    category: null,
    priceText: null,
    priceType: 'fixed',
    priceCents: 25000,
    appointmentDuration: 60,
    variants: [],
    ...over,
  }) as VenueConfig['services'][number];

afterEach(() => cleanup());

const bookHref = () =>
  (
    screen.getByRole('link', { name: /^book$/i }) as HTMLAnchorElement
  ).getAttribute('href');

describe('VenueServices — the per-service Book button carries the branch', () => {
  it('links into the branch the page is showing', () => {
    render(
      <VenueServices
        organizationSlug="sharp cuts/ie"
        branchSegment="cork"
        services={[service()]}
        currencySymbol="€"
      />
    );

    // Both segments encoded — the org slug carries a space and a slash on
    // purpose, to prove neither is spliced in raw.
    expect(bookHref()).toBe('/sites/sharp%20cuts%2Fie/l/cork/book/svc_1');
  });

  it('addresses a slug-less branch by the id it was given', () => {
    // `slug` is nullable and the backfill has not run, so the caller resolves
    // `slug ?? id` and this component just carries whatever it is handed.
    render(
      <VenueServices
        organizationSlug="glow"
        branchSegment="ib0go2zlh69el"
        services={[service()]}
        currencySymbol="€"
      />
    );

    expect(bookHref()).toBe('/sites/glow/l/ib0go2zlh69el/book/svc_1');
  });

  it('encodes a service id rather than splicing it', () => {
    render(
      <VenueServices
        organizationSlug="glow"
        branchSegment="cork"
        services={[service({ id: 'svc/1 2' })]}
        currencySymbol="€"
      />
    );

    expect(bookHref()).toBe('/sites/glow/l/cork/book/svc%2F1%202');
  });
});
