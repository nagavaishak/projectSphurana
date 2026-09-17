import { describe, expect, it } from 'vitest';
import { deriveOutcomeTitle } from './render-copy.js';

describe('deriveOutcomeTitle (A3 — rename by outcome)', () => {
  it('renames a generic facial by what it solves', () => {
    const title = deriveOutcomeTitle({ name: 'Signature Facial' });
    expect(title).not.toBe('Signature Facial');
    expect(title.toLowerCase()).toContain('facial');
    expect(title).toBe('Brighten & Clear Facial');
  });

  it('uses a problem-specific title when the facial name signals a concern', () => {
    expect(deriveOutcomeTitle({ name: 'Acne Deep Cleanse Facial' })).toBe(
      'Clear-Skin Facial'
    );
    expect(deriveOutcomeTitle({ name: 'Anti-Ageing Facial' })).toBe(
      'Anti-Ageing Facial'
    );
  });

  it('titles other treatments by outcome too', () => {
    expect(deriveOutcomeTitle({ name: 'Microneedling' })).toBe(
      'Skin-Renewal Microneedling'
    );
    expect(deriveOutcomeTitle({ name: 'Head Spa' })).toBe('De-Stress Head Spa');
  });

  it('falls back to the literal name for unrecognised treatments', () => {
    expect(deriveOutcomeTitle({ name: 'Bespoke Wellness Pod' })).toBe(
      'Bespoke Wellness Pod'
    );
  });
});
