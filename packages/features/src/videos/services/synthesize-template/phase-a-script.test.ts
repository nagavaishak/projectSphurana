import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import type { TemplateDoc } from '@borradh-workspace/video-templates';
import { type MockInstance, vi } from 'vitest';

// Local fixture for script-slot tests. We used to point these at the real
// `scriptSlotTemplate`, but the educational templates became captions-led (no
// on-screen text overlays), so they no longer expose hook/body/cta script-text
// slots. Keeping a synthetic template that still has them decouples the tests
// from product-template content and exercises the slot machinery directly.
const scriptSlotTemplate: TemplateDoc = {
  id: 'test-script-slots',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  duration: { kind: 'driven', by: 'staggered-list-main' },
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      {
        kind: 'media-track',
        id: 'broll',
        duration: { kind: 'fill' },
        clips: {
          source: 'query',
          query: { kind: 'asset-clips', tag: 'procedure', count: [1, 4] },
          required: true,
        },
        cuts: { mode: 'beat-synced', beatsPerEdit: 4 },
      },
    ],
    overlays: [
      {
        kind: 'staggered-list',
        id: 'staggered-list-main',
        duration: { kind: 'content' },
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'heading',
          container: 'none',
          entrance: 'slide-up',
        },
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'body' },
            required: true,
          },
          style: 'body',
          container: 'pill',
          entrance: 'slide-up',
        },
        trail: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'cta' },
            required: true,
          },
          style: 'caption',
          container: 'button',
          entrance: 'slide-up',
        },
        stagger: { beatsPerItem: 4 },
      },
    ],
  },
  globals: {
    audio: {
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
  },
};

// `@borradh-workspace/ai` is aliased to the canonical mock (vite.config.ts), so
// NEVER `vi.mock` it — import the boundary symbols and drive them with
// `vi.mocked()`. `getOrgContext` is NOT an aliased module, so it stays a hoisted
// `vi.fn()` wired via a restored `vi.spyOn` on its source (see below).
const hoistedMocks = vi.hoisted(() => ({
  mockGetOrgContext: vi.fn(),
}));

// `getVariationById` is spied (not `vi.mock`'d) so the REAL templates barrel is
// restored after this file. Under `isolate: false` a file-local `vi.mock` of
// this internal barrel would persist on the shared worker graph and DELETE
// every export the factory omitted (`selectRandomVariationForTemplate`,
// `CONTENT_IDEA_TEMPLATES`, …) for every later test file. The spy handle is
// restored in `afterEach` — we restore it specifically rather than calling
// `vi.restoreAllMocks()`, which would also wipe the canonical boundary mocks
// (`@borradh-workspace/ai`, …) above.
import {
  extractJson,
  isAIClientInitialized,
  isRateLimitError,
} from '@borradh-workspace/ai';
import * as orgContext from '../../../shared/core/org-context.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as videoTemplates from '../../templates/index.js';
import { resolveScriptSlot } from './phase-a-script.js';
import {
  discoverScriptSlots,
  fillScriptSlots,
  flattenScriptForLegacyCompiler,
} from './script-parsing.js';

// Boundary AI symbols come from the canonical mock — drive with `vi.mocked()`.
const mockExtractJson = vi.mocked(extractJson);
const mockIsAIClientInitialized = vi.mocked(isAIClientInitialized);
const mockIsRateLimitError = vi.mocked(isRateLimitError);

const orgContextFixture = {
  businessType: 'medical_aesthetics' as never,
  brandVoice: ['professional'],
  targetAudienceDescription: 'Adults 30-55 seeking aesthetic treatments',
  credibilityLine: 'Board-certified team',
  tagline: null,
  services: ['Botox'],
  serviceDetails: [],
};

describe('discoverScriptSlots / fillScriptSlots / flattenScript', () => {
  it('discovers educational-1 hook/body/cta script-text slots', () => {
    const slots = discoverScriptSlots(scriptSlotTemplate);
    const roles = slots.map((s) => s.role);
    expect(roles).toEqual(expect.arrayContaining(['hook', 'body', 'cta']));

    const body = slots.find((s) => s.role === 'body');
    expect(body?.valueShape).toBe('string-array');

    const hook = slots.find((s) => s.role === 'hook');
    expect(hook?.valueShape).toBe('string');
  });

  it('fills educational-1 slots with distinct lead / items / trail values', () => {
    const { filled, missingRequiredRoles } = fillScriptSlots(
      scriptSlotTemplate,
      {
        hook: 'Struggling with fine lines?',
        body: [
          'Botox softens forehead lines',
          'Minimal downtime',
          'Natural-looking results',
        ],
        cta: 'DM to learn more',
      }
    );

    expect(missingRequiredRoles).toEqual([]);
    if (filled.root.kind !== 'leaf') throw new Error('root must be leaf');
    const overlay = filled.root.overlays[0];
    if (overlay.kind !== 'staggered-list')
      throw new Error('overlay must be staggered-list');

    expect(overlay.lead?.text.source).toBe('fixed');
    if (overlay.lead?.text.source !== 'fixed') throw new Error('unreachable');
    expect(overlay.lead.text.value).toBe('Struggling with fine lines?');

    expect(overlay.items.texts.source).toBe('fixed');
    if (overlay.items.texts.source !== 'fixed') throw new Error('unreachable');
    expect(overlay.items.texts.value).toEqual([
      'Botox softens forehead lines',
      'Minimal downtime',
      'Natural-looking results',
    ]);

    expect(overlay.trail?.text.source).toBe('fixed');
    if (overlay.trail?.text.source !== 'fixed') throw new Error('unreachable');
    expect(overlay.trail.text.value).toBe('DM to learn more');
  });

  it('reports missing required roles when the response omits them', () => {
    const { missingRequiredRoles } = fillScriptSlots(scriptSlotTemplate, {
      hook: 'Struggling?',
      body: [],
      cta: undefined,
    });
    expect(missingRequiredRoles).toEqual(expect.arrayContaining(['cta']));
  });

  it('flattens response in hook → body[] → disclaimer → cta order', () => {
    const text = flattenScriptForLegacyCompiler({
      hook: 'Hook line',
      body: ['Body 1', 'Body 2'],
      disclaimer: 'Results vary',
      cta: 'DM to learn more',
    });
    expect(text).toBe(
      'Hook line\nBody 1\nBody 2\nResults vary\nDM to learn more'
    );
  });
});

