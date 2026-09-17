import type { VideoDraftConfig } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import { templateDocSchema } from '@borradh-workspace/video-templates';

import { convertBeforeAfter } from './convert-before-after.service.js';
import type { BeforeAfterVariationId } from './convert-before-after.service.js';

// Representative v1 before-after draftConfig. before-after templates always
// ran in `text_only` narration mode (no talking head, no AI voice) — the
// reveal IS the message. Brand fields land on the outro card.
function fixtureDraftConfig(): VideoDraftConfig {
  return {
    scriptText:
      "Check out this transformation. Here's where we started... and here's the result.",
    narrationType: 'text_only',
    talkingHeadAssetId: null,
    talkingHeadUrl: null,
    bRollClips: [
      { assetId: 'asset-before-1', order: 1, clipType: 'before' },
      { assetId: 'asset-procedure-1', order: 2, clipType: 'bRoll' },
      { assetId: 'asset-after-1', order: 3, clipType: 'after' },
    ],
    captions: {
      enabled: false,
      position: 'bottom',
      fontFamily: 'Inter',
      fontSize: 48,
      textColor: '#FFFFFF',
      highlightColor: '#FFD700',
      backgroundColor: '#000000',
      showBackground: false,
    },
    musicTrackId: 'epic-pop',
    musicUrl: 'https://cdn.example.com/audio/epic-pop.mp3',
    musicVolume: 0.5,
    outro: {
      logoUrl: 'https://cdn.example.com/logo.png',
      businessName: 'Glow Clinic',
      ctaText: 'Book now',
      backgroundOpacity: 0.9,
      backgroundColor: '#FF3366',
      textColor: '#FFFFFF',
      durationSec: 3,
    },
    orientation: 'portrait',
    pipOverlays: [
      {
        imageUrl: 'https://cdn.example.com/before.jpg',
        label: 'BEFORE',
        position: 'top-right',
        startSec: 0,
        durationSec: 3,
      },
    ],
  };
}

const ALL_VARIATIONS: BeforeAfterVariationId[] = [
  'before-after-1',
  'before-after-2',
  'before-after-3',
];

describe('convertBeforeAfter', () => {
  describe.each(ALL_VARIATIONS)('variation %s', (variationId) => {
    it('returns a TemplateDoc that parses against templateDocSchema', () => {
      const result = convertBeforeAfter(variationId, fixtureDraftConfig());
      const parsed = templateDocSchema.safeParse(result.templateDoc);
      if (!parsed.success) {
        throw new Error(
          `templateDocSchema rejected converted ${variationId}: ${JSON.stringify(
            parsed.error.issues,
            null,
            2
          )}`
        );
      }
      expect(parsed.success).toBe(true);
    });

    it('returns templateId equal to the variationId', () => {
      const result = convertBeforeAfter(variationId, fixtureDraftConfig());
      expect(result.templateId).toBe(variationId);
    });

    it('extracts primary + onPrimary colours from outro', () => {
      const result = convertBeforeAfter(variationId, fixtureDraftConfig());
      expect(result.brandFieldsForTheme.colors?.primary).toBe('#FF3366');
      expect(result.brandFieldsForTheme.colors?.onPrimary).toBe('#FFFFFF');
    });

    it('extracts logo URL as the light variant', () => {
      const result = convertBeforeAfter(variationId, fixtureDraftConfig());
      expect(result.brandFieldsForTheme.logo?.light).toBe(
        'https://cdn.example.com/logo.png'
      );
    });

    it('extracts business name and CTA into identity', () => {
      const result = convertBeforeAfter(variationId, fixtureDraftConfig());
      expect(result.brandFieldsForTheme.identity?.businessName).toBe(
        'Glow Clinic'
      );
      expect(result.brandFieldsForTheme.identity?.ctaText).toBe('Book now');
    });

    it('pins before/after asset IDs for wave-7 fidelity replay', () => {
      const result = convertBeforeAfter(variationId, fixtureDraftConfig());
      expect(result.themeOverridesForVideo.pinnedAssets).toEqual({
        beforeAssetId: 'asset-before-1',
        afterAssetId: 'asset-after-1',
      });
    });

    it('pins music trackId + volume when v1 had a music pick', () => {
      const result = convertBeforeAfter(variationId, fixtureDraftConfig());
      expect(result.themeOverridesForVideo.pinnedMusic).toEqual({
        trackId: 'epic-pop',
        volume: 0.5,
      });
    });

    it('emits a portrait template (Shape C invariant)', () => {
      const result = convertBeforeAfter(variationId, fixtureDraftConfig());
      expect(result.templateDoc.aspectRatios).toEqual(['portrait']);
    });
  });

  it('routes to the correct TemplateDoc per variationId', () => {
    const cfg = fixtureDraftConfig();
    expect(convertBeforeAfter('before-after-1', cfg).templateDoc.id).toBe(
      'before-after-1'
    );
    expect(convertBeforeAfter('before-after-2', cfg).templateDoc.id).toBe(
      'before-after-2'
    );
    expect(convertBeforeAfter('before-after-3', cfg).templateDoc.id).toBe(
      'before-after-3'
    );
  });

  it('skips pinnedAssets entirely when v1 had no before/after clips', () => {
    const cfg: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      bRollClips: [
        { assetId: 'asset-procedure-1', order: 1, clipType: 'bRoll' },
      ],
    };
    const result = convertBeforeAfter('before-after-1', cfg);
    expect(result.themeOverridesForVideo.pinnedAssets).toBeUndefined();
  });

  it('skips pinnedMusic when v1 had no musicTrackId', () => {
    const cfg: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      musicTrackId: undefined,
    };
    const result = convertBeforeAfter('before-after-1', cfg);
    expect(result.themeOverridesForVideo.pinnedMusic).toBeUndefined();
  });

  it('skips brand fields when v1 outro values are missing', () => {
    const cfg: VideoDraftConfig = {
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
    const result = convertBeforeAfter('before-after-1', cfg);
    expect(result.brandFieldsForTheme.colors).toBeUndefined();
    expect(result.brandFieldsForTheme.identity).toBeUndefined();
    expect(result.brandFieldsForTheme.logo).toBeUndefined();
  });

  it('handles only-before (missing after) and only-after (missing before) cases', () => {
    const onlyBefore: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      bRollClips: [{ assetId: 'asset-before-1', order: 1, clipType: 'before' }],
    };
    const resultBefore = convertBeforeAfter('before-after-2', onlyBefore);
    expect(resultBefore.themeOverridesForVideo.pinnedAssets).toEqual({
      beforeAssetId: 'asset-before-1',
    });

    const onlyAfter: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      bRollClips: [{ assetId: 'asset-after-1', order: 1, clipType: 'after' }],
    };
    const resultAfter = convertBeforeAfter('before-after-3', onlyAfter);
    expect(resultAfter.themeOverridesForVideo.pinnedAssets).toEqual({
      afterAssetId: 'asset-after-1',
    });
  });
});
