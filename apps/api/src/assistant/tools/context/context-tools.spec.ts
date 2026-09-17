import {
  defineFixture,
  listedServiceSchema,
  organizationServiceSchema,
} from '@borradh-workspace/contracts';
import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { addServiceLocationsTool } from './add-service-locations.tool.js';
import { checkConnectedPagesTool } from './check-connected-pages.tool.js';
import { createServiceTool } from './create-service.tool.js';
import { deleteServiceTool } from './delete-service.tool.js';
import { getOrganizationContextTool } from './get-organization-context.tool.js';
import { getServiceDetailsTool } from './get-service-details.tool.js';
import { contextTools } from './index.js';
import { listOffersTool } from './list-offers.tool.js';
import { listRecentGraphicsTool } from './list-recent-graphics.tool.js';
import { listRecentVideosTool } from './list-recent-videos.tool.js';
import { listServicesTool } from './list-services.tool.js';
import { updateServiceTool } from './update-service.tool.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Short-circuit the database barrel — it transitively pulls in
// `@paralleldrive/cuid2` (ESM-only) which the api/jest swc transform doesn't
// handle. The tools never touch `db`; confirmation.ts is the only file that
// imports it, and `buildCtx` overrides the create/verify hooks so
// confirmation.ts is never invoked.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
}));

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  buildApiFetch?: AssistantToolsContext['buildApiFetch'];
  callCounter?: { count: number; max: number };
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
  runHardBlocks?: AssistantToolsContext['runHardBlocks'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    // Context tools that declare additionalAllowedPaths (create/update/delete
    // service) call ctx.buildApiFetch(...) to get a path-extended apiFetch.
    // Returning the same mock keeps assertions on the calls simple.
    buildApiFetch: overrides.buildApiFetch ?? jest.fn(() => apiFetch),
    callCounter: overrides.callCounter ?? createToolCallCounter(50),
    runHardBlocks:
      overrides.runHardBlocks ??
      (jest.fn(async () => ({ pass: true })) as never),
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
  };
}

/**
 * Service fixtures built through the SAME schemas the tools now parse with, so
 * a fixture that drifts from the contract throws at construction instead of
 * quietly agreeing with a wrong reader.
 *
 * This block replaces hand-written literals carrying a `pricingDescription`
 * field — a name `organization_service` has never had (the columns are
 * `priceText` / `priceType` / `priceCents`). `listServices` mapped that name
 * field-by-field, so it reported `null` pricing for every service on every
 * call, and these mocks asserted the same wrong shape, which is why the suite
 * stayed green over it.
 */
const aListedService = defineFixture(listedServiceSchema, {
  id: 's-1',
  organizationId: 'org-1',
  name: 'Lip Filler',
  description: 'desc',
  category: 'treatment',
  categoryId: null,
  sortOrder: 0,
  isCustom: false,
  isActive: true,
  requiresDeposit: false,
  depositAmountCents: null,
  paymentPolicy: null,
  depositBasis: null,
  depositPercent: null,
  depositLink: null,
  stripePaymentLinkId: null,
  stripeProductId: null,
  painPoints: null,
  expectedResults: null,
  processDescription: null,
  targetArea: null,
  priceText: 'From €250',
  priceType: 'from',
  priceCents: 25000,
  // The API now returns Stripe's optional classification for every service.
  // This fixture represents a clinic using its account-level default instead.
  taxCode: null,
  appointmentDuration: 60,
  // Cleanup minutes the ROOM stays held after the appointment. Null = none,
  // which is every service until a clinic sets one.
  turnaroundMinutes: null,
  // Footage spec — defaults for a service nobody has specced yet, which is the
  // state every production service starts in.
  regions: [],
  specSource: 'unknown',
  techniqueSlug: null,
  techniqueClassifiedAt: null,
  expectedShotEmbedding: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hasGraphicMedia: false,
  hasVideoFootage: false,
  variants: [],
  // Empty means EVERY branch (the empty-junction convention), which is the
  // state a service is in until someone scopes it to particular locations.
  locationIds: [],
});

