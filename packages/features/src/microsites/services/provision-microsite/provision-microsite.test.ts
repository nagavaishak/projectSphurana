import { extractJson, isAIClientInitialized } from '@borradh-workspace/ai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
// Stubbed with restored `vi.spyOn`, NOT `vi.mock`: the features suite runs
// `isolate: false`, so a hoisted factory would leak into every later file.
import * as venueModule from '../../../venue/services/get-venue-config/get-venue-config.service.js';
import * as createModule from '../create-microsite/create-microsite.service.js';
import * as publishModule from '../publish-microsite/publish-microsite.service.js';
import * as themeModule from '../seed-microsite-theme/seed-microsite-theme.service.js';
import { type MockDb, createMockDb } from '../shared/mock-db.test-utils.js';
import { ORG_ID, SITE_ID, THEME } from '../shared/test-fixtures.test-utils.js';
import type { MicrositeCopy } from './provision-microsite.schema.js';
import { provisionMicrosite } from './provision-microsite.service.js';

const MODEL_COPY: MicrositeCopy = {
  heroHeadline: 'Calm, careful treatments',
  heroSubheadline: 'A small clinic that runs on time.',
  aboutMarkdown: '## About us\n\nWe have been here a while.',
  servicesIntro: 'Everything we offer, with live prices.',
  ctaHeadline: 'Book your appointment',
  ctaSubtext: 'See live availability and book in under a minute.',
  contactIntro: 'Find us and see when we are open.',
};

const venueConfig = {
  organization: { name: 'Willow Lane Clinic', slug: 'willow-lane-clinic' },
  location: {
    id: 'loc-1',
    city: 'Galway',
    openingHours: { 1: { from: 540, to: 1020 } },
  },
  services: [{ id: 'svc-1', name: 'Deep Tissue Massage' }],
  team: [{ id: 'prac-1', name: 'Ana' }],
  photos: [{ id: 'photo-1' }],
};

let db: MockDb;
let venueSpy: MockInstance;
let themeSpy: MockInstance;
let createSpy: MockInstance;
let publishSpy: MockInstance;

const createdSite = (overrides: Record<string, unknown> = {}) => ({
  success: true as const,
  data: {
    id: SITE_ID,
    organizationId: ORG_ID,
    slug: 'willow-lane-clinic',
    status: 'draft' as const,
    theme: THEME,
    publishedRevisionId: null,
    created: true,
    ...overrides,
  },
});

/** Every page write matches exactly one existing draft row. */
const pageWritesSucceed = () =>
  db.updateReturning.mockResolvedValue([{ id: 'page-1' }]);

