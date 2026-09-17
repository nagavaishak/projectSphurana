import { describe, expect, it } from '@borradh-workspace/testing';
import type { GeneratedOfferCopy } from '../../../ai-content/services/generate-offer-copy/generate-offer-copy.schema.js';
import { buildOfferCardBlock } from './offer-card-block.js';

const baseCopy: GeneratedOfferCopy = {
  headline: 'Glow this season',
  ctaText: 'Book now',
  urgencyText: 'Ends Sunday',
  audienceText: 'New clients',
  bulletPoints: ['Quick visit', 'Natural look'],
};

describe('buildOfferCardBlock', () => {
  it('maps copy, pricing and brand into a renderable offerCard', () => {
    const { offerCard } = buildOfferCardBlock({
      copy: baseCopy,
      pricing: {
        originalPriceCents: 20000,
        offerPriceCents: 15000,
        discountPercent: 25,
      },
      serviceName: 'Lip Filler',
      brand: {
        primaryColor: '#111111',
        secondaryColor: '#EEEEEE',
        logoUrl: 'https://cdn/logo.png',
      },
      businessName: 'Glow Clinic',
      currencyCode: 'GBP',
    });

    expect(offerCard).toMatchObject({
      serviceName: 'Lip Filler',
      headline: 'Glow this season',
      originalPriceCents: 20000,
      offerPriceCents: 15000,
      discountPercent: 25,
      bulletPoints: ['Quick visit', 'Natural look'],
      ctaText: 'Book now',
      urgencyText: 'Ends Sunday',
      audienceText: 'New clients',
      logoUrl: 'https://cdn/logo.png',
      businessName: 'Glow Clinic',
      primaryColor: '#111111',
      secondaryColor: '#EEEEEE',
      currencyCode: 'GBP',
    });
  });

  it('falls back to copy.headline for serviceName when none supplied', () => {
    const { offerCard } = buildOfferCardBlock({
      copy: baseCopy,
      pricing: {},
    });
    expect(offerCard.serviceName).toBe('Glow this season');
  });

  it('applies default brand colours when the org has none', () => {
    const { offerCard } = buildOfferCardBlock({
      copy: baseCopy,
      pricing: {},
      brand: { primaryColor: null, secondaryColor: null, logoUrl: null },
    });
    expect(offerCard.primaryColor).toBe('#007AFF');
    expect(offerCard.secondaryColor).toBe('#FFFFFF');
    expect(offerCard.logoUrl).toBeUndefined();
  });

  it('coerces null pricing fields to absent (never leaks null to the renderer)', () => {
    const { offerCard } = buildOfferCardBlock({
      copy: baseCopy,
      pricing: {
        originalPriceCents: null,
        offerPriceCents: null,
        discountPercent: null,
      },
    });
    expect(offerCard).not.toHaveProperty('originalPriceCents');
    expect(offerCard).not.toHaveProperty('offerPriceCents');
    expect(offerCard).not.toHaveProperty('discountPercent');
  });

  it('drops empty urgency/audience strings rather than rendering blanks', () => {
    const { offerCard } = buildOfferCardBlock({
      copy: { ...baseCopy, urgencyText: '', audienceText: '   ' },
      pricing: {},
    });
    expect(offerCard).not.toHaveProperty('urgencyText');
    expect(offerCard).not.toHaveProperty('audienceText');
  });

  it('defaults a blank ctaText to "Book now"', () => {
    const { offerCard } = buildOfferCardBlock({
      copy: { ...baseCopy, ctaText: '' },
      pricing: {},
    });
    expect(offerCard.ctaText).toBe('Book now');
  });
});