const anOrganizationService = defineFixture(organizationServiceSchema, {
  id: 's-1',
  organizationId: 'org-1',
  name: 'Lip Filler',
  description: 'desc',
  category: 'treatment',
  categoryId: null,
  sortOrder: 0,
  isCustom: false,
  isActive: true,
  requiresDeposit: true,
  depositAmountCents: 5000,
  paymentPolicy: null,
  depositBasis: null,
  depositPercent: null,
  depositLink: null,
  stripePaymentLinkId: null,
  stripeProductId: null,
  painPoints: ['thin lips'],
  expectedResults: ['fuller lips'],
  processDescription: 'inject',
  targetArea: 'lips',
  priceText: 'From €250',
  priceType: 'from',
  priceCents: 25000,
  taxCode: null,
  appointmentDuration: 60,
  // Cleanup minutes the ROOM stays held after the appointment. Null = none,
  // which is every service until a clinic sets one.
  turnaroundMinutes: null,
  // Footage spec. `targetArea` above is the DEPRECATED freeform field; `regions`
  // is the controlled vocabulary the b-roll gate reads. Left empty here because
  // this fixture models an unspecced service.
  regions: [],
  specSource: 'unknown',
  techniqueSlug: null,
  techniqueClassifiedAt: null,
  expectedShotEmbedding: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('context tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registry', () => {
    it('exports 11 tools', () => {
      expect(contextTools).toHaveLength(11);
    });

    it('every tool name uses the context_ prefix and feature "context"', () => {
      for (const tool of contextTools) {
        expect(tool.name).toMatch(/^context_/);
        expect(tool.feature).toBe('context');
      }
    });

    it('marks only the service writes as destructive, with their actions', () => {
      const destructive = contextTools.filter((t) => t.destructive);
      expect(destructive.map((t) => t.name).sort()).toEqual([
        'context_addServiceLocations',
        'context_createService',
        'context_deleteService',
        'context_updateService',
      ]);
      expect(createServiceTool.destructiveAction).toBe('create_service');
      expect(updateServiceTool.destructiveAction).toBe('update_service');
      expect(deleteServiceTool.destructiveAction).toBe('delete_service');
      // Its own action value, not a reused one: `verify-confirmation-token`
      // scopes a token by (org, conversation, action, resource), so sharing
      // `update_service` would let a token issued for an edit be spent on a
      // branch change to the same service.
      expect(addServiceLocationsTool.destructiveAction).toBe(
        'add_service_locations'
      );
    });

    it('read tools are non-destructive', () => {
      const reads = [
        getOrganizationContextTool,
        listServicesTool,
        getServiceDetailsTool,
        listRecentVideosTool,
        listRecentGraphicsTool,
        listOffersTool,
        checkConnectedPagesTool,
      ];
      for (const tool of reads) {
        expect(tool.destructive).toBe(false);
        expect(tool.destructiveAction).toBeUndefined();
      }
    });
  });

  describe('getOrganizationContextTool', () => {
    it('GETs assistant/context and returns the profile unchanged', async () => {
      const profile = {
        name: 'Test Clinic',
        address: 'Dublin',
        businessType: 'aesthetics',
        businessTypeLabel: 'Aesthetics',
        brandVoice: ['warm'],
        targetAudienceDescription: 'Adults 25-45',
        credibilityLine: '10 years',
        tagline: 'Glow up',
        services: ['Lip Filler'],
        serviceDetails: [],
      };
      const apiFetch = jest.fn(async () => profile);
      const result = await getOrganizationContextTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'assistant/context',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data).toMatchObject({ name: 'Test Clinic' });
      }
    });

    it('returns a hard error (TOOL_EXECUTION_ERROR) when apiFetch throws', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('context down');
      });
      const result = await getOrganizationContextTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TOOL_EXECUTION_ERROR');
      }
    });
  });

  describe('listServicesTool', () => {
    it('GETs the full catalogue and maps the items', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [aListedService()],
        total: 1,
      }));
      const result = await listServicesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'organization-services?limit=100&offset=0',
        expect.objectContaining({ schema: expect.anything() })
      );
      // A short first page IS the whole catalogue — no wasted second call.
      expect(apiFetch).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.services).toHaveLength(1);
        expect(result.data.services[0]?.name).toBe('Lip Filler');
        expect(result.data.total).toBe(1);
      }
    });

    it('pages past the 100-item server cap to return every service', async () => {
      // The endpoint's `limit` maxes at 100 (list-services.schema.ts), so an
      // org with more than 100 services used to have the tail silently cut off
      // — and a service Claire could not see reads as one the org doesn't
      // offer.
      const page = (offset: number, count: number) =>
        Array.from({ length: count }, (_, i) =>
          aListedService({
            id: `s-${offset + i}`,
            name: `Service ${offset + i}`,
          })
        );
      const apiFetch = jest.fn(async (path: string) => ({
        items: path.includes('offset=0') ? page(0, 100) : page(100, 30),
        total: 130,
      }));

      const result = await listServicesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(apiFetch).toHaveBeenNthCalledWith(
        2,
        'organization-services?limit=100&offset=100',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.services).toHaveLength(130);
        expect(result.data.services[129]?.id).toBe('s-129');
      }
    });

    it('reports the real pricing fields, not the absent pricingDescription', async () => {
      // The regression this pins: `pricingDescription` is not a column on
      // `organization_service`, so the old mapping produced `null` pricing for
      // every service on every call. A caller cannot quote a price it never
      // received.
      const apiFetch = jest.fn(async () => ({
        items: [aListedService({ priceType: 'fixed', priceCents: 12000 })],
        total: 1,
      }));
      const result = await listServicesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        const service = result.data.services[0];
        expect(service?.priceType).toBe('fixed');
        expect(service?.priceCents).toBe(12000);
        expect(service).not.toHaveProperty('pricingDescription');
      }
    });

    it('reports hasVariants when the service carries priced options', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [aListedService(), aListedService({ id: 's-2', name: 'B' })],
        total: 2,
      }));
      const result = await listServicesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.total).toBe(2);
        expect(result.data.services[0]?.hasVariants).toBe(false);
      }
    });

    it('returns a hard error when apiFetch throws', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('services down');
      });
      const result = await listServicesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('TOOL_EXECUTION_ERROR');
    });
  });

  describe('getServiceDetailsTool', () => {
    it('GETs organization-services/:id and returns the detail row', async () => {
      const apiFetch = jest.fn(async () => anOrganizationService());
      const result = await getServiceDetailsTool.execute(
        { serviceId: 's-1' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'organization-services/s-1',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.name).toBe('Lip Filler');
        expect(result.data.depositAmountCents).toBe(5000);
      }
    });

    it('rejects when serviceId is empty (validation)', async () => {
      const apiFetch = jest.fn();
      const result = await getServiceDetailsTool.execute(
        { serviceId: '' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('listOffersTool', () => {
    it('defaults to active-only and maps offer items', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'o-1',
            name: 'Spring Special',
            headline: '20% off',
            type: 'discount',
            originalPriceCents: 25000,
            offerPriceCents: 20000,
            discountPercent: 20,
            bulletPoints: ['fast', 'painless'],
            ctaText: 'Book now',
            urgencyText: 'Ends soon',
            isActive: true,
            validFrom: '2026-01-01',
            validUntil: '2026-03-01',
            serviceIds: ['s-1'],
          },
        ],
        total: 1,
      }));
      const result = await listOffersTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'offers?state=active&limit=50',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.offers).toHaveLength(1);
        expect(result.data.offers[0]?.name).toBe('Spring Special');
        expect(result.data.total).toBe(1);
      }
    });

    it('passes activeOnly=false through to the query string', async () => {
      const apiFetch = jest.fn(async () => ({ items: [], total: 0 }));
      await listOffersTool.execute(
        { activeOnly: false },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'offers?limit=50',
        expect.objectContaining({ schema: expect.anything() })
      );
    });

    it('rejects a non-boolean activeOnly (validation)', async () => {
      const apiFetch = jest.fn();
      const result = await listOffersTool.execute(
        { activeOnly: 'yes' } as never,
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('listRecentVideosTool', () => {
    it('GETs videos with no query when no filters are given', async () => {
      const apiFetch = jest.fn(async () => ({ items: [], total: 0 }));
      await listRecentVideosTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith('videos');
    });

    it('builds a query string and re-filters by status client-side', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'v-1',
            title: 'Ready video',
            status: 'ready',
            templateId: 't-1',
            blobUrl: 'https://x/v1.mp4',
            thumbnailUrl: null,
            durationMs: 15000,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'v-2',
            title: 'Draft video',
            status: 'draft',
            templateId: 't-1',
            blobUrl: null,
            thumbnailUrl: null,
            durationMs: null,
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        total: 2,
      }));
      const result = await listRecentVideosTool.execute(
        { limit: 5, status: 'ready' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toMatch(/^videos\?/);
      expect(calledPath).toContain('limit=5');
      expect(calledPath).toContain('status=ready');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // Client-side filter drops the draft row.
        expect(result.data.videos).toHaveLength(1);
        expect(result.data.videos[0]?.id).toBe('v-1');
        expect(result.data.total).toBe(1);
      }
    });

    it('rejects an out-of-range limit (validation)', async () => {
      const apiFetch = jest.fn();
      const result = await listRecentVideosTool.execute(
        { limit: 9999 },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('listRecentGraphicsTool', () => {
    it('GETs graphics with a default limit when no filters are given', async () => {
      const apiFetch = jest.fn(async () => ({ items: [] }));
      const result = await listRecentGraphicsTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      // Default limit is sent so the server caps the page rather than
      // returning its own (larger) default.
      expect(apiFetch).toHaveBeenCalledWith(
        'graphics?limit=10',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.graphics).toHaveLength(0);
        expect(result.data.total).toBe(0);
      }
    });

    it('builds a query string, flattens outputs, and re-filters by status', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'g-1',
            title: 'Lip filler tips',
            status: 'ready',
            usageType: 'organic',
            kind: 'carousel',
            serviceId: 's1',
            topicSummary: 'Lip filler aftercare',
            aspectRatio: '4:5',
            outputs: [
              {
                url: 'https://cdn/g1-s1.png',
                thumbnailUrl: 'https://cdn/g1-s1-thumb.png',
                slideOrder: 0,
              },
              { url: 'https://cdn/g1-s2.png', slideOrder: 1 },
            ],
            createdAt: '2026-01-02T00:00:00.000Z',
          },
          {
            id: 'g-2',
            title: 'Draft graphic',
            status: 'rendering',
            usageType: 'ad',
            kind: 'single',
            serviceId: 's2',
            topicSummary: null,
            aspectRatio: '4:5',
            outputs: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }));
      const result = await listRecentGraphicsTool.execute(
        { limit: 5, status: 'ready' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      const calledPath = (apiFetch.mock.calls[0] as unknown[])[0] as string;
      expect(calledPath).toMatch(/^graphics\?/);
      expect(calledPath).toContain('limit=5');
      expect(calledPath).toContain('status=ready');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // Client-side filter drops the still-rendering row.
        expect(result.data.graphics).toHaveLength(1);
        const g = result.data.graphics[0];
        expect(g?.id).toBe('g-1');
        expect(g?.usageType).toBe('organic');
        // First slide (slideOrder 0) drives the preview; carousel slideCount.
        expect(g?.thumbnailUrl).toBe('https://cdn/g1-s1-thumb.png');
        expect(g?.imageUrl).toBe('https://cdn/g1-s1.png');
        expect(g?.slideCount).toBe(2);
        expect(result.data.total).toBe(1);
      }
    });

    it('falls back to the full-res url when a slide has no thumbnail', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'g-3',
            title: null,
            status: 'ready',
            kind: 'single',
            serviceId: 's1',
            topicSummary: null,
            aspectRatio: '1:1',
            outputs: [{ url: 'https://cdn/g3.png', slideOrder: 0 }],
            createdAt: '2026-01-03T00:00:00.000Z',
          },
        ],
      }));
      const result = await listRecentGraphicsTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        const g = result.data.graphics[0];
        expect(g?.title).toBe('Graphic');
        expect(g?.thumbnailUrl).toBe('https://cdn/g3.png');
        expect(g?.slideCount).toBe(1);
      }
    });

    it('rejects an out-of-range limit (validation)', async () => {
      const apiFetch = jest.fn();
      const result = await listRecentGraphicsTool.execute(
        { limit: 9999 },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('checkConnectedPagesTool', () => {
    it('returns the active platforms when Meta is connected with active pages', async () => {
      const apiFetch = jest.fn(async () => ({
        integration: {
          configurationStatus: 'configured',
          tokenStatus: 'healthy',
          pages: [
            {
              pageName: 'Borradh',
              platform: 'facebook',
              pageUsername: 'borradh',
              isActive: true,
            },
            {
              pageName: 'Borradh IG',
              platform: 'instagram',
              pageUsername: 'borradh.ig',
              isActive: true,
            },
            {
              pageName: 'Old Page',
              platform: 'facebook',
              pageUsername: 'old',
              isActive: false,
            },
          ],
        },
      }));
      const result = await checkConnectedPagesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledWith(
        'integrations/meta-ads/integration',
        expect.objectContaining({ schema: expect.anything() })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.connected).toBe(true);
        expect(result.data.availablePlatforms).toEqual([
          'facebook',
          'instagram',
        ]);
        expect(result.data.pages).toHaveLength(2);
      }
    });

    it('returns connected: false with a setup message when integration is null', async () => {
      const apiFetch = jest.fn(async () => ({ integration: null }));
      const result = await checkConnectedPagesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.connected).toBe(false);
        expect(result.data.availablePlatforms).toEqual([]);
        expect(result.data.message).toContain('Settings → Integrations');
      }
    });

    it('returns connected: false when the token needs reconnecting', async () => {
      const apiFetch = jest.fn(async () => ({
        integration: {
          configurationStatus: 'configured',
          tokenStatus: 'needs_reconnect',
          pages: [],
        },
      }));
      const result = await checkConnectedPagesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.connected).toBe(false);
        expect(result.data.message).toContain('reconnected');
      }
    });

    it('returns connected: true with no platforms when there are no active pages', async () => {
      const apiFetch = jest.fn(async () => ({
        integration: {
          configurationStatus: 'configured',
          tokenStatus: 'healthy',
          pages: [
            {
              pageName: 'Inactive',
              platform: 'facebook',
              pageUsername: 'inactive',
              isActive: false,
            },
          ],
        },
      }));
      const result = await checkConnectedPagesTool.execute(
        {},
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.connected).toBe(true);
        expect(result.data.availablePlatforms).toEqual([]);
        expect(result.data.message).toContain('no active pages');
      }
    });
  });

  describe('createServiceTool — destructive flow', () => {
    const validInput = {
      name: 'Lip Filler 0.5ml',
      category: 'treatment' as const,
      description: 'A short description',
      isActive: true,
    };

    it('first call: runs hard blocks (none), builds the summary, issues a token, does NOT POST', async () => {
      const apiFetch = jest.fn(async () => ({}));
      const createConfirmation = jest.fn(async () => ({
        id: 'token-create',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await createServiceTool.execute(validInput, ctx);

      expect(apiFetch).not.toHaveBeenCalled();
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'create_service',
        resourceId: 'service:Lip Filler 0.5ml',
        payload: expect.objectContaining({
          name: 'Lip Filler 0.5ml',
          category: 'treatment',
        }),
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        expect(result.presentation.token).toBe('token-create');
        const fields = result.presentation.summary?.fields ?? [];
        expect(fields.find((f) => f.label === 'Service name')?.value).toBe(
          'Lip Filler 0.5ml'
        );
        expect(fields.find((f) => f.label === 'Category')?.value).toBe(
          'treatment'
        );
      }
    });

    it('second call: verifies token, POSTs to organization-services, returns the created row', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 's-new',
        name: 'Lip Filler 0.5ml',
        category: 'treatment',
        description: 'A short description',
        isActive: true,
        pricingDescription: null,
      }));
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: null,
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        verifyConfirmation: verifyConfirmation as never,
      });

      const result = await createServiceTool.execute(
        { ...validInput, confirmationToken: 'token-create' },
        ctx
      );

      expect(verifyConfirmation).toHaveBeenCalled();
      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('organization-services');
      expect(calledOpts.method).toBe('POST');
      expect(calledOpts.body).toMatchObject({
        name: 'Lip Filler 0.5ml',
        category: 'treatment',
        isActive: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.serviceId).toBe('s-new');
        expect(result.data.name).toBe('Lip Filler 0.5ml');
      }
    });

    it('rejects an invalid category before any confirmation (validation)', async () => {
      const createConfirmation = jest.fn();
      const ctx = buildCtx({ createConfirmation: createConfirmation as never });
      const result = await createServiceTool.execute(
        { name: 'X', category: 'not-a-category' } as never,
        ctx
      );
      expect(createConfirmation).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('updateServiceTool — destructive flow', () => {
    it('first call: looks up the service for the summary, issues a token, does NOT PUT', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 's-1',
        name: 'Lip Filler',
        category: 'treatment',
        isActive: true,
      }));
      const createConfirmation = jest.fn(async () => ({
        id: 'token-update',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await updateServiceTool.execute(
        { serviceId: 's-1', name: 'Lip Filler 1ml', isActive: false },
        ctx
      );

      // summarizeForConfirmation does a GET lookup, but no mutating PUT.
      const putCall = apiFetch.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'PUT'
      );
      expect(putCall).toBeUndefined();
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'update_service',
        resourceId: 's-1',
        payload: expect.objectContaining({
          serviceId: 's-1',
          name: 'Lip Filler 1ml',
          isActive: false,
        }),
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        expect(fields.find((f) => f.label === 'Name')?.value).toBe(
          'Lip Filler 1ml'
        );
        expect(fields.find((f) => f.label === 'Active')?.value).toContain(
          'hidden'
        );
      }
    });

    it('second call: PUTs only the provided fields', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 's-1',
        name: 'Lip Filler 1ml',
        category: 'treatment',
        isActive: false,
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await updateServiceTool.execute(
        {
          serviceId: 's-1',
          name: 'Lip Filler 1ml',
          isActive: false,
          confirmationToken: 'token-update',
        },
        ctx
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('organization-services/s-1');
      expect(calledOpts.method).toBe('PUT');
      expect(calledOpts.body).toEqual({
        name: 'Lip Filler 1ml',
        isActive: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.serviceId).toBe('s-1');
      }
    });

    it('rejects an empty serviceId (validation)', async () => {
      const apiFetch = jest.fn();
      const result = await updateServiceTool.execute(
        { serviceId: '', name: 'X' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('createServiceTool — variants', () => {
    it('second call: POSTs each variant to the new service with name/price/sortOrder', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'organization-services') {
          return {
            id: 'svc-x',
            name: 'Lip Filler',
            category: 'treatment',
            description: null,
            isActive: true,
            pricingDescription: null,
          };
        }
        // Variant POSTs — the tool ignores the return value.
        return {};
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await createServiceTool.execute(
        {
          name: 'Lip Filler',
          category: 'treatment' as const,
          isActive: true,
          variants: [
            { name: '1 area', priceCents: 20000 },
            { name: '2 areas', priceCents: 35000 },
          ],
          confirmationToken: 'token-create',
        },
        ctx
      );

      const variantCalls = apiFetch.mock.calls.filter(
        (c) => c[0] === 'organization-services/svc-x/variants'
      );
      expect(variantCalls).toHaveLength(2);
      expect(
        (variantCalls[0]?.[1] as { method?: string; body?: unknown })?.method
      ).toBe('POST');
      expect(
        (variantCalls[0]?.[1] as { body?: Record<string, unknown> })?.body
      ).toMatchObject({ name: '1 area', priceCents: 20000, sortOrder: 0 });
      expect(
        (variantCalls[1]?.[1] as { body?: Record<string, unknown> })?.body
      ).toMatchObject({ name: '2 areas', priceCents: 35000, sortOrder: 1 });

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.serviceId).toBe('svc-x');
        expect(result.data.variantsCreated).toBe(2);
      }
    });
  });

  describe('updateServiceTool — variants upsert', () => {
    it('second call: PUTs the name-matched variant and POSTs the new one', async () => {
      const apiFetch = jest.fn(
        async (path: string, opts?: { method?: string }) => {
          if (path === 'organization-services/s-1' && opts?.method === 'PUT') {
            return {
              id: 's-1',
              name: 'Lip Filler',
              category: 'treatment',
              isActive: true,
            };
          }
          if (path === 'organization-services/s-1/variants') {
            // GET (no method) returns the existing set; POST returns nothing.
            if (opts?.method === 'POST') return {};
            return { items: [{ id: 'v1', name: '1 area' }] };
          }
          // PUT to the matched-variant endpoint.
          return {};
        }
      );
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await updateServiceTool.execute(
        {
          serviceId: 's-1',
          variants: [
            { name: '1 area', priceCents: 22000 },
            { name: 'New Option', priceCents: 9000 },
          ],
          confirmationToken: 'token-update',
        },
        ctx
      );

      // Existing "1 area" is matched by name → PUT to the variant endpoint.
      const putVariant = apiFetch.mock.calls.find(
        (c) =>
          c[0] === 'organization-services/variants/v1' &&
          (c[1] as { method?: string } | undefined)?.method === 'PUT'
      );
      expect(putVariant).toBeDefined();
      expect(
        (putVariant?.[1] as { body?: Record<string, unknown> })?.body
      ).toMatchObject({ name: '1 area', priceCents: 22000 });

      // "New Option" has no match → POST to the service's variants collection.
      const postVariant = apiFetch.mock.calls.find(
        (c) =>
          c[0] === 'organization-services/s-1/variants' &&
          (c[1] as { method?: string } | undefined)?.method === 'POST'
      );
      expect(postVariant).toBeDefined();
      expect(
        (postVariant?.[1] as { body?: Record<string, unknown> })?.body
      ).toMatchObject({ name: 'New Option', priceCents: 9000 });

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.variantsUpserted).toBe(2);
      }
    });
  });

  describe('deleteServiceTool — destructive flow', () => {
    it('first call: looks up the service, issues a token, does NOT DELETE', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 's-1',
        name: 'Lip Filler',
        category: 'treatment',
        isActive: true,
      }));
      const createConfirmation = jest.fn(async () => ({
        id: 'token-delete',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });

      const result = await deleteServiceTool.execute({ serviceId: 's-1' }, ctx);

      const deleteCall = apiFetch.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'DELETE'
      );
      expect(deleteCall).toBeUndefined();
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'delete_service',
        resourceId: 's-1',
        payload: expect.objectContaining({ serviceId: 's-1' }),
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.presentation?.type === 'confirmation_required') {
        const fields = result.presentation.summary?.fields ?? [];
        expect(fields.find((f) => f.label === 'Service name')?.value).toBe(
          'Lip Filler'
        );
        expect(fields.find((f) => f.label === 'Warning')?.value).toContain(
          'permanently'
        );
      }
    });

    it('second call: DELETEs organization-services/:id and returns deleted: true', async () => {
      const apiFetch = jest.fn(async () => ({}));
      const ctx = buildCtx({ apiFetch: apiFetch as never });

      const result = await deleteServiceTool.execute(
        { serviceId: 's-1', confirmationToken: 'token-delete' },
        ctx
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string },
      ];
      expect(calledPath).toBe('organization-services/s-1');
      expect(calledOpts.method).toBe('DELETE');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.deleted).toBe(true);
        expect(result.data.serviceId).toBe('s-1');
      }
    });

    it('rejects an empty serviceId (validation)', async () => {
      const apiFetch = jest.fn();
      const result = await deleteServiceTool.execute(
        { serviceId: '' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });
  });
});
