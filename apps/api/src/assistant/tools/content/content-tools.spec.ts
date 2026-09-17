import { openContentProposal } from '@borradh-workspace/features/content-items';
import { logError, logWarning } from '@borradh-workspace/observability';
import { buildAssistantPorts } from '../../ports/index.js';
import { ApiFetchError } from '../../tool-factory/index.js';
import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { createContentTool } from './create-content.tool.js';
import { contentTools } from './index.js';
import { listMediaTool } from './list-media.tool.js';
import { patchContentTool } from './patch-content.tool.js';
import { renderVideoTool } from './render-video.tool.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  // The graphic half reaches the template registries, which pull in the
  // image-generation module tree — and that logs at import time.
  createLogger: () => ({
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Short-circuit the database barrel — the factory's confirmation.ts is the only
// thing that imports `db`, and `buildCtx` overrides both confirmation helpers
// so that path is never reached.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
// The graphic half derives its style catalogue from the BRIEF registries, and
// importing that module tree boots the email env at load time. Only the two
// arrays are needed here.
// The web graphic path opens a PROPOSAL — an item whose attempt 0 has no asset
// yet — and there is no HTTP surface for that, so the tool calls the service
// directly. Defaults to success; the card degrades gracefully without it.
jest.mock('@borradh-workspace/features/content-items', () => ({
  openContentProposal: jest.fn().mockResolvedValue({
    success: true,
    data: { itemId: 'item-1', attemptId: 'attempt-1' },
  }),
}));
jest.mock('@borradh-workspace/features/image-generation', () => ({
  // Organic styles are BRIEFS now — a subject, not a layout. Composition
  // templates survive only for ads, which Claire does not choose between, so
  // this mock no longer needs them.
  DECK_BRIEFS: [
    { slug: 'myths-corrected', label: 'Myths, corrected', description: 'x' },
  ],
  SINGLE_BRIEFS: [
    { slug: 'one-striking-fact', label: 'One striking fact', description: 'x' },
  ],
}));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  channel?: AssistantToolsContext['channel'];
  confirmedActions?: string[];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: jest.fn(() => apiFetch),
    // Ports are composed over the SAME mocked apiFetch, so assertions about
    // which paths a tool hits hold whether it goes through a port or not.
    ports: buildAssistantPorts({ apiFetch, conversationId: 'conv-1' }),
    callCounter: createToolCallCounter(50),
    // Both tools declare `policy: 'member'`, and the factory refuses when it
    // cannot verify a role — so an unset role here reads as FORBIDDEN, not as
    // "no policy".
    callerRole: 'member',
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation: jest.fn(async () => ({
      id: 'token-content',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    })) as never,
    verifyConfirmation: jest.fn(async () => ({
      valid: true,
      payload: null,
    })) as never,
    ...(overrides.channel ? { channel: overrides.channel } : {}),
    ...(overrides.confirmedActions
      ? { confirmedActions: overrides.confirmedActions }
      : {}),
  } as AssistantToolsContext;
}

const SERVICE_ID = '22222222-2222-4222-8222-222222222222';