describe('resolveScriptSlot', () => {
  const mockDb = createMockDatabase();
  const input = {
    videoId: 'vid_1',
    organizationId: 'org_1',
  };
  let mockGetVariationById: MockInstance;
  // `getOrgContext` is spied on its SOURCE module
  // (`shared/core/org-context.js`) rather than `vi.mock`'d on the
  // `shared/org-context.js` back-compat shim — a file-local `vi.mock` of that
  // shim would persist on the shared worker graph under `isolate: false` and
  // leak into every later test file. Restored specifically in `afterEach`.
  let mockGetOrgContextSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockIsAIClientInitialized.mockReturnValue(true);
    mockIsRateLimitError.mockReturnValue(false);
    hoistedMocks.mockGetOrgContext.mockReset();
    hoistedMocks.mockGetOrgContext.mockResolvedValue(orgContextFixture);
    mockGetOrgContextSpy = (
      vi.spyOn(orgContext, 'getOrgContext') as MockInstance
    ).mockImplementation((...args) => hoistedMocks.mockGetOrgContext(...args));
    mockGetVariationById = (
      vi.spyOn(videoTemplates, 'getVariationById') as MockInstance
    ).mockReturnValue({
      template: { id: 'educational' },
      variation: {
        id: 'educational-1',
        variationName: 'Q&A',
        description: 'Educational text-only',
        scriptTemplate: 'Struggling with [PAIN]?',
        narrationMode: 'text_only',
      },
    } as never);
    mockDb.query.video.findFirst.mockResolvedValue({
      draftConfig: { scriptText: '' },
    });
  });

  afterEach(() => {
    mockGetVariationById.mockRestore();
    mockGetOrgContextSpy.mockRestore();
  });

  it('happy path: fills educational-1 with distinct hook / body / cta values', async () => {
    mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: {
        hook: 'Struggling with fine lines?',
        body: ['Botox softens lines', 'Minimal downtime'],
        cta: 'DM to learn more',
      },
    });

    const result = await resolveScriptSlot(
      mockDb as never,
      input,
      scriptSlotTemplate
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    if (result.data.filledDoc.root.kind !== 'leaf')
      throw new Error('root must be leaf');
    const overlay = result.data.filledDoc.root.overlays[0];
    if (overlay.kind !== 'staggered-list')
      throw new Error('overlay must be staggered-list');

    if (overlay.lead?.text.source !== 'fixed')
      throw new Error('lead must be fixed');
    if (overlay.items.texts.source !== 'fixed')
      throw new Error('items must be fixed');
    if (overlay.trail?.text.source !== 'fixed')
      throw new Error('trail must be fixed');

    expect(overlay.lead.text.value).toBe('Struggling with fine lines?');
    expect(overlay.items.texts.value).toEqual([
      'Botox softens lines',
      'Minimal downtime',
    ]);
    expect(overlay.trail.text.value).toBe('DM to learn more');

    expect(result.data.scriptText).toBe(
      'Struggling with fine lines?\nBotox softens lines\nMinimal downtime\nDM to learn more'
    );
  });

  it('returns VALIDATION_ERROR when required role is missing from the response', async () => {
    mockExtractJson.mockResolvedValueOnce({
      success: true,
      data: {
        hook: 'Struggling?',
        body: ['One', 'Two'],
      },
    });

    await expectResult(
      resolveScriptSlot(mockDb as never, input, scriptSlotTemplate)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('retries once on schema-mismatch then surfaces VALIDATION_ERROR', async () => {
    mockExtractJson
      .mockResolvedValueOnce({
        success: false,
        data: null,
        raw: '{"not":"valid"}',
        error: 'Schema validation failed',
      })
      .mockResolvedValueOnce({
        success: false,
        data: null,
        raw: '{"still":"wrong"}',
        error: 'Schema validation failed',
      });

    const result = await resolveScriptSlot(
      mockDb as never,
      input,
      scriptSlotTemplate
    );

    expect(result.success).toBe(false);
    expect(mockExtractJson).toHaveBeenCalledTimes(2);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('succeeds on second attempt when first response was malformed', async () => {
    mockExtractJson
      .mockResolvedValueOnce({
        success: false,
        data: null,
        raw: '{"hook":"x"}',
        error: 'Schema validation failed',
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          hook: 'Retry hook',
          body: ['Retry body'],
          cta: 'Retry cta',
        },
      });

    const result = await resolveScriptSlot(
      mockDb as never,
      input,
      scriptSlotTemplate
    );

    expect(result.success).toBe(true);
    expect(mockExtractJson).toHaveBeenCalledTimes(2);
  });
});