describe('provisionMicrosite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    pageWritesSucceed();

    (db.query as Record<string, unknown>).organization = {
      findFirst: vi.fn().mockResolvedValue({
        id: ORG_ID,
        name: 'Willow Lane Clinic',
        slug: 'willow-lane-clinic',
      }),
    };

    vi.mocked(isAIClientInitialized).mockReturnValue(true);
    vi.mocked(extractJson).mockResolvedValue({
      success: true,
      data: MODEL_COPY,
    });

    venueSpy = vi
      .spyOn(venueModule, 'getVenueConfig')
      .mockResolvedValue({ success: true, data: venueConfig } as never);
    themeSpy = vi
      .spyOn(themeModule, 'seedMicrositeTheme')
      .mockResolvedValue({ success: true, data: THEME } as never);
    createSpy = vi
      .spyOn(createModule, 'createMicrosite')
      .mockResolvedValue(createdSite() as never);
    publishSpy = vi.spyOn(publishModule, 'publishMicrosite').mockResolvedValue({
      success: true,
      data: {
        micrositeId: SITE_ID,
        publishedRevisionId: 'rev-1',
        previousRevisionId: null,
        status: 'published',
        pageCount: 4,
      },
    } as never);
  });

  afterEach(() => {
    venueSpy.mockRestore();
    themeSpy.mockRestore();
    createSpy.mockRestore();
    publishSpy.mockRestore();
  });

  it('seeds the theme, composes four pages and publishes revision 1', async () => {
    const result = await provisionMicrosite(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ micrositeId: SITE_ID, published: true });

    // The theme comes from the seeding service — provisioning never re-derives
    // brand colour.
    expect(themeSpy).toHaveBeenCalledWith(db, { organizationId: ORG_ID });
    expect(createSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organizationId: ORG_ID, theme: THEME })
    );

    expect(publishSpy).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        micrositeId: SITE_ID,
        organizationId: ORG_ID,
        createdBy: 'system',
      })
    );
  });

  it('attributes the $ai_generation event to the org explicitly', async () => {
    await provisionMicrosite(db as never, { organizationId: ORG_ID });

    const [, options] = vi.mocked(extractJson).mock.calls[0];
    expect(options?.observability).toEqual({
      distinctId: ORG_ID,
      spanName: 'microsites.provisionMicrosite',
      groups: { organization: ORG_ID },
    });
  });

  it('still publishes a site when the model call fails', async () => {
    vi.mocked(extractJson).mockResolvedValue({
      success: false,
      data: null,
      raw: 'sorry, I cannot help with that',
      error: 'Failed to parse JSON from response',
    });

    const result = await provisionMicrosite(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.published).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(1);

    // And the site it published is a REAL site: fallback copy, off the org's
    // own row, on every page.
    const pages = writtenPages();
    expect(pages).toHaveLength(4);
    const hero = pages[0].blocks.find(
      (b: { type: string }) => b.type === 'hero'
    );
    expect(hero.props.headline).toContain('Willow Lane Clinic');
  });

  it('publishes a home page with a cta_booking even on the fallback path', async () => {
    vi.mocked(extractJson).mockRejectedValue(new Error('upstream down'));

    await provisionMicrosite(db as never, { organizationId: ORG_ID });

    // `order: 0` is the home page — the update payload carries the fields
    // being written, and `path` is in the WHERE clause, not the SET.
    const home = writtenPages().find((p: { order: number }) => p.order === 0);
    expect(
      home.blocks.some((b: { type: string }) => b.type === 'cta_booking')
    ).toBe(true);
  });

  it('provisions an org that has no location yet', async () => {
    venueSpy.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.NOT_FOUND, message: 'Location not found' },
    } as never);

    const result = await provisionMicrosite(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    // `order: 0` is the home page — the update payload carries the fields
    // being written, and `path` is in the WHERE clause, not the SET.
    const home = writtenPages().find((p: { order: number }) => p.order === 0);
    expect(
      home.blocks.some((b: { type: string }) => b.type === 'cta_booking')
    ).toBe(true);
    expect(
      home.blocks.some((b: { type: string }) => b.type === 'map_location')
    ).toBe(false);
  });

  it('leaves an already-published site alone on a retry', async () => {
    createSpy.mockResolvedValue(
      createdSite({ created: false, publishedRevisionId: 'rev-1' }) as never
    );

    const result = await provisionMicrosite(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ micrositeId: SITE_ID, published: true });
    // No re-composition, no second publish: the owner's edits survive a retry.
    expect(db.update).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('reports the draft rather than failing when publishing does not land', async () => {
    publishSpy.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'boom' },
    } as never);

    const result = await provisionMicrosite(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ micrositeId: SITE_ID, published: false });
  });

  it('returns NOT_FOUND for an unknown organization', async () => {
    (
      db.query as unknown as { organization: { findFirst: MockInstance } }
    ).organization.findFirst.mockResolvedValue(undefined);

    const result = await provisionMicrosite(db as never, {
      organizationId: 'nope',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty organization id before touching anything', async () => {
    const result = await provisionMicrosite(db as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

/** The page-update payloads handed to the page-block writer, in write order. */
// biome-ignore lint/suspicious/noExplicitAny: reading loosely-typed mock calls.
function writtenPages(): any[] {
  return db.set.mock.calls.map(([values]) => values);
}
