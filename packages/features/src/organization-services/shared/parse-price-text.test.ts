import { describe, expect, it } from '@borradh-workspace/testing';
import { parsePriceText } from './parse-price-text.js';

describe('parsePriceText', () => {
  describe('empty / null → poa', () => {
    it.each([null, undefined, '', '   '])('%p → poa', (input) => {
      expect(parsePriceText(input as string | null)).toEqual({
        priceType: 'poa',
        priceCents: null,
      });
    });
  });

  describe('junk / placeholder → poa (never a fabricated number)', () => {
    // Real strings pulled from the prod audit's ~11% junk bucket.
    it.each([
      'Prices Vary',
      'Prices vary by area',
      'Pricing not specifically mentioned.',
      'Pricing depends on the treatment plan',
      'Pricing available on consultation',
      'Price on request',
      'POA',
      'p.o.a',
      'TBC',
      'varies',
      'asdf',
      '?',
      'again?',
      "don't know",
      'n/a',
      'Contact for pricing',
      '5', // bare number < 10 is a count/placeholder, not a price
      '9',
    ])('%p → poa', (input) => {
      const r = parsePriceText(input);
      expect(r.priceType).toBe('poa');
      expect(r.priceCents).toBeNull();
      expect(r.variants).toBeUndefined();
    });
  });

  describe('free → free', () => {
    it.each([
      'Free',
      'free',
      'Complimentary',
      'Free consultation',
      'No charge',
    ])('%p → free', (input) => {
      const r = parsePriceText(input);
      expect(r.priceType).toBe('free');
      expect(r.priceCents).toBeNull();
    });
  });

  describe('one fixed price (~67%)', () => {
    it.each<[string, number]>([
      ['€50.00', 5000],
      ['€50', 5000],
      ['£85', 8500],
      ['$150', 15000],
      ['€12.50', 1250],
      ['£1,425', 142500],
      ['150 euros', 15000],
      ['85 pounds', 8500],
      ['150', 15000], // bare whole-string number ≥10 → fixed
      ['€85 per session', 8500],
      ['£95 — Combines microdermabrasion and facial massaging', 9500],
    ])('%p → fixed %p', (input, cents) => {
      const r = parsePriceText(input);
      expect(r.priceType).toBe('fixed');
      expect(r.priceCents).toBe(cents);
      expect(r.variants).toBeUndefined();
    });
  });

  describe('"from" price (~14%)', () => {
    it.each<[string, number]>([
      ['From £150', 15000],
      ['from €200', 20000],
      ['€150+', 15000],
      ['Prices from £50', 5000],
      ['Starting at $99', 9900],
      ['From £250', 25000],
      // start-verb forms. All real prod price_text (2026-07-17 audit) that were
      // being mis-typed as `fixed` — a floor rendered as a hard price. The
      // start-verb can sit mid-string after a lead-in, so it is not anchored.
      ['Starting from £25 per session', 2500],
      ['Start from £25', 2500],
      ['Prices start from €10. Hot and warm wax used', 1000],
      ['Introductory price starts @ $199', 19900],
      ['Introductory price start at $99', 9900],
      ['Introductory session starts at $150', 15000],
      ['Introductory starts at $399', 39900],
      // "from" after a duration / service-count lead-in. Anchoring `from` to the
      // string start typed these as a hard `fixed` price.
      ['30 mins • 2 services from £29.70', 2970],
      ['3 hr From €250', 25000],
      ['1 hr, 35 mins • 2 services from €90', 9000],
      ['15 mins - 20 mins from €35', 3500],
      ['20 mins from £36.27', 3627],
    ])('%p → from %p', (input, cents) => {
      const r = parsePriceText(input);
      expect(r.priceType).toBe('from');
      expect(r.priceCents).toBe(cents);
    });
  });

  describe('NOISE stripping — really one price', () => {
    it('strips deposit + duration ("$150 with a $25.00 deposit required. Duration: 30 min" → $150)', () => {
      const r = parsePriceText(
        '$150 with a $25.00 deposit required. Duration: 30 min'
      );
      expect(r.priceType).toBe('fixed');
      expect(r.priceCents).toBe(15000);
    });

    it('strips a trailing duration only', () => {
      const r = parsePriceText('£90 (30 mins)');
      expect(r.priceType).toBe('fixed');
      expect(r.priceCents).toBe(9000);
    });

    it('strips "British" so worded pounds parse', () => {
      const r = parsePriceText('150 British pounds');
      expect(r.priceType).toBe('fixed');
      expect(r.priceCents).toBe(15000);
    });

    it('strips a "Save up to 10%" clause', () => {
      const r = parsePriceText('£285 per session. Save up to 10%');
      expect(r.priceType).toBe('fixed');
      expect(r.priceCents).toBe(28500);
    });

    it('deposit-then-price does not become a two-amount variant', () => {
      const r = parsePriceText('Requires a €50 deposit — £200');
      expect(r.priceType).toBe('fixed');
      expect(r.priceCents).toBe(20000);
    });
  });

  describe('genuinely multi-point (~8%) → best-effort variants', () => {
    it('"1 Area £160, 2 Areas £190" → 2 variants, from £160', () => {
      const r = parsePriceText('1 Area £160, 2 Areas £190');
      expect(r.priceType).toBe('from');
      expect(r.priceCents).toBe(16000);
      expect(r.variants).toEqual([
        { name: '1 Area', priceCents: 16000 },
        { name: '2 Areas', priceCents: 19000 },
      ]);
    });

    it('"1 session: £120, 3 sessions: £300" → labelled variants', () => {
      const r = parsePriceText('1 session: £120, 3 sessions: £300');
      expect(r.priceType).toBe('from');
      expect(r.priceCents).toBe(12000);
      expect(r.variants).toEqual([
        { name: '1 session', priceCents: 12000 },
        { name: '3 sessions', priceCents: 30000 },
      ]);
    });

    it('"Deep Detox: £35, Hydra Facial: £65" → named service variants', () => {
      const r = parsePriceText('Deep Detox: £35, Hydra Facial: £65');
      expect(r.priceType).toBe('from');
      expect(r.priceCents).toBe(3500);
      expect(r.variants).toEqual([
        { name: 'Deep Detox', priceCents: 3500 },
        { name: 'Hydra Facial', priceCents: 6500 },
      ]);
    });

    it('multi-point with an UNLABELLED segment ("£55 or £140 for 3") → poa, no fabricated names', () => {
      const r = parsePriceText('£55 or £140 for 3');
      expect(r.priceType).toBe('poa');
      expect(r.priceCents).toBeNull();
      expect(r.variants).toBeUndefined();
    });
  });

  describe('safety — ambiguous never fabricates', () => {
    it('two identical amounts collapse to one fixed price', () => {
      const r = parsePriceText('£50, £50');
      expect(r.priceType).toBe('fixed');
      expect(r.priceCents).toBe(5000);
    });

    it('duplicate variant labels → poa rather than a bad variant set', () => {
      const r = parsePriceText('Area £160, Area £190');
      expect(r.priceType).toBe('poa');
      expect(r.priceCents).toBeNull();
    });
  });
});
