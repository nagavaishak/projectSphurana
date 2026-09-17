import { describe, expect, it } from '@borradh-workspace/testing';
import { isDraftConfigComplete } from './queue-video-export.service.js';

// Minimal valid pieces reused across cases.
const captions = {
  enabled: true,
  position: 'bottom' as const,
  fontFamily: 'Inter',
  fontSize: 64,
  textColor: '#FFFFFF',
  highlightColor: '#39E508',
  backgroundColor: '#000000',
  showBackground: false,
};

const base = {
  orientation: 'portrait' as const,
  captions,
  musicVolume: 0.5,
  bRollClips: [{ assetId: 'asset_1', url: '', order: 0 }],
};

describe('isDraftConfigComplete — text_only (ENG-379 / ENG-321 upstream guard)', () => {
  it('accepts a text_only config with b-roll and text frames', () => {
    const error = isDraftConfigComplete({
      ...base,
      narrationType: 'text_only',
      textFrames: [{ text: 'Hello' }],
    } as never);
    expect(error).toBeNull();
  });

  it('rejects text_only with no b-roll clips', () => {
    const error = isDraftConfigComplete({
      ...base,
      bRollClips: [],
      narrationType: 'text_only',
      textFrames: [{ text: 'Hello' }],
    } as never);
    expect(error).toMatch(/b-roll clip/i);
  });

  it('rejects text_only with neither text frames nor offer card', () => {
    const error = isDraftConfigComplete({
      ...base,
      narrationType: 'text_only',
    } as never);
    expect(error).toMatch(/text frames, an offer card, or organic/i);
  });

  it('accepts text_only with an offer card and no text frames', () => {
    const error = isDraftConfigComplete({
      ...base,
      narrationType: 'text_only',
      offerCard: { headline: 'Deal' },
    } as never);
    expect(error).toBeNull();
  });

  it('accepts text_only with an organic config block (no text frames)', () => {
    const error = isDraftConfigComplete(
      {
        ...base,
        narrationType: 'text_only',
        fadeBenefits: { lines: ['One', 'Two'] },
      } as never,
      'fade-benefits-1'
    );
    expect(error).toBeNull();
  });

  // The deployed v1 worker (`buildVideoConfig`) has NO before-after / educational
  // exemption — it requires text frames, an offer card, or an organic config for
  // every text_only draft. The enqueue gate must match it, otherwise a content-
  // less before-after / educational draft passes here and then throws on every
  // render retry (PostHog issue 019ed0cc).
  it('rejects content-less before-after text_only drafts (matches the worker)', () => {
    const error = isDraftConfigComplete(
      { ...base, narrationType: 'text_only' } as never,
      'before-after-variation1'
    );
    expect(error).toMatch(/text frames, an offer card, or organic/i);
  });

  it('rejects content-less educational text_only drafts (matches the worker)', () => {
    const error = isDraftConfigComplete(
      { ...base, narrationType: 'text_only' } as never,
      'educational-explainer'
    );
    expect(error).toMatch(/text frames, an offer card, or organic/i);
  });

  it('accepts a before-after text_only draft once it has text frames', () => {
    const error = isDraftConfigComplete(
      {
        ...base,
        narrationType: 'text_only',
        textFrames: [{ text: 'Before' }, { text: 'After' }],
      } as never,
      'before-after-variation1'
    );
    expect(error).toBeNull();
  });

  it('still requires b-roll even for before-after variations', () => {
    const error = isDraftConfigComplete(
      { ...base, bRollClips: [], narrationType: 'text_only' } as never,
      'before-after-variation1'
    );
    expect(error).toMatch(/b-roll clip/i);
  });
});

describe('isDraftConfigComplete — AI voiceover', () => {
  it('rejects AI voiceover with no b-roll', () => {
    const error = isDraftConfigComplete(
      {
        ...base,
        bRollClips: [],
        narrationType: 'ai_voiceover',
        aiVoiceId: 'voice_1',
        scriptText: 'Authority script',
      } as never,
      'authority-2'
    );
    expect(error).toMatch(/b-roll clip/i);
  });
});