describe('content tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registry', () => {
    // Four: make it, look at what you could make it from, change it, render it.
    // What was eight content tools split by asset kind, plus a confirm/execute
    // render pair and two listers split by which shelf they read.
    it('exports the four content tools', () => {
      expect(contentTools.map((t) => t.name).sort()).toEqual([
        'content_createContent',
        'content_listMedia',
        'content_patchContent',
        'content_renderVideo',
      ]);
      expect(contentTools).toContain(createContentTool);
      expect(contentTools).toContain(patchContentTool);
    });

    // The cost line, and the reason `renderVideo` is not part of `patchContent`:
    // confirmation is declared per TOOL, so one tool doing both would have to
    // confirm every caption change or spend a render without asking.
    it('confirms the render and nothing else', () => {
      for (const tool of contentTools) {
        expect(tool.feature).toBe('content');
        expect(tool.destructive).toBe(tool.name === 'content_renderVideo');
      }
    });
  });

  describe('createContentTool — graphic proposals', () => {
    // A proposal stores nothing about what was proposed — attempt 0 with a null
    // asset is an existence marker, not a spec — so revising one is this same
    // call with different inputs. Opening a second item instead leaves the card
    // the owner is looking at stale while a new one appears below it, and strands
    // a row for content that will never exist.
    it('reuses the item when re-proposing rather than opening a second', async () => {
      const result = await createContentTool.execute(
        {
          kind: 'graphic',
          itemId: 'item-existing',
          serviceId: SERVICE_ID,
          category: 'tips',
          imageKind: 'carousel',
        },
        buildCtx()
      );

      expect(result.ok).toBe(true);
      const card = (
        result as { presentation?: { type?: string; itemId?: string } }
      ).presentation;
      expect(card?.type).toBe('graphic_draft');
      expect(card?.itemId).toBe('item-existing');
      expect(openContentProposal).not.toHaveBeenCalled();
    });

    it('opens one when there is nothing to revise', async () => {
      const result = await createContentTool.execute(
        { kind: 'graphic', serviceId: SERVICE_ID, category: 'tips' },
        buildCtx()
      );

      expect(result.ok).toBe(true);
      expect(openContentProposal).toHaveBeenCalled();
    });
  });

  describe('patchContentTool — the caption card', () => {
    const state = {
      itemId: 'item-1',
      kind: 'video' as const,
      attemptId: 'attempt-1',
      assetId: 'video-1',
      superseded: false,
      reviewStatus: 'pending',
      targetPageIds: [],
      caption: null,
      textFields: {},
      templateKey: null,
    };

    // ONE card per post, re-shown prefilled. A caption change costs nothing and
    // has already happened, so there is nothing to approve — but the post is
    // still the post, and suppressing its card left Claire typing the caption out
    // in chat as the only evidence.
    it('re-shows the post card rather than leaving Claire to narrate', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(state)
        .mockResolvedValueOnce({
          caption: 'Three sessions is all it takes.',
          messages: [],
          suggestedRule: null,
          stagedEdits: null,
          renderCount: 0,
          pendingRegenerate: null,
        });

      const result = await patchContentTool.execute(
        { itemId: 'item-1', instruction: 'make the caption less salesy' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        (result as { presentation?: { type?: string } }).presentation?.type
      ).toBe('content_clips');
      expect(result.data?.title).toBe('Caption updated');
      expect(result.data?.fields).toEqual([
        { label: 'Caption', value: 'Three sessions is all it takes.' },
      ]);
    });

    // The failure this pins: a staged re-roll came back with a card and a list of
    // changes, and the outer model — which never sees the classifier's "nothing
    // is spent" instruction — wrote "Done — slide 6 has been refreshed" over a
    // slide that had not changed.
    it('says plainly that nothing has been spent yet', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({
          ...state,
          kind: 'graphic',
          assetId: 'graphic-1',
        })
        .mockResolvedValueOnce({
          caption: 'unchanged',
          messages: [],
          suggestedRule: null,
          stagedEdits: null,
          renderCount: 0,
          pendingRegenerate: [
            { slideIndex: 5, op: 'refine', note: 'something different' },
          ],
        });

      const result = await patchContentTool.execute(
        { itemId: 'item-1', instruction: 'change slide 6' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data?.awaitingApproval).toBe(true);
      expect(result.data?.fields).toContainEqual({
        label: 'Status',
        value: 'Waiting for you to confirm — nothing has been spent yet',
      });
    });

    // A proposal has no graphic yet, so there is nothing to point a card at. An
    // empty id rendered a card pointed at nothing.
    it('shows no card for a graphic that has not been generated', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({ ...state, kind: 'graphic', assetId: null })
        .mockResolvedValueOnce({
          caption: 'unchanged',
          messages: [],
          suggestedRule: null,
          stagedEdits: null,
          renderCount: 0,
          pendingRegenerate: null,
        });

      const result = await patchContentTool.execute(
        { itemId: 'item-1', instruction: 'make it warmer' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      expect(
        (result as { presentation?: { type?: string } }).presentation?.type
      ).toBe('none');
    });

    // Anything costing a render still comes back as the list with the approval.
    it('returns the clip card when the change is waiting on a render', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(state)
        .mockResolvedValueOnce({
          caption: 'unchanged',
          messages: [],
          suggestedRule: null,
          stagedEdits: {
            clips: [{ op: 'remove', clipNumber: 2 }],
            textChanges: [],
          },
          renderCount: 0,
          pendingRegenerate: null,
        });

      const result = await patchContentTool.execute(
        { itemId: 'item-1', instruction: 'get rid of clip 2' },
        buildCtx({ apiFetch: apiFetch as never })
      );

      const card = (result as { presentation?: { type?: string } })
        .presentation;
      expect(card?.type).toBe('content_clips');
      expect(result.ok && result.data?.awaitingApproval).toBe(true);
    });
  });

  describe('createContentTool — the card stamp', () => {
    // Render the video, reload the page, and the ORIGINAL proposal was still
    // offering Accept over a cut that no longer existed. The card decides that by
    // comparing the attempt it was drawn for against the item's live one — so
    // without a stamp every card for an item is equally live, forever.
    it('stamps the clip card with the attempt it was drawn for', async () => {
      const apiFetch = jest.fn().mockResolvedValueOnce({
        id: 'v-new',
        title: 'Microneedling — Caption Tease',
        itemId: 'item-1',
        attemptId: 'attempt-1',
        draftConfig: {},
      });

      const result = await createContentTool.execute(
        { kind: 'video', format: 'caption_tease', serviceId: SERVICE_ID },
        buildCtx({ apiFetch: apiFetch as never })
      );

      const card = (
        result as {
          presentation?: { type?: string; attemptId?: string; itemId?: string };
        }
      ).presentation;
      expect(card?.type).toBe('content_clips');
      expect(card?.itemId).toBe('item-1');
      expect(card?.attemptId).toBe('attempt-1');
    });
  });

  describe('createContentTool — video', () => {
    it('POSTs partial input, returns a preview card with auto-picked clips, and does NOT auto-queue the render', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValue({ id: 'a', name: 'Clip', type: 'video' })
        .mockResolvedValueOnce({
          id: 'v-new',
          title: 'Auto-titled',
          templateId: 'authority',
          variationId: 'authority-1',
          serviceId: SERVICE_ID,
          draftConfig: {
            scriptText: 'A quick word on lip filler this winter.',
            orientation: 'portrait',
            narrationType: 'ai_voiceover',
            bRollClips: [
              { assetId: 'asset-1', order: 0 },
              { assetId: 'asset-2', order: 1 },
              { assetId: 'asset-3', order: 2 },
            ],
          },
        });
      const result = await createContentTool.execute(
        {
          kind: 'video',
          format: 'authority',
          serviceId: SERVICE_ID,
          title: 'Lip filler — winter',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      // POST videos + 3 asset hydration fetches — no auto-render.
      expect(apiFetch).toHaveBeenCalledTimes(4);
      const [postPath, postOpts] = apiFetch.mock.calls[0] as [
        string,
        {
          method?: string;
          body?: { format?: string; title?: string; serviceId?: string };
        },
      ];
      expect(postPath).toBe('videos');
      expect(postOpts.method).toBe('POST');
      expect(postOpts.body?.format).toBe('authority');
      expect(postOpts.body?.title).toBe('Lip filler — winter');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.videoId).toBe('v-new');
        expect(result.data.status).toBe('draft');
        // `rendered` is gone from the contract entirely — `status` is the only
        // claim, and it says only what the server confirmed.
        expect('rendered' in result.data).toBe(false);
        expect(result.data.uiState).toBe('created');
        // Card surfaces resolved defaults the user is about to render with,
        // including the auto-picked clip summary the frontend hydrates into
        // the interactive strip.
        const labels = result.data.fields?.map((f) => f.label) ?? [];
        expect(labels).toEqual(
          expect.arrayContaining([
            'Format',
            'Orientation',
            'Narration',
            'Script',
            'Clips',
            'Status',
          ])
        );
        // Clip asset IDs flow through ordered for the picker dialog.
        expect(result.data.clipAssetIds).toEqual([
          'asset-1',
          'asset-2',
          'asset-3',
        ]);
        expect(result.data.serviceId).toBe(SERVICE_ID);
        // No action buttons — Claire asks "render this?" in chat instead.
        expect(result.data.actions).toEqual([]);
      }
    });

    it('queues the render only when autoRender: true is explicitly passed', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({ id: 'v-new', title: 'x', draftConfig: {} })
        .mockResolvedValueOnce(undefined);
      const result = await createContentTool.execute(
        {
          kind: 'video',
          format: 'authority',
          serviceId: SERVICE_ID,
          autoRender: true,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(apiFetch).toHaveBeenCalledTimes(2);
      const [exportPath, exportOpts] = apiFetch.mock.calls[1] as [
        string,
        { method?: string; body?: { allowStockFootage?: boolean } },
      ];
      expect(exportPath).toBe('videos/v-new/export');
      expect(exportOpts.method).toBe('POST');
      expect(exportOpts.body?.allowStockFootage).toBe(true);
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.status).toBe('queued');
        // The 47-case production shape was `{ rendered: true, status:
        // 'queued' }`. `rendered` no longer exists, so a queued job can no
        // longer be relayed as a completed render.
        expect('rendered' in result.data).toBe(false);
        expect(result.data.renderBlocked).toBeUndefined();
      }
    });

    it('still returns the created card when an explicit render-queue step fails', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'v-new',
          title: 'Needs clips',
          draftConfig: {},
        })
        .mockRejectedValueOnce(
          new Error('Video configuration is incomplete: missing clips')
        );
      const result = await createContentTool.execute(
        {
          kind: 'video',
          format: 'authority',
          serviceId: SERVICE_ID,
          autoRender: true,
        },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.videoId).toBe('v-new');
        // The draft WAS created; only the render was refused. The old shape
        // fused these into `{ rendered: false, error }`, which read as a total
        // failure. `error` is now reserved for "nothing was created".
        expect(result.data.status).toBe('draft');
        expect(result.data.error).toBeUndefined();
        expect(result.data.renderBlocked).toContain('missing clips');
        // CreatedCard shape is still emitted so the user sees iterate actions.
        expect(result.data.uiState).toBe('created');
      }
    });

    // `before_after` is deliberately absent — the format is retired.
    it('accepts every supported format — ad, offer, and organics', () => {
      for (const format of [
        'authority',
        'educational',
        'offer',
        'caption_tease',
        'ins_outs',
        'question_cta',
        'improves',
      ]) {
        const parsed = createContentTool.inputSchema.safeParse({
          kind: 'video',
          format,
          serviceId: SERVICE_ID,
          // offer needs an offerId; harmless for the others.
          offerId: 'offer_1',
        });
        expect(parsed.success).toBe(true);
      }
    });

    it('rejects unknown formats not in the enum', () => {
      for (const format of ['testimonial', 'not_a_format']) {
        const parsed = createContentTool.inputSchema.safeParse({
          kind: 'video',
          format,
          serviceId: SERVICE_ID,
        });
        expect(parsed.success).toBe(false);
      }
    });

    it('forwards offerId for offer-format videos so the controller can build the card', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValue({ id: 'a', name: 'Clip', type: 'video' })
        .mockResolvedValueOnce({
          id: 'v-offer',
          title: 'Summer Offer',
          templateId: 'offer',
          variationId: 'offer-square-1',
          serviceId: SERVICE_ID,
          draftConfig: {
            orientation: 'square',
            narrationType: 'text_only',
            bRollClips: [{ assetId: 'asset-1', order: 0 }],
          },
        });

      const result = await createContentTool.execute(
        {
          kind: 'video',
          format: 'offer',
          serviceId: SERVICE_ID,
          offerId: 'offer_1',
        },
        buildCtx({ apiFetch: apiFetch as never })
      );

      const [, postOpts] = apiFetch.mock.calls[0] as [
        string,
        { body?: { format?: string; offerId?: string } },
      ];
      expect(postOpts.body?.format).toBe('offer');
      expect(postOpts.body?.offerId).toBe('offer_1');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        const formatField = result.data.fields?.find(
          (f) => f.label === 'Format'
        );
        expect(formatField?.value).toBe('Offer (promo card)');
      }
    });

    it('surfaces the organic format label on the preview card', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValue({ id: 'a', name: 'Clip', type: 'video' })
        .mockResolvedValueOnce({
          id: 'v-organic',
          title: "In's & Out's",
          templateId: 'ins-outs',
          variationId: 'ins-outs-1',
          serviceId: SERVICE_ID,
          draftConfig: {
            orientation: 'portrait',
            narrationType: 'text_only',
            bRollClips: [{ assetId: 'asset-1', order: 0 }],
          },
        });

      const result = await createContentTool.execute(
        { kind: 'video', format: 'ins_outs', serviceId: SERVICE_ID },
        buildCtx({ apiFetch: apiFetch as never })
      );

      const [, postOpts] = apiFetch.mock.calls[0] as [
        string,
        { body?: { format?: string } },
      ];
      // The organic format alias is forwarded verbatim to the controller,
      // which resolves it to the ins-outs template + organic copy.
      expect(postOpts.body?.format).toBe('ins_outs');
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        const formatField = result.data.fields?.find(
          (f) => f.label === 'Format'
        );
        expect(formatField?.value).toBe("In's & Out's (organic)");
      }
    });
  });
});

