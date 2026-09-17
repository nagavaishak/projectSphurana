import type { VideoDraftConfig } from '@borradh-workspace/database/schema';
import type { CaptionPage } from '@borradh-workspace/remotion';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BuilderContext,
  BuilderOptions,
  NarrationResult,
  OrgDetails,
} from './editor-state-builder.js';

// ================================================================
// Mocks
// ================================================================

vi.mock('@borradh-workspace/features/videos', () => ({
  getTemplateById: vi.fn(() => undefined),
}));

vi.mock('@borradh-workspace/video-processing/b-roll', () => ({
  scheduleBRollClips: vi.fn(() => []),
  scheduledClipsToScenes: vi.fn(() => []),
}));

vi.mock('@borradh-workspace/video-processing/captions', () => ({
  alignEditedCaptions: vi.fn((captions: unknown[]) => captions),
  buildCaptionPages: vi.fn((): CaptionPage[] => [
    {
      startFrame: 0,
      endFrame: 15,
      words: [
        { text: 'hello', startFrame: 0, endFrame: 10, isHighlighted: false },
        { text: 'world', startFrame: 10, endFrame: 15, isHighlighted: false },
      ],
    },
  ]),
}));

import {
  scheduleBRollClips,
  scheduledClipsToScenes,
} from '@borradh-workspace/video-processing/b-roll';
// Import after mocks
import { buildEditorState } from './editor-state-builder.js';

// ================================================================
// Test helpers
// ================================================================

const DEFAULT_ORG: OrgDetails = {
  name: 'Test Org',
  logo: null,
  outroStyle: 'tagline',
  primaryColor: '#6366f1',
  secondaryColor: '#8b5cf6',
  backgroundColor: '#FFFFFF',
  tagline: null,
  address: null,
};

function createMockCtx(overrides?: Partial<BuilderContext>): BuilderContext {
  return {
    presignUrl: vi.fn(async (url: string) => url),
    getOrganizationDetails: vi.fn(async () => DEFAULT_ORG),
    resolveBRollAssets: vi.fn(
      async (ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            {
              url: `https://cdn.example.com/${id}.mp4`,
              durationSec: 5,
              mediaType: 'video' as const,
            },
          ])
        )
    ),
    updateVideoStage: vi.fn(async () => {}),
    transcribe: vi.fn(async () => [
      { text: 'hello', startMs: 0, endMs: 300 },
      { text: 'world', startMs: 300, endMs: 500 },
    ]),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as BuilderContext['log'],
    ...overrides,
  };
}

function createBaseDraftConfig(
  overrides?: Partial<VideoDraftConfig>
): VideoDraftConfig {
  return {
    narrationType: 'recorded',
    talkingHeadUrl: 'https://s3.example.com/talking-head.mp4',
    bRollClips: [
      { assetId: 'clip-1', order: 0 },
      { assetId: 'clip-2', order: 1 },
    ],
    captions: {
      enabled: true,
      position: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 64,
      textColor: '#FFFFFF',
      highlightColor: '#FFFFFF',
      backgroundColor: 'transparent',
      showBackground: false,
    },
    musicVolume: 0.05,
    outro: {
      logoUrl: undefined,
      businessName: 'Test Business',
      ctaText: 'Book Now',
      backgroundOpacity: 0.8,
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
      durationSec: 3,
    },
    orientation: 'portrait',
    ...overrides,
  };
}

function createRecordedNarration(
  overrides?: Partial<NarrationResult>
): NarrationResult {
  return {
    audioPath: '/tmp/audio.wav',
    audioDurationSec: 10,
    presignedTalkingHeadUrl: 'https://cdn.example.com/talking-head.mp4',
    ...overrides,
  };
}

function createBaseOptions(
  overrides?: Partial<BuilderOptions>
): BuilderOptions {
  return {
    narration: createRecordedNarration(),
    ...overrides,
  };
}

const VIDEO_ID = 'test-video-id';
const ORG_ID = 'test-org-id';

// ================================================================
// Tests
// ================================================================

