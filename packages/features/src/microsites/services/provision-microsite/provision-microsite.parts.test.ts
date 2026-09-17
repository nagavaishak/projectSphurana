import { extractJson, isAIClientInitialized } from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { composeDefaultPages } from './compose-pages.js';
import type { MicrositeOrgContext } from './provision-context.js';
import { fallbackCopy, generateMicrositeCopy } from './provision-copy.js';
import type { MicrositeCopy } from './provision-microsite.schema.js';

const fullContext: MicrositeOrgContext = {
  organizationId: 'org-1',
  organizationName: 'Willow Lane Clinic',
  organizationSlug: 'willow-lane-clinic',
  locationId: 'loc-1',
  city: 'Galway',
  serviceNames: ['Deep Tissue Massage', 'Facial'],
  serviceCount: 2,
  practitionerCount: 3,
  hasOpeningHours: true,
  hasPhotos: true,
};

/** A brand-new org: no location, no services, no team, no photos. */
const bareContext: MicrositeOrgContext = {
  ...fullContext,
  locationId: null,
  city: null,
  serviceNames: [],
  serviceCount: 0,
  practitionerCount: 0,
  hasOpeningHours: false,
  hasPhotos: false,
};

const modelCopy: MicrositeCopy = {
  heroHeadline: 'Calm, careful treatments',
  heroSubheadline: 'A small clinic that runs on time.',
  aboutMarkdown: '## About us\n\nWe have been here a while.',
  servicesIntro: 'Everything we offer, with live prices.',
  ctaHeadline: 'Book your appointment',
  ctaSubtext: 'See live availability and book in under a minute.',
  contactIntro: 'Find us and see when we are open.',
};

const DATA_BOUND = ['services', 'team', 'opening_hours', 'map_location'];

describe('composeDefaultPages', () => {
  it('composes Home, About, Services and Contact in order', () => {
    const result = composeDefaultPages(fullContext, modelCopy);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map((p) => p.path)).toEqual([
      '/',
      '/about',
      '/services',
      '/contact',
    ]);
    expect(result.data.map((p) => p.order)).toEqual([0, 1, 2, 3]);
  });

  it('always puts a cta_booking on the home page', () => {
    for (const context of [fullContext, bareContext]) {
      const result = composeDefaultPages(context, modelCopy);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const home = result.data.find((p) => p.path === '/');
      expect(home?.blocks.some((b) => b.type === 'cta_booking')).toBe(true);
    }
  });

  it('uses live data-bound blocks and copies NO business data into their props', () => {
    const result = composeDefaultPages(fullContext, modelCopy);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const dataBound = result.data
      .flatMap((p) => p.blocks)
      .filter((b) => DATA_BOUND.includes(b.type));

    // The differentiator exists at all: the pages DO render live data.
    expect(dataBound.length).toBeGreaterThan(0);

    for (const block of dataBound) {
      const props = block.props as Record<string, unknown>;
      // Structural props are a query — pointers, limits, display flags.
      for (const [key, value] of Object.entries(props)) {
        if (key === 'title' || key === 'intro') continue;
        for (const name of [...fullContext.serviceNames, 'Galway']) {
          expect(String(value)).not.toContain(name);
        }
      }
      // Specifically: no denormalised list of the org's own records.
      expect(props).not.toHaveProperty('services');
      expect(props).not.toHaveProperty('items');
      expect(props).not.toHaveProperty('practitioners');
    }

    // And the location-scoped blocks point at the location by ID.
    const map = dataBound.find((b) => b.type === 'map_location');
    expect((map?.props as { locationId?: string }).locationId).toBe('loc-1');
  });

  it('omits blocks with nothing to render on a bare org, but still builds a site', () => {
    const result = composeDefaultPages(bareContext, modelCopy);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const home = result.data.find((p) => p.path === '/');
    const homeTypes = home?.blocks.map((b) => b.type) ?? [];
    expect(homeTypes).not.toContain('services');
    expect(homeTypes).not.toContain('team');
    expect(homeTypes).not.toContain('map_location');
    expect(homeTypes).toContain('cta_booking');

    // The Services page KEEPS its services block even with nothing to show:
    // it is a query, so it fills itself in the moment the org adds a service,
    // with no republish and no agent turn.
    const servicesPage = result.data.find((p) => p.path === '/services');
    expect(servicesPage?.blocks.map((b) => b.type)).toContain('services');
  });

  it('rejects model copy that fails the block schemas', () => {
    const result = composeDefaultPages(fullContext, {
      ...modelCopy,
      heroHeadline: '',
    } as MicrositeCopy);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});

describe('fallbackCopy', () => {
  it("is derived from the org's own data and satisfies the block schemas", () => {
    const copy = fallbackCopy(fullContext);

    expect(copy.heroHeadline).toContain('Willow Lane Clinic');
    expect(copy.aboutMarkdown).toContain('Deep Tissue Massage');

    const result = composeDefaultPages(fullContext, copy);
    expect(result.success).toBe(true);
  });

  it('works for an org with nothing but a name', () => {
    const copy = fallbackCopy(bareContext);
    expect(composeDefaultPages(bareContext, copy).success).toBe(true);
  });
});

describe('generateMicrositeCopy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAIClientInitialized).mockReturnValue(true);
  });

  it('returns model copy and attributes the generation to the org explicitly', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce({
      success: true,
      data: modelCopy,
    });

    const result = await generateMicrositeCopy(fullContext);

    expect(result.source).toBe('model');
    expect(result.copy.heroHeadline).toBe('Calm, careful treatments');

    // A BullMQ job has no ambient context: without this the $ai_generation
    // event loses its org attribution entirely.
    const [, options] = vi.mocked(extractJson).mock.calls[0];
    expect(options?.observability).toEqual({
      distinctId: 'org-1',
      spanName: 'microsites.provisionMicrosite',
      groups: { organization: 'org-1' },
    });
  });

  it('falls back to org-derived copy when extraction fails', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce({
      success: false,
      data: null,
      raw: 'not json',
      error: 'Failed to parse JSON from response',
    });

    const result = await generateMicrositeCopy(fullContext);

    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('Failed to parse JSON from response');
    expect(result.copy).toEqual(fallbackCopy(fullContext));
  });

  it('falls back when the model output does not satisfy the copy schema', async () => {
    vi.mocked(extractJson).mockResolvedValueOnce({
      success: true,
      data: { heroHeadline: 'x'.repeat(500) },
    });

    const result = await generateMicrositeCopy(fullContext);
    expect(result.source).toBe('fallback');
  });

  it('falls back when the AI call throws', async () => {
    vi.mocked(extractJson).mockRejectedValueOnce(new Error('upstream down'));

    const result = await generateMicrositeCopy(fullContext);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('upstream down');
  });
});
