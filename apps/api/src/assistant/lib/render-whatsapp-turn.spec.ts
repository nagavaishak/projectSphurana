/**
 * WS-6 gate — the WhatsApp turn renderer.
 *
 * Tests the PURE `renderWhatsappTurn` planner: a HeadlessTurnResult with text +
 * an ad/offer `preview_card` → expected ordered sends (text bubble(s), media,
 * summary, CTA); `---MSG_BREAK---` splitting; >4096 char splitting; offer
 * variant; web-only presentation degraded.
 *
 * `render-whatsapp-turn.ts` imports `@borradh-workspace/database` and
 * `@borradh-workspace/features/meta-ads` (used only inside the async
 * `resolvePreviewMedia` helper, never by the pure planner). Those barrels pull
 * in cuid2 (ESM) which jest can't transform, so we mock them — the pure tests
 * never touch the real modules.
 */
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/meta-ads', () => ({
  resolveMediaAsset: jest.fn(),
  getFreshDownloadUrl: jest.fn(),
}));

import type {
  CollectedToolEvent,
  HeadlessTurnResult,
} from './collecting-sink.js';
import {
  type ResolvedPreviewMedia,
  type WhatsappSend,
  renderWhatsappTurn,
  splitTextIntoBodies,
} from './render-whatsapp-turn.js';

function baseResult(
  overrides: Partial<HeadlessTurnResult> = {}
): HeadlessTurnResult {
  return {
    textSegments: [],
    toolEvents: [],
    reasoningSegments: [],
    stopReason: 'end_turn',
    rounds: 1,
    toolParts: [],
    finalText: '',
    ...overrides,
  };
}

function adPreviewEvent(
  overrides: Partial<{
    toolCallId: string;
    state: Record<string, unknown>;
    missing: string[];
  }> = {}
): CollectedToolEvent {
  const toolCallId = overrides.toolCallId ?? 'call-ad-1';
  const state = overrides.state ?? {
    headline: 'Glow facial - 20% off',
    primaryText: 'Treat yourself this month.',
    callToAction: 'Book Now',
    serviceIds: ['svc-1'],
    videoId: 'video-1',
    targeting: { radiusKm: 20, ageMin: 25, ageMax: 55 },
  };
  const missing = overrides.missing ?? [];
  return {
    toolName: 'claire_showAdPreview',
    toolCallId,
    input: {},
    output: {
      data: { draftId: 'ad-1', ready: missing.length === 0, missing },
      presentation: {
        type: 'preview_card',
        kind: 'ad',
        draftId: 'ad-1',
        state,
      },
    },
    presentation: { type: 'preview_card', kind: 'ad', draftId: 'ad-1', state },
  };
}

describe('splitTextIntoBodies', () => {
  it('splits on the MSG_BREAK delimiter into separate bubbles', () => {
    expect(
      splitTextIntoBodies('first bubble\n---MSG_BREAK---\nsecond bubble')
    ).toEqual(['first bubble', 'second bubble']);
  });

  it('drops empty fragments', () => {
    expect(splitTextIntoBodies('only\n---MSG_BREAK---\n   ')).toEqual(['only']);
  });

  it('hard-caps an overlong fragment at <= 4096 chars, splitting on a boundary', () => {
    const long = `${'a'.repeat(3990)} ${'b'.repeat(3990)}`;
    const bodies = splitTextIntoBodies(long);
    expect(bodies.length).toBe(2);
    for (const b of bodies) expect(b.length).toBeLessThanOrEqual(4000);
    expect(bodies[0]).toMatch(/^a+$/);
    expect(bodies[1]).toMatch(/^b+$/);
  });
});

