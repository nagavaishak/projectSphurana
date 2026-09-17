import type { VideoDraftConfig } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import { templateDocSchema } from '@borradh-workspace/video-templates';

import { convertOfferSquare } from './convert-offer-square.service.js';

// A representative v1 offer-square-1 offerCard. Lives standalone so tests
// that mutate one field can spread it without a non-null assertion on
// `fixtureDraftConfig().offerCard` (biome's no-non-null-assertion rule).
function fixtureOfferCard() {
  return {
    serviceName: 'Teeth Whitening',
    headline: 'WHITER TEETH IN 60 MINUTES',
    originalPriceCents: 35000,
    offerPriceCents: 15500,
    discountPercent: 50,
    bulletPoints: [
      'In-clinic, FDA-approved',
      'No sensitivity',
      'Visible results in one session',
    ],
    ctaText: 'Book your slot',
    urgencyText: 'Only 5 slots left',
    logoUrl: 'https://cdn.example.com/logo.png',
    businessName: 'Cosmetic Clinic',
    primaryColor: '#0066FF',
    secondaryColor: '#FFCC00',
    currencyCode: 'EUR',
  } satisfies NonNullable<VideoDraftConfig['offerCard']>;
}

// A representative v1 offer-square-1 draftConfig fixture. offer-square-1 has
// no talking-head leg (narrationMode: 'text_only') — the procedure footage on
// the left pane plus the offer card on the right pane carry the video.
function fixtureDraftConfig(): VideoDraftConfig {
  return {
    narrationType: 'text_only',
    // Even though v1 stored these on the row, the offer-square render path
    // ignored them (no talking head). They're here so the fixture mirrors a
    // real DB row shape.
    talkingHeadAssetId: null,
    talkingHeadUrl: null,
    bRollClips: [
      { assetId: 'asset-procedure-1', order: 1, clipType: 'bRoll' },
      { assetId: 'asset-procedure-2', order: 2, clipType: 'bRoll' },
      { assetId: 'asset-procedure-3', order: 3, clipType: 'bRoll' },
    ],
    captions: {
      enabled: false,
      position: 'bottom',
      fontFamily: 'Inter',
      fontSize: 48,
      textColor: '#FFFFFF',
      highlightColor: '#00FF00',
      backgroundColor: '#000000',
      showBackground: false,
    },
    musicTrackId: 'tea-pop',
    musicUrl: 'https://cdn.example.com/audio/tea-pop.mp3',
    musicVolume: 0.6,
    // No outro on offer-square — the offer card IS the closing frame. v1
    // still required the outro object to exist on the draftConfig type so we
    // pass through empty-ish values; the converter ignores them.
    outro: {
      businessName: '',
      ctaText: '',
      backgroundOpacity: 1,
      backgroundColor: '',
      textColor: '',
      durationSec: 0,
    },
    orientation: 'square',
    offerCard: fixtureOfferCard(),
  };
}

describe('convertOfferSquare', () => {
  it('returns a TemplateDoc that parses against templateDocSchema', () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    const parsed = templateDocSchema.safeParse(result.templateDoc);
    if (!parsed.success) {
      throw new Error(
        `templateDocSchema rejected converted offer-square-1: ${JSON.stringify(
          parsed.error.issues,
          null,
          2
        )}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it("returns templateId === 'offer-square-1'", () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    expect(result.templateId).toBe('offer-square-1');
  });

  it('has a split root region (Shape E invariant — exercises §4 recursion)', () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    expect(result.templateDoc.root.kind).toBe('split');
  });

  it('extracts primary + secondary colours from offerCard', () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    expect(result.brandFieldsForTheme.colors?.primary).toBe('#0066FF');
    expect(result.brandFieldsForTheme.colors?.secondary).toBe('#FFCC00');
  });

  it('extracts logo URL as the light logo variant', () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    expect(result.brandFieldsForTheme.logo?.light).toBe(
      'https://cdn.example.com/logo.png'
    );
  });

  it('extracts business name + CTA text into identity', () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    expect(result.brandFieldsForTheme.identity?.businessName).toBe(
      'Cosmetic Clinic'
    );
    expect(result.brandFieldsForTheme.identity?.ctaText).toBe('Book your slot');
  });

  it('promotes a 3-char ISO 4217 currencyCode to Theme.identity.currency', () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    expect(result.brandFieldsForTheme.identity?.currency).toBe('EUR');
  });

  it('passes headline + items + cta through as frozenOfferContent', () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    expect(result.frozenOfferContent?.headline).toBe(
      'WHITER TEETH IN 60 MINUTES'
    );
    expect(result.frozenOfferContent?.items).toEqual([
      'In-clinic, FDA-approved',
      'No sensitivity',
      'Visible results in one session',
    ]);
    expect(result.frozenOfferContent?.cta).toBe('Book your slot');
  });

  it('formats offerPriceCents as a 2-decimal string in frozenOfferContent.price', () => {
    const result = convertOfferSquare(fixtureDraftConfig());
    expect(result.frozenOfferContent?.price).toBe('155.00');
    expect(result.frozenOfferContent?.currency).toBe('EUR');
  });

  it('returns undefined frozenOfferContent when no offerCard is set', () => {
    const config: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      offerCard: undefined,
    };
    const result = convertOfferSquare(config);
    expect(result.frozenOfferContent).toBeUndefined();
    // Brand fields also fall away when there's no offerCard.
    expect(result.brandFieldsForTheme.colors).toBeUndefined();
    expect(result.brandFieldsForTheme.logo).toBeUndefined();
    expect(result.brandFieldsForTheme.identity).toBeUndefined();
  });

  it('skips a malformed currencyCode rather than corrupting Theme.identity', () => {
    const config: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      offerCard: {
        ...fixtureOfferCard(),
        currencyCode: 'not-a-currency',
      },
    };
    const result = convertOfferSquare(config);
    // identity.currency falls through to the brand_kit / engineDefaultTheme;
    // identity itself still exists because businessName/ctaText were valid.
    expect(result.brandFieldsForTheme.identity?.currency).toBeUndefined();
    // …but the per-video frozenOfferContent.currency keeps the raw v1 value
    // so the compiler can still render whatever symbol the original video
    // used. Lossless replay over strict typing on the brand side.
    expect(result.frozenOfferContent?.currency).toBe('not-a-currency');
  });

  it('skips price when offerPriceCents is missing', () => {
    const config: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      offerCard: {
        ...fixtureOfferCard(),
        offerPriceCents: undefined,
      },
    };
    const result = convertOfferSquare(config);
    expect(result.frozenOfferContent?.price).toBeUndefined();
    // Other fields still come through.
    expect(result.frozenOfferContent?.headline).toBe(
      'WHITER TEETH IN 60 MINUTES'
    );
  });

  it('skips colour fields when the v1 hex string is invalid', () => {
    const config: VideoDraftConfig = {
      ...fixtureDraftConfig(),
      offerCard: {
        ...fixtureOfferCard(),
        primaryColor: 'not-a-color',
        secondaryColor: 'also-broken',
      },
    };
    const result = convertOfferSquare(config);
    expect(result.brandFieldsForTheme.colors).toBeUndefined();
  });
});
