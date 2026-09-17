import { describe, expect, it } from '@borradh-workspace/testing';
import { generateGiftCardCode } from './generate-gift-card-code.js';

describe('generateGiftCardCode', () => {
  it('matches the GC-XXXX-XXXX-XXXX format', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateGiftCardCode()).toMatch(
        /^GC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/
      );
    }
  });

  it('never contains ambiguous characters (O, 0, I, 1, L)', () => {
    for (let i = 0; i < 50; i++) {
      const body = generateGiftCardCode().slice(3);
      expect(body).not.toMatch(/[O0I1L]/);
    }
  });

  it('generates distinct codes', () => {
    const codes = new Set(
      Array.from({ length: 100 }, () => generateGiftCardCode())
    );
    expect(codes.size).toBe(100);
  });
});