describe('renderWhatsappTurn', () => {
  it('text + ad preview (media resolved) → text, media, summary, CTA in order', () => {
    const event = adPreviewEvent();
    const result = baseResult({
      textSegments: ["Here's the ad I put together."],
      toolEvents: [event],
    });
    const previewMedia: ResolvedPreviewMedia[] = [
      {
        toolCallId: event.toolCallId,
        media: {
          mediaType: 'video',
          link: 'https://signed.example/video-1.mp4',
        },
      },
    ];

    const sends = renderWhatsappTurn(result, { previewMedia });

    // 1 narration bubble, 1 media, 1 summary, 1 CTA.
    expect(sends.map((s) => s.kind)).toEqual(['text', 'media', 'text', 'text']);

    expect(sends[0]).toEqual({
      kind: 'text',
      body: "Here's the ad I put together.",
    });
    expect(sends[1]).toEqual({
      kind: 'media',
      mediaType: 'video',
      link: 'https://signed.example/video-1.mp4',
    });
    const summary = sends[2] as Extract<WhatsappSend, { kind: 'text' }>;
    expect(summary.body).toContain('*Ad preview*');
    expect(summary.body).toContain('Headline: Glow facial - 20% off');
    expect(summary.body).toContain('Caption: Treat yourself this month.');
    expect(summary.body).toContain('Button: Book Now');
    expect(summary.body).toContain('Targeting: 20km radius, ages 25-55');
    expect(sends[3]).toEqual({
      kind: 'text',
      body: 'Reply *launch* to publish, or tell me what to change.',
    });
  });

  it('splits a narration segment on MSG_BREAK into multiple bubbles before the preview', () => {
    const event = adPreviewEvent();
    const result = baseResult({
      textSegments: ['Bubble one.\n---MSG_BREAK---\nBubble two.'],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {
      previewMedia: [
        {
          toolCallId: event.toolCallId,
          media: { mediaType: 'image', link: 'https://signed.example/img.png' },
        },
      ],
    });
    expect(sends.map((s) => s.kind)).toEqual([
      'text', // bubble one
      'text', // bubble two
      'media',
      'text', // summary
      'text', // CTA
    ]);
    expect(sends[0]).toEqual({ kind: 'text', body: 'Bubble one.' });
    expect(sends[1]).toEqual({ kind: 'text', body: 'Bubble two.' });
  });

  it('ad preview with no resolved media → summary lists missing fields, no media bubble', () => {
    const event = adPreviewEvent({
      state: { headline: 'Draft headline', serviceIds: [] },
      missing: ['creative', 'campaign'],
    });
    const result = baseResult({ textSegments: [], toolEvents: [event] });

    // No previewMedia entry → media is treated as null.
    const sends = renderWhatsappTurn(result, {});

    expect(sends.map((s) => s.kind)).toEqual(['text', 'text']); // summary + CTA, no media
    const summary = sends[0] as Extract<WhatsappSend, { kind: 'text' }>;
    expect(summary.body).toContain('*Ad preview*');
    expect(summary.body).toContain('Still needed: creative, campaign');
    expect(sends[1].kind).toBe('text');
  });

  it('offer preview variant → offer summary + CTA, media null (offers carry no creative)', () => {
    const event: CollectedToolEvent = {
      toolName: 'claire_showOfferPreview',
      toolCallId: 'call-offer-1',
      input: {},
      output: {
        data: { draftId: 'offer-1', ready: true, missing: [] },
        presentation: {
          type: 'preview_card',
          kind: 'offer',
          draftId: 'offer-1',
          state: {
            name: 'New client intro',
            discountType: 'percentage',
            discountPercent: 30,
            validUntil: '2026-07-01T00:00:00.000Z',
            serviceIds: ['svc-1'],
          },
        },
      },
      presentation: {
        type: 'preview_card',
        kind: 'offer',
        draftId: 'offer-1',
        state: {
          name: 'New client intro',
          discountType: 'percentage',
          discountPercent: 30,
          validUntil: '2026-07-01T00:00:00.000Z',
          serviceIds: ['svc-1'],
        },
      },
    };
    const result = baseResult({
      textSegments: ['Your offer is ready.'],
      toolEvents: [event],
    });

    const sends = renderWhatsappTurn(result, {
      previewMedia: [{ toolCallId: 'call-offer-1', media: null }],
    });

    expect(sends.map((s) => s.kind)).toEqual(['text', 'text', 'text']); // narration, summary, CTA — no media
    const summary = sends[1] as Extract<WhatsappSend, { kind: 'text' }>;
    expect(summary.body).toContain('*Offer preview*');
    expect(summary.body).toContain('Name: New client intro');
    expect(summary.body).toContain('Discount: 30% off');
    expect(summary.body).toContain('Valid until: 2026-07-01T00:00:00.000Z');
  });

  it('web-only presentation (dispatchTour) is omitted; only narration text is sent', () => {
    const tourEvent: CollectedToolEvent = {
      toolName: 'meta_dispatchTour',
      toolCallId: 'call-tour-1',
      input: {},
      output: { presentation: { type: 'dispatch_tour', tourId: 'welcome' } },
      presentation: { type: 'dispatch_tour', tourId: 'welcome' },
    };
    const result = baseResult({
      textSegments: ['Let me show you around.'],
      toolEvents: [tourEvent],
    });

    const sends = renderWhatsappTurn(result, {});

    expect(sends).toEqual([{ kind: 'text', body: 'Let me show you around.' }]);
  });

  it('listAvailableAssets (≤10 clips) renders only the interactive list, no narration text', () => {
    const event: CollectedToolEvent = {
      toolName: 'videos_listAvailableAssets',
      toolCallId: 'call-assets-1',
      input: {},
      output: {
        data: {
          assets: [
            { id: 'a1', name: 'Clinic tour', type: 'video', duration: 45 },
            { id: 'a2', name: 'Before after', type: 'image', duration: null },
          ],
          total: 2,
        },
      },
    };
    const result = baseResult({
      textSegments: ['Here are your clips.'],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['interactive_list']);
    const list = sends[0] as Extract<
      WhatsappSend,
      { kind: 'interactive_list' }
    >;
    expect(list.header).toBe('Your clips');
    expect(list.buttonText).toBe('Browse clips');
    expect(list.sections).toHaveLength(1);
    const rows = list.sections[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('a1');
    expect(rows[0].title).toContain('Clinic tour');
    expect(rows[0].description).toContain('Video');
    expect(rows[0].description).toContain('45s');
    expect(rows[1].id).toBe('a2');
    expect(rows[1].title).toContain('Before after');
    expect(rows[1].description).toContain('Image');
  });

  it('listAvailableAssets (>10 clips) falls back to numbered text list', () => {
    const assets = Array.from({ length: 12 }, (_, i) => ({
      id: `a${i}`,
      name: `Clip ${i + 1}`,
      type: 'video',
      duration: 30,
    }));
    const event: CollectedToolEvent = {
      toolName: 'videos_listAvailableAssets',
      toolCallId: 'call-assets-many',
      input: {},
      output: { data: { assets, total: 12 } },
    };
    const result = baseResult({
      textSegments: ['Here are your clips.'],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['text', 'text']);
    const list = (sends[1] as Extract<WhatsappSend, { kind: 'text' }>).body;
    expect(list).toContain('*Your clips:*');
    expect(list).toContain('1.');
    expect(list).toContain('12.');
    expect(list).toContain('Reply with the numbers');
  });

  it('createDraftVideo without clips sends only the narration (no duplicate summary)', () => {
    const event: CollectedToolEvent = {
      toolName: 'videos_createDraftVideo',
      toolCallId: 'call-draft-1',
      input: {},
      output: {
        data: {
          videoId: 'v1',
          title: 'Facial promo',
          uiState: 'created',
          fields: [
            { label: 'Format', value: 'Educational' },
            { label: 'Orientation', value: 'Portrait' },
          ],
        },
      },
    };
    const result = baseResult({
      textSegments: ['Draft created.'],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['text']);
    expect(sends[0]).toEqual({ kind: 'text', body: 'Draft created.' });
  });

  it('createDraftVideo with clips sends only the interactive clip list, no narration text', () => {
    const event: CollectedToolEvent = {
      toolName: 'videos_createDraftVideo',
      toolCallId: 'call-draft-2',
      input: {},
      output: {
        data: {
          videoId: 'v1',
          title: 'Botox treatment',
          uiState: 'created',
          clipAssetIds: ['a1', 'a2', 'a3'],
          clips: [
            { id: 'a1', name: 'Clinic tour', type: 'video', duration: 45 },
            { id: 'a2', name: 'Before shot', type: 'image', duration: null },
            { id: 'a3', name: 'After shot', type: 'image', duration: null },
          ],
          fields: [
            { label: 'Format', value: 'Before & After' },
            { label: 'Clips', value: '3 selected' },
          ],
        },
      },
    };
    const result = baseResult({
      textSegments: ['Here is your video draft.'],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['interactive_list']);
    const list = sends[0] as Extract<
      WhatsappSend,
      { kind: 'interactive_list' }
    >;
    expect(list.header).toBe('Clips in your video');
    expect(list.buttonText).toBe('View clips');
    expect(list.sections[0].rows).toHaveLength(3);
    expect(list.sections[0].rows[0].title).toContain('Clinic tour');
    expect(list.sections[0].rows[1].title).toContain('Before shot');
    expect(list.sections[0].rows[2].title).toContain('After shot');
  });

  it('getVideoStatus with ready status renders a video media send', () => {
    const event: CollectedToolEvent = {
      toolName: 'videos_getVideoStatus',
      toolCallId: 'call-status-1',
      input: {},
      output: {
        data: {
          videoId: 'v1',
          status: 'ready',
          blobUrl: 'https://cdn.example/video.mp4',
          title: 'My video',
        },
      },
    };
    const result = baseResult({ toolEvents: [event] });
    const sends = renderWhatsappTurn(result, {});
    expect(sends).toEqual([
      {
        kind: 'media',
        mediaType: 'video',
        link: 'https://cdn.example/video.mp4',
        caption: '✅ My video',
      },
    ]);
  });

  it('getVideoStatus with processing status renders a text status', () => {
    const event: CollectedToolEvent = {
      toolName: 'videos_getVideoStatus',
      toolCallId: 'call-status-2',
      input: {},
      output: {
        data: {
          videoId: 'v1',
          status: 'rendering',
          progress: 42,
          processingStage: 'compositing',
        },
      },
    };
    const result = baseResult({ toolEvents: [event] });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['text']);
    const body = (sends[0] as Extract<WhatsappSend, { kind: 'text' }>).body;
    expect(body).toContain('*Video render*');
    expect(body).toContain('Status: rendering');
    expect(body).toContain('Progress: 42%');
    expect(body).toContain('Stage: compositing');
  });

  it('executeVideoExport queued event is silently skipped', () => {
    const event: CollectedToolEvent = {
      toolName: 'videos_executeVideoExport',
      toolCallId: 'call-export-1',
      input: {},
      output: {
        data: { videoId: 'v1', status: 'queued', message: 'Render queued' },
      },
    };
    const result = baseResult({
      textSegments: ['Render is queued.'],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends).toEqual([{ kind: 'text', body: 'Render is queued.' }]);
  });

  it('multiple text segments (before + after tool call) merge into a single bubble', () => {
    const event: CollectedToolEvent = {
      toolName: 'content_patchContent',
      toolCallId: 'call-patch-1',
      input: {},
      output: {
        data: {
          videoId: 'v1',
          title: 'Facial promo',
          uiState: 'created',
          rendered: true,
          fields: [{ label: 'Status', value: 'Patch applied — re-rendering' }],
        },
      },
    };
    const result = baseResult({
      textSegments: [
        "I'll change the orientation to portrait.",
        'Done — your video is re-rendering now.',
      ],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends).toHaveLength(1);
    expect(sends[0]).toEqual({
      kind: 'text',
      body: "I'll change the orientation to portrait.\n\nDone — your video is re-rendering now.",
    });
  });

  it('patchContent emits only merged narration (no carousel)', () => {
    const event: CollectedToolEvent = {
      toolName: 'content_patchContent',
      toolCallId: 'call-patch-2',
      input: {},
      output: {
        data: {
          videoId: 'v1',
          title: 'Botox treatment',
          uiState: 'created',
          rendered: true,
          fields: [{ label: 'Status', value: 'Patch applied — re-rendering' }],
        },
      },
    };
    const result = baseResult({
      textSegments: ['Updated — re-rendering with new clips.'],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['text']);
  });

  it('createGraphic (rendering) emits status text alongside model narration', () => {
    const event: CollectedToolEvent = {
      toolName: 'graphics_createGraphic',
      toolCallId: 'call-graphic-1',
      input: {},
      output: {
        data: {
          graphicId: 'g1',
          status: 'rendering',
          serviceId: 'svc-1',
          category: 'tips',
          uiState: 'created',
          title: 'Graphic',
          fields: [
            { label: 'Category', value: 'Tips' },
            { label: 'Status', value: 'Generating' },
          ],
        },
      },
    };
    const result = baseResult({
      textSegments: ['Creating a graphic for Botox.'],
      toolEvents: [event],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['text', 'text']);
    expect(sends[0]).toEqual({
      kind: 'text',
      body: 'Creating a graphic for Botox.',
    });
    expect(
      (sends[1] as Extract<WhatsappSend, { kind: 'text' }>).body
    ).toContain('Creating your graphic');
  });

  it('regenerateGraphic (rendering) emits status text', () => {
    const event: CollectedToolEvent = {
      toolName: 'graphics_regenerateGraphic',
      toolCallId: 'call-regen-1',
      input: {},
      output: {
        data: {
          graphicId: 'g2',
          status: 'rendering',
          scope: 'all',
          uiState: 'created',
          title: 'Graphic (edited)',
          fields: [
            { label: 'Change', value: 'make it brighter' },
            { label: 'Status', value: 'Regenerating' },
          ],
        },
      },
    };
    const result = baseResult({ toolEvents: [event] });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['text']);
    expect(
      (sends[0] as Extract<WhatsappSend, { kind: 'text' }>).body
    ).toContain('Creating your graphic');
  });

  it('createGraphic with error emits the error message', () => {
    const event: CollectedToolEvent = {
      toolName: 'graphics_createGraphic',
      toolCallId: 'call-graphic-err',
      input: {},
      output: {
        data: {
          error: 'Service not found',
        },
      },
    };
    const result = baseResult({ toolEvents: [event] });
    const sends = renderWhatsappTurn(result, {});
    expect(sends.map((s) => s.kind)).toEqual(['text']);
    expect(sends[0]).toEqual({ kind: 'text', body: 'Service not found' });
  });

  it('a failed tool event is omitted entirely', () => {
    const failed: CollectedToolEvent = {
      toolName: 'claire_showAdPreview',
      toolCallId: 'call-fail-1',
      input: {},
      errorText: 'boom',
      presentation: {
        type: 'preview_card',
        kind: 'ad',
        draftId: 'ad-x',
        state: {},
      },
    };
    const result = baseResult({
      textSegments: ['Sorry, something went wrong.'],
      toolEvents: [failed],
    });
    const sends = renderWhatsappTurn(result, {});
    expect(sends).toEqual([
      { kind: 'text', body: 'Sorry, something went wrong.' },
    ]);
  });
});
