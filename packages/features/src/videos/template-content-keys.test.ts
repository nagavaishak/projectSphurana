import { describe, expect, it } from '@borradh-workspace/testing';
import {
  VARIATION_CONTENT_KEY,
  describeIneffectivePatch,
} from './template-content-keys.js';

describe('describeIneffectivePatch', () => {
  // The real one. A myth-fact video renders from `mythFact.pairs` and only
  // reads `scriptText` for AI voiceover, so patching `scriptText` on a
  // text-only myth-fact video persisted, spent a render, and moved nothing on
  // screen.
  it('catches scriptText patched onto a text-only myth-fact video', () => {
    const report = describeIneffectivePatch({
      variationId: 'myth-fact-1',
      narrationType: 'text_only',
      patchKeys: ['scriptText'],
    });

    expect(report).not.toBeNull();
    expect(report?.ignoredKeys).toEqual(['scriptText']);
    expect(report?.suggestedKey).toBe('mythFact');
  });

  it('allows scriptText when the video is actually narrated from it', () => {
    expect(
      describeIneffectivePatch({
        variationId: 'myth-fact-1',
        narrationType: 'ai_voiceover',
        patchKeys: ['scriptText'],
      })
    ).toBeNull();
  });

  it('allows the template its own content key', () => {
    expect(
      describeIneffectivePatch({
        variationId: 'myth-fact-1',
        narrationType: 'text_only',
        patchKeys: ['mythFact'],
      })
    ).toBeNull();
  });

  it('catches another template’s content key', () => {
    const report = describeIneffectivePatch({
      variationId: 'myth-fact-1',
      narrationType: 'text_only',
      patchKeys: ['poll'],
    });
    expect(report?.ignoredKeys).toEqual(['poll']);
    expect(report?.suggestedKey).toBe('mythFact');
  });

  it('allows universal keys on any template', () => {
    for (const key of ['bRollClips', 'captions', 'musicVolume', 'outro']) {
      expect(
        describeIneffectivePatch({
          variationId: 'myth-fact-1',
          narrationType: 'text_only',
          patchKeys: [key],
        })
      ).toBeNull();
    }
  });

  // A mixed patch got what it asked for. Refusing it would break a client on
  // older code that sends a field this template happens to have dropped.
  it('does not flag a patch that also changes something real', () => {
    expect(
      describeIneffectivePatch({
        variationId: 'myth-fact-1',
        narrationType: 'text_only',
        patchKeys: ['scriptText', 'mythFact'],
      })
    ).toBeNull();
  });

  it('says nothing about an empty patch', () => {
    expect(
      describeIneffectivePatch({
        variationId: 'myth-fact-1',
        narrationType: 'text_only',
        patchKeys: [],
      })
    ).toBeNull();
  });

  // Refusing a patch because a template forgot to register would be worse than
  // the no-op the guard exists to prevent.
  it('gives an unmapped variation the benefit of the doubt', () => {
    expect(
      describeIneffectivePatch({
        variationId: 'brand-new-template-1',
        narrationType: 'text_only',
        patchKeys: ['scriptText'],
      })
    ).toBeNull();
  });

  it('says nothing when the video has no variation at all', () => {
    expect(
      describeIneffectivePatch({
        variationId: null,
        narrationType: 'text_only',
        patchKeys: ['scriptText'],
      })
    ).toBeNull();
  });

  // The map this replaced held 7 of the 17 organic variations, myth-fact-1
  // among the missing — which is why the batch path could not edit that
  // template's copy either.
  it('covers every organic variation', () => {
    const VARIATIONS = [
      'caption-tease-1',
      'fade-benefits-1',
      'aesthetic-line-1',
      'numbered-list-1',
      'ins-outs-1',
      'question-cta-1',
      'improves-1',
      'highlight-caption-1',
      'curiosity-hook-1',
      'step-timer-1',
      'time-progress-1',
      'poll-1',
      'myth-fact-1',
      'versus-1',
      'price-reveal-1',
      'client-question-1',
      'come-with-me-1',
    ];
    const missing = VARIATIONS.filter((v) => !VARIATION_CONTENT_KEY[v]);
    expect(missing).toEqual([]);
  });
});
