/**
 * THE CHOOSER MUST BE IN THE BYTES.
 *
 * The venue page next door renders through `client:load`, so its HTML is an
 * empty shell: a crawler, a customer whose bundle failed, and anyone reading
 * view-source all see nothing (audit addendum D). This page is the top of a
 * clinic's booking funnel, so the same defect here would be worse.
 *
 * Grepping the source for `client:` would only prove a string is absent from a
 * file. This renders the real component through the real Astro container and
 * asserts on the bytes a visitor would receive — the branch names, the
 * addresses, the hours and, above all, the hrefs.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BookingChooserPayload } from './location-chooser';
import LocationChooser from './location-chooser.astro';

const WEEKDAY = { from: 540, to: 1080 };

const PAYLOAD: BookingChooserPayload = {
  organizationName: 'Glow Clinic',
  organizationSlug: 'glow',
  organizationLogo: 'https://cdn.test/logo.png',
  locations: [
    {
      id: 'loc_1',
      slug: 'dublin',
      segment: 'dublin',
      name: 'Glow Dublin',
      addressLine1: '12 Baggot Street',
      addressLine2: null,
      city: 'Dublin',
      county: null,
      postalCode: 'D02 X285',
      country: 'ie',
      latitude: 53.33,
      longitude: -6.24,
      openingHours: { '1': WEEKDAY, '2': WEEKDAY },
      photo: 'https://cdn.test/dublin.jpg',
      isPrimary: true,
    },
    {
      id: 'loc_2',
      slug: 'cork',
      segment: 'cork',
      name: 'Glow Cork',
      addressLine1: '4 Oliver Plunkett Street',
      addressLine2: null,
      city: 'Cork',
      county: null,
      postalCode: null,
      country: 'ie',
      latitude: null,
      longitude: null,
      openingHours: null,
      photo: null,
      isPrimary: false,
    },
  ],
};

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

const render = (props: Record<string, unknown>) =>
  container.renderToString(LocationChooser, { props });

describe('location chooser HTML', () => {
  it('ships no client island', async () => {
    const html = await render({
      payload: PAYLOAD,
      orgContext: { basePath: '/sites/glow' },
    });
    expect(html).not.toContain('astro-island');
    expect(html).not.toContain('client:');
  });

  it('names every branch and its address in the markup', async () => {
    const html = await render({
      payload: PAYLOAD,
      orgContext: { basePath: '/sites/glow' },
    });

    expect(html).toContain('Glow Dublin');
    expect(html).toContain('12 Baggot Street, Dublin, D02 X285');
    expect(html).toContain('Glow Cork');
    expect(html).toContain('4 Oliver Plunkett Street, Cork');
    expect(html).toContain('9:00 am – 6:00 pm');
  });

  it('badges the primary branch once', async () => {
    const html = await render({
      payload: PAYLOAD,
      orgContext: { basePath: '/sites/glow' },
    });
    expect(html.match(/Main location/g)).toHaveLength(1);
  });

  it('links each card at the branch-scoped wizard, under the microsite base', async () => {
    const html = await render({
      payload: PAYLOAD,
      orgContext: { basePath: '/sites/glow' },
    });
    expect(html).toContain('href="/sites/glow/l/dublin/book"');
    expect(html).toContain('href="/sites/glow/l/cork/book"');
  });

  it('carries a legacy service through the pick', async () => {
    const html = await render({
      payload: PAYLOAD,
      orgContext: { basePath: '/sites/glow' },
      serviceId: 'svc_1',
    });
    expect(html).toContain('href="/sites/glow/l/dublin/book/svc_1"');
    expect(html).toContain('href="/sites/glow/l/cork/book/svc_1"');
  });

  it('builds base-relative links on a host tier, not links back to ours', async () => {
    const html = await render({
      payload: PAYLOAD,
      orgContext: { basePath: '' },
    });
    expect(html).toContain('href="/l/dublin/book"');
    expect(html).not.toContain('/sites/glow/book');
  });
});