/**
 * A 4xx is an ANSWER; a 5xx is a fault.
 *
 * The port names why a render was refused — not a draft, b-roll still
 * transcoding — so the owner gets a sentence they can act on. Reporting those
 * to Sentry buries the real faults under refusals that are working as designed.
 *
 * These guards existed for `executeVideoExport` and `updateDraftConfig` and
 * went out with them when the render pair collapsed into `renderVideo`. It
 * inherits the same port and the same `describeRenderBlocked` path, so the
 * behaviour should be identical — "should be" is exactly what a regression
 * guard is for.
 */
describe('renderVideoTool — 4xx reportIssue gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const videoItem = {
    itemId: 'item-1',
    kind: 'video' as const,
    attemptId: 'attempt-1',
    assetId: 'video-1',
    superseded: false,
    reviewStatus: 'pending',
    targetPageIds: [],
    caption: null,
    textFields: {},
    templateKey: null,
    pendingRegenerate: null,
  };

  it('relays a 4xx refusal without reporting it', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      if (path.endsWith('/state')) return videoItem;
      throw new ApiFetchError('Video is not in draft state', 400);
    });

    const result = await renderVideoTool.execute(
      { itemId: 'item-1' },
      // PRE-CONFIRMED. `renderVideo` is destructive, so an unconfirmed call
      // returns the confirmation card and never reaches the body — assertions
      // guarded by `if (result.data)` then passed by being skipped, which is
      // how this guard was silently vacuous before. The WhatsApp branch is the
      // documented way in: an inbound affirmation is the confirmation there.
      // What is under test — how a refusal versus a fault is reported — runs
      // the same either way.
      buildCtx({
        apiFetch: apiFetch as never,
        channel: 'whatsapp',
        confirmedActions: ['queue_video_export'],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.data?.error).toBeTruthy();
    expect(logWarning).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('still reports a 5xx as a genuine fault', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      if (path.endsWith('/state')) return videoItem;
      throw new ApiFetchError('Internal server error', 500);
    });

    const result = await renderVideoTool.execute(
      { itemId: 'item-1' },
      // PRE-CONFIRMED. `renderVideo` is destructive, so an unconfirmed call
      // returns the confirmation card and never reaches the body — assertions
      // guarded by `if (result.data)` then passed by being skipped, which is
      // how this guard was silently vacuous before. The WhatsApp branch is the
      // documented way in: an inbound affirmation is the confirmation there.
      // What is under test — how a refusal versus a fault is reported — runs
      // the same either way.
      buildCtx({
        apiFetch: apiFetch as never,
        channel: 'whatsapp',
        confirmedActions: ['queue_video_export'],
      })
    );

    expect(result.ok).toBe(true);
    // The port classifies a 5xx as `server_error` rather than a stated refusal,
    // so the owner gets a sentence they can act on instead of "Internal server
    // error" — which told them nothing.
    expect(result.ok && result.data?.error).toContain('on our side');
    // reportIssue defaults to level: 'warning' → logWarning
    expect(logWarning).toHaveBeenCalledTimes(1);
  });

  // Pointing the render at a post whose cut has moved on is a mistake to
  // correct, not an incident.
  it('refuses a graphic without reporting it', async () => {
    const apiFetch = jest.fn(async () => ({
      ...videoItem,
      kind: 'graphic' as const,
    }));

    const result = await renderVideoTool.execute(
      { itemId: 'item-1' },
      // PRE-CONFIRMED. `renderVideo` is destructive, so an unconfirmed call
      // returns the confirmation card and never reaches the body — assertions
      // guarded by `if (result.data)` then passed by being skipped, which is
      // how this guard was silently vacuous before. The WhatsApp branch is the
      // documented way in: an inbound affirmation is the confirmation there.
      // What is under test — how a refusal versus a fault is reported — runs
      // the same either way.
      buildCtx({
        apiFetch: apiFetch as never,
        channel: 'whatsapp',
        confirmedActions: ['queue_video_export'],
      })
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.data?.error).toContain('graphic');
    expect(logWarning).not.toHaveBeenCalled();
  });
});

