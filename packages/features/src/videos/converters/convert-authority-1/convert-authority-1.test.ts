import type { VideoDraftConfig } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import { templateDocSchema } from '@borradh-workspace/video-templates';

import { convertAuthority1 } from './convert-authority-1.service.js';

// A representative v1 authority-1 draftConfig fixture. Mirrors the shape a
// recorded talking-head authority video would carry: a talking head asset,
// procedure + environment + before/after b-roll, music, and an outro card
// with brand colours + logo + business name.
function fixtureDraftConfig(): VideoDraftConfig {
  return {
    scriptText:
      "Hi, I'm Dr. Jane from Cosmetic Clinic.\nOne of the most common reasons people come to us for teeth whitening is...",
    narrationType: 'recorded',
    talkingHeadAssetId: 'asset-talking-head-1',
    talkingHeadUrl: 'https://cdn.example.com/talking-head.mp4',
    bRollClips: [
      { assetId: 'asset-procedure-1', order: 1, clipType: 'bRoll' },
      { assetId: 'asset-environment-1', order: 2, clipType: 'bRoll' },
      { assetId: 'asset-before-1', order: 3, clipType: 'before' },
    ],
    captions: {
      enabled: true,
      position: 'bottom',
      fontFamily: 'Inter',
      fontSize: 48,
      textColor: '#FFFFFF',
      highlightColor: '#00FF00',
      backgroundColor: '#000000',
      showBackground: true,
    },
    musicTrackId: 'tea-pop',
    musicUrl: 'https://cdn.example.com/audio/tea-pop.mp3',
    musicVolume: 0.4,
    outro: {
      logoUrl: 'https://cdn.example.com/logo.png',
      businessName: 'Cosmetic Clinic',
      ctaText: 'Book a consultation',
      backgroundOpacity: 0.9,
      backgroundColor: '#0066FF',
      textColor: '#FFFFFF',
      durationSec: 3,
    },
    orientation: 'portrait',
  };
}

describe('convertAuthority1', () => {
  it('returns a TemplateDoc that parses against templateDocSchema', () => {
    const result = convertAuthority1(fixtureDraftConfig());
    const parsed = templateDocSchema.safeParse(result.templateDoc);
    if (!parsed.success) {
      throw new Error(
        `templateDocSchema rejected converted authority-1: ${JSON.stringify(
          parsed.error.issues,
          null,
          2
        )}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("returns templateId === 'authority-1'", () => {
    const result = convertAuthority1(fixtureDraftConfig());
    expect(result.templateId).toBe('authority-1');
  });

  it('extracts primary colour from outro.backgroundColor', () => {
    const result = convertAuthority1(fixtureDraftConfig());
    expect(result.brandFieldsForTheme.colors?.primary).toBe('#0066FF');
  });

  it('extracts onPrimary colour from outro.textColor', () => {
    const result = convertAuthority1(fixtureDraftConfig());
    expect(result.brandFieldsForTheme.colors?.onPrimary).toBe('#FFFFFF');
  });

  it('extracts logo URL from outro.logoUrl as the light logo variant', () => {
    const result = convertAuthority1(fixtureDraftConfig());
    expect(result.brandFieldsForTheme.logo?.light).toBe(
      'https://cdn.example.com/logo.png'
    );
  });

  it('extracts business name and CTA text into identity', () => {
    const result = convertAuthority1(fixtureDraftConfig());
    expect(result.brandFieldsForTheme.identity?.businessName).toBe(
      'Cosmetic Clinic'
    );
    expect(result.brandFieldsForTheme.identity?.ctaText).toBe(
      'Book a consultation'
    );
  });

  it('has exactly one spine media-track block with id base-clip', () => {
    const result = convertAuthority1(fixtureDraftConfig());
    expect(result.templateDoc.root.kind).toBe('leaf');
    if (result.templateDoc.root.kind !== 'leaf') return;
    expect(result.templateDoc.root.spine).toHaveLength(1);
    expect(result.templateDoc.root.spine[0]?.kind).toBe('media-track');
    expect(result.templateDoc.root.spine[0]?.id).toBe('base-clip');
  });

  it('lifts narration audio from the spine clip', () => {
    const result = convertAuthority1(fixtureDraftConfig());
    expect(result.templateDoc.globals.audio.narration).toEqual({
      source: 'clip',
      clipRef: 'base-clip',
    });
  });

  it('skips brand fields when v1 outro values are missing', () => {
    const config: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      outro: {
        businessName: '',
        ctaText: '',
        backgroundOpacity: 0.9,
        backgroundColor: 'not-a-color',
        textColor: '',
        durationSec: 3,
      },
    };
    const result = convertAuthority1(config);
    expect(result.brandFieldsForTheme.colors).toBeUndefined();
    expect(result.brandFieldsForTheme.identity).toBeUndefined();
    expect(result.brandFieldsForTheme.logo).toBeUndefined();
  });
});