describe('buildEditorState', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: scheduledClipsToScenes returns two b-roll scenes
    vi.mocked(scheduledClipsToScenes).mockReturnValue([
      {
        id: 'clip-1',
        type: 'b-roll',
        clipUrl: 'https://cdn.example.com/clip-1.mp4',
        trimStart: 0,
        trimEnd: 0,
        startFrame: 90,
        durationInFrames: 90,
        transition: 'fade',
        mediaType: 'video',
      },
      {
        id: 'clip-2',
        type: 'b-roll',
        clipUrl: 'https://cdn.example.com/clip-2.mp4',
        trimStart: 0,
        trimEnd: 0,
        startFrame: 210,
        durationInFrames: 60,
        transition: 'fade',
        mediaType: 'video',
      },
    ]);

    // Default: scheduleBRollClips returns scheduled clips
    vi.mocked(scheduleBRollClips).mockReturnValue([
      {
        id: 'clip-1',
        url: 'https://cdn.example.com/clip-1.mp4',
        startTimeSec: 3,
        durationSec: 3,
        trimStartSec: 0,
      },
      {
        id: 'clip-2',
        url: 'https://cdn.example.com/clip-2.mp4',
        startTimeSec: 7,
        durationSec: 2,
        trimStartSec: 0,
      },
    ]);
  });

  // ------------------------------------------------------------------
  // Recorded narration: talking-head + b-roll tracks
  // ------------------------------------------------------------------

  it('recorded narration → talking-head + b-roll tracks', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig();
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    // Should have tracks
    expect(state.tracks.length).toBeGreaterThanOrEqual(2);

    // base-video track with talking-head item
    const baseTrack = state.tracks.find((t) => t.id === 'base-video');
    expect(baseTrack).toBeDefined();
    const thItem = state.items[baseTrack?.items[0] ?? ''];
    expect(thItem.type).toBe('talking-head');
    expect(thItem.from).toBe(0);
    expect(thItem.durationInFrames).toBe(300); // 10s * 30fps

    // b-roll track
    const bRollTrack = state.tracks.find((t) => t.id === 'b-roll');
    expect(bRollTrack).toBeDefined();
    expect(bRollTrack?.items).toHaveLength(2);

    // Composition meta
    expect(state.fps).toBe(30);
    expect(state.durationInFrames).toBe(300);
    expect(state.compositionWidth).toBe(1080);
    expect(state.compositionHeight).toBe(1920);
    expect(state.orientation).toBe('portrait');
  });

  // ------------------------------------------------------------------
  // talking-head hiddenRanges match b-roll timing
  // ------------------------------------------------------------------

  it('talking-head hiddenRanges match b-roll timing', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig();
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    const baseTrack = state.tracks.find((t) => t.id === 'base-video');
    const thItem = state.items[baseTrack?.items[0] ?? ''] as Record<
      string,
      unknown
    >;

    const hiddenRanges = thItem.hiddenRanges as Array<{
      from: number;
      durationInFrames: number;
    }>;
    expect(hiddenRanges).toHaveLength(2);
    expect(hiddenRanges[0]).toEqual({ from: 90, durationInFrames: 90 });
    expect(hiddenRanges[1]).toEqual({ from: 210, durationInFrames: 60 });
  });

  // ------------------------------------------------------------------
  // AI voiceover: no talking-head, has narration-audio
  // ------------------------------------------------------------------

  it('AI voiceover → no talking-head, has narration-audio', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: 'ai_voiceover',
      scriptText: 'Hello world, this is a test script.',
      aiVoiceId: 'voice-1',
      talkingHeadUrl: null,
    });
    const options = createBaseOptions({
      narration: {
        audioPath: '/tmp/ai-voiceover.wav',
        audioDurationSec: 10,
        narrationAudioUrl: 'https://cdn.example.com/ai-narration.mp3',
      },
    });

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    // No talking-head track
    const baseTrack = state.tracks.find((t) => t.id === 'base-video');
    expect(baseTrack).toBeUndefined();

    // Has narration-audio item
    const audioTrack = state.tracks.find((t) => t.id === 'audio');
    expect(audioTrack).toBeDefined();
    const narrationItem = audioTrack?.items
      .map((id) => state.items[id])
      .find((item) => item.type === 'narration-audio');
    expect(narrationItem).toBeDefined();
    expect(narrationItem?.durationInFrames).toBe(300);
  });

  // ------------------------------------------------------------------
  // text_only: text-frame items, no narration
  // ------------------------------------------------------------------

  it('text_only → text-frame items, no narration', async () => {
    // For text_only, scheduledClipsToScenes should return scenes covering the duration
    vi.mocked(scheduledClipsToScenes).mockReturnValue([
      {
        id: 'clip-1',
        type: 'b-roll',
        clipUrl: 'https://cdn.example.com/clip-1.mp4',
        trimStart: 0,
        trimEnd: 0,
        startFrame: 0,
        durationInFrames: 150,
        transition: 'none',
        mediaType: 'video',
      },
    ]);

    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: 'text_only',
      talkingHeadUrl: null,
      textFrames: [
        { id: 'tf-1', text: 'Welcome', durationSec: 3, style: 'default' },
        { id: 'tf-2', text: 'Learn More', durationSec: 2, style: 'cta' },
      ],
    });
    const options = createBaseOptions({
      narration: {
        audioPath: null,
        audioDurationSec: 5,
        parsedTextFrames: [
          { id: 'tf-1', text: 'Welcome', durationSec: 3, style: 'default' },
          { id: 'tf-2', text: 'Learn More', durationSec: 2, style: 'cta' },
        ],
      },
    });

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    // No talking-head track
    expect(state.tracks.find((t) => t.id === 'base-video')).toBeUndefined();

    // No narration-audio item
    const audioTrack = state.tracks.find((t) => t.id === 'audio');
    const narrationItem = audioTrack?.items
      .map((id) => state.items[id])
      .find((item) => item.type === 'narration-audio');
    expect(narrationItem).toBeUndefined();

    // Has text-frame items
    const textTrack = state.tracks.find((t) => t.id === 'text');
    expect(textTrack).toBeDefined();
    const textItems = (textTrack?.items ?? []).map((id) => state.items[id]);
    const frameItems = textItems.filter((item) => item.type === 'text-frame');
    expect(frameItems).toHaveLength(2);
    expect((frameItems[0] as Record<string, unknown>).text).toBe('Welcome');
    expect(frameItems[0].from).toBe(0);
    expect(frameItems[0].durationInFrames).toBe(90); // 3s * 30fps
    expect((frameItems[1] as Record<string, unknown>).text).toBe('Learn More');
    expect(frameItems[1].from).toBe(90); // starts after first frame
    expect(frameItems[1].durationInFrames).toBe(60); // 2s * 30fps

    // No captions (no audio to transcribe)
    expect(ctx.transcribe).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // text_only educational → stacked-list item
  // ------------------------------------------------------------------

  it('text_only educational → stacked-list item', async () => {
    vi.mocked(scheduledClipsToScenes).mockReturnValue([
      {
        id: 'clip-1',
        type: 'b-roll',
        clipUrl: 'https://cdn.example.com/clip-1.mp4',
        trimStart: 0,
        trimEnd: 0,
        startFrame: 0,
        durationInFrames: 240,
        transition: 'none',
        mediaType: 'video',
      },
    ]);

    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: 'text_only',
      talkingHeadUrl: null,
      textFrames: [
        {
          id: 'tf-q',
          text: 'Top 3 Tips?',
          durationSec: 2,
          style: 'question',
        },
        { id: 'tf-1', text: 'Tip One', durationSec: 2, style: 'answer' },
        { id: 'tf-2', text: 'Tip Two', durationSec: 2, style: 'answer' },
        { id: 'tf-cta', text: 'DM me!', durationSec: 2, style: 'cta' },
      ],
      outro: undefined as unknown as VideoDraftConfig['outro'],
    });
    const options = createBaseOptions({
      narration: {
        audioPath: null,
        audioDurationSec: 8,
        parsedTextFrames: [
          {
            id: 'tf-q',
            text: 'Top 3 Tips?',
            durationSec: 2,
            style: 'question',
          },
          { id: 'tf-1', text: 'Tip One', durationSec: 2, style: 'answer' },
          { id: 'tf-2', text: 'Tip Two', durationSec: 2, style: 'answer' },
          { id: 'tf-cta', text: 'DM me!', durationSec: 2, style: 'cta' },
        ],
      },
      variationId: 'educational-list',
    });

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    // Has stacked-list item
    const textTrack = state.tracks.find((t) => t.id === 'text');
    const textItems = (textTrack?.items ?? []).map((id) => state.items[id]);
    const stackedItem = textItems.find(
      (item) => item.type === 'stacked-list'
    ) as Record<string, unknown> | undefined;
    expect(stackedItem).toBeDefined();
    expect(stackedItem?.durationInFrames).toBe(240); // 8s * 30fps

    const config = stackedItem?.config as Record<string, unknown>;
    expect(config.headerText).toBe('Top 3 Tips?');
    expect(config.items).toEqual(['Tip One', 'Tip Two']);
    expect(config.ctaText).toBe('DM me!');
    expect(config.primaryColor).toBe('#6366f1');

    // No outro for educational
    expect(state.tracks.find((t) => t.id === 'outro')).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // text_only offer → content-card item
  // ------------------------------------------------------------------

  it('text_only offer → content-card item with variant dark-overlay', async () => {
    vi.mocked(scheduledClipsToScenes).mockReturnValue([
      {
        id: 'clip-1',
        type: 'b-roll',
        clipUrl: 'https://cdn.example.com/clip-1.mp4',
        trimStart: 0,
        trimEnd: 0,
        startFrame: 0,
        durationInFrames: 180,
        transition: 'none',
        mediaType: 'video',
      },
    ]);

    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: 'text_only',
      talkingHeadUrl: null,
      textFrames: [],
      offerCard: {
        serviceName: 'Deep Tissue Massage',
        headline: '50% Off',
        originalPriceCents: 10000,
        offerPriceCents: 5000,
        discountPercent: 50,
        bulletPoints: ['60 min session', 'All areas'],
        ctaText: 'Book Now',
        primaryColor: '#FF0000',
        secondaryColor: '#00FF00',
      },
    });
    const options = createBaseOptions({
      narration: {
        audioPath: null,
        audioDurationSec: 6,
        parsedTextFrames: [],
      },
    });

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    // Has content-card item on overlays track
    const overlaysTrack = state.tracks.find((t) => t.id === 'overlays');
    expect(overlaysTrack).toBeDefined();
    const cardItem = (overlaysTrack?.items ?? [])
      .map((id) => state.items[id])
      .find((item) => item.type === 'content-card') as Record<string, unknown>;
    expect(cardItem).toBeDefined();
    expect(cardItem.variant).toBe('dark-overlay');
    expect(cardItem.durationInFrames).toBe(180); // 6s * 30fps

    const card = cardItem.card as Record<string, unknown>;
    expect(card.serviceName).toBe('Deep Tissue Massage');
    expect(card.headline).toBe('50% Off');
    expect(card.primaryColor).toBe('#FF0000');
  });

  // ------------------------------------------------------------------
  // before-after-1 → reveals + pip + interstitial
  // ------------------------------------------------------------------

  it('before-after-1 → reveals + pip + interstitial', async () => {
    vi.mocked(scheduledClipsToScenes).mockReturnValue([
      {
        id: 'before-asset',
        type: 'b-roll',
        clipUrl: 'https://cdn.example.com/before.jpg',
        trimStart: 0,
        trimEnd: 0,
        startFrame: 15,
        durationInFrames: 45,
        transition: 'none',
        mediaType: 'image',
        bRollType: 'before',
      },
      {
        id: 'after-asset',
        type: 'b-roll',
        clipUrl: 'https://cdn.example.com/after.jpg',
        trimStart: 0,
        trimEnd: 0,
        startFrame: 120,
        durationInFrames: 60,
        transition: 'fade',
        mediaType: 'image',
        bRollType: 'after',
      },
    ]);

    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      bRollClips: [
        { assetId: 'before-asset', order: 0, clipType: 'before' },
        { assetId: 'after-asset', order: 1, clipType: 'after' },
      ],
    });
    const options = createBaseOptions({
      variationId: 'before-after-1',
    });

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    // Has reveals track with full-screen-reveal
    const revealsTrack = state.tracks.find((t) => t.id === 'reveals');
    expect(revealsTrack).toBeDefined();
    const revealItem = state.items[revealsTrack?.items[0] ?? ''] as Record<
      string,
      unknown
    >;
    expect(revealItem.type).toBe('full-screen-reveal');
    expect(revealItem.label).toBe('AFTER');

    // Has overlays track with pip-overlay
    const overlaysTrack = state.tracks.find((t) => t.id === 'overlays');
    expect(overlaysTrack).toBeDefined();
    const pipItem = state.items[overlaysTrack?.items[0] ?? ''] as Record<
      string,
      unknown
    >;
    expect(pipItem.type).toBe('pip-overlay');
    expect(pipItem.label).toBe('BEFORE');

    // Has text track with text-interstitial
    const textTrack = state.tracks.find((t) => t.id === 'text');
    expect(textTrack).toBeDefined();
    const interstitialItem = (textTrack?.items ?? [])
      .map((id) => state.items[id])
      .find((item) => item.type === 'text-interstitial') as Record<
      string,
      unknown
    >;
    expect(interstitialItem).toBeDefined();
    expect(interstitialItem.text).toBe('CLIENT RESULTS COMING NOW');
  });

  // ------------------------------------------------------------------
  // music → music item in audio track
  // ------------------------------------------------------------------

  it('music → music item in audio track', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      musicTrackId: 'track-1',
      musicUrl: 'https://cdn.example.com/music.mp3',
      musicVolume: 0.1,
    });
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    const audioTrack = state.tracks.find((t) => t.id === 'audio');
    expect(audioTrack).toBeDefined();
    const musicItem = (audioTrack?.items ?? [])
      .map((id) => state.items[id])
      .find((item) => item.type === 'music') as Record<string, unknown>;
    expect(musicItem).toBeDefined();
    expect(musicItem.volume).toBe(0.1);
    expect(musicItem.durationInFrames).toBe(300);

    // Music asset should exist
    const musicAssetId = musicItem.assetId as string;
    expect(state.assets[musicAssetId]).toBeDefined();
    expect(state.assets[musicAssetId].type).toBe('audio');
    expect(state.assets[musicAssetId].src).toBe(
      'https://cdn.example.com/music.mp3'
    );
  });

  // ------------------------------------------------------------------
  // captions → tiktok-captions item
  // ------------------------------------------------------------------

  it('captions → tiktok-captions item', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig();
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    const captionsTrack = state.tracks.find((t) => t.id === 'captions');
    expect(captionsTrack).toBeDefined();
    expect(captionsTrack?.items).toHaveLength(1);

    const captionItem = state.items[captionsTrack?.items[0] ?? ''] as Record<
      string,
      unknown
    >;
    expect(captionItem.type).toBe('tiktok-captions');
    expect(captionItem.from).toBe(0);
    expect(captionItem.durationInFrames).toBe(300);

    const pages = captionItem.pages as CaptionPage[];
    expect(pages).toHaveLength(1);
    expect(pages[0].words).toHaveLength(2);
  });

  // ------------------------------------------------------------------
  // outro → outro-layout item at end
  // ------------------------------------------------------------------

  it('outro → outro-layout item at end', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      outro: {
        businessName: 'Test Biz',
        ctaText: 'Call Now',
        durationSec: 3,
        backgroundOpacity: 0.8,
        backgroundColor: '#000',
        textColor: '#FFF',
      },
    });
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    const outroTrack = state.tracks.find((t) => t.id === 'outro');
    expect(outroTrack).toBeDefined();
    expect(outroTrack?.items).toHaveLength(1);

    const outroItem = state.items[outroTrack?.items[0] ?? ''] as Record<
      string,
      unknown
    >;
    expect(outroItem.type).toBe('outro-layout');
    const outroDuration = 3 * 30; // 3s * 30fps = 90 frames
    expect(outroItem.durationInFrames).toBe(outroDuration);
    expect(outroItem.from).toBe(300 - outroDuration); // totalDuration - outroDuration
  });

  // ------------------------------------------------------------------
  // empty b-roll → no b-roll track
  // ------------------------------------------------------------------

  it('empty b-roll → no b-roll track', async () => {
    vi.mocked(scheduledClipsToScenes).mockReturnValue([]);

    const ctx = createMockCtx();
    const draft = createBaseDraftConfig();
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    const bRollTrack = state.tracks.find((t) => t.id === 'b-roll');
    expect(bRollTrack).toBeUndefined();

    // talking head should still be present with no hidden ranges
    const baseTrack = state.tracks.find((t) => t.id === 'base-video');
    const thItem = state.items[baseTrack?.items[0] ?? ''] as Record<
      string,
      unknown
    >;
    const hiddenRanges = thItem.hiddenRanges as unknown[];
    expect(hiddenRanges).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // assembler produces valid EditorState
  // ------------------------------------------------------------------

  it('assembler produces valid EditorState — all item refs valid', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      musicTrackId: 'track-1',
      musicUrl: 'https://cdn.example.com/music.mp3',
    });
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    // Every track's item IDs exist in items map
    for (const track of state.tracks) {
      for (const itemId of track.items) {
        expect(state.items[itemId]).toBeDefined();
        expect(state.items[itemId].trackId).toBe(track.id);
      }
    }

    // Every item with an assetId references a valid asset
    for (const item of Object.values(state.items)) {
      const assetId = (item as Record<string, unknown>).assetId;
      if (typeof assetId === 'string') {
        expect(state.assets[assetId]).toBeDefined();
      }
    }
  });

  // ------------------------------------------------------------------
  // validation: no narrationType → throws
  // ------------------------------------------------------------------

  it('validation: no narrationType → throws', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: undefined,
    });
    const options = createBaseOptions();

    await expect(
      buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options)
    ).rejects.toThrow('narrationType is not set');
  });

  // ------------------------------------------------------------------
  // validation: text_only without content → throws
  // ------------------------------------------------------------------

  it('validation: text_only without text frames or offer card → throws', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: 'text_only',
      talkingHeadUrl: null,
      textFrames: [],
      offerCard: undefined,
    });
    const options = createBaseOptions({
      narration: {
        audioPath: null,
        audioDurationSec: 5,
        parsedTextFrames: [],
      },
    });

    await expect(
      buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options)
    ).rejects.toThrow('requires at least one text frame or an offer card');
  });

  // ------------------------------------------------------------------
  // validation: text_only without b-roll → throws
  // ------------------------------------------------------------------

  it('validation: text_only without b-roll → throws', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: 'text_only',
      talkingHeadUrl: null,
      bRollClips: [],
      textFrames: [
        { id: 'tf-1', text: 'Hello', durationSec: 3, style: 'default' },
      ],
    });
    const options = createBaseOptions({
      narration: {
        audioPath: null,
        audioDurationSec: 3,
        parsedTextFrames: [
          { id: 'tf-1', text: 'Hello', durationSec: 3, style: 'default' },
        ],
      },
    });

    await expect(
      buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options)
    ).rejects.toThrow('text_only mode requires at least one b-roll clip');
  });

  // ------------------------------------------------------------------
  // validation: AI voiceover without scriptText → throws
  // ------------------------------------------------------------------

  it('validation: AI voiceover without scriptText → throws', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: 'ai_voiceover',
      scriptText: undefined,
      aiVoiceId: 'voice-1',
      talkingHeadUrl: null,
    });
    const options = createBaseOptions();

    await expect(
      buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options)
    ).rejects.toThrow('AI voiceover requires scriptText');
  });

  // ------------------------------------------------------------------
  // validation: recorded without talkingHeadUrl → throws
  // ------------------------------------------------------------------

  it('validation: recorded without talkingHeadUrl → throws', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      narrationType: 'recorded',
      talkingHeadUrl: null,
    });
    const options = createBaseOptions();

    await expect(
      buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options)
    ).rejects.toThrow('Recorded narration requires a talkingHeadUrl');
  });

  // ------------------------------------------------------------------
  // captions disabled → no captions track
  // ------------------------------------------------------------------

  it('captions disabled → no captions track', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({
      captions: {
        enabled: false,
        position: 'center',
        fontFamily: 'Inter',
        fontSize: 64,
        textColor: '#FFFFFF',
        highlightColor: '#FFFFFF',
        backgroundColor: 'transparent',
        showBackground: false,
      },
    });
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    const captionsTrack = state.tracks.find((t) => t.id === 'captions');
    expect(captionsTrack).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // landscape orientation → correct dimensions
  // ------------------------------------------------------------------

  it('landscape orientation → correct dimensions', async () => {
    const ctx = createMockCtx();
    const draft = createBaseDraftConfig({ orientation: 'landscape' });
    const options = createBaseOptions();

    const state = await buildEditorState(ctx, draft, ORG_ID, VIDEO_ID, options);

    expect(state.compositionWidth).toBe(1920);
    expect(state.compositionHeight).toBe(1080);
    expect(state.orientation).toBe('landscape');
  });
});