/**
 * "What footage is there?" asked of two shelves.
 *
 * Two tools made that a decision Claire had to get right before she could
 * answer it, and getting it wrong had a specific failure: read only uploads,
 * find none, and tell the owner to go and film something. Most orgs have no
 * uploads for a given service and their videos are already built from stock, so
 * that answer was both wrong and discouraging.
 */
describe('listMediaTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads UPLOADS by default, through the port', async () => {
    const apiFetch = jest.fn().mockResolvedValue({
      assets: [{ id: 'asset-1', name: 'Clip', type: 'video' }],
      total: 1,
    });

    const result = await listMediaTool.execute(
      { serviceId: SERVICE_ID },
      buildCtx({ apiFetch: apiFetch as never })
    );

    expect(result.ok).toBe(true);
    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toContain('assets');
    expect(path).not.toContain('stock-clips');
  });

  // A grid the owner picks from by eye — which shot is right is a judgement
  // made by looking, and a list of sentences is a worse version of a UI that
  // already exists.
  it('returns a picker card for uploads', async () => {
    const apiFetch = jest
      .fn()
      .mockResolvedValue({ assets: [{ id: 'asset-1', name: 'Clip' }] });

    const result = await listMediaTool.execute(
      {},
      buildCtx({ apiFetch: apiFetch as never })
    );

    expect(
      (result as { presentation?: { type?: string } }).presentation?.type
    ).toBe('asset_picker');
  });

  // The grid paints from an <img>, and `blobUrl` is the .mp4 — so dropping the
  // poster frame anywhere on the way through the port is a wall of broken
  // thumbnails, which is exactly what shipped.
  it('carries the poster frame through to the picker card', async () => {
    // `items` — the shape `GET /assets` actually returns, and the one the port
    // reads. A payload keyed `assets` parses to an empty list.
    const apiFetch = jest.fn().mockResolvedValue({
      items: [
        {
          id: 'asset-1',
          name: 'Clip',
          type: 'video',
          blobUrl: 'https://cdn.example/clip.mp4',
          thumbnailUrl: 'https://cdn.example/clip.jpg',
        },
      ],
    });

    const result = await listMediaTool.execute(
      {},
      buildCtx({ apiFetch: apiFetch as never })
    );

    const { assets } = (
      result as {
        presentation: { assets: { thumbnailUrl?: string | null }[] };
      }
    ).presentation;
    expect(assets[0]?.thumbnailUrl).toBe('https://cdn.example/clip.jpg');
  });

  it('reads the STOCK bank when asked, narrowed to the service', async () => {
    const apiFetch = jest.fn().mockResolvedValue({
      items: [
        {
          stockClipId: 'stock-1',
          description: 'Treatment room pan',
          durationSec: 8,
          isGeneric: false,
        },
      ],
    });

    const result = await listMediaTool.execute(
      { source: 'stock', serviceId: SERVICE_ID },
      buildCtx({ apiFetch: apiFetch as never })
    );

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toContain('videos/stock-clips');
    expect(path).toContain(`serviceId=${SERVICE_ID}`);
    expect(result.ok && result.data?.clips?.[0]?.stockClipId).toBe('stock-1');
  });

  // Stock tiles have NO asset id until they are minted, so a picker built from
  // them would hand back ids nothing can attach.
  it('shows no picker card for stock', async () => {
    const apiFetch = jest.fn().mockResolvedValue({ items: [] });

    const result = await listMediaTool.execute(
      { source: 'stock' },
      buildCtx({ apiFetch: apiFetch as never })
    );

    expect(
      (result as { presentation?: { type?: string } }).presentation
    ).toBeUndefined();
  });

  it('relays a stock failure rather than throwing', async () => {
    const apiFetch = jest.fn(async () => {
      throw new Error('bank unreachable');
    });

    const result = await listMediaTool.execute(
      { source: 'stock' },
      buildCtx({ apiFetch: apiFetch as never })
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.data?.error).toContain('bank unreachable');
  });
});
